from fractions import Fraction

import pytest


def test_fraction_and_utf8_are_lossless() -> None:
    from embodied.exact import Reader, rational_tokens, string_tokens

    for value in (Fraction(0), Fraction(-1, 2), Fraction(1, 3), Fraction(2516)):
        reader = Reader(rational_tokens(value))
        assert reader.rational() == value
        reader.finish()
    for value in (None, "", "客厅", "living_room"):
        reader = Reader(string_tokens(value))
        assert reader.string() == value
        reader.finish()


@pytest.mark.parametrize(
    "tokens", [["<DIGIT_0>", "<DIGIT_1>", "<END_INT>"], ["<END_INT>"], ["<DIGIT_1>"]]
)
def test_noncanonical_integer_rejected(tokens: list[str]) -> None:
    from embodied.exact import Reader

    with pytest.raises(ValueError, match="TOKEN_GRAMMAR_ERROR"):
        Reader(tokens).uint()


def test_exact_time_and_bin_checked() -> None:
    from embodied.config import Config
    from embodied.exact import Reader, duration_tokens

    config = Config(linear_speed_mm_s=3000)
    assert config.move_time(Fraction(1)) == Fraction(1, 3)
    tokens = duration_tokens(Fraction(2516), config.duration_bins_ms)
    assert tokens[1] == "<DT_BIN_14>"
    assert Reader(tokens).duration(config.duration_bins_ms) == 2516
    tokens[1] = "<DT_BIN_00>"
    with pytest.raises(ValueError, match="TOKEN_GRAMMAR_ERROR"):
        Reader(tokens).duration(config.duration_bins_ms)


def test_config_strict_and_positive() -> None:
    from embodied.config import Config

    with pytest.raises(ValueError):
        Config(linear_speed_mm_s=0)
    with pytest.raises(ValueError):
        Config(duration_bins_ms=(0, 100, 100))
