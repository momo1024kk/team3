"""images/ の画像から特徴点を検出し、結果を output/ に保存する

使い方:
    python main.py              # images/ の全画像
    python main.py star.png     # 1枚だけ
"""
import sys
from pathlib import Path

import cv2

from features import concavity, edges_vertices, extremes
from features.preprocess import find_shapes, load_binary

ROOT = Path(__file__).parent
IMAGES = ROOT / "images"
OUTPUT = ROOT / "output"

# 各担当の検出関数。全員 detect(contour) -> {ラベル: [(x, y), ...]} の形にそろえる
DETECTORS = [extremes.detect, edges_vertices.detect, concavity.detect]

# ラベルごとの描画色 (B, G, R) と表示文字
STYLES = {
    "top":       ((0, 0, 255),   "T"),
    "bottom":    ((255, 0, 0),   "B"),
    "left":      ((0, 200, 0),   "L"),
    "right":     ((0, 200, 255), "R"),
    "vertex":    ((255, 0, 255), "V"),
    "concavity": ((255, 255, 0), "C"),
}


def draw(img, contour, features):
    cv2.drawContours(img, [contour], -1, (128, 128, 128), 2)
    for label, points in features.items():
        color, text = STYLES.get(label, ((0, 0, 0), label[:1]))
        for x, y in points:
            cv2.circle(img, (x, y), 6, color, -1)
            cv2.putText(img, text, (x + 8, y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)


def process(path):
    img, binary = load_binary(path)
    result = img.copy()
    for i, contour in enumerate(find_shapes(binary)):
        features = {}
        for detect in DETECTORS:
            features.update(detect(contour))
        print(f"{path.name} 図形{i}: {features}")
        draw(result, contour, features)
    cv2.imwrite(str(OUTPUT / path.name), result)


def main():
    OUTPUT.mkdir(exist_ok=True)
    if sys.argv[1:]:
        files = [IMAGES / name for name in sys.argv[1:]]
    else:
        files = sorted(p for p in IMAGES.iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg"))
    for path in files:
        process(path)
    print(f"結果を {OUTPUT} に保存しました")


if __name__ == "__main__":
    main()
