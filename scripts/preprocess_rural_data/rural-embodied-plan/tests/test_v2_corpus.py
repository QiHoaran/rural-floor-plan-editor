import json

import pytest
from test_timed_corpus import _two_record_fixture
from v2_fixtures import raw_rectangle


def test_cleaned_adapter_preserves_null_semantics_and_unsupported_geometry():
    from rural_embodied_plan.v2 import corpus

    raw = raw_rectangle()
    clean = dict(raw, schema_version="rural-clean-canonical/1.0.0")
    for key in ("walls", "wall_elements"):
        clean[key] = [dict(item, id=k) for k, item in raw[key].items()]
    clean["rooms"] = [
        dict(
            raw["faces"]["room"],
            id="room",
            original_function_code=None,
            semantic="unknown",
            holes=[[1]],
        )
    ]
    del clean["faces"]
    converted = corpus.adapt_cleaned(clean)
    assert converted["faces"]["room"]["function_code"] is None
    assert converted["faces"]["room"]["holes"] == [[1]]


def test_v2_corpus_publication_audit_and_repeatability(tmp_path):
    from rural_embodied_plan.v2 import corpus

    source = _two_record_fixture(tmp_path)
    first, second = tmp_path / "first", tmp_path / "second"
    summary = corpus.build_v2_corpus(source, first)
    assert summary["input_building_count"] == 2
    assert summary["valid_building_count"] == 2
    assert summary["quarantined_building_count"] == 0
    assert corpus.audit_v2_corpus(first, source)["status"] == "valid"
    corpus.build_v2_corpus(source, second)
    assert {p.relative_to(first): p.read_bytes() for p in first.rglob("*") if p.is_file()} == {
        p.relative_to(second): p.read_bytes() for p in second.rglob("*") if p.is_file()
    }
    with pytest.raises(FileExistsError):
        corpus.build_v2_corpus(source, first)
    artifact = first / "rural_001_house_0001/behavior_tokens.json"
    data = json.loads(artifact.read_text(encoding="utf-8"))
    data["tokens"][0] = "<SOURCE_ID_LEAK>"
    artifact.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(ValueError, match="HASH_MISMATCH"):
        corpus.audit_v2_corpus(first, source)


def test_source_integrity_failure_never_publishes(tmp_path):
    from rural_embodied_plan.v2 import corpus

    source = _two_record_fixture(tmp_path)
    manifest_path = source / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["records"][0]["canonical_sha256"] = "0" * 64
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="HASH_MISMATCH"):
        corpus.build_v2_corpus(source, tmp_path / "out")
    assert not (tmp_path / "out").exists()


@pytest.mark.parametrize(
    "reason", ["TOKEN_GRAMMAR_ERROR", "FLOORPLAN_ROUNDTRIP_MISMATCH", "NON_DETERMINISTIC_REENCODE"]
)
def test_codec_failure_blocks_publication(tmp_path, monkeypatch, reason):
    from rural_embodied_plan.v2 import corpus

    source = _two_record_fixture(tmp_path)
    original = corpus.build_v2_artifacts

    def injected_failure(document, output, config):
        original(document, output, config)
        return {"status": "quarantined", "reason_code": reason, "reason": reason}

    monkeypatch.setattr(corpus, "build_v2_artifacts", injected_failure)
    with pytest.raises(ValueError, match="CODEC_PUBLICATION_BLOCKED"):
        corpus.build_v2_corpus(source, tmp_path / "out")
    assert not (tmp_path / "out").exists()
