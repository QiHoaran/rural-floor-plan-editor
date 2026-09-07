"""Optional, read-only legacy corpus fixtures in either supported editor layout."""
from pathlib import Path

import pytest


def sample_path(building_id: str) -> Path:
    repository = Path(__file__).resolve().parents[4]
    candidates = [
        repository / "data/rural_data/JSON" / building_id / "draft/building.autosave.json",
        repository / "data" / building_id / "building.json",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    pytest.skip(f"External editor sample unavailable: {building_id}; synthetic v2 tests remain active")


def cleaned_root() -> Path:
    root = Path(__file__).resolve().parents[4] / "data/rural_data/cleaned"
    if not (root / "manifest.json").is_file():
        pytest.skip("External cleaned corpus manifest is not installed")
    return root
