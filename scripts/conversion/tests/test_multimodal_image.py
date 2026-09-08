from __future__ import annotations

import io
import copy
import unittest

from conversion_image.image import image_schema_document, render_training_masks
from conversion_shared.records import build_records
from conversion_shared.schemas import validate_json_schema
from tests.test_records import sample_document, source_for


class ImageConversionTest(unittest.TestCase):
    def test_renders_flipped_semantic_and_room_instance_masks(self) -> None:
        """Catches wrong Y orientation, layer priority, or instance IDs under walls."""

        self.assertIsNotNone(render_training_masks, "training mask renderer is missing")
        cleaned = build_records(source_for(sample_document()))

        rendered = render_training_masks(cleaned.training)

        self.assertEqual(rendered.semantic.mode, "P")
        self.assertEqual(rendered.instance.mode, "I;16")
        self.assertEqual(rendered.semantic.size, (256, 256))
        self.assertEqual(rendered.instance.size, (256, 256))
        self.assertEqual(rendered.semantic.getpixel((128, 127)), 3)
        self.assertEqual(rendered.instance.getpixel((128, 127)), 1)
        self.assertEqual(rendered.semantic.getpixel((10, 217)), 16)
        self.assertEqual(rendered.instance.getpixel((10, 217)), 0)
        self.assertEqual(rendered.semantic.getpixel((95, 217)), 32)
        self.assertEqual(rendered.instance.getpixel((95, 217)), 0)
        self.assertEqual(rendered.semantic.getpixel((128, 38)), 16)
        self.assertEqual(set(rendered.stats["semantic_histogram"]), {"0", "3", "16", "32"})
        self.assertEqual(sum(rendered.stats["semantic_histogram"].values()), 256 * 256)
        invalid_stats = copy.deepcopy(rendered.stats)
        invalid_stats["semantic_histogram"]["3"] = "many"
        with self.assertRaisesRegex(ValueError, "must have JSON type integer"):
            validate_json_schema(invalid_stats, image_schema_document())

    def test_png_serialization_is_byte_deterministic(self) -> None:
        """Catches encoder settings that inject timestamps or unstable metadata."""

        self.assertIsNotNone(render_training_masks, "training mask renderer is missing")
        cleaned = build_records(source_for(sample_document()))
        rendered = render_training_masks(cleaned.training)
        first = io.BytesIO()
        second = io.BytesIO()

        rendered.semantic.save(first, format="PNG", optimize=False, compress_level=9)
        rendered.semantic.save(second, format="PNG", optimize=False, compress_level=9)

        self.assertEqual(first.getvalue(), second.getvalue())


if __name__ == "__main__":
    unittest.main()
