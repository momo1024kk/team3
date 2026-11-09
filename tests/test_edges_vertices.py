"""小さい内側輪郭の頂点と辺の回帰テスト。"""

import unittest

import cv2
import numpy as np

from features.edges_vertices import analyze_contour, detect


class InnerContourTests(unittest.TestCase):
    def innermost_contour(self, image):
        # 実験Notebookと同じ図形から、最内側（深さ3）の輪郭だけを入力にする。
        contours, hierarchy = cv2.findContours(image, cv2.RETR_TREE, cv2.CHAIN_APPROX_NONE)
        self.assertEqual(len(contours), 4)
        depths = []
        for index in range(len(contours)):
            depth = 0
            parent = hierarchy[0, index, 3]
            while parent != -1:
                depth += 1
                parent = hierarchy[0, parent, 3]
            depths.append(depth)
        self.assertEqual(sorted(depths), [0, 1, 2, 3])
        return contours[depths.index(3)]

    def assert_corners(self, contour, expected_corners):
        # 既定の比率だけなら1px未満となり、画素段差を拾う図形で確認する。
        self.assertLess(0.003 * cv2.arcLength(contour, True), 1.0)
        result = analyze_contour(contour)
        self.assertEqual(len(result["vertices"]), len(expected_corners))
        for x, y in expected_corners:
            with self.subTest(corner=(x, y)):
                nearest = min(np.hypot(px - x, py - y) for px, py in result["vertices"])
                self.assertLessEqual(nearest, 1.0)
        self.assertEqual(len(result["edges"]), len(expected_corners))
        self.assertEqual(result["arc_midpoints"], [])
        self.assertEqual(detect(contour), {"vertex": result["vertices"]})

    def test_innermost_square(self):
        image = np.zeros((320, 320), dtype=np.uint8)
        cv2.rectangle(image, (25, 25), (295, 295), 255, -1)
        cv2.rectangle(image, (65, 65), (255, 255), 0, -1)
        cv2.rectangle(image, (105, 105), (215, 215), 255, -1)
        cv2.rectangle(image, (130, 130), (190, 190), 0, -1)
        self.assert_corners(
            self.innermost_contour(image),
            [(130, 130), (190, 130), (190, 190), (130, 190)],
        )

    def test_innermost_triangle(self):
        image = np.zeros((320, 320), dtype=np.uint8)
        for corners, color in (
            ([(160, 18), (18, 300), (302, 300)], 255),
            ([(160, 66), (64, 273), (256, 273)], 0),
            ([(160, 113), (112, 236), (208, 236)], 255),
            ([(160, 137), (137, 216), (183, 216)], 0),
        ):
            cv2.fillPoly(image, [np.asarray(corners, dtype=np.int32)], color)
        self.assert_corners(
            self.innermost_contour(image),
            [(160, 137), (137, 216), (183, 216)],
        )


if __name__ == "__main__":
    unittest.main()
