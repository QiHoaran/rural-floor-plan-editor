from __future__ import annotations

import tempfile
import unittest
import copy
from pathlib import Path
import logging

logging.getLogger("ezdxf").setLevel(logging.ERROR)
import ezdxf
from ezdxf import units

import rural_data_prep.multimodal as multimodal
from rural_data_prep.records import build_records
from tests.test_records import sample_document, source_for

build_cad_primitives = getattr(multimodal, "build_cad_primitives", None)
write_dxf = getattr(multimodal, "write_dxf", None)


class CadConversionTest(unittest.TestCase):
    def test_builds_millimetre_primitives_and_roundtrippable_r2010_dxf(self) -> None:
        """Catches unit, layer, entity-type, or canonical-coordinate regressions."""

        self.assertIsNotNone(build_cad_primitives, "CAD primitive builder is missing")
        self.assertIsNotNone(write_dxf, "DXF writer is missing")
        cleaned = build_records(source_for(sample_document()))
        primitives = build_cad_primitives(cleaned.canonical)

        self.assertEqual(primitives["schema_version"], "rural-training-cad/1.0.0")
        self.assertEqual(primitives["units"], "millimeters")
        self.assertEqual(primitives["boundaries"][0]["vertices_mm"], [[0, 0], [4000, 0], [4000, 3000], [0, 3000]])
        self.assertEqual(primitives["rooms"][0]["layer"], "ROOM_KITCHEN")
        self.assertEqual(primitives["walls"][0]["start_mm"], [0, 0])
        self.assertEqual(primitives["walls"][0]["end_mm"], [4000, 0])
        self.assertEqual(primitives["openings"][0]["layer"], "OPENING_EXTERIOR_DOOR")
        invalid = copy.deepcopy(primitives)
        invalid["walls"][0].pop("start_mm")
        with self.assertRaisesRegex(ValueError, "start_mm is required"):
            multimodal.validate_json_schema(invalid, multimodal.cad_schema_document())

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.dxf"
            write_dxf(primitives, path)
            document = ezdxf.readfile(path)
            entities = list(document.modelspace())

            self.assertEqual(document.dxfversion, "AC1024")
            self.assertEqual(document.units, units.MM)
            self.assertEqual(sum(entity.dxftype() == "LWPOLYLINE" for entity in entities), 2)
            self.assertEqual(sum(entity.dxftype() == "LINE" for entity in entities), 5)
            self.assertEqual(
                {entity.dxf.layer for entity in entities},
                {"BOUNDARY", "ROOM_KITCHEN", "WALL_EXTERIOR", "OPENING_EXTERIOR_DOOR"},
            )

    def test_dxf_bytes_are_deterministic_with_fixed_metadata(self) -> None:
        """Catches saving timestamps or random GUIDs leaking into training artifacts."""

        self.assertIsNotNone(build_cad_primitives, "CAD primitive builder is missing")
        self.assertIsNotNone(write_dxf, "DXF writer is missing")
        cleaned = build_records(source_for(sample_document()))
        primitives = build_cad_primitives(cleaned.canonical)
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.dxf"
            second = Path(directory) / "second.dxf"

            write_dxf(primitives, first)
            write_dxf(primitives, second)

            self.assertEqual(first.read_bytes(), second.read_bytes())


if __name__ == "__main__":
    unittest.main()
