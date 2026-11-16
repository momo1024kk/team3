"""階層付き輪郭APIと通常応答の互換性を確認する。"""

import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app import server
from features import edges_vertices
from features.preprocess import find_shapes, load_binary


LABELS = {"top", "bottom", "left", "right", "vertex", "concavity"}
ROOT = Path(__file__).resolve().parents[1]


def double_square():
    image = np.zeros((320, 320), np.uint8)
    for a, b, color in (
        ((25, 25), (295, 295), 255),
        ((65, 65), (255, 255), 0),
        ((105, 105), (215, 215), 255),
        ((130, 130), (190, 190), 0),
    ):
        cv2.rectangle(image, a, b, color, -1)
    return image


def double_triangle():
    image = np.zeros((320, 320), np.uint8)
    for corners, color in (
        ([(160, 18), (18, 300), (302, 300)], 255),
        ([(160, 66), (64, 273), (256, 273)], 0),
        ([(160, 113), (112, 236), (208, 236)], 255),
        ([(160, 137), (137, 216), (183, 216)], 0),
    ):
        cv2.fillPoly(image, [np.asarray(corners, np.int32)], color)
    return image


def six_levels():
    image = np.zeros((320, 320), np.uint8)
    for inset, color in ((20, 255), (45, 0), (70, 255),
                         (95, 0), (120, 255), (145, 0)):
        cv2.rectangle(image, (inset, inset), (319 - inset, 319 - inset), color, -1)
    return image


class ContourApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.addCleanup(self.client.close)

    def upload(self, image, expanded=False):
        ok, encoded = cv2.imencode(".png", image)
        self.assertTrue(ok)
        url = "/api/detect?include_contours=true" if expanded else "/api/detect"
        response = self.client.post(
            url, files={"file": ("shape.png", encoded.tobytes(), "image/png")}
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def assert_chain(self, image, levels, vertices, edges):
        old = self.upload(image)
        new = self.upload(image, expanded=True)
        self.assertEqual(set(old), {"width", "height", "points"})
        self.assertEqual({key: new[key] for key in old}, old)
        self.assertEqual(set(new), {*old, "contours"})
        by_depth = {row["depth"]: row for row in new["contours"]}
        self.assertEqual(len(new["contours"]), levels)
        self.assertEqual(set(by_depth), set(range(levels)))
        self.assertEqual(new["contours"][0]["points"], new["points"])
        for depth, row in by_depth.items():
            self.assertEqual(set(row), {
                "id", "parent_id", "depth", "is_hole", "points", "edges", "arc_midpoints"
            })
            self.assertEqual(row["parent_id"], None if depth == 0 else by_depth[depth - 1]["id"])
            self.assertEqual(row["is_hole"], depth % 2 == 1)
            self.assertEqual(set(row["points"]), LABELS)
            for coords in row["points"].values():
                for x, y in coords:
                    self.assertIs(type(x), int)
                    self.assertIs(type(y), int)
            for segment in row["edges"]:
                self.assertEqual(len(segment), 2)
                for x, y in segment:
                    self.assertIs(type(x), int)
                    self.assertIs(type(y), int)
            if row["is_hole"]:
                self.assertEqual(row["points"]["concavity"], [])
        innermost = by_depth[levels - 1]
        self.assertEqual(len(innermost["points"]["vertex"]), vertices)
        self.assertEqual(len(innermost["edges"]), edges)
        self.assertEqual(innermost["arc_midpoints"], [])
        return innermost

    def test_default_keeps_three_keys_without_hierarchy_search(self):
        with patch.object(server, "find_contours_with_hierarchy", side_effect=AssertionError):
            result = self.upload(double_square())
        self.assertEqual(set(result), {"width", "height", "points"})
        self.assertEqual(set(result["points"]), LABELS)

    def test_double_square_four_levels_and_positions(self):
        inner = self.assert_chain(double_square(), 4, 4, 4)
        for x, y in ((130, 130), (190, 130), (190, 190), (130, 190)):
            self.assertLessEqual(min(
                np.hypot(px - x, py - y) for px, py in inner["points"]["vertex"]
            ), 1)

    def test_double_triangle_four_levels_and_positions(self):
        inner = self.assert_chain(double_triangle(), 4, 3, 3)
        for x, y in ((160, 137), (137, 216), (183, 216)):
            self.assertLessEqual(min(
                np.hypot(px - x, py - y) for px, py in inner["points"]["vertex"]
            ), 1)

    def test_six_nested_levels(self):
        self.assert_chain(six_levels(), 6, 4, 4)

    def test_small_hole_is_not_filtered_out(self):
        image = np.zeros((120, 120), np.uint8)
        cv2.rectangle(image, (10, 10), (110, 110), 255, -1)
        cv2.rectangle(image, (50, 50), (55, 55), 0, -1)
        rows = self.upload(image, expanded=True)["contours"]
        self.assertEqual([row["depth"] for row in rows], [0, 1])
        self.assertEqual(rows[1]["parent_id"], rows[0]["id"])

    def test_only_descendants_of_largest_external_shape(self):
        image = np.zeros((320, 320), np.uint8)
        cv2.rectangle(image, (15, 15), (190, 190), 255, -1)
        cv2.rectangle(image, (60, 60), (90, 90), 0, -1)
        cv2.rectangle(image, (240, 240), (290, 290), 255, -1)
        rows = self.upload(image, expanded=True)["contours"]
        self.assertEqual([row["depth"] for row in rows], [0, 1])
        self.assertEqual(rows[1]["parent_id"], rows[0]["id"])
        self.assertEqual(set(map(tuple, rows[0]["points"]["vertex"])),
                         {(15, 15), (190, 15), (190, 190), (15, 190)})

    def test_tied_areas_select_same_external_contour(self):
        image = np.zeros((340, 340), np.uint8)
        cv2.rectangle(image, (15, 15), (125, 125), 255, -1)
        cv2.rectangle(image, (45, 45), (65, 65), 0, -1)
        cv2.rectangle(image, (200, 200), (310, 310), 255, -1)
        expected = edges_vertices.detect(max(find_shapes(image), key=cv2.contourArea))["vertex"]
        result = self.upload(image, expanded=True)
        rows = result["contours"]
        self.assertEqual(result["points"]["vertex"], [list(point) for point in expected])
        self.assertEqual(rows[0]["points"], result["points"])
        self.assertEqual(len(rows), 1 if rows[0]["points"]["vertex"][0][0] > 150 else 2)

    def test_root_matching_ignores_start_and_traversal_direction(self):
        contour = find_shapes(double_square())[0]
        self.assertTrue(server._matches_boundary(contour, np.roll(contour, 17, axis=0)))
        self.assertTrue(server._matches_boundary(contour, contour[::-1].copy()))
        self.assertFalse(server._matches_boundary(contour, contour + (1, 0)))

    def test_analyze_once_per_contour_and_skip_hole_concavity(self):
        with patch.object(server.edges_vertices, "analyze_contour",
                          wraps=edges_vertices.analyze_contour) as analyze:
            with patch.object(server.concavity, "detect",
                              wraps=server.concavity.detect) as concavity_detect:
                rows = self.upload(double_square(), expanded=True)["contours"]
        self.assertEqual(analyze.call_count, len(rows))
        self.assertEqual(concavity_detect.call_count, 2)  # 深さ0と2のみ

    def test_curved_midpoint_matches_existing_detector(self):
        path = ROOT / "images" / "speech_bubble.png"
        response = self.client.post(
            "/api/detect?include_contours=true",
            files={"file": (path.name, path.read_bytes(), "image/png")},
        )
        self.assertEqual(response.status_code, 200, response.text)
        _, binary = load_binary(path)
        primary = max(find_shapes(binary), key=cv2.contourArea)
        expected = edges_vertices.analyze_contour(primary)["arc_midpoints"]
        self.assertTrue(expected)
        self.assertEqual(response.json()["contours"][0]["arc_midpoints"],
                         [list(point) for point in expected])

    def test_blank_and_errors(self):
        old = self.upload(np.full((120, 120), 255, np.uint8))
        new = self.upload(np.full((120, 120), 255, np.uint8), expanded=True)
        self.assertEqual({key: new[key] for key in old}, old)
        self.assertEqual(new["contours"], [])
        for payload in (b"", b"not an image"):
            response = self.client.post("/api/detect?include_contours=true",
                                        files={"file": ("x.png", payload, "image/png")})
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.post("/api/detect?include_contours=true").status_code, 422)


if __name__ == "__main__":
    unittest.main()
