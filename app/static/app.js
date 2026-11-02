// ==============================
// team3 スナップ：画面の処理
// ==============================

// 置く図形の画像（images/ フォルダの中のファイル）
const SHAPES = ["star", "square", "circle", "triangle", "cloud", "speech_bubble"];

// 画面に表示するときの図形の大きさ（元の画像は 400×400）
const SHAPE_SIZE = 200;

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
  const markers = new Konva.Group({ listening: false });  // 印はクリックの対象にしない
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

  layer.add(group);
}

// ---- 最初の配置：6つの図形を横に3つずつ並べる ----
SHAPES.forEach((name, i) => {
  const col = i % 3;
  const row = Math.floor(i / 3);
  addShape(name, 40 + col * (SHAPE_SIZE + 40), 20 + row * (SHAPE_SIZE + 20));
});
