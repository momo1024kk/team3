"""テスト用の図形画像を images/ に作る（白背景に黒い図形）"""
import cv2
import numpy as np
from pathlib import Path

out = Path(__file__).parent / "images"
out.mkdir(exist_ok=True)


def canvas():
    return np.full((400, 400, 3), 255, np.uint8)


def save(name, img):
    cv2.imwrite(str(out / f"{name}.png"), img)


img = canvas(); cv2.circle(img, (200, 200), 120, (0, 0, 0), -1); save("circle", img)
img = canvas(); cv2.rectangle(img, (100, 120), (300, 280), (0, 0, 0), -1); save("square", img)
img = canvas(); cv2.fillPoly(img, [np.array([[200, 60], [340, 320], [60, 320]])], (0, 0, 0)); save("triangle", img)

# 星（外側と内側の点を交互に並べる）
pts = []
for i in range(10):
    r = 150 if i % 2 == 0 else 60
    a = np.deg2rad(-90 + i * 36)
    pts.append([200 + r * np.cos(a), 200 + r * np.sin(a)])
img = canvas(); cv2.fillPoly(img, [np.int32(pts)], (0, 0, 0)); save("star", img)

# 吹き出し（楕円＋しっぽ）
img = canvas()
cv2.ellipse(img, (200, 170), (150, 100), 0, 0, 360, (0, 0, 0), -1)
cv2.fillPoly(img, [np.array([[150, 240], [200, 250], [110, 350]])], (0, 0, 0))
save("speech_bubble", img)

# 雲（円をいくつか重ねる）
img = canvas()
for (x, y, r) in [(130, 220, 60), (200, 180, 80), (280, 210, 65), (170, 250, 55), (250, 255, 55)]:
    cv2.circle(img, (x, y), r, (0, 0, 0), -1)
save("cloud", img)
print("images/ にサンプル画像を作成しました")
