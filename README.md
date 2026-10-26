# team3 — 図形の特徴点検出

画像認識の授業の班課題です。画像の図形から、次の3種類の特徴点を検出します。
対象は簡単な図形（円・四角・三角）から、星・吹き出し・雲のような複雑な図形までです。

| 特徴点 | ファイル | 担当 |
| --- | --- | --- |
| 上下左右 | `features/extremes.py` | @momo1024kk |
| 頂点・辺 | `features/edges_vertices.py` | @koma-0704 |
| くぼみ | `features/concavity.py` | @y240197 |

## フォルダ構成

```
team3/
├── main.py              # 実行用：全員の検出結果を1枚の画像に重ねて output/ に保存
├── make_samples.py      # テスト画像を images/ に作る
├── requirements.txt     # 必要なライブラリ
├── images/              # テスト画像（全員で共有）
├── output/              # 実行結果（各自で生成。Git には上げない）
└── features/
    ├── preprocess.py      # 共通：読み込み → 二値化 → 輪郭抽出
    ├── extremes.py        # 上下左右
    ├── edges_vertices.py  # 頂点・辺
    └── concavity.py       # くぼみ
```

## 環境構築と実行

```bash
# 1. 仮想環境を作る（最初の1回だけ）
python -m venv .venv
# Windows:      .venv\Scripts\activate
# Mac / Linux:  source .venv/bin/activate

# 2. ライブラリを入れる
pip install -r requirements.txt

# 3. 実行
python main.py              # images/ の全画像
python main.py star.png     # 1枚だけ
```

結果の画像は `output/` に保存されます。

## コードのルール

### 検出関数の形をそろえる

`main.py` から全員の結果をまとめて呼ぶため、各ファイルには同じ形の関数 `detect` を作ります。

```python
def detect(contour):
    """contour: features/preprocess.py の find_shapes() が返す輪郭1つ"""
    return {"ラベル": [(x1, y1), (x2, y2), ...]}
```

- 座標は `int` の `(x, y)` にする（左上が原点、y は下向きが正）
- ラベル名は次のとおり。新しく追加するときは `main.py` の `STYLES` に色も追加する

| ファイル | ラベル |
| --- | --- |
| extremes.py | `top`, `bottom`, `left`, `right` |
| edges_vertices.py | `vertex` |
| concavity.py | `concavity` |

### 共通部分

- `features/preprocess.py` と `main.py` は全員が使います。変更するときはチームに一言相談してください
- テスト画像は `images/` に入れて共有します。どんな図形で試したかがみんなに分かるようにするためです

## Git のルール

1. **`main` に直接 push しない**
2. 作業前に最新の `main` を取り込む
   ```bash
   git checkout main
   git pull
   ```
3. 自分用のブランチを作って作業する（名前は `feature/内容`）
   ```bash
   git checkout -b feature/extremes
   ```
4. こまめにコミットして push する
   ```bash
   git add .
   git commit -m "星形の上下左右に対応"
   git push -u origin feature/extremes
   ```
5. GitHub でプルリクエストを作り、**他のメンバー1人に見てもらってから** `main` にマージする

## メモ・検討中のこと

- 一番下などの点が同じ高さに2つ以上並ぶ場合（星の下の2つの先端など）、今は片方だけを返している。両方返すかどうか班で決める
