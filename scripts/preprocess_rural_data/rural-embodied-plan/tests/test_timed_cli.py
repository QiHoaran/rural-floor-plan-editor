"""CLI coverage for the canonical timed single-building pipeline."""

import json
from pathlib import Path
from editor_samples import sample_path

from typer.testing import CliRunner

from rural_embodied_plan.cli import app


def test_pipeline_timed_command_writes_validated_artifacts(tmp_path: Path) -> None:
    package = Path(__file__).resolve().parents[1]
    raw = sample_path("rural_001_house_0001")

    result = CliRunner().invoke(
        app,
        [
            "pipeline-timed",
            str(raw),
            "--output-dir",
            str(tmp_path),
            "--config",
            str(package / "examples/sample_config.yaml"),
            "--robot-config",
            str(package / "examples/robot_config.json"),
        ],
    )

    assert result.exit_code == 0, result.output
    report = json.loads(result.output)
    assert report["status"] == "valid"
    assert (tmp_path / "timed_trajectory.json").is_file()
    assert (tmp_path / "behavior_tokens.json").is_file()
