from __future__ import annotations

import json
from pathlib import Path
from editor_samples import cleaned_root

from rural_embodied_plan.corpus import build_corpus


def test_all_465_cleaned_buildings_publish_without_exclusions(tmp_path: Path) -> None:
    output_root = tmp_path / "embodied"

    summary = build_corpus(cleaned_root(), output_root)

    assert summary["valid_building_count"] == 465
    assert summary["excluded_building_count"] == 0
    assert summary["artifact_count"] == 2790
    assert summary["schema_validation_count"] == 1395
    assert json.loads((output_root / "excluded_buildings.json").read_text())["buildings"] == []
    for building_id in (
        "rural_002_house_0029",
        "rural_002_house_0031",
        "rural_002_house_0051",
    ):
        assert len(list((output_root / building_id).glob("*.json"))) == 6
