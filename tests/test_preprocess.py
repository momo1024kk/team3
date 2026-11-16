"""外側・内側輪郭の取得と既存の外側輪郭取得の互換性を確認する。"""

import unittest

import cv2
import numpy as np

from features.edges_vertices import analyze_contour
from features.preprocess import find_contours_with_hierarchy, find_shapes


class ContourHierarchyTests(unittest.TestCase):
    def assert_nested_chain(self, items, count):
        self.assertEqual(len(items), count)
        by_depth = {item["depth"]: item for item in items}
        self.assertEqual(set(by_depth), set(range(count)))
        for depth, item in by_depth.items():
            self.assertEqual(item["is_hole"], depth % 2 == 1)
            self.assertIsInstance(item["area"], float)
            self.assertGreater(item["area"], 0)
            self.assertEqual(
                item["parent_index"],
                None if depth == 0 else by_depth[depth - 1]["index"],
            )
        return by_depth

    def double_square(self):
        image = np.zeros((320, 320), dtype=np.uint8)
        for a, b, color in (
            ((25, 25), (295, 295), 255),
            ((65, 65), (255, 255), 0),
            ((105, 105), (215, 215), 255),
            ((130, 130), (190, 190), 0),
        ):
            cv2.rectangle(image, a, b, color, -1)
        return image

    def double_triangle(self):
        image = np.zeros((320, 320), dtype=np.uint8)
        for corners, color in (
            ([(160, 18), (18, 300), (302, 300)], 255),
            ([(160, 66), (64, 273), (256, 273)], 0),
            ([(160, 113), (112, 236), (208, 236)], 255),
            ([(160, 137), (137, 216), (183, 216)], 0),
        ):
            cv2.fillPoly(image, [np.asarray(corners, dtype=np.int32)], color)
        return image

    def test_double_square_and_inner_features(self):
        inner = self.assert_nested_chain(find_contours_with_hierarchy(self.double_square()), 4)[3]
        features = analyze_contour(inner["contour"])
        self.assertEqual((len(features["vertices"]), len(features["edges"])), (4, 4))
        self.assertEqual(features["arc_midpoints"], [])
        for x, y in ((130, 130), (190, 130), (190, 190), (130, 190)):
            self.assertLessEqual(
                min(np.hypot(px - x, py - y) for px, py in features["vertices"]), 1
            )

    def test_double_triangle_and_inner_features(self):
        inner = self.assert_nested_chain(find_contours_with_hierarchy(self.double_triangle()), 4)[3]
        features = analyze_contour(inner["contour"])
        self.assertEqual((len(features["vertices"]), len(features["edges"])), (3, 3))
        self.assertEqual(features["arc_midpoints"], [])
        for x, y in ((160, 137), (137, 216), (183, 216)):
            self.assertLessEqual(
                min(np.hypot(px - x, py - y) for px, py in features["vertices"]), 1
            )

    def test_six_nested_levels(self):
        image = np.zeros((240, 240), dtype=np.uint8)
        for inset, color in ((10, 255), (30, 0), (50, 255),
                             (70, 0), (90, 255), (110, 0)):
            cv2.rectangle(image, (inset, inset), (239 - inset, 239 - inset), color, -1)
        self.assert_nested_chain(find_contours_with_hierarchy(image), 6)

    def test_multiple_outer_shapes_and_a_hole(self):
        image = np.zeros((200, 320), dtype=np.uint8)
        cv2.rectangle(image, (20, 20), (160, 160), 255, -1)
        cv2.rectangle(image, (60, 60), (100, 100), 0, -1)
        cv2.rectangle(image, (220, 40), (280, 120), 255, -1)
        items = find_contours_with_hierarchy(image)
        self.assertEqual(len(items), 3)
        roots = [item for item in items if item["parent_index"] is None]
        holes = [item for item in items if item["is_hole"]]
        self.assertEqual(len(roots), 2)
        self.assertEqual(len(holes), 1)
        self.assertEqual(holes[0]["depth"], 1)
        left_root = next(item for item in roots if cv2.boundingRect(item["contour"])[0] < 200)
        self.assertEqual(holes[0]["parent_index"], left_root["index"])

    def test_small_hole_and_optional_area_filter(self):
        image = np.zeros((120, 120), dtype=np.uint8)
        cv2.rectangle(image, (10, 10), (110, 110), 255, -1)
        cv2.rectangle(image, (50, 50), (55, 55), 0, -1)
        items = self.assert_nested_chain(find_contours_with_hierarchy(image), 2)
        self.assertLess(items[1]["area"], 100)
        filtered = find_contours_with_hierarchy(image, min_area=100)
        self.assertEqual([item["depth"] for item in filtered], [0])
        self.assertEqual(find_shapes(image)[0].shape, items[0]["contour"].shape)

    def test_blank_image(self):
        self.assertEqual(find_contours_with_hierarchy(np.zeros((80, 80), np.uint8)), [])

    def test_find_shapes_still_returns_only_external_contours(self):
        image = self.double_square()
        expected, _ = cv2.findContours(image, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        actual = find_shapes(image)
        self.assertEqual(len(actual), 1)
        np.testing.assert_array_equal(actual[0], expected[0])
        self.assertEqual(len(find_contours_with_hierarchy(image)), 4)


if __name__ == "__main__":
    unittest.main()
