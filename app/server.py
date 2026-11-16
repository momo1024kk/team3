"""画像を受け取り、3人の検出結果を JSON で返す。

team3 フォルダで起動: uvicorn app.server:app --reload
画像を送るテスト画面: http://localhost:8000/docs
"""
from pathlib import Path
from shutil import copyfileobj
from tempfile import TemporaryDirectory

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from features import concavity, edges_vertices, extremes
from features.preprocess import find_contours_with_hierarchy, find_shapes, load_binary

ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT / "app" / "static"
IMAGES_DIR = ROOT / "images"
LABELS = ("top", "bottom", "left", "right", "vertex", "concavity")


class FeaturePoints(BaseModel):
    """検出点がない種類も、必ず空の配列を返す。"""

    top: list[tuple[int, int]] = Field(default_factory=list)
    bottom: list[tuple[int, int]] = Field(default_factory=list)
    left: list[tuple[int, int]] = Field(default_factory=list)
    right: list[tuple[int, int]] = Field(default_factory=list)
    vertex: list[tuple[int, int]] = Field(default_factory=list)
    concavity: list[tuple[int, int]] = Field(default_factory=list)


class ContourResult(BaseModel):
    """1つの輪郭と、その輪郭上で検出した特徴点。"""

    id: int
    parent_id: int | None
    depth: int
    is_hole: bool
    points: FeaturePoints
    edges: list[tuple[tuple[int, int], tuple[int, int]]]
    arc_midpoints: list[tuple[int, int]]


class DetectionResult(BaseModel):
    width: int
    height: int
    points: FeaturePoints
    contours: list[ContourResult] | None = None


def _matches_boundary(a, b):
    """取得モードで点列の開始位置が変わっても、同じ外縁なら一致とみなす。"""
    if cv2.boundingRect(a) != cv2.boundingRect(b):
        return False
    if cv2.contourArea(a) != cv2.contourArea(b):
        return False
    if np.array_equal(a, b):
        return True
    return {tuple(xy) for xy in a.reshape(-1, 2)} == {
        tuple(xy) for xy in b.reshape(-1, 2)
    }


def _contours_for_shape(binary, primary, primary_points, primary_analysis):
    """従来選択した最大外縁に対応する輪郭と、その子孫だけを返す。"""
    items = find_contours_with_hierarchy(binary, min_area=0)
    root = next(
        (item for item in items if item["parent_index"] is None
         and _matches_boundary(item["contour"], primary)),
        None,
    )
    if root is None:
        # 別の外縁を誤って最大図形に紐付けない。
        raise HTTPException(status_code=500, detail="外側輪郭と階層の対応付けに失敗しました。")

    children = {}
    for item in items:
        children.setdefault(item["parent_index"], []).append(item["index"])
    selected = set()
    pending = [root["index"]]
    while pending:
        index = pending.pop()
        selected.add(index)
        pending.extend(children.get(index, ()))

    result = []
    for item in items:
        if item["index"] not in selected:
            continue
        if item["index"] == root["index"]:
            analysis = primary_analysis
            contour_points = primary_points.copy()
        else:
            contour = item["contour"]
            analysis = edges_vertices.analyze_contour(contour)
            contour_points = {label: [] for label in LABELS}
            for label, coordinates in extremes.detect(contour).items():
                contour_points[label] = [(int(x), int(y)) for x, y in coordinates]
            contour_points["vertex"] = [
                (int(x), int(y)) for x, y in analysis["vertices"]
            ]
            # 穴のくぼみは未評価。外縁・穴内の図形に限って既存処理を使う。
            if not item["is_hole"]:
                contour_points["concavity"] = [
                    (int(x), int(y)) for x, y in concavity.detect(contour)["concavity"]
                ]
        result.append({
            "id": item["index"],
            "parent_id": item["parent_index"],
            "depth": item["depth"],
            "is_hole": item["is_hole"],
            "points": contour_points,
            "edges": [
                ((int(x1), int(y1)), (int(x2), int(y2)))
                for (x1, y1), (x2, y2) in analysis["edges"]
            ],
            "arc_midpoints": [
                (int(x), int(y)) for x, y in analysis["arc_midpoints"]
            ],
        })
    return result


app = FastAPI(title="team3 特徴点検出 API")


@app.middleware("http")
async def check_screen_files_every_time(request: Request, call_next):
    """画面のファイル（index.html・app.js・style.css・画像）が古いまま表示されないようにする。

    ブラウザは一度読んだファイルを覚えておき、次から使い回すことがある。
    そのせいで、app.js などを直しても再読み込みで変わらないことがあった。
    "no-cache" は「使う前に、変わっていないかサーバーに確認して」という意味。
    変わっていなければ短い返事（304）で済むので、遅くはならない。
    """
    response = await call_next(request)
    # API（/api/...）とテスト画面（/docs など）はそのままにする
    if not request.url.path.startswith(("/api/", "/docs", "/redoc", "/openapi.json")):
        response.headers["Cache-Control"] = "no-cache"
    return response


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/images", StaticFiles(directory=IMAGES_DIR), name="images")


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def index():
    """画面担当が用意する index.html を表示する。"""
    index_file = STATIC_DIR / "index.html"
    if index_file.is_file():
        return FileResponse(index_file)

    # 画面が届く前も、起動確認と API 単体のテストができるようにする。
    return HTMLResponse(
        '<!doctype html><html lang="ja"><meta charset="utf-8">'
        '<title>team3 API</title><h1>API が起動しました</h1>'
        '<p>画面は準備中です。</p><p><a href="/docs">'
        '画像を送って API をテストする</a></p></html>'
    )


@app.post("/api/detect", response_model=DetectionResult, response_model_exclude_unset=True)
def detect_image(
    file: UploadFile = File(..., description="図形が1つ写った画像"),
    include_contours: bool = False,
):
    """画像1枚から特徴点を返す。指定時のみ最大図形の輪郭階層も返す。"""
    # 共通の load_binary() はファイルのパスを受け取るため、
    # 送られた画像を一時ファイルにする。処理後は自動で削除される。
    with TemporaryDirectory(prefix="team3_api_") as folder:
        path = Path(folder) / "upload.png"
        with path.open("wb") as output:
            copyfileobj(file.file, output)

        try:
            img, binary = load_binary(path)
        except (FileNotFoundError, cv2.error):
            raise HTTPException(
                status_code=400,
                detail="画像を読み込めません。PNG または JPEG の画像を送ってください。",
            ) from None

    height, width = img.shape[:2]
    points = {label: [] for label in LABELS}
    contours = find_shapes(binary)
    primary = None
    primary_analysis = None

    if contours:
        # 中間発表までは図形1つが対象。複数ある場合は最大の図形を使う。
        primary = max(contours, key=cv2.contourArea)
        if include_contours:
            primary_analysis = edges_vertices.analyze_contour(primary)
            detectors = (extremes, concavity)
        else:
            detectors = (extremes, edges_vertices, concavity)
        for detector in detectors:
            for label, coordinates in detector.detect(primary).items():
                if label in points:
                    # NumPy の整数も、JSON で扱える Python の整数にそろえる。
                    points[label] = [(int(x), int(y)) for x, y in coordinates]
        if include_contours:
            points["vertex"] = [
                (int(x), int(y)) for x, y in primary_analysis["vertices"]
            ]

    result = {"width": int(width), "height": int(height), "points": points}
    if include_contours:
        result["contours"] = (
            _contours_for_shape(binary, primary, points, primary_analysis)
            if primary is not None else []
        )
    return result


# index.html は app.js・style.css などを相対パスで読むため、
# トップページと同じ場所でも画面用ファイルを配信する。
# API と /docs が先に見つかるよう、この設定は最後に置く。
app.mount("/", StaticFiles(directory=STATIC_DIR), name="screen_files")
