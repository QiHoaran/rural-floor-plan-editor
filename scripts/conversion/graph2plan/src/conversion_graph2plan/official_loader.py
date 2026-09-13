"""Load a published split with Graph2Plan's own ``FloorPlanDataset``.

This module exists to answer "can the official code actually read this?" without
trusting our own reader. It puts ``<repo>/Network`` on ``sys.path`` and drives
``model.floorplan.FloorPlanDataset`` and ``floorplan_collate_fn`` exactly as
``Network/train.py`` does, then reports what came out. Torch and OpenCV are imported
only here, so the converter itself stays dependency-light.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from typing import Any

import numpy as np
import scipy.io as sio

SPLITS = ("train", "valid", "test")


def _load_upstream(graph2plan_root: Path):
    network = graph2plan_root.resolve() / "Network"
    if not (network / "model" / "floorplan.py").is_file():
        raise ValueError(f"GRAPH2PLAN_ROOT_INVALID: no Network/model/floorplan.py under {network}")
    if str(network) not in sys.path:
        sys.path.insert(0, str(network))
    return importlib.import_module("model.floorplan")


def _stored_predicates(mat_path: Path) -> dict[str, list[int]]:
    """Read rEdge's third column straight from the file, as the format defines it."""

    data = sio.loadmat(str(mat_path), squeeze_me=True, struct_as_record=False)["data"]
    stored = {}
    for entry in data:
        edges = np.atleast_2d(entry.rEdge)
        stored[str(entry.name)] = [] if edges.size == 0 else edges[:, 2].astype(int).tolist()
    return stored


def predicate_cross_check(module: Any, mat_path: Path) -> dict[str, Any]:
    """Compare rEdge's third column against the relation ``get_triples`` derives.

    ``FloorPlanDataset`` augments the training split with a random rotation and mirror,
    which legitimately changes the derived relation. This check therefore builds an
    unaugmented ``FloorPlan`` per record so the format semantics are compared directly.
    """

    dataset = module.FloorPlanDataset(str(mat_path))
    stored = _stored_predicates(mat_path)
    mismatches: list[dict[str, Any]] = []
    checked = 0
    for index in range(len(dataset)):
        record = dataset.data[index]
        name = str(record.name)
        derived = module.FloorPlan(record).get_triples(random=False, tensor=False)
        got = [] if np.asarray(derived).size == 0 else np.asarray(derived)[:, 1].astype(int).tolist()
        expected = stored.get(name, [])
        checked += 1
        if got != expected:
            mismatches.append(
                {"name": name, "stored": expected, "derived": got}
            )
    return {
        "checked": checked,
        "mismatch_count": len(mismatches),
        "mismatches": mismatches[:10],
    }


def verify_split(module: Any, mat_path: Path, *, limit: int | None = None) -> dict[str, Any]:
    """Instantiate the upstream dataset, read every record and collate one batch."""

    dataset = module.FloorPlanDataset(str(mat_path))
    total = len(dataset)
    wanted = total if limit is None else min(total, limit)
    report: dict[str, Any] = {"path": mat_path.name, "records": total, "loaded": 0, "failures": []}
    items = []
    for index in range(wanted):
        try:
            items.append(dataset[index])
        except Exception as error:  # noqa: BLE001 - report, never mask, an upstream failure
            # Best-effort only: the record name makes the failure legible, but a
            # malformed record may not expose one, which must not mask the real error.
            try:
                name = str(dataset.data[index].name)
            except Exception:  # noqa: BLE001
                name = None
            report["failures"].append(
                {"index": index, "name": name, "error": f"{type(error).__name__}: {error}"}
            )
    report["loaded"] = len(items)
    if report["failures"] or not items:
        return report

    (
        boundary,
        inside_box,
        rooms,
        attrs,
        triples,
        layout,
        boxes,
        inside_coords,
        obj_to_img,
        _triple_to_img,
        names,
    ) = module.floorplan_collate_fn(items)

    # floorplan_collate_fn returns inside_coords as a ragged list, one entry per
    # sample, because CoverageLoss consumes them per image rather than concatenated.
    report["shapes"] = {
        "boundary": list(boundary.shape),
        "inside_box": list(inside_box.shape),
        "objs": list(rooms.shape),
        "attrs": list(attrs.shape),
        "triples": list(triples.shape),
        "layout": list(layout.shape),
        "boxes": list(boxes.shape),
        "inside_coords_items": len(inside_coords),
        "inside_coords_item": list(inside_coords[0].shape),
    }
    values, counts = np.unique(layout.numpy(), return_counts=True)
    report["layout_label_range"] = [int(values.min()), int(values.max())]
    report["layout_histogram"] = {str(int(v)): int(c) for v, c in zip(values, counts)}
    report["names"] = [str(name) for name in names]
    report["objects_per_record"] = [
        int((obj_to_img == index).sum()) for index in range(len(names))
    ]
    report["boundary_value_range"] = [int(boundary.min()), int(boundary.max())]
    report["inside_box_range"] = [float(inside_box.min()), float(inside_box.max())]
    report["normalised_box_range"] = [float(boxes.min()), float(boxes.max())]
    if triples.numel():
        report["predicate_range"] = [int(triples[:, 1].min()), int(triples[:, 1].max())]

    report["augmented"] = bool(getattr(dataset, "train", False))
    return report


def verify_dataset(
    graph2plan_root: Path, dataset_dir: Path, *, limit: int | None = None
) -> dict[str, Any]:
    """Run the upstream loader over every published split."""

    module = _load_upstream(graph2plan_root)
    report: dict[str, Any] = {
        "graph2plan_root": str(graph2plan_root.resolve()),
        "dataset_dir": str(dataset_dir.resolve()),
        "splits": {},
        "ok": True,
    }
    for split in SPLITS:
        mat_path = dataset_dir / f"data_{split}.mat"
        if not mat_path.is_file():
            report["splits"][split] = {"path": mat_path.name, "error": "missing file"}
            report["ok"] = False
            continue
        try:
            result = verify_split(module, mat_path, limit=limit)
            result["predicate_check"] = predicate_cross_check(module, mat_path)
        except Exception as error:  # noqa: BLE001 - surface upstream errors verbatim
            result = {"path": mat_path.name, "error": f"{type(error).__name__}: {error}"}
        if result.get("failures") or result.get("error"):
            report["ok"] = False
        check = result.get("predicate_check", {})
        if check.get("mismatch_count"):
            report["ok"] = False
        report["splits"][split] = result
    return report
