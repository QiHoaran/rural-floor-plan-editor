"""Finite alphabet, unique rational spelling and fail-closed token reader."""

from bisect import bisect_left
from fractions import Fraction
from typing import NoReturn


def fail(message: str) -> NoReturn:
    raise ValueError(f"TOKEN_GRAMMAR_ERROR: {message}")


def uint_tokens(value: int) -> list[str]:
    if value < 0:
        raise ValueError("negative unsigned integer")
    return [f"<DIGIT_{digit}>" for digit in str(value)] + ["<END_INT>"]


def rational_tokens(value: Fraction | int) -> list[str]:
    value = Fraction(value)
    return (
        ["<NEG>" if value < 0 else "<POS>"]
        + uint_tokens(abs(value.numerator))
        + ["<DEN>"]
        + uint_tokens(value.denominator)
    )


def string_tokens(value: str | None) -> list[str]:
    if value is None:
        return ["<NULL>"]
    raw = value.encode("utf-8")
    return ["<STRING>"] + uint_tokens(len(raw)) + [f"<BYTE_{b:02X}>" for b in raw]


def duration_tokens(value: Fraction, bins: tuple[int, ...]) -> list[str]:
    if value < 0:
        raise ValueError("negative duration")
    return (
        ["<DT_BEGIN>", f"<DT_BIN_{bisect_left(bins, value):02d}>"]
        + rational_tokens(value)
        + ["<DT_END>"]
    )


class Reader:
    def __init__(self, tokens: list[str]) -> None:
        self.tokens = tokens
        self.index = 0

    def peek(self) -> str:
        if self.index >= len(self.tokens):
            fail(f"unexpected EOF at {self.index}")
        return self.tokens[self.index]

    def take(self) -> str:
        token = self.peek()
        self.index += 1
        return token

    def expect(self, token: str) -> None:
        actual = self.take()
        if actual != token:
            fail(f"at {self.index - 1}: expected {token}, got {actual}")

    def uint(self) -> int:
        digits: list[str] = []
        while self.peek() != "<END_INT>":
            token = self.take()
            if token not in {f"<DIGIT_{n}>" for n in range(10)}:
                fail("expected decimal digit")
            digits.append(token[7])
            if len(digits) > 32:
                fail("integer exceeds codec safety limit (32 digits)")
        self.expect("<END_INT>")
        if not digits or len(digits) > 1 and digits[0] == "0":
            fail("noncanonical integer spelling")
        return int("".join(digits))

    def rational(self) -> Fraction:
        sign = self.take()
        if sign not in ("<POS>", "<NEG>"):
            fail("missing rational sign")
        numerator = self.uint()
        self.expect("<DEN>")
        denominator = self.uint()
        if not denominator or sign == "<NEG>" and not numerator:
            fail("zero denominator or negative zero")
        value = Fraction(-numerator if sign == "<NEG>" else numerator, denominator)
        if value.denominator != denominator:
            fail("fraction not reduced")
        return value

    def string(self) -> str | None:
        if self.peek() == "<NULL>":
            self.take()
            return None
        self.expect("<STRING>")
        length = self.uint()
        if length > len(self.tokens) - self.index:
            fail("string length exceeds remaining stream")
        raw = bytearray()
        for _ in range(length):
            token = self.take()
            if len(token) != 9 or token[:6] != "<BYTE_" or token[-1] != ">":
                fail("invalid byte")
            try:
                byte = int(token[6:8], 16)
            except ValueError:
                fail("invalid byte digits")
            if token != f"<BYTE_{byte:02X}>":
                fail("noncanonical byte")
            raw.append(byte)
        try:
            return raw.decode("utf-8", errors="strict")
        except UnicodeError:
            fail("invalid UTF-8")

    def duration(self, bins: tuple[int, ...]) -> Fraction:
        self.expect("<DT_BEGIN>")
        coarse = self.take()
        value = self.rational()
        self.expect("<DT_END>")
        if value < 0 or coarse != f"<DT_BIN_{bisect_left(bins, value):02d}>":
            fail("duration/bin mismatch")
        return value

    def finish(self) -> None:
        if self.index != len(self.tokens):
            fail("unconsumed tokens")
