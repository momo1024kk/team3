"""頂点・辺の検出（担当: koma-0704 / team3 最小版）。

輪郭1つから、整数の頂点座標と、辺の両端の座標を求める。
チームの main.py は detect(contour) を呼び出す。
辺の情報が必要なときは analyze_contour(contour) を使う。
"""
import cv2


def analyze_contour(contour, epsilon_ratio=0.012):
    """輪郭1つを多角形に近似し、頂点と辺を返す。

    入力: 共通の find_shapes() が返す、図形1つ分の OpenCV 輪郭配列。
    epsilon_ratio: 周長に対する近似の許容誤差の割合（既定値 0.012）。
    戻り値:
        vertices: 頂点を輪郭順に並べた [(x, y), ...]。
        edges: 辺の両端を並べた [((x1, y1), (x2, y2)), ...]。
    座標は整数。画像の左上が原点で、右が x、下が y。
    空・退化した輪郭には、空の頂点リストと辺リストを返す。
    """
    if not 0 < epsilon_ratio < 0.1:
        raise ValueError("epsilon_ratio は 0 より大きく 0.1 より小さくしてください")
    if contour is None or len(contour) == 0:
        return {"vertices": [], "edges": []}

    perimeter = cv2.arcLength(contour, True)
    if perimeter <= 0:
        return {"vertices": [], "edges": []}

    approx = cv2.approxPolyDP(contour, epsilon_ratio * perimeter, True)
    vertices = [(int(x), int(y)) for x, y in approx.reshape(-1, 2)]
    if len(vertices) < 3:
        return {"vertices": [], "edges": []}

    # 隣り合う頂点を辺にする。最後の頂点と最初の頂点も結ぶ。
    edges = [
        (vertices[i], vertices[(i + 1) % len(vertices)])
        for i in range(len(vertices))
    ]
    return {"vertices": vertices, "edges": edges}


def detect(contour):
    """チーム共通の形式 {"vertex": [(x, y), ...]} で頂点を返す。"""
    return {"vertex": analyze_contour(contour)["vertices"]}