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

  // 2. 画像を API に送る
  const result = await detectPoints(await imageResponse.blob(), name + ".png");
  pointsCache[name] = result;
  return result;
}

// 画像のデータ（blob）を API に送って、特徴点を受け取る（フォームでファイルを送るのと同じ形）
async function detectPoints(blob, fileName) {
  const form = new FormData();
  form.append("file", blob, fileName);
  const response = await fetch("/api/detect", { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(typeof result.detail === "string" ? result.detail : "特徴点の検出に失敗しました");
  }
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
  const scale = pointScale(result);

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
function startEditing(text) {
  transformer.nodes([]);
  updateTextTools();
  text.hide();  // 編集中は、下のテキストを隠して入力欄だけ見せる

  // テキストの画面上の位置と、画面上での文字の大きさ
  const box = text.getClientRect();
  const scale = stage.scaleX() * text.scaleX();

  const area = document.createElement("textarea");
  area.className = "text-editor";
  area.value = text.text();
  Object.assign(area.style, {
    left: box.x + "px",
    top: box.y + "px",
    fontSize: text.fontSize() * scale + "px",
    fontFamily: text.fontFamily(),
    fontWeight: text.fontStyle().includes("bold") ? "bold" : "normal",
    lineHeight: text.lineHeight(),
    color: text.fill(),
  });
  container.appendChild(area);

  // 打った文字の量に合わせて、入力欄の大きさを広げる
  function fitSize() {
    area.style.width = "0px";
    area.style.height = "0px";
    area.style.width = area.scrollWidth + text.fontSize() * scale + "px";  // 次の1文字ぶん余裕を持たせる
    area.style.height = area.scrollHeight + "px";
  }
  fitSize();
  area.addEventListener("input", fitSize);
  area.focus();
  area.select();  // 最初は全部選んだ状態にして、すぐに打ち直せるようにする

  let finished = false;
  // save が true なら打った内容を残す、false なら元に戻す
  function finish(save) {
    if (finished) return;  // 2回呼ばれても1回だけ処理する
    finished = true;
    if (save) text.text(area.value);
    area.remove();
    text.show();
    // 空っぽになったテキストは消す。そうでなければ選んだ状態に戻す
    if (text.text().trim() === "") {
      text.destroy();
    } else {
      select(text);
    }
  }

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
// 画像
// ==============================

// 置くときの最大の大きさ（スライドの座標）。大きい画像は、この中に収まるように縮めて置く
const IMAGE_MAX_SIZE = 400;
// API に送るときの最大の大きさ（ピクセル）。大きすぎる写真をそのまま送ると時間がかかるので縮める
const DETECT_MAX_SIZE = 800;

// ---- お知らせを数秒だけ表示する ----
const statusText = document.getElementById("status");
let statusTimer = null;
function notify(message) {
  statusText.textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (statusText.textContent = ""), 5000);
}

// ---- 画像ファイルを読み込んで、HTML の画像（Image）にする ----
function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);  // パソコンの中のファイルを、ブラウザで開ける仮の URL にする
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);  // 読み込みが終わったら仮の URL は要らない
      resolve(img);
    };
    img.onerror = () => reject(new Error("画像を読み込めません：" + file.name));
    img.src = url;
  });
}

// ---- 白い背景の上に画像を描いた canvas を作る ----
// 透明な部分がある画像（PNG など）は、そのまま送ると API 側で透明な部分が黒くなってしまう。
// 白い紙の上に描いてから送ることで、班の画像と同じ「白い背景に図形」の形にそろえる
function drawOnWhite(img, maxSize) {
  const fit = Math.min(1, maxSize / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * fit));
  canvas.height = Math.max(1, Math.round(img.height * fit));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// ---- 図形らしい画像かどうかを判断する ----
// API（画像処理）は「一色の背景に、はっきりした図形」が写った画像向け。
// 写真を送っても、変な位置に点が出るだけなので、次の2つを満たす画像だけを「図形らしい」とする
//   1. 周り（上下左右の端）が、ほぼ一色（＝背景がはっきりしている）
//   2. 使われている色が少ない（写真は色の種類がとても多い）
function looksLikeShape(img) {
  // 小さく縮めて調べる（64×64 で十分。速く終わる）
  const N = 64;
  const ctx = drawOnWhite(img, N).getContext("2d");
  const { width, height } = ctx.canvas;
  const px = ctx.getImageData(0, 0, width, height).data;  // [R, G, B, 透明度, R, G, B, 透明度, ...]
  const color = (x, y) => {
    const i = (y * width + x) * 4;
    return [px[i], px[i + 1], px[i + 2]];
  };
  const isNear = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 60;

  // 1. 端の点のうち、左上の色（背景の色とみなす）に近いものの割合
  const background = color(0, 0);
  let edge = 0, edgeSame = 0;
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) { edge++; if (isNear(color(x, y), background)) edgeSame++; }
  }
  for (let y = 0; y < height; y++) {
    for (const x of [0, width - 1]) { edge++; if (isNear(color(x, y), background)) edgeSame++; }
  }
  const plainEdge = edgeSame / edge >= 0.9;

  // 2. 色を大まかに 64 種類に分けて、多い順に 3 種類で全体の何割をしめるか
  //    （R・G・B をそれぞれ 4 段階に分ける。図形の縁のにじんだ色があるので、少し余裕を見て 8 割）
  const counts = {};
  for (let i = 0; i < px.length; i += 4) {
    const key = (px[i] >> 6) * 16 + (px[i + 1] >> 6) * 4 + (px[i + 2] >> 6);
    counts[key] = (counts[key] || 0) + 1;
  }
  const top3 = Object.values(counts).sort((a, b) => b - a).slice(0, 3).reduce((sum, n) => sum + n, 0);
  const fewColors = top3 / (width * height) >= 0.8;

  return plainEdge && fewColors;
}

// ---- 画像を1つキャンバスに置く ----
// center: 置く場所の真ん中（スライドの座標）。省略するとスライドの真ん中
async function addImageFile(file, center) {
  if (!file.type.startsWith("image/")) {
    notify("画像ファイル（PNG・JPEG など）を選んでください");
    return;
  }
  let img;
  try {
    img = await loadImageFile(file);
  } catch (error) {
    notify(error.message);
    return;
  }

  // 置く大きさ：縦横の比率はそのままで、IMAGE_MAX_SIZE に収める
  const fit = Math.min(1, IMAGE_MAX_SIZE / Math.max(img.width, img.height));
  const width = img.width * fit;
  const height = img.height * fit;
  if (!center) {
    const shift = (addCount++ % 5) * 20;
    center = { x: slide.width() / 2 + shift, y: slide.height() / 2 + shift };
  }
  const x = center.x - width / 2;
  const y = center.y - height / 2;

  // 図形らしい画像なら、API で特徴点を調べる
  let result = null;
  let message = "写真として追加しました。外枠（上下左右・中央）にスナップします";
  if (looksLikeShape(img)) {
    const white = drawOnWhite(img, DETECT_MAX_SIZE);
    try {
      const blob = await new Promise((resolve) => white.toBlob(resolve, "image/png"));
      result = await detectPoints(blob, "upload.png");
      // 点が1つも見つからなかったときは、写真と同じ扱いにする
      if (Object.values(result.points).flat().length === 0) {
        result = null;
        message = "図形の特徴点が見つからなかったので、外枠にスナップします";
      } else {
        message = "図形として追加しました。画像処理で見つけた特徴点にスナップします";
        result.displayWidth = width;  // API の座標を、置いた大きさに直すために覚えておく
        img = white;                  // 白い背景つきの画像を使う（下で白を透明にする）
      }
    } catch (error) {
      // API が動いていないときなど。画像は置けるので、外枠でスナップする
      message = "特徴点を調べられなかったので、外枠にスナップします（" + error.message + "）";
    }
  }

  let node;
  if (result) {
    // 図形：用意してある図形と同じく、画像と特徴点の印を1つのグループにする
    node = new Konva.Group({ x: x, y: y, draggable: true, name: "item image" });
    node.add(new Konva.Image({ image: makeWhiteTransparent(img), width: width, height: height }));
    node.add(makeMarkers(result));
    node.setAttr("points", result);
    node.on("transform", () => keepMarkerSize(node));
  } else {
    // 写真：画像をそのまま置く。スナップは外枠の 9 点（テキストと同じ）
    node = new Konva.Image({ x: x, y: y, image: img, width: width, height: height, draggable: true, name: "item image" });
  }
  makeMovable(node);
  layer.add(node);
  select(node);
  notify(message);
}

// 画像ボタン：押すとファイルを選ぶ画面を出す
const imageFileInput = document.getElementById("image-file");
document.getElementById("add-image").addEventListener("click", () => imageFileInput.click());
imageFileInput.addEventListener("change", async () => {
  for (const file of imageFileInput.files) await addImageFile(file);
  imageFileInput.value = "";  // 同じファイルをもう一度選んでも反応するように、選択を空にする
});

// 画像ファイルをスライドの上にドラッグ＆ドロップしても追加できる
container.addEventListener("dragover", (e) => {
  e.preventDefault();  // これがないと、ブラウザが画像を新しいタブで開いてしまう
  container.classList.add("drop-target");
});
container.addEventListener("dragleave", () => container.classList.remove("drop-target"));
container.addEventListener("drop", async (e) => {
  e.preventDefault();
  container.classList.remove("drop-target");
  // 落とした場所を、スライドの座標に直す
  stage.setPointersPositions(e);
  const point = layer.getRelativePointerPosition();
  for (const file of e.dataTransfer.files) {
    await addImageFile(file, { ...point });
    point.x += 20;  // 何枚か一度に落としたときは、少しずつずらす
    point.y += 20;
  }
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

// API の座標（元の画像の大きさ）を、画面に置いた大きさに直すための倍率。
// 用意してある図形は SHAPE_SIZE で置く。追加した画像は、置いた幅を displayWidth に覚えさせてある
function pointScale(result) {
  return (result.displayWidth || SHAPE_SIZE) / result.width;
}

// 吸い付く点を、部品自身の中での座標で返す（拡大・移動する前の位置）
function localSnapPoints(node) {
  // 図形：画像処理（API）で見つけた特徴点
  const result = node.getAttr("points");
  if (result) {
    const scale = pointScale(result);
    return Object.values(result.points).flat().map(([x, y]) => ({ x: x * scale, y: y * scale }));
  }
  // テキスト・写真：画像処理は使わず、外枠の四角から計算する。
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

// ==============================
// PNG で保存
// ==============================

// 保存する画像の幅（ピクセル）。高さは 16:9 なので 1080 になる
const EXPORT_WIDTH = 1920;

document.getElementById("export-png").addEventListener("click", () => {
  // 1. 保存する画像に写したくない「編集用の表示」を、いったん隠す
  //    （選択の枠・特徴点の印・ガイド線）
  const selected = transformer.nodes();
  transformer.nodes([]);
  const markers = layer.find(".markers");
  const wasVisible = markers.map((m) => m.visible());
  markers.forEach((m) => m.visible(false));
  guideLayer.destroyChildren();

  // 2. スライドの白い部分だけを切り取って画像にする。
  //    画面上のスライドの位置と大きさを調べ、幅が EXPORT_WIDTH になる倍率で書き出す
  const box = slide.getClientRect({ skipShadow: true });
  const dataUrl = stage.toDataURL({
    x: box.x, y: box.y, width: box.width, height: box.height,
    pixelRatio: EXPORT_WIDTH / box.width,
    mimeType: "image/png",
  });

  // 3. 隠したものを元に戻す
  markers.forEach((m, i) => m.visible(wasVisible[i]));
  transformer.nodes(selected);

  // 4. ダウンロードさせる（リンクを作って、自動でクリックする）
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = "slide.png";
  link.click();
  notify("スライドを slide.png として保存しました");
});
