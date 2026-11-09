// ==============================
// team3 スナップ：画面の処理
// ==============================

// 置く図形の画像（images/ フォルダの中のファイル）と、ボタンに出す日本語の名前
const SHAPES = ["star", "square", "circle", "triangle", "cloud", "speech_bubble"];
const SHAPE_NAMES = {
  star: "星", square: "四角形", circle: "円",
  triangle: "三角形", cloud: "雲", speech_bubble: "吹き出し",
};

// 画面に表示するときの図形の大きさ（元の画像は 400×400）
const SHAPE_SIZE = 200;

// スライドの大きさ。図形の位置や大きさは、すべてこのスライドの中での座標で表す。
// 画面（ウィンドウ）の大きさが変わったら、キャンバス全体を拡大・縮小して合わせるので、この座標は変わらない
const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;

// スナップする距離（画面上のピクセル）。特徴点どうしの縦か横の位置がこれ以内なら吸い付く
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

// 「特徴点を表示」のチェックボックス
const showMarkers = document.getElementById("show-markers");

// ---- キャンバスを作る ----
// 白い枠（id="stage" の箱）と同じ大きさにする
const container = document.getElementById("stage");
const stage = new Konva.Stage({
  container: "stage",
  width: container.clientWidth,
  height: container.clientHeight,
});
const slideLayer = new Konva.Layer({ listening: false });  // スライドを描く「層」（一番奥）
stage.add(slideLayer);
const layer = new Konva.Layer();  // 図形を置く「層」
stage.add(layer);
const guideLayer = new Konva.Layer({ listening: false });  // ガイド線を描く「層」（図形より手前）
stage.add(guideLayer);

// ---- スライド（16:9 の白い四角）----
// スライドの左上が座標 (0, 0)、右下が (SLIDE_WIDTH, SLIDE_HEIGHT)
const slide = new Konva.Rect({
  x: 0, y: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT,
  fill: "#ffffff",
  shadowColor: "black", shadowOpacity: 0.15, shadowBlur: 8, shadowOffsetY: 2,
});
slideLayer.add(slide);

// スライドが作業スペースの真ん中に、はみ出さない一番大きいサイズで見えるように、
// キャンバス全体の拡大率（scale）と位置をずらす。図形の座標そのものは変えない
function layoutStage() {
  const pad = 32;  // スライドのまわりの余白（画面上のピクセル）
  const scale = Math.max(0.1, Math.min(
    (stage.width() - pad * 2) / SLIDE_WIDTH,
    (stage.height() - pad * 2) / SLIDE_HEIGHT,
  ));
  stage.scale({ x: scale, y: scale });
  stage.position({
    x: (stage.width() - SLIDE_WIDTH * scale) / 2,
    y: (stage.height() - SLIDE_HEIGHT * scale) / 2,
  });
}
layoutStage();

// スライドの「端」と「中央」の線。図形の特徴点はここにも吸い付く
function slideLines() {
  const { x, y, width, height } = slide.attrs;
  return {
    x: [x, x + width / 2, x + width],    // 左端・中央・右端（縦の線）
    y: [y, y + height / 2, y + height],  // 上端・中央・下端（横の線）
  };
}

// ウィンドウの大きさが変わったら、キャンバスの大きさと拡大率を合わせ直す。
// 図形はスライドの座標で置いてあるので、スライドと一緒に拡大・縮小され、位置はずれない
window.addEventListener("resize", () => {
  stage.width(container.clientWidth);
  stage.height(container.clientHeight);
  layoutStage();
});

// ---- 特徴点を取ってくる ----
// 図形の画像を API（POST /api/detect）に送って、画像処理で見つけた特徴点を受け取る。
// 戻り値は班で決めた形：{ width, height, points: { top: [[x, y], ...], ... } }
// 同じ図形を何回追加しても結果は同じなので、1回目の結果を覚えておいて使い回す
const pointsCache = {};

async function fetchPoints(name) {
  if (pointsCache[name]) return pointsCache[name];

  // 1. 図形の画像ファイルを読み込む
  const imageResponse = await fetch("/images/" + name + ".png");
  if (!imageResponse.ok) throw new Error("図形の画像を読み込めません：" + name);

  // 2. 画像を API に送る（フォームでファイルを送るのと同じ形）
  const form = new FormData();
  form.append("file", await imageResponse.blob(), name + ".png");
  const response = await fetch("/api/detect", { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(typeof result.detail === "string" ? result.detail : "特徴点の検出に失敗しました");
  }

  pointsCache[name] = result;
  return result;
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
  const markers = new Konva.Group({
    listening: false,  // 印はクリックの対象にしない
    name: "markers",
    visible: showMarkers.checked,  // 「特徴点を表示」のチェックに合わせる
  });
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

// エラーのお知らせを出している最中かどうか
let errorShown = false;

// ---- 図形を1つキャンバスに置く ----
// 画像と特徴点の印を1つのグループにまとめるので、ドラッグすると一緒に動く
async function addShape(name, x, y) {
  let img, result;
  try {
    img = await loadImage("/images/" + name + ".png");
    result = await fetchPoints(name);
  } catch (error) {
    // API が起動していないときなどは、図形を置かずに理由を知らせる（同時に失敗しても知らせるのは1回だけ）
    if (!errorShown) {
      errorShown = true;
      alert("図形を追加できませんでした。\n" + error.message +
            "\n\nuvicorn app.server:app --reload で起動しているか確認してください。");
      setTimeout(() => (errorShown = false), 1000);
    }
    throw error;
  }

  // name の "item" は「スライドに置いた部品」の目印（図形もテキストも付ける）
  const group = new Konva.Group({ x: x, y: y, draggable: true, name: "item " + name });
  group.add(new Konva.Image({
    image: makeWhiteTransparent(img), width: SHAPE_SIZE, height: SHAPE_SIZE,
  }));
  group.add(makeMarkers(result));

  // 後でスナップに使うので、特徴点のデータをグループに覚えさせておく
  group.setAttr("points", result);

  makeMovable(group);

  // 大きさを変えている間、印の大きさは変わらないようにする
  group.on("transform", () => keepMarkerSize(group));

  layer.add(group);
  return group;
}

// ---- 図形・テキストに共通の動き（ドラッグ・スナップ・選択）を付ける ----
function makeMovable(node) {
  // マウスを乗せたら、つかめることが分かるようにカーソルを変える
  node.on("mouseenter", () => (stage.container().style.cursor = "grab"));
  node.on("mouseleave", () => (stage.container().style.cursor = "default"));

  // ドラッグ中のスナップ
  node.on("dragstart", () => {
    node.moveToTop();         // つかんだものを一番手前にする
    transformer.moveToTop();  // 選択の枠は、さらにその手前
  });
  node.on("dragmove", () => snap(node));
  node.on("dragend", () => guideLayer.destroyChildren());  // 離したらガイド線を消す

  // クリック（またはドラッグ開始）で選択する
  node.on("mousedown touchstart", () => select(node));
}

// ==============================
// テキスト
// ==============================

// 新しいテキストの最初の見た目
const TEXT_DEFAULTS = {
  text: "テキスト",
  fontSize: 40,  // スライドの座標での大きさ（スライドの幅は 1280）
  fontFamily: document.querySelector("#font-family option").value,  // 一覧の一番上（ゴシック体）
  fill: "#222222",
  fontStyle: "normal",
};

// ---- テキストを1つキャンバスに置く ----
function addText(x, y) {
  const text = new Konva.Text({ ...TEXT_DEFAULTS, x: x, y: y, draggable: true, name: "item text" });
  makeMovable(text);

  // ダブルクリック（スマホではダブルタップ）で文字を編集する
  text.on("dblclick dbltap", () => startEditing(text));

  // 四隅のつまみで大きさを変えたら、引き伸ばすのではなく文字の大きさ（fontSize）に直す。
  // こうすると、文字の設定欄の「大きさ」と見た目がいつも一致する
  text.on("transformend", () => {
    text.fontSize(Math.round(text.fontSize() * text.scaleX()));
    text.scale({ x: 1, y: 1 });
    updateTextTools();
  });

  layer.add(text);
  return text;
}

// ---- 文字の編集 ----
// Konva には文字を直接打ち込む機能がないので、HTML の入力欄（textarea）を
// テキストの上にぴったり重ねて出し、打ち終わったら内容をテキストに戻す
// 文字を編集している間だけ、編集を終わらせる関数が入る（編集していないときは null）
let stopEditing = null;

function startEditing(text) {
  transformer.nodes([]);
  updateTextTools();
  text.hide();  // 編集中は、下のテキストを隠して入力欄だけ見せる

  const area = document.createElement("textarea");
  area.className = "text-editor";
  area.value = text.text();
  Object.assign(area.style, {
    fontFamily: text.fontFamily(),
    fontWeight: text.fontStyle().includes("bold") ? "bold" : "normal",
    lineHeight: text.lineHeight(),
    color: text.fill(),
  });
  container.appendChild(area);

  // 入力欄を、テキストの画面上の位置と大きさにぴったり合わせる。
  // ウィンドウの大きさが変わるとスライドの拡大率が変わるので、そのたびに合わせ直す
  function place() {
    const scale = stage.scaleX() * text.scaleX();  // 画面上での文字の拡大率
    const box = text.getClientRect();              // 画面上でのテキストの位置
    area.style.left = box.x + "px";
    area.style.top = box.y + "px";
    area.style.fontSize = text.fontSize() * scale + "px";
    // 打った文字の量に合わせて、入力欄の大きさを広げる
    area.style.width = "0px";
    area.style.height = "0px";
    area.style.width = area.scrollWidth + text.fontSize() * scale + "px";  // 次の1文字ぶん余裕を持たせる
    area.style.height = area.scrollHeight + "px";
  }
  place();
  area.addEventListener("input", place);
  window.addEventListener("resize", place);
  area.focus();
  area.select();  // 最初は全部選んだ状態にして、すぐに打ち直せるようにする

  let finished = false;
  // save が true なら打った内容を残す、false なら元に戻す。
  // reselect が true なら、終わったあとにこのテキストを選んだ状態にする
  function finish(save, reselect = true) {
    if (finished) return;  // 2回呼ばれても1回だけ処理する
    finished = true;
    stopEditing = null;
    window.removeEventListener("resize", place);
    if (save) text.text(area.value);
    area.remove();
    text.show();
    if (text.text().trim() === "") {
      // 空っぽになったテキストは消す
      text.destroy();
    } else if (reselect && transformer.nodes().length === 0) {
      // ほかのものが選ばれていなければ、このテキストを選ぶ。
      // 入力中に別の図形をクリックしたときは、その図形の選択をそのまま残す
      // （ここで上書きすると、Delete キーでクリックした図形ではなくテキストが消えてしまう）
      select(text);
    }
  }
  stopEditing = finish;

  area.addEventListener("keydown", (e) => {
    // 日本語の変換中（isComposing）の Enter は「変換の確定」なので、編集は終わらせない
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();  // Enter で確定。改行したいときは Shift + Enter
      finish(true);
    } else if (e.key === "Escape") {
      finish(false);       // Esc で取り消し
    }
  });
  // 入力欄の外をクリックしたときも確定する
  area.addEventListener("blur", () => finish(true));
}

// 「T」ボタン：スライドの真ん中にテキストを置いて、すぐに編集を始める
document.getElementById("add-text").addEventListener("click", () => {
  const shift = (addCount++ % 5) * 20;
  const text = addText(0, 0);
  // 文字の大きさが分かってから、真ん中に来るように位置を決める
  text.position({
    x: slide.width() / 2 - text.width() / 2 + shift,
    y: slide.height() / 2 - text.height() / 2 + shift,
  });
  startEditing(text);
});

// ---- 文字の設定欄（フォント・大きさ・色・太字）----
const textTools = document.getElementById("text-tools");
const fontFamilyInput = document.getElementById("font-family");
const fontSizeInput = document.getElementById("font-size");
const fontColorInput = document.getElementById("font-color");
const fontBoldInput = document.getElementById("font-bold");

// 今選んでいるテキスト。テキスト以外を選んでいるとき・何も選んでいないときは null
function selectedText() {
  const node = transformer.nodes()[0];
  return node && node.hasName("text") ? node : null;
}

// 設定欄の表示を、選んでいるテキストに合わせる
function updateTextTools() {
  const text = selectedText();
  textTools.disabled = !text;
  if (!text) return;
  fontFamilyInput.value = text.fontFamily();
  fontSizeInput.value = text.fontSize();
  fontColorInput.value = text.fill();
  fontBoldInput.checked = text.fontStyle().includes("bold");
}

// 設定欄を変えたら、選んでいるテキストに反映する
function changeText(apply) {
  const text = selectedText();
  if (!text) return;
  apply(text);
  transformer.forceUpdate();  // 文字の大きさが変わるので、選択の枠も合わせ直す
}

fontFamilyInput.addEventListener("change", () => changeText((t) => t.fontFamily(fontFamilyInput.value)));
fontColorInput.addEventListener("input", () => changeText((t) => t.fill(fontColorInput.value)));
fontBoldInput.addEventListener("change", () => {
  changeText((t) => t.fontStyle(fontBoldInput.checked ? "bold" : "normal"));
});
fontSizeInput.addEventListener("input", () => {
  const size = Number(fontSizeInput.value);
  if (size >= 8 && size <= 200) changeText((t) => t.fontSize(size));  // 打ちかけの変な値は無視する
});

// ==============================
// 図形を追加するボタン
// ==============================

// 続けて追加したときに、ぴったり重ならないように少しずつずらす
let addCount = 0;

const buttonBox = document.getElementById("shape-buttons");
for (const name of SHAPES) {
  const button = document.createElement("button");
  button.title = SHAPE_NAMES[name] + "を追加";  // マウスを乗せると出る説明
  button.innerHTML = `<img src="/images/${name}.png" alt="${SHAPE_NAMES[name]}">`;
  button.addEventListener("click", async () => {
    // スライドの真ん中に置く（ずらしは 20px ずつ、5回で元に戻る）
    const shift = (addCount++ % 5) * 20;
    const x = slide.x() + slide.width() / 2 - SHAPE_SIZE / 2 + shift;
    const y = slide.y() + slide.height() / 2 - SHAPE_SIZE / 2 + shift;
    const group = await addShape(name, x, y);
    select(group);  // 追加した図形を選んだ状態にする
  });
  buttonBox.appendChild(button);
}

// ==============================
// 特徴点の表示 ON/OFF
// ==============================

// チェックを切り替えたら、すべての図形の印を表示する／隠す（スナップは効いたまま）
showMarkers.addEventListener("change", () => {
  for (const markers of layer.find(".markers")) markers.visible(showMarkers.checked);
});

// ==============================
// 選択・大きさの変更・削除
// ==============================

// 選択した図形のまわりに出る枠。四隅のつまみで大きさを変えられる
const transformer = new Konva.Transformer({
  rotateEnabled: false,  // 回転は、スナップの対応が終わってから
  keepRatio: true,       // 縦横の比率を保つ
  enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right"],
  // 小さくしすぎないようにする（スライドの座標で 20 未満には縮めない）。
  // newBox は画面上のピクセルなので、拡大率をかけて比べる。
  // 最初から小さい文字でも大きくはできるように、縮めるときだけ止める
  boundBoxFunc: (oldBox, newBox) => {
    const min = 20 * stage.scaleX();
    const tooSmall = newBox.width < min || newBox.height < min;
    return tooSmall && newBox.width < oldBox.width ? oldBox : newBox;
  },
});
layer.add(transformer);

function select(node) {
  transformer.nodes([node]);
  transformer.moveToTop();
  updateTextTools();  // テキストを選んだら、文字の設定欄を使えるようにする
}

// 何もないところをクリックしたら、選択を外す
stage.on("mousedown touchstart", (e) => {
  if (e.target === stage) {
    // 文字の編集中なら、打った内容を残して終わらせる。何もないところを押したので、何も選ばない
    if (stopEditing) stopEditing(true, false);
    transformer.nodes([]);
    updateTextTools();
  }
});

// Delete キー（または Backspace キー）で、選択中の図形を消す
window.addEventListener("keydown", (e) => {
  if (e.key !== "Delete" && e.key !== "Backspace") return;
  // 入力欄（文字の編集・大きさの数字など）で文字を消しているときは、図形を消さない
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
  for (const node of transformer.nodes()) node.destroy();
  transformer.nodes([]);
  updateTextTools();
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

// 吸い付く点を、部品自身の中での座標で返す（拡大・移動する前の位置）
function localSnapPoints(node) {
  // 図形：画像処理（API）で見つけた特徴点
  const result = node.getAttr("points");
  if (result) {
    const scale = SHAPE_SIZE / result.width;
    return Object.values(result.points).flat().map(([x, y]) => ({ x: x * scale, y: y * scale }));
  }
  // テキスト：画像処理は使わず、文字の外枠の四角から計算する。
  // 左端・中央・右端 × 上端・真ん中・下端 の 9 点
  const list = [];
  for (const x of [0, node.width() / 2, node.width()]) {
    for (const y of [0, node.height() / 2, node.height()]) list.push({ x, y });
  }
  return list;
}

// 吸い付く点を、スライドの座標にして返す
// getTransform() は「部品の位置と拡大率」をまとめたもの。これで大きさを変えた部品にも対応できる
function canvasPoints(node) {
  const transform = node.getTransform();
  return localSnapPoints(node).map((p) => transform.point(p));
}

// 動かしている図形の位置（values）と、吸い付く先の位置（targets）の組み合わせの中から、
// 差が一番小さいものを探す。SNAP_DISTANCE より遠ければ null
function findClosest(values, targets) {
  // SNAP_DISTANCE は画面上のピクセルなので、スライドの座標での距離に直す
  // （画面が小さくスライドが縮んで見えるときでも、吸い付く感覚が変わらないように）
  const limit = SNAP_DISTANCE / stage.scaleX();
  let best = null;
  for (const v of values) {
    for (const t of targets) {
      const diff = t - v;
      if (Math.abs(diff) <= limit && (best === null || Math.abs(diff) < Math.abs(best))) {
        best = diff;
      }
    }
  }
  return best;
}

// スライドの端・中央の線に揃ったときのガイド線。スライドの端から端まで引く
function drawSlideGuide(value, axis) {
  const { x, y, width, height } = slide.attrs;
  const points = axis === "x" ? [value, y, value, y + height] : [x, value, x + width, value];
  // strokeScaleEnabled: false … 拡大・縮小しても線の太さは画面上で 1px のまま
  guideLayer.add(new Konva.Line({
    points: points, stroke: GUIDE_COLOR, strokeWidth: 1, strokeScaleEnabled: false,
  }));
}

// ガイド線を1本描く。2つの点を結ぶ線を、少しはみ出す長さで描き、両端の点に輪を付ける
function drawGuide(a, b, axis) {
  const margin = 20;
  const points = axis === "x"
    ? [a.x, Math.min(a.y, b.y) - margin, a.x, Math.max(a.y, b.y) + margin]  // 縦の線
    : [Math.min(a.x, b.x) - margin, a.y, Math.max(a.x, b.x) + margin, a.y]; // 横の線
  guideLayer.add(new Konva.Line({
    points: points, stroke: GUIDE_COLOR, strokeWidth: 1, dash: [4, 4], strokeScaleEnabled: false,
  }));
  // 輪の大きさも、画面上で同じ大きさに見えるように拡大率で割る
  const radius = 7 / stage.scaleX();
  for (const p of [a, b]) {
    guideLayer.add(new Konva.Circle({
      x: p.x, y: p.y, radius: radius, stroke: GUIDE_COLOR, strokeWidth: 2, strokeScaleEnabled: false,
    }));
  }
}

// ドラッグ中に毎回呼ばれる：近い点があれば吸い付かせて、ガイド線を描く
function snap(moving) {
  guideLayer.destroyChildren();  // 前回のガイド線を消す

  // 他の図形の点を全部集める
  const others = layer.getChildren((node) => node !== moving && node.hasName("item"));
  const otherPoints = others.flatMap(canvasPoints);

  // 吸い付く先：他の図形の点と、スライドの端・中央の線
  const lines = slideLines();
  const targetsX = otherPoints.map((p) => p.x).concat(lines.x);
  const targetsY = otherPoints.map((p) => p.y).concat(lines.y);

  // 1. 横方向（x）と縦方向（y）それぞれで、一番近いずれを探して、その分だけ動かす（吸い付き）
  const before = canvasPoints(moving);
  const dx = findClosest(before.map((p) => p.x), targetsX);
  const dy = findClosest(before.map((p) => p.y), targetsY);
  if (dx !== null) moving.x(moving.x() + dx);
  if (dy !== null) moving.y(moving.y() + dy);

  // 2. 吸い付いた後の位置で、ぴったり揃っているもの全部にガイド線を描く
  const movingPoints = canvasPoints(moving);
  const near = (a, b) => Math.abs(a - b) < 0.5;
  for (const m of movingPoints) {
    // 他の図形の点と揃っている
    for (const o of otherPoints) {
      if (dx !== null && near(o.x, m.x)) drawGuide(m, o, "x");
      if (dy !== null && near(o.y, m.y)) drawGuide(m, o, "y");
    }
    // スライドの端・中央と揃っている
    for (const lx of lines.x) if (dx !== null && near(lx, m.x)) drawSlideGuide(lx, "x");
    for (const ly of lines.y) if (dy !== null && near(ly, m.y)) drawSlideGuide(ly, "y");
  }
}

// ---- 最初の配置：6つの図形を、スライドの中に横に3つずつ並べる ----
SHAPES.forEach((name, i) => {
  const col = i % 3;
  const row = Math.floor(i / 3);
  addShape(name, slide.x() + 40 + col * (SHAPE_SIZE + 40), slide.y() + 20 + row * (SHAPE_SIZE + 20));
});
