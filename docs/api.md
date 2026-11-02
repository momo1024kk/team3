# API の起動と画面への接続

## 起動（Windows のコマンドプロンプト）

`team3` フォルダで実行します。仮想環境をまだ作っていない場合だけ、先に
`python -m venv .venv` を実行してください。

```bat
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.server:app --reload
```

- 画面: http://localhost:8000/
- API を試す画面: http://localhost:8000/docs
- 終了: `Ctrl + C`

`/docs` の `POST /api/detect` を開き、`Try it out` → `file` に
`images/star.png` を指定 → `Execute` の順に押します。
200 と座標が返れば、API 単体の動作を確認できます。

## 画面側との約束

| 項目 | 内容 |
| --- | --- |
| 送信先 | `POST /api/detect` |
| 送り方 | `multipart/form-data` |
| ファイルを入れる項目名 | `file` |
| 画像 | 1枚。PNG / JPEG で確認 |
| 座標 | 元画像の左上が `(0, 0)`、右が x、下が y |
| 戻り値 | `width`、`height`、`points` |
| `points` の項目 | `top`、`bottom`、`left`、`right`、`vertex`、`concavity` |

各項目の点は `[[x, y], ...]` の形です。検出点がない項目も `[]` を返します。
`width` と `height` は元画像の大きさです。縮小して画面に描画するときは、
画面側で画像と座標を同じ倍率にしてください。

画面側の JavaScript から送る例です。`file` は利用者が選んだ File オブジェクトです。

```javascript
async function detectFeatures(file) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/detect", {
    method: "POST",
    body: form,
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(typeof result.detail === "string" ? result.detail : "画像を確認してください。");
  }
  return result;
}
```

`Content-Type` はブラウザが自動で設定するため、自分では指定しません。
戻り値は次の形です（点の値は例です）。

```json
{
  "width": 400,
  "height": 400,
  "points": {
    "top": [[200, 50]],
    "bottom": [[111, 321]],
    "left": [[57, 153]],
    "right": [[342, 153]],
    "vertex": [[200, 50], [111, 321], [342, 153]],
    "concavity": []
  }
}
```

## 画面ファイルの置き方

画面担当が作った HTML を `app/static/index.html` に置きます。
CSS や JavaScript も `app/static/` に置きます。PR #4 のように
`style.css`、`app.js` という相対パスのまま参照できます。
`/static/style.css`、`/static/app.js` という参照方法も使えます。
共有画像は `/images/star.png` のように配信します。
ブラウザでは HTML を直接開かず、http://localhost:8000/ を開いてください。
画面と API が同じ場所から配信されるため、追加の CORS 設定は不要です。

`index.html` がない間は、トップページに起動確認と `/docs` へのリンクが出ます。
本番の画面が置かれたら、その画面を表示します。

## PR #4 の画面を API に切り替えるとき

PR #4 の `app/static/app.js` は、`fetchPoints(name)` で
`mock_points.json` を読んでいます。API が追加されたら、画面担当がこの関数を
次のように置き換えると、本物の検出結果を取得できます。
この API 用パッチには、画面側のファイル変更を含めていません。

```javascript
async function fetchPoints(name) {
  const imageResponse = await fetch("/images/" + name + ".png");
  if (!imageResponse.ok) {
    throw new Error("図形の画像を読み込めません。");
  }
  const form = new FormData();
  form.append("file", await imageResponse.blob(), name + ".png");
  const response = await fetch("/api/detect", { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(typeof result.detail === "string" ? result.detail : "検出に失敗しました。");
  }
  return result;
}
```

この変更後は `let mockData = null;` も不要になります。
画面と API を合わせるときは、uvicorn で起動してください。
`python -m http.server` は静的ファイルを表示するための起動方法です。

## 今回の範囲

- 1枚の画像に図形1つを想定します。複数の輪郭が残った場合は面積が最大のものを使います。
- 図形が検出できない画像は、200 と6種類すべて空の配列を返します。
- 画像として読めないファイルや空ファイルは 400、ファイル未指定は 422 を返します。
- `load_binary()` を再利用するため一時ファイルを使います。読み込み後に自動で削除されます。
- `main.py`、`features/preprocess.py`、3人の検出コードはそのまま呼び出します。
- 現在の `main` ではくぼみ検出が未実装なので `concavity` は空です。
  担当者が既存の `detect(contour)` に実装すれば、API でもその結果を返します。
- 曲線で頂点が多く出る点は、既存の頂点検出の改良で対応する内容です。

## 自動テスト

```bat
pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
python main.py
```

API のテストはサーバーを起動せずに実行できます。共有の6画像、座標と画像サイズ、
白背景・黒背景、JPEG と日本語のファイル名、不正なファイル、画面配信を確認します。

参考: FastAPI 公式の [ファイル受け取り](https://fastapi.tiangolo.com/tutorial/request-files/)
と [静的ファイルの配信](https://fastapi.tiangolo.com/tutorial/static-files/)。
