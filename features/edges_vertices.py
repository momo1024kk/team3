"""曲線を考慮した頂点・直線辺の検出（実験版）。

入力は OpenCV の閉じた輪郭 1 つ。detect(contour) はチーム共通形式を保つ。
曲線上の多角形近似点を頂点から除外し、直線と判断した区間のみ辺として返す。
鋭い点に挟まれた曲線について、輪郭に沿った中間位置も候補として返す。
"""

import cv2
import numpy as np


def analyze_contour(
    contour,
    epsilon_ratio=0.012,
    corner_epsilon_ratio=0.003,
    corner_angle_deg=35.0,
    corner_window_ratio=0.01,
    line_tolerance_px=2.0,
    min_edge_length_px=12.0,
):
    """輪郭から鋭い角・直線区間・曲線の中間候補を求める。

    戻り値: {"vertices": [(x, y), ...],
             "edges": [((x1, y1), (x2, y2)), ...],
             "arc_midpoints": [(x, y), ...]}
    座標は元画像上の整数 (x, y)。辺の端点は必ずしも鋭い頂点ではない。
    arc_midpoints は座標の平均ではなく、輪郭の道のりの中間にある実際の輪郭点。
    鋭い点が 2 つ未満の円などでは空リスト（円の上下左右は別機能で扱う）。
    各パラメータは図形の大きさや用途に合わせて調整できる。
    """
    if not 0 < epsilon_ratio < 0.1:
        raise ValueError("epsilon_ratio は 0 より大きく 0.1 より小さくしてください")
    if not 0 < corner_epsilon_ratio < 0.1:
        raise ValueError("corner_epsilon_ratio は 0 より大きく 0.1 より小さくしてください")
    if not 0 < corner_angle_deg < 180:
        raise ValueError("corner_angle_deg は 0〜180 度の範囲にしてください")
    if not 0 < corner_window_ratio < 0.1:
        raise ValueError("corner_window_ratio は 0 より大きく 0.1 より小さくしてください")
    if line_tolerance_px < 0 or min_edge_length_px < 0:
        raise ValueError("長さ・許容誤差は 0 以上にしてください")

    empty = {"vertices": [], "edges": [], "arc_midpoints": []}
    if contour is None or len(contour) < 3:
        return empty

    points = np.asarray(contour).reshape(-1, 2).astype(np.float64)
    closed = np.vstack((points, points[0]))
    lengths = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    distances = np.r_[0.0, np.cumsum(lengths)]
    perimeter = distances[-1]
    if perimeter <= 0:
        return empty

    # 小さな角を拾う近似と、円弧を短い辺に分割しない近似を分ける。
    # 小さい図形の角にある1pxの画素段差を別々の頂点として拾わない。
    corner_approx = cv2.approxPolyDP(contour, max(corner_epsilon_ratio * perimeter, 1.0), True)
    edge_approx = cv2.approxPolyDP(contour, epsilon_ratio * perimeter, True)
    candidates = [tuple(map(int, xy)) for xy in corner_approx.reshape(-1, 2)]
    edge_candidates = [tuple(map(int, xy)) for xy in edge_approx.reshape(-1, 2)]
    if len(candidates) < 3 or len(edge_candidates) < 3:
        return empty

    # approxPolyDP の候補点は入力輪郭上の点。元の輪郭の位置を対応させる。
    point_indices = {tuple(map(int, xy)): i for i, xy in enumerate(points)}
    indices = [point_indices[xy] for xy in candidates]
    edge_indices = [point_indices[xy] for xy in edge_candidates]

    def sample(position):
        """閉じた輪郭上をピクセル距離でたどり、座標を線形補間する。"""
        at = position % perimeter
        return np.array([
            np.interp(at, distances, closed[:, 0]),
            np.interp(at, distances, closed[:, 1]),
        ])

    # 短い距離での方向変化が大きい候補だけを「角」とする。
    # 円弧では方向が少しずつ変わるので、多角形近似点を頂点として採用しない。
    window = max(4.0, perimeter * corner_window_ratio)
    vertices = []
    vertex_indices = []
    for xy, index in zip(candidates, indices):
        center = points[index]
        before = sample(distances[index] - window)
        after = sample(distances[index] + window)
        incoming = center - before
        outgoing = after - center
        if np.linalg.norm(incoming) == 0 or np.linalg.norm(outgoing) == 0:
            continue
        cross = incoming[0] * outgoing[1] - incoming[1] * outgoing[0]
        turn = abs(np.degrees(np.arctan2(cross, np.dot(incoming, outgoing))))
        if turn >= corner_angle_deg:
            vertices.append(xy)
            vertex_indices.append(index)

    # 隣り合う鋭い点の間を元の輪郭に沿って調べる。
    # 直線は除外し、曲線の道のりの半分に一番近い輪郭点を採用する。
    arc_midpoints = []
    n = len(points)
    if len(vertex_indices) >= 2:
        for i, start in enumerate(vertex_indices):
            end = vertex_indices[(i + 1) % len(vertex_indices)]
            if end <= start:
                end += n
            section_indices = np.arange(start, end + 1) % n
            section = points[section_indices]
            a, b = section[0], section[-1]
            direction = b - a
            chord_length = np.linalg.norm(direction)
            if chord_length < min_edge_length_px:
                continue
            deviation = np.max(np.abs(
                direction[0] * (section[:, 1] - a[1])
                - direction[1] * (section[:, 0] - a[0])
            )) / chord_length
            if deviation <= line_tolerance_px:
                continue

            section_distances = np.r_[
                0.0, np.cumsum(np.linalg.norm(np.diff(section, axis=0), axis=1))
            ]
            halfway = section_distances[-1] / 2
            nearest = int(np.argmin(np.abs(section_distances - halfway)))
            xy = tuple(map(int, section[nearest]))
            if xy not in vertices and xy not in arc_midpoints:
                arc_midpoints.append(xy)

    # 鋭い点が複数あればそこで区切る。浅い切り欠きの左右も個別に判定できる。
    # 角がないカプセル等では大きめの多角形近似で長い直線区間だけ探す。
    if len(vertex_indices) >= 2:
        edge_candidates = vertices
        edge_indices = vertex_indices
        min_line_length = min_edge_length_px
    else:
        min_line_length = max(min_edge_length_px, 0.07 * perimeter)

    # 元の輪郭が十分直線に近い区間だけを辺にする。
    edges = []
    for i, start in enumerate(edge_indices):
        end = edge_indices[(i + 1) % len(edge_indices)]
        if end <= start:
            end += n
        section = points[np.arange(start, end + 1) % n]
        a, b = section[0], section[-1]
        direction = b - a
        chord_length = np.linalg.norm(direction)
        if chord_length < min_line_length:
            continue
        # 点と両端を結ぶ直線の距離の最大値（単位 px）。
        deviation = np.max(np.abs(
            direction[0] * (section[:, 1] - a[1])
            - direction[1] * (section[:, 0] - a[0])
        )) / chord_length
        if deviation <= line_tolerance_px:
            edges.append((edge_candidates[i], edge_candidates[(i + 1) % len(edge_indices)]))

    return {"vertices": vertices, "edges": edges, "arc_midpoints": arc_midpoints}


def detect(contour):
    """チーム共通形式で鋭い頂点の候補を返す。"""
    return {"vertex": analyze_contour(contour)["vertices"]}
