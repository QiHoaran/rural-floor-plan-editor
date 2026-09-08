"""Atomic publication, recovery, and cross-process locking for conversion outputs."""

from __future__ import annotations

import ctypes
import hashlib
import json
import os
import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path

from .io import _write_json

_PUBLICATION_MARKER = ".conversion_transaction.json"
_PUBLICATION_MARKER_SCHEMA = "rural-model-ready-transaction/1.0.0"


def _paths_overlap(left: Path, right: Path) -> bool:
    left = left.resolve()
    right = right.resolve()
    try:
        left.relative_to(right)
        return True
    except ValueError:
        pass
    try:
        right.relative_to(left)
        return True
    except ValueError:
        return False


def _publish_staging(staging: Path, output_root: Path, *, force: bool) -> None:
    if not output_root.exists():
        os.replace(staging, output_root)
        return
    if not force:
        raise FileExistsError(f"Output already exists: {output_root}")
    backup = output_root.with_name(f".{output_root.name}.backup")
    if backup.exists():
        raise FileExistsError(f"Refusing replacement because backup already exists: {backup}")
    marker = output_root / _PUBLICATION_MARKER
    if marker.exists():
        raise FileExistsError(f"Refusing replacement because transaction marker exists: {marker}")
    _write_json(
        marker,
        {
            "schema_version": _PUBLICATION_MARKER_SCHEMA,
            "output_root": str(output_root.resolve()),
        },
    )
    try:
        os.replace(output_root, backup)
    except BaseException:
        marker.unlink(missing_ok=True)
        raise
    try:
        os.replace(staging, output_root)
    except BaseException:
        os.replace(backup, output_root)
        (output_root / _PUBLICATION_MARKER).unlink(missing_ok=True)
        raise
    try:
        shutil.rmtree(backup)
    except OSError:
        # The new corpus is already committed. A later run will retry cleanup.
        pass


def _recover_publication(output_root: Path) -> None:
    """Reconcile the fixed backup left by an interrupted force publication."""

    backup = output_root.with_name(f".{output_root.name}.backup")
    output_marker = output_root / _PUBLICATION_MARKER
    if not backup.exists():
        if output_marker.exists():
            _validate_publication_marker(output_marker, output_root)
            output_marker.unlink()
        return
    _validate_publication_marker(backup / _PUBLICATION_MARKER, output_root)
    if not output_root.exists():
        os.replace(backup, output_root)
        (output_root / _PUBLICATION_MARKER).unlink()
        return
    try:
        shutil.rmtree(backup)
    except OSError as error:
        raise RuntimeError(f"Could not clean stale publication backup: {backup}") from error


def _validate_publication_marker(marker: Path, output_root: Path) -> None:
    try:
        value = json.loads(marker.read_bytes())
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Refusing unauthenticated publication backup: {marker.parent}") from error
    expected = {
        "schema_version": _PUBLICATION_MARKER_SCHEMA,
        "output_root": str(output_root.resolve()),
    }
    if value != expected:
        raise RuntimeError(f"Refusing unauthenticated publication backup: {marker.parent}")


@contextmanager
def _publication_lock(output_root: Path):
    """Serialize recovery and publication for one absolute output identity."""

    identity = hashlib.sha256(str(output_root.resolve()).casefold().encode("utf-8")).hexdigest()
    if os.name == "nt":
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        kernel32.WaitForSingleObject.restype = ctypes.c_uint32
        kernel32.ReleaseMutex.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = kernel32.CreateMutexW(None, False, f"Local\\Conversion-{identity}")
        if not handle:
            raise OSError(ctypes.get_last_error(), "Could not create publication mutex")
        result = kernel32.WaitForSingleObject(handle, 0xFFFFFFFF)
        if result not in (0, 0x80):
            kernel32.CloseHandle(handle)
            raise OSError(ctypes.get_last_error(), "Could not acquire publication mutex")
        try:
            yield
        finally:
            kernel32.ReleaseMutex(handle)
            kernel32.CloseHandle(handle)
        return

    import fcntl

    lock_path = Path(tempfile.gettempdir()) / f"conversion-{identity}.lock"
    with lock_path.open("a+b") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
