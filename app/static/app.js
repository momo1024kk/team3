// ==============================
// team3 スナップ：画面の処理
// ==============================

// 置く図形の画像（images/ フォルダの中のファイル）
const SHAPES = ["star", "square", "circle", "triangle", "cloud", "speech_bubble"];

// 画面に表示するときの図形の大きさ（元の画像は 400×400）
const SHAPE_SIZE = 200;

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

// ---- 図形を1つキャンバスに置く ----
function addShape(name, x, y) {
  const img = new Image();
  img.onload = () => {
    const shape = new Konva.Image({
      image: makeWhiteTransparent(img),
      x: x,
      y: y,
      width: SHAPE_SIZE,
      height: SHAPE_SIZE,
      draggable: true,  // マウスでドラッグできるようにする
      name: name,
    });

    // マウスを乗せたら、つかめることが分かるようにカーソルを変える
    shape.on("mouseenter", () => (stage.container().style.cursor = "grab"));
    shape.on("mouseleave", () => (stage.container().style.cursor = "default"));

    layer.add(shape);
  };
  img.src = "/images/" + name + ".png";
}

// ---- 最初の配置：6つの図形を横に3つずつ並べる ----
SHAPES.forEach((name, i) => {
  const col = i % 3;
  const row = Math.floor(i / 3);
  addShape(name, 40 + col * (SHAPE_SIZE + 40), 20 + row * (SHAPE_SIZE + 20));
});
