// PDF編集ツール - 最小統合PoC
//
// idontlovepdf-engine の正式Release bundle（vendor/idontlovepdf-engine.js）だけを
// 利用して、PDFの読み込みと本文テキストの認識までを行う。
//
// 方針:
//   - PDFはブラウザ内だけで処理する。サーバーや外部サービスへ送らない。
//   - engineの内部モジュールは参照しない。正式公開APIのみを使う。
//   - engineのversionはbundleがexportする ENGINE_VERSION から取得し、
//     この本体側へ版数をハードコードしない。
//   - パスワードは処理中のメモリ内だけで扱い、保存もログ出力もしない。

import { PdfTextEditor, ENGINE_VERSION } from "../vendor/idontlovepdf-engine.js";

/* ------------------------------------------------------------------ 要素 */

const elements = {
  picker:        document.getElementById("picker"),
  fileInput:     document.getElementById("pdf-input"),
  state:         document.getElementById("state"),
  stateValue:    document.getElementById("state-value"),
  result:        document.getElementById("result"),
  resultFile:    document.getElementById("result-file"),
  resultEngine:  document.getElementById("result-engine"),
  resultLoad:    document.getElementById("result-load"),
  resultText:    document.getElementById("result-text"),
  password:      document.getElementById("password"),
  passwordForm:  document.getElementById("password-form"),
  passwordInput: document.getElementById("password-input"),
  error:         document.getElementById("error"),
  errorTitle:    document.getElementById("error-title"),
  errorLead:     document.getElementById("error-lead"),
  errorRaw:      document.getElementById("error-raw"),
  debugEngine:   document.getElementById("debug-engine"),
  debugRuns:     document.getElementById("debug-runs"),
  debugState:    document.getElementById("debug-state")
};

/* ------------------------------------------------------------ 画面の状態 */

// 色だけに頼らず、文字でも状態が分かるようにする。
const STATES = {
  idle:    { text: "未選択",         className: "" },
  busy:    { text: "処理中…",        className: "is-busy" },
  waiting: { text: "パスワード待ち", className: "is-waiting" },
  ok:      { text: "成功",           className: "is-ok" },
  ng:      { text: "失敗",           className: "is-ng" }
};

function setState(name) {
  const state = STATES[name];
  elements.state.className = `state ${state.className}`.trim();
  elements.stateValue.textContent = state.text;
  elements.debugState.textContent = name;
  elements.picker.classList.toggle("is-busy", name === "busy");
  elements.fileInput.disabled = name === "busy";
}

/* ---------------------------------------------------- engineのerror分類 */

// engineが投げるerrorを、一般利用者向けの区分へ振り分ける。
// すべてを「PDFを処理できませんでした」へ丸めない。
const ERROR_KINDS = {
  "password-required": {
    title: "パスワードが必要です",
    lead: "このPDFはパスワードで保護されています。開くためのパスワードを入力してください。"
  },
  "password-wrong": {
    title: "パスワードが正しくありません",
    lead: "入力したパスワードでは開けませんでした。もう一度入力してください。"
  },
  "not-pdf": {
    title: "PDFファイルではありません",
    lead: "選択されたファイルはPDF形式ではないようです。拡張子が .pdf のファイルを選んでください。"
  },
  unsupported: {
    title: "このPDFの形式には対応していません",
    lead: "このツールがまだ対応していない構造、または暗号化方式が使われています。元のファイル（Word等）からの修正をご検討ください。"
  },
  broken: {
    title: "PDFを解析できませんでした",
    lead: "ファイルが壊れているか、このツールが読み取れない構造になっています。別のPDFでお試しください。"
  },
  other: {
    title: "処理中に問題が発生しました",
    lead: "もう一度お試しください。繰り返し発生する場合は、情報担当へご連絡ください。"
  }
};

const UNSUPPORTED_PATTERN = /Unsupported|not supported|Security Handler|requires the browser|is not available in this environment/;

const BROKEN_PATTERN = /Malformed|Unterminated|invalid|Invalid|not found|must contain|must start after|does not (?:match|end|start)|Expected|Circular|has no |is missing|out of the safe integer range|is too large|failed/;

function classifyError(error, passwordAttempted) {
  if (error && error.passwordRequired === true) {
    return passwordAttempted ? "password-wrong" : "password-required";
  }
  const message = errorMessage(error);
  if (message.startsWith("Input is not a PDF document")) return "not-pdf";
  if (UNSUPPORTED_PATTERN.test(message)) return "unsupported";
  if (BROKEN_PATTERN.test(message)) return "broken";
  return "other";
}

// 「詳細（開発者向け）」へ出す内部message。
// パスワードや鍵に関わりうる内容は、ここでも出さない。
function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.startsWith("Password contains a character")) {
    return "Password contains a character that cannot be represented in PDFDocEncoding";
  }
  return message;
}

/* ------------------------------------------------------------ 画面の更新 */

function hidePanels() {
  elements.password.hidden = true;
  elements.error.hidden = true;
}

function showError(kind, error) {
  const message = ERROR_KINDS[kind];
  elements.errorTitle.textContent = message.title;
  elements.errorLead.textContent = message.lead;
  elements.errorRaw.textContent = errorMessage(error);
  elements.error.hidden = false;
}

function showPasswordPrompt(kind, error) {
  elements.password.hidden = false;
  elements.passwordInput.value = "";
  elements.passwordInput.focus();
  if (kind === "password-wrong") showError(kind, error);
  setState("waiting");
}

function resetResult(fileName) {
  elements.result.hidden = false;
  elements.resultFile.textContent = fileName;
  elements.resultEngine.textContent = `v${ENGINE_VERSION}`;
  elements.resultLoad.textContent = "処理中…";
  elements.resultText.textContent = "—";
  elements.debugRuns.textContent = "—";
}

function showSuccess(runCount) {
  elements.resultLoad.textContent = "✓ 成功";
  elements.resultText.textContent = `${runCount}件のテキストを認識`;
  elements.debugRuns.textContent = `text run ${runCount}件`;
  hidePanels();
  setState("ok");
}

function showFailure(kind) {
  elements.resultLoad.textContent = kind === "password-required" || kind === "password-wrong"
    ? "パスワード待ち"
    : "✗ 失敗";
  elements.resultText.textContent = "—";
  elements.debugRuns.textContent = "—";
}

/* -------------------------------------------------------------- 読み込み */

// 選択中のPDF。パスワード再試行時に同じ editor を使い回す。
let editor = null;
let passwordAttempted = false;

// 「処理中…」を実際に描画させてから、重い解析へ入る。
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function loadFile(file) {
  hidePanels();
  passwordAttempted = false;
  editor = null;
  resetResult(file.name);
  setState("busy");
  await nextFrame();

  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    showFailure("other");
    showError("other", error);
    setState("ng");
    return;
  }

  try {
    editor = new PdfTextEditor(bytes);
  } catch (error) {
    const kind = classifyError(error, false);
    showFailure(kind);
    showError(kind, error);
    setState("ng");
    return;
  }

  await extractText();
}

// `password` は引数として受け取るだけで、保存も再利用もしない。
async function extractText(password) {
  setState("busy");
  elements.resultLoad.textContent = "処理中…";
  await nextFrame();

  try {
    // 引数なし呼び出しと同じく、空パスワードでの認証がまず試される。
    const runs = await editor.listTextRuns(password);
    showSuccess(runs.length);
  } catch (error) {
    const kind = classifyError(error, passwordAttempted);
    showFailure(kind);
    if (kind === "password-required" || kind === "password-wrong") {
      showPasswordPrompt(kind, error);
      return;
    }
    hidePanels();
    showError(kind, error);
    setState("ng");
  }
}

/* -------------------------------------------------------------- イベント */

elements.fileInput.addEventListener("change", () => {
  const file = elements.fileInput.files && elements.fileInput.files[0];
  if (file) loadFile(file);
  // 同じファイルを選び直したときも change が発火するようにする。
  elements.fileInput.value = "";
});

elements.passwordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!editor) return;
  const password = elements.passwordInput.value;
  // 入力値は画面へ残さない。保存もしない。
  elements.passwordInput.value = "";
  passwordAttempted = true;
  elements.error.hidden = true;
  extractText(password);
});

for (const type of ["dragenter", "dragover"]) {
  elements.picker.addEventListener(type, (event) => {
    event.preventDefault();
    elements.picker.classList.add("is-dragover");
  });
}

for (const type of ["dragleave", "dragend"]) {
  elements.picker.addEventListener(type, () => {
    elements.picker.classList.remove("is-dragover");
  });
}

elements.picker.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.picker.classList.remove("is-dragover");
  if (elements.fileInput.disabled) return;
  const file = event.dataTransfer && event.dataTransfer.files[0];
  if (file) loadFile(file);
});

// ページ外へのドロップでブラウザがPDFを開いてしまわないようにする。
for (const type of ["dragover", "drop"]) {
  window.addEventListener(type, (event) => {
    if (!elements.picker.contains(event.target)) event.preventDefault();
  });
}

/* -------------------------------------------------------------- 初期表示 */

elements.debugEngine.textContent = `idontlovepdf-engine v${ENGINE_VERSION}`;
setState("idle");

// index.html 側の起動失敗表示を取り消す（moduleがここまで到達できた＝読み込み成功）。
window.__idontlovepdfReady = true;
