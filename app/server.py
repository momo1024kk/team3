"""画像を受け取り、3人の検出結果を JSON で返す。

team3 フォルダで起動: uvicorn app.server:app --reload
画像を送るテスト画面: http://localhost:8000/docs
"""
from pathlib import Path
from shutil import copyfileobj
from tempfile import TemporaryDirectory

import cv2
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from features import concavity, edges_vertices, extremes
from features.preprocess import find_shapes, load_binary

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


class DetectionResult(BaseModel):
    width: int
    height: int
    points: FeaturePoints


app = FastAPI(title="team3 特徴点検出 API")
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


@app.post("/api/detect", response_model=DetectionResult)
def detect_image(file: UploadFile = File(..., description="図形が1つ写った画像")):
    """画像1枚から、元画像の大きさと6種類の特徴点を返す。"""
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

    if contours:
        # 中間発表までは図形1つが対象。複数ある場合は最大の図形を使う。
        contour = max(contours, key=cv2.contourArea)
        for detector in (extremes, edges_vertices, concavity):
            for label, coordinates in detector.detect(contour).items():
                if label in points:
                    # NumPy の整数も、JSON で扱える Python の整数にそろえる。
                    points[label] = [(int(x), int(y)) for x, y in coordinates]

    return {"width": int(width), "height": int(height), "points": points}


# index.html は app.js・style.css などを相対パスで読むため、
# トップページと同じ場所でも画面用ファイルを配信する。
# API と /docs が先に見つかるよう、この設定は最後に置く。
app.mount("/", StaticFiles(directory=STATIC_DIR), name="screen_files")
