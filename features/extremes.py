"""上下左右（最も上・下・左・右にある点）の検出（担当：momo1024kk）"""
import numpy as np

# 同じ値の点どうしが、これより離れていたら「別の場所」とみなす（ピクセル）
GAP = 5


def _pick(points, axis, use_max):
    """axis(0=x, 1=y) が最小/最大の点を選んで、リストで返す。

    - 星の下の2つの先端のように、同じ値の点が離れた場所にあるときは、それぞれ1点ずつ全部返す
    - 四角形の上辺のように、同じ値の点がつながって並んでいるとき（平らな辺）は、その真ん中の1点を返す
    """
    values = points[:, axis]
    target = values.max() if use_max else values.min()
    candidates = points[values == target]

    # もう一方の座標（上下なら x、左右なら y）の順に並べる
    other = 1 - axis
    candidates = candidates[np.argsort(candidates[:, other])]

    # 隣の点との間が GAP より大きいところで区切って、かたまりに分ける
    gaps = np.diff(candidates[:, other])
    groups = np.split(candidates, np.where(gaps > GAP)[0] + 1)

    # かたまりごとに、真ん中の点を1つ選ぶ
    return [tuple(int(v) for v in g[len(g) // 2]) for g in groups]


def detect(contour):
    """輪郭1つから上下左右の点を返す。
    戻り値: {"top": [(x, y), ...], "bottom": [...], "left": [...], "right": [...]}
    同じ値の点が離れた場所にあるときは、1つのラベルに点が2つ以上入る。"""
    pts = contour.reshape(-1, 2)
    return {
        "top":    _pick(pts, axis=1, use_max=False),
        "bottom": _pick(pts, axis=1, use_max=True),
        "left":   _pick(pts, axis=0, use_max=False),
        "right":  _pick(pts, axis=0, use_max=True),
    }
