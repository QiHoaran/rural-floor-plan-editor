"""Survey-field isolation and pseudonymous record identifiers."""

from __future__ import annotations

import hashlib
from typing import Any


ARCHITECTURAL_FIELDS = (
    "construction_era",
    "building_area",
    "clear_height_mm",
    "plan_form",
    "building_structure",
    "main_room_bay_mm",
    "main_room_width_mm",
    "wing_room_bay_mm",
    "wing_room_width_mm",
    "bay_count",
)

HOUSEHOLD_FIELDS = (
    "gender",
    "age",
    "resident_count",
    "family_structure",
    "annual_income",
    "primary_income_source",
)

DIRECT_IDENTIFIER_FIELDS = {"village_code", "household_code"}


def record_id_for(building_id: str) -> str:
    digest = hashlib.sha256(f"rural-clean-v1:{building_id}".encode()).hexdigest()
    return f"record_{digest[:16]}"


def split_survey(
    survey: object,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Separate architectural, household, and unknown survey fields."""

    values = survey if isinstance(survey, dict) else {}
    architectural = {key: values[key] for key in ARCHITECTURAL_FIELDS if key in values}
    household = {key: values[key] for key in HOUSEHOLD_FIELDS if key in values}
    known = set(ARCHITECTURAL_FIELDS) | set(HOUSEHOLD_FIELDS) | DIRECT_IDENTIFIER_FIELDS
    extensions = {key: value for key, value in values.items() if key not in known}
    return architectural, household, extensions
