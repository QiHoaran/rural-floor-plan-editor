import json
from pathlib import Path

import pytest
from test_regression import layout
from typer.testing import CliRunner
from fixtures import raw_rectangle

from embodied.building import BuildingDocument
from embodied.config import Config


def test_pipeline_and_standalone_decode(tmp_path: Path) -> None:
    from embodied.cli import app
    from embodied.pipeline import build_artifacts

    source = BuildingDocument.model_validate(raw_rectangle())
    output = tmp_path / "one"
    report = build_artifacts(source, output, Config())
    assert report["roundtrip_exact"] is True
    assert report["token_roundtrip_exact"] is True
    assert report["schema_validation_count"] >= 4
    assert (output / "navigation_scene.json").exists()
    assert (output / "reconstructed_floorplan.json").exists()
    artifact = json.loads((output / "behavior_tokens.json").read_text(encoding="utf-8"))
    assert all(isinstance(i, int) for i in artifact["token_ids"])
    decoded = tmp_path / "decoded.json"
    result = CliRunner().invoke(
        app,
        [
            "decode",
            str(output / "behavior_tokens.json"),
            "--robot-config",
            str(output / "robot_config.json"),
            "--output",
            str(decoded),
        ],
    )
    assert result.exit_code == 0, result.output
    assert json.loads(decoded.read_text(encoding="utf-8")) == json.loads(
        (output / "canonical_floorplan.json").read_text(encoding="utf-8")
    )
    with pytest.raises(FileExistsError):
        build_artifacts(source, output, Config())


def test_quarantine_is_not_silent_fallback(tmp_path: Path) -> None:
    from embodied.pipeline import build_artifacts

    output = tmp_path / "failed"
    report = build_artifacts(layout([(0, 0), (2, 0)], [], [(0, 0)]), output, Config())
    assert report["status"] == "quarantined"
    assert report["roundtrip_exact"] is False
    assert "UNREACHABLE_COMPONENT" in report["reason"]
    assert not (output / "behavior_tokens.json").exists()


def test_roundtrip_gate_rejects_noncanonical_extra_behavior() -> None:
    from embodied.floorplan import canonicalize_floorplan
    from embodied.floorplan_encoder import encode_floorplan
    from embodied.roundtrip_validator import validate_roundtrip

    f = canonicalize_floorplan(layout([(0, 0)], [], [(0, 0)]))
    c = Config()
    t = encode_floorplan(f, c)
    i = t.index("<ACT_LOOK_FRONT>")
    end = t.index("<DT_END>", i) + 1
    t[i:i] = t[i:end]
    with pytest.raises(ValueError, match="NON_DETERMINISTIC_REENCODE"):
        validate_roundtrip(f, t, c)


def test_repeated_publication_is_byte_identical(tmp_path: Path) -> None:
    from embodied.pipeline import build_artifacts

    document = layout([(0, 0), (2, 0)], [], [(0, 0), (1, 0)])
    first, second = tmp_path / "first", tmp_path / "second"
    build_artifacts(document, first, Config())
    build_artifacts(document, second, Config())
    assert {p.name: p.read_bytes() for p in first.iterdir()} == {
        p.name: p.read_bytes() for p in second.iterdir()
    }


def test_raw_room_hole_extension_is_quarantined_before_legacy_parser(tmp_path: Path) -> None:
    from embodied.pipeline import build_artifacts

    raw = raw_rectangle()
    raw["faces"]["room"]["holes"] = [[[500, 500], [1000, 500], [1000, 1000], [500, 1000]]]
    report = build_artifacts(raw, tmp_path / "hole", Config())
    assert report["status"] == "quarantined"
    assert report["reason_code"] == "UNSUPPORTED_GEOMETRY"
