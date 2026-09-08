"""Modality conversion orchestration: staging, atomic publish, and manifest."""

from __future__ import annotations

import shutil
import tempfile
from dataclasses import dataclass
from importlib.metadata import version as package_version
from pathlib import Path
from typing import Any, Literal

from .corpus import CleanedCorpus, load_cleaned_corpus
from .io import _artifact, _safe_output_path, _sha256, _write_json
from .publication import (
    _paths_overlap,
    _publication_lock,
    _publish_staging,
    _recover_publication,
)
from .vocabulary import multimodal_vocabulary


@dataclass(frozen=True)
class ConversionSummary:
    modality: str
    source_corpus_hash: str
    record_count: int
    output_root: Path
    dry_run: bool
    files_written: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "modality": self.modality,
            "source_corpus_hash": self.source_corpus_hash,
            "record_count": self.record_count,
            "output_root": str(self.output_root),
            "dry_run": self.dry_run,
            "files_written": self.files_written,
        }


def _assemble_manifest(
    modality: str,
    corpus: CleanedCorpus,
    vocabulary: dict[str, Any],
    corpus_artifact_paths: list[str],
    root: Path,
    records: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "schema_version": "rural-model-ready-manifest/1.0.0",
        "modality": modality,
        "source_corpus_hash": corpus.corpus_hash,
        "source_manifest_schema_version": corpus.manifest["schema_version"],
        "vocabulary_schema_version": vocabulary["schema_version"],
        "record_count": len(records),
        "dependencies": {"Pillow": package_version("Pillow"), "ezdxf": package_version("ezdxf")},
        "corpus_artifacts": [
            _artifact(path, _sha256(_safe_output_path(root, path)))
            for path in sorted(corpus_artifact_paths)
        ],
        "records": records,
    }


def _build_modality_tree(
    modality: Literal["graph", "image", "cad"], corpus: CleanedCorpus, root: Path
) -> dict[str, Any]:
    """Write the shared vocabulary plus one modality's artifacts, then assemble the manifest."""

    if modality == "graph":
        from conversion_graph.graph import build_tree
    elif modality == "image":
        from conversion_image.image import build_tree
    elif modality == "cad":
        from conversion_cad.cad import build_tree
    else:
        raise ValueError(f"Unsupported modality: {modality}")
    vocabulary = multimodal_vocabulary()
    _write_json(_safe_output_path(root, "vocabulary.json"), vocabulary)
    records, corpus_artifact_paths = build_tree(corpus, root)
    return _assemble_manifest(
        modality,
        corpus,
        vocabulary,
        ["vocabulary.json", *corpus_artifact_paths],
        root,
        records,
    )


def convert_modality(
    modality: Literal["graph", "image", "cad"],
    input_root: Path,
    output_root: Path,
    *,
    force: bool = False,
    dry_run: bool = False,
) -> ConversionSummary:
    """Convert and atomically publish one complete training modality."""

    input_root = input_root.resolve()
    output_root = output_root.resolve()
    if _paths_overlap(input_root, output_root):
        raise ValueError("Input and output paths must not overlap")
    corpus = load_cleaned_corpus(input_root)
    if dry_run:
        with tempfile.TemporaryDirectory(prefix=f"rural-{modality}-dry-run-") as directory:
            staging = Path(directory)
            manifest = _build_modality_tree(modality, corpus, staging)
            _write_json(staging / "manifest.json", manifest)
            file_count = sum(path.is_file() for path in staging.rglob("*"))
        return ConversionSummary(
            modality=modality,
            source_corpus_hash=corpus.corpus_hash,
            record_count=len(corpus.records),
            output_root=output_root,
            dry_run=True,
            files_written=file_count,
        )
    output_root.parent.mkdir(parents=True, exist_ok=True)
    with _publication_lock(output_root):
        _recover_publication(output_root)
        if output_root.exists() and not force:
            raise FileExistsError(f"Output already exists: {output_root}")
        staging = Path(
            tempfile.mkdtemp(prefix=f".{output_root.name}.staging-", dir=output_root.parent)
        )
        try:
            manifest = _build_modality_tree(modality, corpus, staging)
            _write_json(staging / "manifest.json", manifest)
            file_count = sum(path.is_file() for path in staging.rglob("*"))
            _publish_staging(staging, output_root, force=force)
        except BaseException:
            if staging.exists():
                shutil.rmtree(staging)
            raise
    return ConversionSummary(
        modality=modality,
        source_corpus_hash=corpus.corpus_hash,
        record_count=len(corpus.records),
        output_root=output_root,
        dry_run=False,
        files_written=file_count,
    )
