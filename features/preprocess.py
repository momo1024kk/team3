"""全員で共通に使う前処理：画像読み込み → 二値化 → 輪郭抽出

ここを変更するときは、全員の結果に影響するのでチームに相談すること。
"""
import cv2
import numpy as np


def load_binary(path):
    """画像を読み込み、(元画像, 二値画像) を返す。
    二値画像は 図形=白(255)、背景=黒(0)。白背景・黒背景どちらの画像でもOK。"""
    img = cv2.imread(str(path))
    if img is None:
        raise FileNotFoundError(path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # 大津の二値化（しきい値を自動で決める）
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # 背景が白なら反転（四隅の色で判定）
    corners = [binary[0, 0], binary[0, -1], binary[-1, 0], binary[-1, -1]]
    if np.mean(corners) > 127:
        binary = cv2.bitwise_not(binary)
    return img, binary


def find_shapes(binary, min_area=100):
    """図形の外側の輪郭のリストを返す（面積 min_area 未満のゴミは除く）。
    輪郭は OpenCV の形式（shape = (点の数, 1, 2)、各点は (x, y)）。"""
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    return [c for c in contours if cv2.contourArea(c) >= min_area]


def find_contours_with_hierarchy(binary, min_area=0):
    """外縁・穴・穴の中の図形を、親子関係とともに返す。

    図形=白の二値画像を入力し、輪郭ごとに次の辞書を返す:
    {"index": int, "contour": OpenCV輪郭, "parent_index": int | None,
     "depth": int, "is_hole": bool, "area": float}
    index と parent_index はフィルタ前の OpenCV 輪郭番号。深さ0は外縁、
    奇数は穴の縁、偶数（0以外）は穴の中の図形の外縁を表す。
    小さな穴も取得できるよう、面積フィルタは既定では無効にする。
    輪郭がない場合は空リストを返す。
    """
    contours, hierarchy = cv2.findContours(binary, cv2.RETR_TREE, cv2.CHAIN_APPROX_NONE)
    if hierarchy is None:
        return []

    parents = hierarchy[0, :, 3]
    result = []
    for index, contour in enumerate(contours):
        area = cv2.contourArea(contour)
        if area < min_area:
            continue
        parent = int(parents[index])
        depth = 0
        ancestor = parent
        while ancestor != -1:
            depth += 1
            ancestor = int(parents[ancestor])
        result.append({
            "index": index,
            "contour": contour,
            "parent_index": parent if parent != -1 else None,
            "depth": depth,
            "is_hole": depth % 2 == 1,
            "area": area,
        })
    return result
