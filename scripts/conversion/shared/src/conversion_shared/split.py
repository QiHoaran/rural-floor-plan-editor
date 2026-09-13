"""Project-wide deterministic train/valid/test split shared by every baseline.

The corpus has no split of its own: each converter is per-building, so the split
lives here and is imported by every model-facing exporter. Assignment is derived
from a salted SHA-256 of the building id rather than from position in a shuffled
list, so adding buildings never moves an existing building between splits and
experiments stay comparable across corpus revisions.
"""

from __future__ import annotations

import hashlib
from collections import Counter
from collections.abc import Iterable
from typing import Any

SPLIT_SCHEMA_VERSION = "rural-dataset-split/1.0.0"

# Changing the salt or the thresholds invalidates every published split, so both
# are part of the versioned contract rather than tunable parameters.
SPLIT_SALT = "rural-floor-plan-editor/dataset-split/v1"
SPLIT_BUCKETS = 1000
TRAIN_BELOW = 700
VALID_BELOW = 850
SPLIT_NAMES = ("train", "valid", "test")


def split_bucket(building_id: str) -> int:
    """Return the stable bucket in ``[0, SPLIT_BUCKETS)`` for one building id."""

    digest = hashlib.sha256(f"{SPLIT_SALT}:{building_id}".encode()).digest()
    return int.from_bytes(digest[:8], "big") % SPLIT_BUCKETS


def split_name(building_id: str) -> str:
    """Return ``train``, ``valid`` or ``test`` for one building id."""

    bucket = split_bucket(building_id)
    if bucket < TRAIN_BELOW:
        return "train"
    return "valid" if bucket < VALID_BELOW else "test"


def dataset_split(building_ids: Iterable[str]) -> dict[str, str]:
    """Map every building id to its split, rejecting duplicates."""

    mapping: dict[str, str] = {}
    for building_id in building_ids:
        if building_id in mapping:
            raise ValueError(f"Duplicate building id in split request: {building_id}")
        mapping[building_id] = split_name(building_id)
    return mapping


def split_manifest(mapping: dict[str, str]) -> dict[str, Any]:
    """Return the public, reproducible description of a split assignment."""

    counts = Counter(mapping.values())
    return {
        "schema_version": SPLIT_SCHEMA_VERSION,
        "salt": SPLIT_SALT,
        "buckets": SPLIT_BUCKETS,
        "thresholds": {"train": TRAIN_BELOW, "valid": VALID_BELOW},
        "counts": {name: counts.get(name, 0) for name in SPLIT_NAMES},
        "assignments": dict(sorted(mapping.items())),
    }
