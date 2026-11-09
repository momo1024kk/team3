"""くぼみの検出（担当：y240197）"""

"""図形の輪郭から「くぼみ（凹方向の曲がり）」を検出する担当モジュール。"""

import cv2                  # 輪郭の符号付き面積を求めるために使用
import numpy as np          # 座標の配列操作、平滑化、角度計算に使用


# --- 検出パラメータ（図形に応じて調整できる） ---
SAMPLE_SPACING = 1.0        # 輪郭を約1px間隔で再サンプリングする
SMOOTH_WINDOW = 11          # 前後を含む11点の移動平均で輪郭を滑らかにする（奇数）
POINT_STEP = 18             # 注目点から前後18点を使って曲がり角を測る
MIN_ANGLE = 20.0            # 凹方向の曲がり角が20度以上なら候補にする
MIN_POINT_GAP = 35          # 輪郭点の番号が近い候補を重複採用しない


def _resample_contour(contour):
    """輪郭の点間隔をほぼ一定にする（CHAIN_APPROX_SIMPLE/NONE両対応）。"""

    # OpenCVの輪郭は通常 (N, 1, 2)。これを (N, 2) の座標列に変える。
    coords = np.asarray(contour, dtype=np.float64).reshape(-1, 2)
    if len(coords) < 3:     # 点が3個未満なら閉じた図形を構成できない
        return np.empty((0, 2), dtype=np.float64)

    # 「各点から次の点へ」の長さを求める。np.rollで最後の点→先頭の点も扱う。
    delta = np.roll(coords, -1, axis=0) - coords
    segment_lengths = np.linalg.norm(delta, axis=1)

    # 重複した座標（長さ0の辺）を除外して、0による除算を防ぐ。
    coords = coords[segment_lengths > 1e-8]
    if len(coords) < 3:
        return np.empty((0, 2), dtype=np.float64)

    # 重複点除去後の線分と長さを再計算する。
    delta = np.roll(coords, -1, axis=0) - coords
    segment_lengths = np.linalg.norm(delta, axis=1)
    perimeter = float(segment_lengths.sum())    # 図形の周囲長（px）
    if perimeter < 1e-8:
        return np.empty((0, 2), dtype=np.float64)

    # 周囲長をほぼ1pxごとに分割し、サンプル位置の累積距離を作る。
    sample_count = max(3, int(np.ceil(perimeter / SAMPLE_SPACING)))
    distances = np.linspace(0, perimeter, sample_count, endpoint=False)
    cumulative = np.concatenate(([0.0], np.cumsum(segment_lengths)))

    # サンプル位置がどの線分に属するかを調べる。
    segment_ids = np.searchsorted(cumulative, distances, side="right") - 1

    # 線分の始点から終点までの割合（0〜1）を計算する。
    ratios = (distances - cumulative[segment_ids]) / segment_lengths[segment_ids]

    # 線形補間で、ほぼ等間隔の輪郭点を生成する。
    return coords[segment_ids] + delta[segment_ids] * ratios[:, None]


def _find_local_concavities(contour):
    """元の局所的な角度解析で、くぼみの (x, y) 座標一覧を返す。"""

    # チーム側の輪郭取得方法によらず、同じ程度の点間隔になるよう整える。
    points = _resample_contour(contour)
    count = len(points)
    if count < 2 * POINT_STEP + 1:
        return []

    # 輪郭の点列の向きを求める（時計回り・反時計回りの符号補正に使う）。
    contour_array = np.asarray(contour, dtype=np.float32).reshape(-1, 1, 2)
    orientation = np.sign(cv2.contourArea(contour_array, oriented=True))
    if orientation == 0:
        return []

    # 移動平均：輪郭上の各点を、その前後を含む11点の平均座標へ置き換える。
    smooth = np.zeros_like(points)
    for offset in range(-(SMOOTH_WINDOW // 2), SMOOTH_WINDOW // 2 + 1):
        smooth += np.roll(points, offset, axis=0)
    smooth /= SMOOTH_WINDOW

    # 前の点・後の点を取得し、方向を表す2つのベクトルを作る。
    previous = np.roll(smooth, POINT_STEP, axis=0)
    following = np.roll(smooth, -POINT_STEP, axis=0)
    v1 = smooth - previous
    v2 = following - smooth

    # 外積・内積から各点の符号付き曲がり角を求める。
    cross = v1[:, 0] * v2[:, 1] - v1[:, 1] * v2[:, 0]
    dot = np.sum(v1 * v2, axis=1)
    angles = np.degrees(np.arctan2(cross, dot)) * orientation
    scores = -angles          # 正の値が大きいほど「凹方向」へ強く曲がる

    # しきい値以上の候補だけを取得する。
    candidates = np.flatnonzero(scores >= MIN_ANGLE)
    selected = []

    # 強く曲がった点から優先し、近すぎる候補は重複検出しない。
    for index in sorted(candidates, key=lambda i: -scores[i]):
        if all(
            min(abs(index - j), count - abs(index - j)) >= MIN_POINT_GAP
            for j in selected
        ):
            selected.append(int(index))

    # main.py は角度スコアを受け取らないので、整数の (x, y) だけを返す。
    return [
        (int(round(points[i, 0])), int(round(points[i, 1])))
        for i in sorted(selected)
    ]


def detect(contour):
    return {"concavity": _find_local_concavities(contour)}

