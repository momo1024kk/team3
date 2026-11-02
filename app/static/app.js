// ==============================
// team3 スナップ：画面の処理
// ==============================

// 置く図形の画像（images/ フォルダの中のファイル）
const SHAPES = ["star", "square", "circle", "triangle", "cloud", "speech_bubble"];

// 画面に表示するときの図形の大きさ（元の画像は 400×400）
const SHAPE_SIZE = 200;

// スナップする距離（ピクセル）。特徴点どうしの縦か横の位置がこれ以内なら吸い付く
const SNAP_DISTANCE = 6;

// ガイド線の色
const GUIDE_COLOR = "#ff3b7f";

// 特徴点のラベルごとの色と表示文字（main.py の STYLES と同じ色）
const STYLES = {
  top:       { color: "#ff0000", text: "T" },
  bottom:    { color: "#0000ff", text: "B" },
  left:      { color: "#00c800", text: "L" },
  right:     { color: "#ffc800", text: "R" },
  vertex:    { color: "#ff00ff", text: "V" },
  concavity: { color: "#00e5e5", text: "C" },
};

// ---- キャンバスを作る ----
// 白い枠（id="stage" の箱）と同じ大きさにする
const container = document.getElementById("stage");
const stage = new Konva.Stage({
  container: "stage",
  width: container.clientWidth,
  height: container.clientHeight,
});
const layer = new Konva.Layer();  // 図形を置く「層」
stage.add(layer);
const guideLayer = new Konva.Layer({ listening: false });  // ガイド線を描く「層」（図形より手前）
stage.add(guideLayer);

// ウィンドウの大きさが変わったら、キャンバスも白い枠に合わせて大きさを変える
window.addEventListener("resize", () => {
  stage.width(container.clientWidth);
  stage.height(container.clientHeight);
});

// ---- 特徴点を取ってくる ----
// 今は仮のデータ（mock_points.json）から読む。
// API ができたら、この関数の中身だけを「画像を API に送って結果を受け取る」処理に差し替える。
// 戻り値は班で決めた形：{ width, height, points: { top: [[x, y], ...], ... } }
let mockData = null;
async function fetchPoints(name) {
  if (mockData === null) {
    const res = await fetch("mock_points.json");
    mockData = await res.json();
  }
  return mockData[name];
}

// ---- 画像を読み込む ----
// 読み込みが終わるまで待てるように Promise（「終わったら知らせる約束」）で包む
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ---- 画像の白い背景を透明にする ----
// 元の画像は白い背景なので、そのまま重ねると下の図形が隠れてしまう。
// 白に近い色のピクセルを透明にした画像を作って返す。
function makeWhiteTransparent(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;  // [R, G, B, 透明度, R, G, B, 透明度, ...] と並んでいる
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] > 240 && px[i + 1] > 240 && px[i + 2] > 240) {
      px[i + 3] = 0;  // 透明にする
    }
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

// ---- 特徴点の印を作る ----
// result: fetchPoints() の戻り値。座標は元の画像の大きさなので、表示の大きさに合わせて縮める
function makeMarkers(result) {
  const markers = new Konva.Group({ listening: false, name: "markers" });  // 印はクリックの対象にしない
  const scale = SHAPE_SIZE / result.width;

  for (const [label, points] of Object.entries(result.points)) {
    const style = STYLES[label] || { color: "#000000", text: label[0] };
    for (const [x, y] of points) {
      markers.add(new Konva.Circle({
        x: x * scale, y: y * scale, radius: 4, fill: style.color,
      }));
      markers.add(new Konva.Text({
        x: x * scale + 5, y: y * scale - 14, text: style.text,
        fontSize: 12, fontStyle: "bold", fill: style.color,
      }));
    }
  }
  return markers;
}

// ---- 図形を1つキャンバスに置く ----
// 画像と特徴点の印を1つのグループにまとめるので、ドラッグすると一緒に動く
async function addShape(name, x, y) {
  const img = await loadImage("/images/" + name + ".png");
  const result = await fetchPoints(name);

  const group = new Konva.Group({ x: x, y: y, draggable: true, name: name });
  group.add(new Konva.Image({
    image: makeWhiteTransparent(img), width: SHAPE_SIZE, height: SHAPE_SIZE,
  }));
  group.add(makeMarkers(result));

  // 後でスナップに使うので、特徴点のデータをグループに覚えさせておく
  group.setAttr("points", result);

  // マウスを乗せたら、つかめることが分かるようにカーソルを変える
  group.on("mouseenter", () => (stage.container().style.cursor = "grab"));
  group.on("mouseleave", () => (stage.container().style.cursor = "default"));

  // ドラッグ中のスナップ
  group.on("dragstart", () => {
    group.moveToTop();        // つかんだ図形を一番手前にする
    transformer.moveToTop();  // 選択の枠は、さらにその手前
  });
  group.on("dragmove", () => snap(group));
  group.on("dragend", () => guideLayer.destroyChildren());  // 離したらガイド線を消す

  // クリック（またはドラッグ開始）で選択する
  group.on("mousedown touchstart", () => select(group));

  // 大きさを変えている間、印の大きさは変わらないようにする
  group.on("transform", () => keepMarkerSize(group));

  layer.add(group);
}

// ==============================
// 選択・大きさの変更・削除
// ==============================

// 選択した図形のまわりに出る枠。四隅のつまみで大きさを変えられる
const transformer = new Konva.Transformer({
  rotateEnabled: false,  // 回転は、スナップの対応が終わってから
  keepRatio: true,       // 縦横の比率を保つ
  enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right"],
  // 小さくしすぎないようにする（40px 未満にはしない）
  boundBoxFunc: (oldBox, newBox) => (newBox.width < 40 || newBox.height < 40 ? oldBox : newBox),
});
layer.add(transformer);

function select(group) {
  transformer.nodes([group]);
  transformer.moveToTop();
}

// 何もないところをクリックしたら、選択を外す
stage.on("mousedown touchstart", (e) => {
  if (e.target === stage) transformer.nodes([]);
});

// Delete キー（または Backspace キー）で、選択中の図形を消す
window.addEventListener("keydown", (e) => {
  if (e.key !== "Delete" && e.key !== "Backspace") return;
  for (const node of transformer.nodes()) node.destroy();
  transformer.nodes([]);
});

// 図形を拡大・縮小すると、中の印や文字まで一緒に大きくなってしまう。
// 印1つ1つを逆向きに縮めて、見た目の大きさを保つ
function keepMarkerSize(group) {
  const markers = group.findOne(".markers");
  for (const mark of markers.getChildren()) {
    mark.scaleX(1 / group.scaleX());
    mark.scaleY(1 / group.scaleY());
  }
}

// ==============================
// スナップ
// ==============================

// 図形の特徴点を、キャンバス全体での座標（画面上の位置）にして返す
// getTransform() は「図形の位置と拡大率」をまとめたもの。これで大きさを変えた図形にも対応できる
function canvasPoints(group) {
  const result = group.getAttr("points");
  const scale = SHAPE_SIZE / result.width;
  const transform = group.getTransform();
  const list = [];
  for (const points of Object.values(result.points)) {
    for (const [x, y] of points) {
      list.push(transform.point({ x: x * scale, y: y * scale }));
    }
  }
  return list;
}

// 動かしている図形の点と、他の図形の点の組み合わせの中から、
// axis（"x" か "y"）の位置の差が一番小さいものを探す。SNAP_DISTANCE より遠ければ null
function findClosest(movingPoints, otherPoints, axis) {
  let best = null;
  for (const m of movingPoints) {
    for (const o of otherPoints) {
      const diff = o[axis] - m[axis];
      if (Math.abs(diff) <= SNAP_DISTANCE && (best === null || Math.abs(diff) < Math.abs(best))) {
        best = diff;
      }
    }
  }
  return best;
}

// ガイド線を1本描く。2つの点を結ぶ線を、少しはみ出す長さで描き、両端の点に輪を付ける
function drawGuide(a, b, axis) {
  const margin = 20;
  const points = axis === "x"
    ? [a.x, Math.min(a.y, b.y) - margin, a.x, Math.max(a.y, b.y) + margin]  // 縦の線
    : [Math.min(a.x, b.x) - margin, a.y, Math.max(a.x, b.x) + margin, a.y]; // 横の線
  guideLayer.add(new Konva.Line({ points: points, stroke: GUIDE_COLOR, strokeWidth: 1, dash: [4, 4] }));
  for (const p of [a, b]) {
    guideLayer.add(new Konva.Circle({ x: p.x, y: p.y, radius: 7, stroke: GUIDE_COLOR, strokeWidth: 2 }));
  }
}

// ドラッグ中に毎回呼ばれる：近い点があれば吸い付かせて、ガイド線を描く
function snap(moving) {
  guideLayer.destroyChildren();  // 前回のガイド線を消す

  // 他の図形の点を全部集める
  const others = layer.getChildren((node) => node !== moving && node.getAttr("points"));
  const otherPoints = others.flatMap(canvasPoints);

  // 1. 横方向（x）と縦方向（y）それぞれで、一番近いずれを探して、その分だけ動かす（吸い付き）
  const dx = findClosest(canvasPoints(moving), otherPoints, "x");
  const dy = findClosest(canvasPoints(moving), otherPoints, "y");
  if (dx !== null) moving.x(moving.x() + dx);
  if (dy !== null) moving.y(moving.y() + dy);

  // 2. 吸い付いた後の位置で、ぴったり揃っている点の組み合わせ全部にガイド線を描く
  const movingPoints = canvasPoints(moving);
  for (const m of movingPoints) {
    for (const o of otherPoints) {
      if (dx !== null && Math.abs(o.x - m.x) < 0.5) drawGuide(m, o, "x");
      if (dy !== null && Math.abs(o.y - m.y) < 0.5) drawGuide(m, o, "y");
    }
  }
}

// ---- 最初の配置：6つの図形を横に3つずつ並べる ----
SHAPES.forEach((name, i) => {
  const col = i % 3;
  const row = Math.floor(i / 3);
  addShape(name, 40 + col * (SHAPE_SIZE + 40), 20 + row * (SHAPE_SIZE + 20));
});
