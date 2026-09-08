from __future__ import annotations

import unittest

from conversion_shared.projection import GridTransform, normalize_polygon


class GridTransformTest(unittest.TestCase):
    def test_fits_geometry_with_uniform_scale_and_centers_short_axis(self) -> None:
        vertices = {
            "a": {"x_mm": 1000, "y_mm": -500},
            "b": {"x_mm": 5000, "y_mm": -500},
            "c": {"x_mm": 5000, "y_mm": 1500},
            "d": {"x_mm": 1000, "y_mm": 1500},
        }

        transform = GridTransform.from_vertices(vertices, north_angle_deg=0)
        points = [transform.forward(vertices[key]) for key in ["a", "b", "c", "d"]]

        self.assertEqual(min(point[0] for point in points), 8)
        self.assertEqual(max(point[0] for point in points), 247)
        self.assertGreater(min(point[1] for point in points), 8)
        self.assertLess(max(point[1] for point in points), 247)
        self.assertAlmostEqual(
            min(point[1] for point in points) + max(point[1] for point in points),
            255,
            delta=1,
        )
        source = vertices["c"]
        inverse = transform.inverse(transform.forward(source))
        tolerance = 0.5 / transform.scale_mm_to_grid + 1e-6
        self.assertLessEqual(abs(inverse[0] - source["x_mm"]), tolerance)
        self.assertLessEqual(abs(inverse[1] - source["y_mm"]), tolerance)

    def test_normalizes_polygon_to_ccw_with_stable_start(self) -> None:
        clockwise = [[4, 1], [4, 4], [1, 4], [1, 1]]

        normalized = normalize_polygon(clockwise)

        self.assertEqual(normalized[0], [1, 1])
        self.assertEqual(normalized, [[1, 1], [4, 1], [4, 4], [1, 4]])


if __name__ == "__main__":
    unittest.main()
