"""Repository root discovery for CLI default paths."""

from __future__ import annotations

from pathlib import Path


def find_repository_root(start: Path | None = None) -> Path:
    """Return the repository root (the nearest ancestor with a `.git` directory)."""

    current = (start or Path.cwd()).resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    raise RuntimeError(
        "Could not locate the repository root (no .git directory found above the working directory)"
    )
