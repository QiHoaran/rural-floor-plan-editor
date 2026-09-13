"""Batch conversion of a building corpus into Graph2Plan ``.mat`` splits.

The published layout is exactly what ``Network/train.py`` expects, so
``--dataset_dir`` can point straight at ``<output>/data``:

    data/data_train.mat   data/data_valid.mat   data/data_test.mat

Each ``.mat`` holds one MATLAB struct array named ``data`` whose records carry the
eight fields in ``graph2plan.MAT_FIELDS``. Per-building JSON, the decision sidecar
and a QA render are written alongside so every value in the ``.mat`` can be traced
back to ``building.json``; the ``.mat`` files themselves use a fixed field order and
no timestamps, so a repeated run is byte-identical.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import Any

import numpy as np
import scipy.io as sio
from conversion_shared.discovery import BuildingSource
from conversion_shared.io import _json_bytes, _write_json
from conversion_shared.records import build_records
from conversion_shared.split import SPLIT_NAMES, dataset_split, split_manifest, split_name
from PIL import Image

from .graph2plan import (
    BBOX_COLLISION_TOLERANCE,
    MAT_FIELDS,
    RECORD_SCHEMA_VERSION,
    Graph2PlanSample,
    build_sample,
    mapping_document,
    mat_record,
    record_schema_document,
    validate_record,
)
from .preview import render_preview
from .vocabulary import vocabulary

CORPUS_SCHEMA_VERSION = "graph2plan-corpus/1.0.0"

Progress = Callable[[str], None]


def _noop(_: str) -> None:
    return None


# --------------------------------------------------------------------------------------
# Sources
# --------------------------------------------------------------------------------------


def load_sources(input_root: Path) -> list[tuple[str, dict[str, Any]]]:
    """Load canonical records from a cleaned corpus or an editor ``data/`` root.

    A cleaned corpus (``manifest.json`` plus hashed ``canonical/`` files) is used when
    present; otherwise every ``<building_id>/building.json`` below the root is run
    through the shared cleaner, and the source bytes are never modified.
    """

    root = input_root.resolve()
    if (root / "manifest.json").is_file():
        from conversion_shared.corpus import load_cleaned_corpus

        corpus = load_cleaned_corpus(root)
        return [(record.building_id, record.canonical) for record in corpus.records]
    documents = sorted(root.glob("*/building.json"))
    if not documents:
        raise ValueError(f"No cleaned manifest and no */building.json under {root}")
    sources: list[tuple[str, dict[str, Any]]] = []
    for path in documents:
        raw = path.read_bytes()
        document = json.loads(raw)
        if not isinstance(document, dict):
            raise TypeError(f"Building must be an object: {path}")
        building_id = str(document.get("building_id", path.parent.name))
        source = BuildingSource(
            building_id,
            path,
            f"{building_id}/building.json",
            hashlib.sha256(raw).hexdigest(),
            document,
        )
        sources.append((building_id, build_records(source).canonical))
    return sources


# --------------------------------------------------------------------------------------
# .mat writing
# --------------------------------------------------------------------------------------


def struct_array(records: Sequence[dict[str, Any]], *, profile: str = "official") -> np.ndarray:
    """Build the MATLAB struct array the official ``FloorPlanDataset`` reads.

    Fields are object-typed so records may differ in length; scipy stores the varying
    fields as cells that ``sio.loadmat(..., squeeze_me=True, struct_as_record=False)``
    hands back as plain per-record arrays, which is what the loader indexes into.
    """

    fields = MAT_FIELDS + (("entrances",) if profile == "rural-multi" else ())
    array = np.empty((len(records),), dtype=[(name, object) for name in fields])
    for index, record in enumerate(records):
        array["name"][index] = record["name"]
        for field in ("boundary", "rType", "gtBoxNew", "gtBox", "rEdge", "order"):
            array[field][index] = np.asarray(record[field], dtype=np.int64)
        polygons = np.empty((len(record["rBoundary"]),), dtype=object)
        for position, polygon in enumerate(record["rBoundary"]):
            polygons[position] = np.asarray(polygon, dtype=np.float64)
        array["rBoundary"][index] = polygons
        if profile == "rural-multi":
            array["entrances"][index] = np.asarray(record["entrances"], dtype=np.int64)
    return array


# ``sio.loadmat(..., squeeze_me=True)`` collapses a length-1 array to a scalar, so a
# one-record split would break ``len(dataset.data)`` in the official loader.
MINIMUM_SPLIT_SAMPLES = 2


def write_split_mat(path: Path, samples: Sequence[Graph2PlanSample], *, profile: str = "official") -> None:
    if len(samples) < MINIMUM_SPLIT_SAMPLES:
        raise ValueError(
            f"GRAPH2PLAN_SPLIT_TOO_SMALL: {len(samples)} sample(s); scipy's squeeze_me "
            f"needs at least {MINIMUM_SPLIT_SAMPLES} or the official loader cannot index the split"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    sio.savemat(
        str(path),
        {"data": struct_array([mat_record(sample, profile=profile) for sample in samples], profile=profile)},
        do_compression=True,
        oned_as="row",
    )
    _normalize_mat_header(path)


# The MAT v5 header is 128 bytes: a 116-byte free-text field, then the subsystem
# offset, version and endian indicator. scipy fills the text field with
# "Created on: <local wall clock>", so two identical conversions produced a second
# apart differ in bytes and in artifact hash. Overwriting just the text field keeps
# the file a valid MAT v5 file while making the published corpus reproducible.
MAT_HEADER_TEXT_BYTES = 116
MAT_HEADER_BANNER = b"MATLAB 5.0 MAT-file, Platform: rural-graph2plan, Created by conversion-graph2plan"


def _normalize_mat_header(path: Path) -> None:
    raw = path.read_bytes()
    if len(raw) < 128:
        raise ValueError("GRAPH2PLAN_MAT_HEADER: file is shorter than a MAT v5 header")
    banner = MAT_HEADER_BANNER[:MAT_HEADER_TEXT_BYTES].ljust(MAT_HEADER_TEXT_BYTES, b" ")
    path.write_bytes(banner + raw[MAT_HEADER_TEXT_BYTES:])


# --------------------------------------------------------------------------------------
# Preview sheet
# --------------------------------------------------------------------------------------


def write_contact_sheet(samples: Sequence[Graph2PlanSample], path: Path, *, limit: int, columns: int = 2) -> None:
    """Tile the first ``limit`` QA renders so a whole split can be eyeballed at once."""

    chosen = list(samples[:limit])
    if not chosen:
        return
    tiles = [render_preview(sample) for sample in chosen]
    width, height = tiles[0].size
    rows = (len(tiles) + columns - 1) // columns
    sheet = Image.new("RGB", (width * columns, height * rows), (255, 255, 255))
    for index, tile in enumerate(tiles):
        sheet.paste(tile, ((index % columns) * width, (index // columns) * height))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)


# --------------------------------------------------------------------------------------
# Batch build
# --------------------------------------------------------------------------------------


def build_corpus(
    input_root: Path,
    output_root: Path,
    *,
    progress: Progress = _noop,
    preview_limit: int = 6,
    profile: str = "official",
) -> dict[str, Any]:
    """Convert every source building and publish the three Graph2Plan splits."""

    if output_root.exists() and any(output_root.iterdir()):
        raise ValueError(f"Refusing to write into a non-empty directory: {output_root}")

    sources = load_sources(input_root)
    progress(f"Loaded {len(sources)} source building(s)")

    samples: dict[str, Graph2PlanSample] = {}
    exclusions: list[dict[str, str]] = []
    for building_id, canonical in sources:
        try:
            samples[building_id] = build_sample(canonical)
        except ValueError as error:
            code, _, detail = str(error).partition(":")
            exclusions.append(
                {"building_id": building_id, "reason_code": code.strip(), "reason": detail.strip()}
            )
    progress(f"Converted {len(samples)} building(s); {len(exclusions)} excluded")

    assignment = dataset_split(sorted(samples))
    group_keys = {}
    if profile == "rural-multi":
        # Conservatively group identical target geometry even if entrances differ.
        # Canonical room ordering removes dependence on source room ids.
        for building_id, sample in samples.items():
            rooms = sorted((room["label"], sorted(map(tuple, room["polygon"]))) for room in sample.rooms)
            key = hashlib.sha256(_json_bytes(rooms)).hexdigest()
            group_keys[building_id] = key
            assignment[building_id] = split_name("graph2plan-geometry-v1:" + key)
    split_samples = {
        name: [samples[building_id] for building_id in sorted(samples) if assignment[building_id] == name]
        for name in SPLIT_NAMES
    }
    for name, chosen in split_samples.items():
        if not chosen:
            raise ValueError(f"GRAPH2PLAN_EMPTY_SPLIT: split {name} has no samples")

    root = output_root
    for name, chosen in split_samples.items():
        write_split_mat(root / "data" / f"data_{name}.mat", chosen, profile=profile)
        progress(f"Wrote data/data_{name}.mat with {len(chosen)} sample(s)")

    for building_id, sample in sorted(samples.items()):
        record = mat_record(sample, profile=profile)
        validate_record(record, profile=profile)
        _write_json(
            root / "samples" / f"{building_id}.json",
            {"schema_version": "graph2plan-record/2.0.0" if profile == "rural-multi" else RECORD_SCHEMA_VERSION, "building_id": building_id, "record": record},
        )
        mapping = mapping_document(sample)
        if profile == "rural-multi":
            mapping["profile"] = profile
            mapping["model_entrances"] = [
                {"element_id": door.element_id, "face_id": door.face_id, "segment_grid": segment}
                for door, segment in zip(sample.entrances, record["entrances"])
            ]
            for entrance in mapping["other_entrances"]:
                entrance["encoded"] = True
            mapping["warnings"] = [w for w in mapping["warnings"] if not w.startswith("MULTIPLE_ENTRANCES")]
        _write_json(root / "mapping" / f"{building_id}.json", mapping)
        image_path = root / "preview" / f"{building_id}.png"
        image_path.parent.mkdir(parents=True, exist_ok=True)
        render_preview(sample).save(image_path)

    write_contact_sheet(
        [samples[building_id] for building_id in sorted(samples)],
        root / "preview" / "_contact_sheet.png",
        limit=preview_limit,
    )
    _write_json(root / "vocabulary.json", vocabulary())
    _write_json(root / "record.schema.json", record_schema_document(profile=profile))
    split_doc = split_manifest(assignment)
    if group_keys:
        split_doc.update({"schema_version": "graph2plan-geometry-split/1.0.0",
                          "key_rule": "sorted room labels and sorted projected polygon vertices; doors deliberately ignored",
                          "hash_input_prefix": "graph2plan-geometry-v1:",
                          "group_keys": group_keys, "group_count": len(set(group_keys.values()))})
    _write_json(root / "split.json", split_doc)
    _write_json(root / "exclusions.json", {"count": len(exclusions), "items": exclusions})

    quality = quality_report(samples, exclusions)
    _write_json(root / "quality_report.json", quality)

    artifacts = []
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.name != "manifest.json":
            artifacts.append(
                {
                    "path": path.relative_to(root).as_posix(),
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                }
            )
    manifest = {
        "schema_version": CORPUS_SCHEMA_VERSION,
        "building_count": len(sources),
        "sample_count": len(samples),
        "excluded_count": len(exclusions),
        "splits": {name: len(chosen) for name, chosen in split_samples.items()},
        "split_schema_version": split_doc["schema_version"],
        "profile": profile,
        "grid": {"size": 256, "padding": 8, "y_axis": "down", "source": "image/rpl_256"},
        "edge_source": "canonical derived.room_adjacency (door-mediated)",
        "mat_fields": list(MAT_FIELDS) + (["entrances"] if profile == "rural-multi" else []),
        "artifacts": artifacts,
    }
    _write_json(root / "manifest.json", manifest)
    progress(f"Published {len(samples)} sample(s) to {root}")
    return manifest


def quality_report(
    samples: dict[str, Graph2PlanSample], exclusions: Sequence[dict[str, str]]
) -> dict[str, Any]:
    """Corpus-level checks a reviewer can read without opening the ``.mat`` files."""

    room_counts = Counter(room["label"] for sample in samples.values() for room in sample.rooms)
    entrance_counts = Counter(len(sample.entrances) for sample in samples.values())
    edge_totals = sum(len(sample.edges) for sample in samples.values())
    bbox_only_totals = sum(len(sample.comparison["bbox_only"]) for sample in samples.values())
    door_only_totals = sum(len(sample.comparison["door_only"]) for sample in samples.values())
    return {
        "schema_version": CORPUS_SCHEMA_VERSION,
        "converted_count": len(samples),
        "excluded_count": len(exclusions),
        "r_type_histogram": {str(key): room_counts[key] for key in sorted(room_counts)},
        "room_count_histogram": _histogram(len(sample.rooms) for sample in samples.values()),
        "boundary_vertex_histogram": _histogram(len(sample.boundary) for sample in samples.values()),
        "edge_count_histogram": _histogram(len(sample.edges) for sample in samples.values()),
        "entrance_count_histogram": {str(key): entrance_counts[key] for key in sorted(entrance_counts)},
        "buildings_with_multiple_entrances": sum(
            1 for sample in samples.values() if len(sample.entrances) > 1
        ),
        # order is a topological sort of box-overlap precedence, reversed, so it is
        # descending in area only when no overlap constrains it. Both numbers are
        # recorded so a suspicious shift is visible instead of assumed.
        "order_matches_descending_area": sum(
            1
            for sample in samples.values()
            if sample.order
            == [
                index + 1
                for index, _ in sorted(
                    enumerate(sample.rooms),
                    key=lambda item: -(item[1]["bbox"][2] - item[1]["bbox"][0])
                    * (item[1]["bbox"][3] - item[1]["bbox"][1]),
                )
            ]
        ),
        "rooms_with_overlapping_boxes": sum(
            1
            for sample in samples.values()
            for index, room in enumerate(sample.rooms)
            if any(
                other is not room
                and min(room["bbox"][2], other["bbox"][2]) > max(room["bbox"][0], other["bbox"][0])
                and min(room["bbox"][3], other["bbox"][3]) > max(room["bbox"][1], other["bbox"][1])
                for other in sample.rooms
            )
        ),
        "edge_comparison": {
            "door_based_total": edge_totals,
            "bbox_only_total": bbox_only_totals,
            "door_only_total": door_only_totals,
            "buildings_with_bbox_only_edges": sum(
                1 for sample in samples.values() if sample.comparison["bbox_only"]
            ),
            "bbox_collision_tolerance": BBOX_COLLISION_TOLERANCE,
            "note": (
                "bbox_only pairs exist upstream but not in the door-mediated graph; "
                "they are reported, not added, so rEdge stays the reused cleaner graph."
            ),
        },
        "entrance_rule": "living_room/kitchen host first, then longest host wall, then x, y, element id",
        "exclusions": list(exclusions),
    }


def _histogram(values: Iterable[int]) -> dict[str, int]:
    counts = Counter(values)
    return {str(key): counts[key] for key in sorted(counts)}


def deterministic_digest(root: Path) -> str:
    """Digest every published artifact except the manifest that records them."""

    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.name != "manifest.json":
            digest.update(path.relative_to(root).as_posix().encode("utf-8"))
            digest.update(path.read_bytes())
    return digest.hexdigest()


def read_mat_records(path: Path) -> list[dict[str, Any]]:
    """Read a published split back with the official loader's exact loadmat options."""

    data = sio.loadmat(str(path), squeeze_me=True, struct_as_record=False)["data"]
    records = []
    for entry in data:
        records.append(
            {
                "name": entry.name,
                "boundary": np.asarray(entry.boundary),
                "rType": np.asarray(entry.rType),
                "gtBoxNew": np.asarray(entry.gtBoxNew),
                "gtBox": np.asarray(entry.gtBox),
                "rEdge": np.asarray(entry.rEdge),
                "order": np.asarray(entry.order),
                "rBoundary": list(entry.rBoundary),
            }
        )
    return records


def json_bytes(value: Any) -> bytes:
    return _json_bytes(value)
