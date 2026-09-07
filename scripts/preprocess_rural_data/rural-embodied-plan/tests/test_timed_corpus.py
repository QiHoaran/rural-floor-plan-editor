"""Quarantine-aware canonical timed corpus tests."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from editor_samples import cleaned_root

from typer.testing import CliRunner

from rural_embodied_plan.cli import app
from rural_embodied_plan.timed_corpus import build_timed_corpus


def _two_record_fixture(tmp_path: Path) -> Path:
    source_root = cleaned_root()
    source_manifest = json.loads((source_root / "manifest.json").read_text(encoding="utf-8"))
    wanted = {"rural_001_house_0001", "rural_001_house_0015"}
    records = [record for record in source_manifest["records"] if record["building_id"] in wanted]
    assert {record["building_id"] for record in records} == wanted

    input_root = tmp_path / "cleaned"
    for record in records:
        relative = Path(record["canonical_file"])
        destination = input_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_root / relative, destination)
    manifest = {
        **source_manifest,
        "building_count": len(records),
        "records": records,
    }
    (input_root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
    )
    return input_root


def test_timed_corpus_publishes_valid_buildings_and_quarantines_failures(
    tmp_path: Path,
) -> None:
    package = Path(__file__).resolve().parents[1]
    output = tmp_path / "embodied"

    summary = build_timed_corpus(
        _two_record_fixture(tmp_path),
        output,
        config_path=package / "examples/sample_config.yaml",
        robot_config_path=package / "examples/robot_config.json",
    )

    assert summary["input_building_count"] == 2
    assert summary["valid_building_count"] == 1
    assert summary["quarantined_building_count"] == 1
    assert len(list((output / "rural_001_house_0001").glob("*.json"))) == 6
    assert not (output / "rural_001_house_0015").exists()
    quarantine = json.loads(
        (output / "quarantine/rural_001_house_0015/quarantine_report.json").read_text(
            encoding="utf-8"
        )
    )
    assert quarantine["stage"] == "timed_pipeline"
    assert "forbids exterior teleportation" in quarantine["message"]
    audit = json.loads((output / "dataset_audit.json").read_text(encoding="utf-8"))
    assert audit["status"] == "valid"
    assert all(audit["checks"].values())


def test_timed_corpus_reports_are_byte_deterministic(tmp_path: Path) -> None:
    package = Path(__file__).resolve().parents[1]
    input_root = _two_record_fixture(tmp_path)
    first = tmp_path / "first"
    second = tmp_path / "second"
    kwargs = {
        "config_path": package / "examples/sample_config.yaml",
        "robot_config_path": package / "examples/robot_config.json",
    }

    build_timed_corpus(input_root, first, **kwargs)
    build_timed_corpus(input_root, second, **kwargs)

    for filename in (
        "corpus_manifest.json",
        "corpus_summary.json",
        "dataset_audit.json",
    ):
        assert (first / filename).read_bytes() == (second / filename).read_bytes()


def test_build_timed_corpus_cli(tmp_path: Path) -> None:
    package = Path(__file__).resolve().parents[1]
    output = tmp_path / "cli-embodied"

    result = CliRunner().invoke(
        app,
        [
            "build-timed-corpus",
            "--input-root",
            str(_two_record_fixture(tmp_path)),
            "--output-root",
            str(output),
            "--config",
            str(package / "examples/sample_config.yaml"),
            "--robot-config",
            str(package / "examples/robot_config.json"),
        ],
    )

    assert result.exit_code == 0, result.output
    summary = json.loads(result.output)
    assert summary["valid_building_count"] == 1
    assert summary["quarantined_building_count"] == 1
