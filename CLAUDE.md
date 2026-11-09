# CLAUDE.md

画像の図形から特徴点（上下左右・頂点と辺・くぼみ）を検出する、大学の授業の班課題（Python / OpenCV）。
メンバーは Git と Python の初学者。詳しいルールは README.md を参照。

## コマンド
- 実行：`python main.py`（images/ の全画像を処理し、結果を output/ に保存）
- テスト画像の再生成：`python make_samples.py`
- メンバーは Windows（コマンドプロンプト）を使う。手順を案内するときは Windows のコマンドで書く
  （例：`.venv\Scripts\activate`、`rmdir /s /q`）

## コードの約束
- 各担当ファイルの `detect(contour)` は `{ラベル: [(x, y), ...]}` を返す。座標は int
- ラベル：extremes.py → top/bottom/left/right、edges_vertices.py → vertex、concavity.py → concavity
- 新しいラベルを足すときは main.py の STYLES に色も追加する
- 変更したら `python main.py` で全画像が最後まで動くことを確認する

## 担当（他の人の担当ファイルは、頼まれない限り編集しない）
- features/extremes.py：momo1024kk
- features/edges_vertices.py：koma-0704
- features/concavity.py：y240197
- features/preprocess.py と main.py は全員が使う共通部分。変える前に必ず確認する

## Git
- main は保護されていて直接 push できない。`feature/〇〇`・`fix/〇〇`・`docs/〇〇` のブランチで作業し、プルリクエストを出す
- プルリクエストは .github/pull_request_template.md に沿って日本語で書く
- 強制 push・履歴の書き換えはしない

## 注意
- 公開リポジトリなので、本名・学籍番号・メールアドレスをコード、コミット、プルリクエストに書かない。担当者は GitHub のアカウント名で書く
- 授業の課題なので、コードには初学者が読んで分かる日本語のコメントをつける。説明も専門用語を避けて分かりやすく
