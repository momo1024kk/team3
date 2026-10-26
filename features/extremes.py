"""上下左右（最も上・下・左・右にある点）の検出（担当：momo1024kk）"""
import numpy as np


def _pick(points, axis, use_max):
    """axis(0=x, 1=y) が最小/最大の点を選ぶ。
    平らな辺（四角形の上辺など）で同じ値の点が複数あるときは、その真ん中を返す。"""
    values = points[:, axis]
    target = values.max() if use_max else values.min()
    candidates = points[values == target]
    other = 1 - axis
    candidates = candidates[np.argsort(candidates[:, other])]
    return tuple(int(v) for v in candidates[len(candidates) // 2])


def detect(contour):
    """輪郭1つから上下左右の点を返す。
    戻り値: {"top": [(x, y)], "bottom": [(x, y)], "left": [(x, y)], "right": [(x, y)]}"""
    pts = contour.reshape(-1, 2)
    return {
        "top":    [_pick(pts, axis=1, use_max=False)],
        "bottom": [_pick(pts, axis=1, use_max=True)],
        "left":   [_pick(pts, axis=0, use_max=False)],
        "right":  [_pick(pts, axis=0, use_max=True)],
    }
