from __future__ import annotations

import unittest

from conversion_shared.semantics import normalize_room_semantic
from conversion_shared.survey import record_id_for, split_survey


class SemanticNormalizationTest(unittest.TestCase):
    def test_maps_core_and_custom_room_names_to_stable_codes(self) -> None:
        cases = {
            ("bedroom", "卧室"): "bedroom",
            ("living_room", "客厅"): "living_room",
            ("custom-a", "厨房"): "kitchen",
            ("custom-b", "杂物间"): "storage",
            ("custom-c", "阳光房"): "sunroom",
            (None, ""): "unknown",
            ("custom-z", "火炕间"): "unknown",
        }

        for (code, name), expected in cases.items():
            with self.subTest(code=code, name=name):
                self.assertEqual(normalize_room_semantic(code, name), expected)


class SurveySplitTest(unittest.TestCase):
    def test_splits_building_attributes_from_household_attributes(self) -> None:
        survey = {
            "village_code": "001",
            "household_code": "0001",
            "gender": "男性",
            "age": 62,
            "resident_count": 3,
            "family_structure": "三代户",
            "annual_income": "20001–30000",
            "primary_income_source": "种田",
            "construction_era": "1980 年代",
            "building_area": "50–60 ㎡",
            "clear_height_mm": 2500,
            "plan_form": "一字型",
            "building_structure": "石结构",
            "main_room_bay_mm": 3500,
            "main_room_width_mm": 5000,
            "wing_room_bay_mm": 2500,
            "wing_room_width_mm": 4000,
            "bay_count": 4,
            "future_field": "preserve me",
        }

        architectural, household, extensions = split_survey(survey)

        self.assertEqual(architectural["plan_form"], "一字型")
        self.assertEqual(architectural["main_room_width_mm"], 5000)
        self.assertNotIn("gender", architectural)
        self.assertEqual(household["age"], 62)
        self.assertNotIn("village_code", household)
        self.assertNotIn("household_code", household)
        self.assertEqual(extensions, {"future_field": "preserve me"})

    def test_record_id_is_deterministic_and_does_not_expose_source_id(self) -> None:
        first = record_id_for("rural_001_house_0001")
        second = record_id_for("rural_001_house_0001")

        self.assertEqual(first, second)
        self.assertRegex(first, r"^record_[0-9a-f]{16}$")
        self.assertNotIn("rural", first)


if __name__ == "__main__":
    unittest.main()
