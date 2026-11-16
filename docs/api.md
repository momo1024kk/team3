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
通常の `POST /api/detect` は従来どおり、この3つの最上位項目だけを返します。
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

## 内側輪郭の取得（任意）

同じ画像を `POST /api/detect?include_contours=true` に送ると、従来の
`width`、`height`、`points` に加えて `contours` を返します。
通常呼び出しでは `contours` キー自体がなく、内側輪郭の追加探索も行いません。
最上位の `points` は引き続き最大の外側輪郭だけの結果で、内側の点は混ぜません。

`contours` は最大外側輪郭と、その穴・穴の中の図形などの子孫だけです。
別の独立した図形は含めません。輪郭がない場合は拡張呼び出しで `contours: []`、
通常呼び出しでは従来の6種類の空配列だけを返します。

| 輪郭ごとの項目 | 内容 |
| --- | --- |
| `id` | OpenCV の輪郭番号。この応答内だけで有効。配列の添字とは限らない |
| `parent_id` | 親の輪郭番号。最上位は `null` |
| `depth` / `is_hole` | 深さ0は外縁。奇数の深さが穴で `is_hole: true` |
| `points` | この輪郭上の上下左右・頂点・くぼみ。従来と同じ6種類、各項目は必ず配列 |
| `edges` | 直線辺の端点ペアの配列。例: `[[[10,10],[90,10]], ...]` |
| `arc_midpoints` | 鋭い頂点に挟まれた曲線区間上の中点候補。例: `[[50,20], ...]` |

座標はすべて元画像基準の整数です。`id` と `parent_id` はフィルタ前の
輪郭番号を使うため連番とは限らず、再検出後の永続的な識別子でもありません。
生の輪郭全座標と面積は返しません。穴の `points.concavity` は初期版では
**未評価のため `[]`** とします。「くぼみが存在しない」という意味ではありません。
外縁や穴の中の図形のくぼみは既存の検出処理を使います。
円のように鋭い頂点がない輪郭では `arc_midpoints` も空になり得ます。

例（穴あき四角形、座標と輪郭番号は説明用）：

```json
{
  "width": 100,
  "height": 100,
  "points": {
    "top": [[50, 10]], "bottom": [[50, 90]],
    "left": [[10, 50]], "right": [[90, 50]],
    "vertex": [[10, 10], [90, 10], [90, 90], [10, 90]], "concavity": []
  },
  "contours": [
    {
      "id": 0, "parent_id": null, "depth": 0, "is_hole": false,
      "points": {
        "top": [[50, 10]], "bottom": [[50, 90]],
        "left": [[10, 50]], "right": [[90, 50]],
        "vertex": [[10, 10], [90, 10], [90, 90], [10, 90]], "concavity": []
      },
      "edges": [
        [[10, 10], [90, 10]], [[90, 10], [90, 90]],
        [[90, 90], [10, 90]], [[10, 90], [10, 10]]
      ],
      "arc_midpoints": []
    },
    {
      "id": 1, "parent_id": 0, "depth": 1, "is_hole": true,
      "points": {
        "top": [[50, 30]], "bottom": [[50, 70]],
        "left": [[30, 50]], "right": [[70, 50]],
        "vertex": [[30, 30], [70, 30], [70, 70], [30, 70]], "concavity": []
      },
      "edges": [
        [[30, 30], [70, 30]], [[70, 30], [70, 70]],
        [[70, 70], [30, 70]], [[30, 70], [30, 30]]
      ],
      "arc_midpoints": []
    }
  ]
}
```

画面側が内側の点を使う際は `contours[].points` を明示的に参照してください。
現行画面は `result.points` のみを描画・スナップに使うので、今回は変更不要です。
通常モードと拡張モードを画面で切り替える場合は、図形名だけをキーにした
既存キャッシュをモード別に分ける必要があります。輪郭線の描画や内側点の
スナップへの追加は、このAPI変更だけでは行われません。

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

## 現在の画面との接続

現在の `app/static/app.js` は `fetchPoints(name)` で図形画像を
`POST /api/detect` に送信し、`result.points` をマーカー表示とスナップに使用しています。
今回の拡張指定は画面側でまだ使っていません。必要な図形だけ拡張指定で送る場合、
通常と拡張で結果キャッシュを分け、内側の点を表示・スナップに使うかを
画面担当と決める必要があります。

画面と API を合わせるときは、uvicorn で起動してください。
`python -m http.server` は静的ファイルを表示するための起動方法です。

## 現在の範囲

- 1枚の画像に図形1つを想定します。複数の独立した外側輪郭がある場合は最大のものを使います。
- 図形が検出できない画像は200と6種類すべて空の配列を返します。拡張指定では `contours: []` も返します。
- 画像として読めないファイルや空ファイルは 400、ファイル未指定は 422 を返します。
- `load_binary()` を再利用するため一時ファイルを使います。読み込み後に自動で削除されます。
- 既存の `find_shapes()` と3人の検出アルゴリズムは変更しません。
  拡張指定時のみ `find_contours_with_hierarchy()` を追加で使います。
- くぼみ検出は実装済みです。穴に対する意味付けは今後の検証対象です。

## 自動テスト

```bat
pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
python main.py
```

API のテストはサーバーを起動せずに実行できます。共有の6画像、座標と画像サイズ、
白背景・黒背景、JPEG と日本語のファイル名、不正なファイル、画面配信を確認します。
拡張APIのテストは二重四角形・二重三角形・6階層、親子関係、小さな穴、
最大外側図形の選択、通常応答との一致を確認します。

参考: FastAPI 公式の [ファイル受け取り](https://fastapi.tiangolo.com/tutorial/request-files/)
と [静的ファイルの配信](https://fastapi.tiangolo.com/tutorial/static-files/)。
