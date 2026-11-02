"""API と既存の検出処理をまとめて確認する。

実行: python -m unittest discover -s tests -v
準備: pip install -r requirements-dev.txt
"""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app import server

ROOT = Path(__file__).resolve().parents[1]
LABELS = {"top", "bottom", "left", "right", "vertex", "concavity"}


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.addCleanup(self.client.close)

    def upload_image(self, image):
        success, encoded = cv2.imencode(".png", image)
        self.assertTrue(success)
        return self.client.post(
            "/api/detect", files={"file": ("test.png", encoded.tobytes(), "image/png")}
        )

    def test_shared_sample_images(self):
        """班の6画像が、決めた JSON 形式で返る。"""
        expected_vertices = {"square": 4, "triangle": 3, "star": 10}
        paths = sorted((ROOT / "images").glob("*.png"))
        self.assertGreaterEqual(len(paths), 6)
        for path in paths:
            with self.subTest(image=path.name):
                response = self.client.post(
                    "/api/detect", files={"file": (path.name, path.read_bytes(), "image/png")}
                )
                self.assertEqual(response.status_code, 200, response.text)
                result = response.json()
                self.assertEqual(set(result), {"width", "height", "points"})
                self.assertEqual((result["width"], result["height"]), (400, 400))
                self.assertEqual(set(result["points"]), LABELS)
                for label in ("top", "bottom", "left", "right"):
                    self.assertTrue(result["points"][label])
                for coordinates in result["points"].values():
                    for point in coordinates:
                        self.assertEqual(len(point), 2)
                        self.assertTrue(all(type(value) is int for value in point))
                        self.assertTrue(0 <= point[0] < 400 and 0 <= point[1] < 400)
                if path.stem in expected_vertices:
                    self.assertEqual(len(result["points"]["vertex"]), expected_vertices[path.stem])
                if path.stem == "star":
                    self.assertEqual(
                        {tuple(point) for point in result["points"]["bottom"]},
                        {(111, 321), (288, 321)},
                    )

    def test_original_size_and_largest_shape(self):
        """画像を縮小せず、複数の図形がある場合は最大の図形を使う。"""
        image = np.full((300, 500, 3), 255, np.uint8)
        cv2.rectangle(image, (20, 20), (60, 60), (0, 0, 0), -1)
        cv2.rectangle(image, (200, 70), (420, 230), (0, 0, 0), -1)
        response = self.upload_image(image)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual((result["width"], result["height"]), (500, 300))
        self.assertEqual(
            {tuple(point) for point in result["points"]["vertex"]},
            {(200, 70), (420, 70), (420, 230), (200, 230)},
        )

    def test_black_background(self):
        image = np.zeros((200, 300, 3), np.uint8)
        cv2.rectangle(image, (40, 30), (260, 170), (255, 255, 255), -1)
        response = self.upload_image(image)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["points"]["vertex"]), 4)

    def test_jpeg_with_japanese_filename(self):
        image = cv2.imread(str(ROOT / "images" / "square.png"))
        success, encoded = cv2.imencode(".jpg", image)
        self.assertTrue(success)
        response = self.client.post(
            "/api/detect",
            files={"file": ("四角形.jpg", encoded.tobytes(), "image/jpeg")},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["points"]["vertex"]), 4)

    def test_blank_image_returns_empty_arrays(self):
        response = self.upload_image(np.full((200, 300, 3), 255, np.uint8))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["points"], {label: [] for label in LABELS})

    def test_numpy_points_and_missing_labels(self):
        """検出担当が NumPy の整数を返しても、JSON にできる。"""
        with patch.object(
            server.concavity, "detect",
            return_value={"concavity": [(np.int32(200), np.int64(150))]},
        ):
            image = (ROOT / "images" / "star.png").read_bytes()
            response = self.client.post("/api/detect", files={"file": ("star.png", image)})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["points"]["concavity"], [[200, 150]])

    def test_invalid_and_empty_files(self):
        for content in (b"not an image", b""):
            with self.subTest(content=content):
                response = self.client.post(
                    "/api/detect", files={"file": ("bad.png", content, "image/png")}
                )
                self.assertEqual(response.status_code, 400, response.text)
                self.assertIn("detail", response.json())

    def test_file_is_required(self):
        self.assertEqual(self.client.post("/api/detect").status_code, 422)

    def test_docs_and_openapi(self):
        self.assertEqual(self.client.get("/docs").status_code, 200)
        schema = self.client.get("/openapi.json").json()
        self.assertIn("post", schema["paths"]["/api/detect"])

    def test_root_before_screen_is_ready(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(server, "STATIC_DIR", Path(folder)):
                response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn('href="/docs"', response.text)

    def test_screen_file_is_served_when_available(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "index.html").write_text("<h1>team3 screen</h1>", encoding="utf-8")
            with patch.object(server, "STATIC_DIR", Path(folder)):
                response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.text, "<h1>team3 screen</h1>")

    def test_static_assets(self):
        with tempfile.TemporaryDirectory(dir=server.STATIC_DIR) as folder:
            path = Path(folder) / "test.css"
            path.write_text("h1 { color: red; }", encoding="utf-8")
            response = self.client.get("/static/" + path.relative_to(server.STATIC_DIR).as_posix())
        self.assertEqual(response.status_code, 200)
        self.assertIn("color: red", response.text)

    def test_assets_relative_to_root(self):
        """トップの HTML から、相対パスで CSS・JS を読める。"""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".css", dir=server.STATIC_DIR,
            encoding="utf-8", delete=False,
        ) as file:
            file.write("h1 { color: blue; }")
            path = Path(file.name)
        self.addCleanup(path.unlink, missing_ok=True)
        response = self.client.get("/" + path.name)
        self.assertEqual(response.status_code, 200)
        self.assertIn("color: blue", response.text)

    def test_shared_shape_images_are_served(self):
        """画面の /images/ と、API に送る元画像が一致する。"""
        response = self.client.get("/images/star.png")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, (ROOT / "images" / "star.png").read_bytes())


if __name__ == "__main__":
    unittest.main()
