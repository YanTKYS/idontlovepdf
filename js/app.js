// PDF編集ツール
//
// idontlovepdf-engine の正式Release bundle（vendor/idontlovepdf-engine.js）だけを
// 利用して、PDFの読み込み・本文の検索・1件ずつの置換・編集済みPDFの保存を行う。
//
// 方針:
//   - PDFはブラウザ内だけで処理する。サーバーや外部サービスへ送らない。
//   - engineの内部モジュール・内部プロパティは参照しない。正式公開APIのみを使う。
//   - engineのversionはbundleがexportする ENGINE_VERSION から取得し、
//     この本体側へ版数をハードコードしない。
//   - パスワードは処理中のメモリ内だけで扱い、保存もログ出力もしない。
//   - PDF内部構造（object番号・text run等）は一般利用者向け画面へ出さない。

import { PdfTextEditor, ENGINE_VERSION } from "../vendor/idontlovepdf-engine.js";

/* ------------------------------------------------------------------ 要素 */

const elements = {
  picker:         document.getElementById("picker"),
  fileInput:      document.getElementById("pdf-input"),
  state:          document.getElementById("state"),
  stateValue:     document.getElementById("state-value"),
  result:         document.getElementById("result"),
  resultFile:     document.getElementById("result-file"),
  resultEngine:   document.getElementById("result-engine"),
  resultLoad:     document.getElementById("result-load"),
  resultText:     document.getElementById("result-text"),
  password:       document.getElementById("password"),
  passwordForm:   document.getElementById("password-form"),
  passwordInput:  document.getElementById("password-input"),
  error:          document.getElementById("error"),
  errorTitle:     document.getElementById("error-title"),
  errorLead:      document.getElementById("error-lead"),
  errorRaw:       document.getElementById("error-raw"),
  edit:           document.getElementById("edit"),
  searchForm:     document.getElementById("search-form"),
  searchInput:    document.getElementById("search-input"),
  searchSubmit:   document.getElementById("search-submit"),
  searchStatus:   document.getElementById("search-status"),
  results:        document.getElementById("results"),
  resultsList:    document.getElementById("results-list"),
  resultsMore:    document.getElementById("results-more"),
  replaceForm:    document.getElementById("replace-form"),
  replaceInput:   document.getElementById("replace-input"),
  replaceSubmit:  document.getElementById("replace-submit"),
  editNotice:     document.getElementById("edit-notice"),
  editChanges:    document.getElementById("edit-changes"),
  saveButton:     document.getElementById("save-button"),
  debugEngine:    document.getElementById("debug-engine"),
  debugRuns:      document.getElementById("debug-runs"),
  debugChanges:   document.getElementById("debug-changes"),
  debugState:     document.getElementById("debug-state")
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

let uiState = "idle";

function setState(name) {
  uiState = name;
  const state = STATES[name];
  elements.state.className = `state ${state.className}`.trim();
  elements.stateValue.textContent = state.text;
  elements.debugState.textContent = name;
  elements.picker.classList.toggle("is-busy", name === "busy");
  updateControls();
}

// 各操作ボタンの有効・無効をまとめて決める。
// 処理中はすべて無効にして、二重送信を防ぐ。
function updateControls() {
  const busy = uiState === "busy";
  elements.fileInput.disabled = busy;
  elements.searchSubmit.disabled = busy || elements.searchInput.value.length === 0;
  elements.replaceSubmit.disabled = busy || selectedIndex < 0;
  elements.saveButton.disabled = busy || changeCount === 0;
}

const counter = (value) => value.toLocaleString("ja-JP");

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
  "font-missing": {
    title: "この文字は置き換えられません",
    lead: "入力した文字は、このPDFで使用しているフォントに含まれていないため置換できません。別の文字でお試しいただくか、元のファイル（Word等）からの修正をご検討ください。"
  },
  "modify-denied": {
    title: "このPDFは編集結果を保存できません",
    lead: "文書側で変更が制限されています。このPDFは検索はできますが、編集した内容を保存できません。"
  },
  "encrypted-save": {
    title: "このPDFは編集結果を保存できません",
    lead: "暗号化PDFの保存には現在対応していません。このPDFは検索はできますが、編集した内容を保存できません。"
  },
  "changed-under-us": {
    title: "選択した箇所を特定できませんでした",
    lead: "検索し直してから、もう一度選択してください。"
  },
  other: {
    title: "処理中に問題が発生しました",
    lead: "もう一度お試しください。繰り返し発生する場合は、情報担当へご連絡ください。"
  }
};

const FONT_MISSING_PATTERN = /has no ToUnicode code for|String replacements are limited to single-byte characters/;

const UNSUPPORTED_PATTERN = /Unsupported|not supported|Security Handler|requires the browser|is not available in this environment/;

const BROKEN_PATTERN = /Malformed|Unterminated|invalid|Invalid|not found|must contain|must start after|does not (?:match|end|start)|Expected|Circular|has no |is missing|out of the safe integer range|is too large|failed/;

// `phase` は "load"（PDFを開く）と "edit"（検索結果を置換する）を区別する。
// 置換中に暗号化PDFのパスワードを求められた場合は、パスワードを聞き直すのではなく
// 「保存できないPDF」として案内する（現在のengineは暗号化PDFを再保存できない）。
function classifyError(error, { phase = "load", passwordAttempted = false } = {}) {
  const message = errorMessage(error);

  if (message.startsWith("Document modification is not permitted")) return "modify-denied";
  if (message.startsWith("Saving edits to an encrypted PDF")) return "encrypted-save";
  if (FONT_MISSING_PATTERN.test(message)) return "font-missing";

  if (error && error.passwordRequired === true) {
    if (phase === "edit") return "encrypted-save";
    return passwordAttempted ? "password-wrong" : "password-required";
  }

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

function showLoadFailure(kind) {
  elements.resultLoad.textContent = kind === "password-required" || kind === "password-wrong"
    ? "パスワード待ち"
    : "✗ 失敗";
  elements.resultText.textContent = "—";
  elements.debugRuns.textContent = "—";
  elements.edit.hidden = true;
}

function showRunCount(count) {
  elements.resultLoad.textContent = "✓ 成功";
  elements.resultText.textContent = `${counter(count)}件のテキストを認識`;
  elements.debugRuns.textContent = `text run ${counter(count)}件`;
}

function showChangeCount() {
  elements.editChanges.textContent = `変更 ${counter(changeCount)}件`;
  elements.debugChanges.textContent = String(changeCount);
}

/* -------------------------------------------------------- ドキュメント状態 */

// originalBytes は選択時のPDFそのもの。編集しても失わない。
// currentBytes は編集後の最新PDF。保存対象はこちら。
// engineは入力バイト列を読み取るだけで書き換えないため、初回は同じ配列を指してよい。
let originalBytes = null;
let currentBytes = null;
let fileName = "";

let editor = null;
let runs = [];
let passwordAttempted = false;

let results = [];
let selectedIndex = -1;
let changeCount = 0;

// 最後に「検索」を実行したときの検索文字。
// 検索欄が書き換えられたら、前の検索結果と選択は無効にする。
// そうしないと、画面の検索欄と実際の置換対象がずれて誤編集につながる。
let lastSearchedQuery = null;

// 保存用に発行した Blob URL。次の保存時とページ離脱時に必ず解放する。
let objectUrl = null;
let objectUrlTimer = 0;

function releaseObjectUrl() {
  if (objectUrlTimer) {
    clearTimeout(objectUrlTimer);
    objectUrlTimer = 0;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

// PDFを選び直したときに、前のPDFの編集状態を持ち越さない。
function resetDocument(name) {
  originalBytes = null;
  currentBytes = null;
  fileName = name;
  editor = null;
  runs = [];
  passwordAttempted = false;
  results = [];
  selectedIndex = -1;
  lastSearchedQuery = null;
  changeCount = 0;
  releaseObjectUrl();

  elements.result.hidden = false;
  elements.resultFile.textContent = name;
  elements.resultEngine.textContent = `v${ENGINE_VERSION}`;
  elements.resultLoad.textContent = "処理中…";
  elements.resultText.textContent = "—";
  elements.debugRuns.textContent = "—";

  elements.edit.hidden = true;
  elements.searchInput.value = "";
  elements.replaceInput.value = "";
  elements.searchStatus.textContent = "検索する文字を入力してください";
  elements.results.hidden = true;
  elements.resultsList.replaceChildren();
  elements.resultsMore.hidden = true;
  elements.editNotice.hidden = true;
  showChangeCount();
}

/* -------------------------------------------------------------- 読み込み */

// 「処理中…」を実際に描画させてから、重い解析へ入る。
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function loadFile(file) {
  hidePanels();
  resetDocument(file.name);
  setState("busy");
  await nextFrame();

  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    showLoadFailure("other");
    showError("other", error);
    setState("ng");
    return;
  }

  originalBytes = bytes;
  currentBytes = bytes;

  try {
    editor = new PdfTextEditor(currentBytes);
  } catch (error) {
    const kind = classifyError(error);
    showLoadFailure(kind);
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
    runs = await editor.listTextRuns(password);
  } catch (error) {
    const kind = classifyError(error, { passwordAttempted });
    showLoadFailure(kind);
    if (kind === "password-required" || kind === "password-wrong") {
      showPasswordPrompt(kind, error);
      return;
    }
    hidePanels();
    showError(kind, error);
    setState("ng");
    return;
  }

  hidePanels();
  showRunCount(runs.length);
  elements.edit.hidden = false;
  setState("ok");
}

/* ---------------------------------------------------------------- 検索 */

// 一度に描画する検索結果の上限。件数そのものは全件数を表示する。
const MAX_RESULTS_SHOWN = 100;

// 検索結果に添える前後の文字数。run全文はそのまま画面へ出さない。
const CONTEXT_LENGTH = 14;

// 検索対象は listTextRuns() が返す各 run の本文だけとする。
// 別々のrunをUI側で連結して「見た目上は連続しているはず」と推測はしない。
function findMatches(query) {
  const found = [];
  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    const run = runs[runIndex];
    const text = run.text;
    if (typeof text !== "string" || text.length === 0) continue;

    // 同一run内に複数ある場合は、それぞれ別の検索結果として扱う。
    let from = 0;
    for (;;) {
      const start = text.indexOf(query, from);
      if (start < 0) break;
      found.push({ runIndex, runId: run.id, runText: text, start, end: start + query.length });
      from = start + query.length;
    }
  }
  return found;
}

function contextOf(result) {
  const text = result.runText;
  const leadFrom = Math.max(0, result.start - CONTEXT_LENGTH);
  const tailTo = Math.min(text.length, result.end + CONTEXT_LENGTH);
  return {
    leading: (leadFrom > 0 ? "…" : "") + text.slice(leadFrom, result.start),
    match: text.slice(result.start, result.end),
    trailing: text.slice(result.end, tailTo) + (tailTo < text.length ? "…" : "")
  };
}

function renderResults() {
  const list = elements.resultsList;
  list.replaceChildren();

  const shown = Math.min(results.length, MAX_RESULTS_SHOWN);
  for (let index = 0; index < shown; index += 1) {
    const context = contextOf(results[index]);

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "search-result";
    radio.className = "results__radio";
    radio.id = `search-result-${index}`;
    radio.value = String(index);

    const text = document.createElement("span");
    text.className = "results__text";
    // PDFの本文はテキストノードとして組み立てる（HTMLとして解釈させない）。
    text.append(context.leading);
    const mark = document.createElement("mark");
    mark.textContent = context.match;
    text.append(mark);
    text.append(context.trailing);

    // 選択中であることを、色だけでなく文字でも示す。
    const badge = document.createElement("span");
    badge.className = "results__badge";
    badge.textContent = "選択中";

    const label = document.createElement("label");
    label.className = "results__item";
    label.htmlFor = radio.id;
    label.append(radio, text, badge);

    const item = document.createElement("li");
    item.append(label);
    list.append(item);
  }

  if (results.length > shown) {
    elements.resultsMore.textContent =
      `全${counter(results.length)}件のうち、先頭${counter(shown)}件を表示しています。`
      + "検索する文字を長くすると絞り込めます。";
    elements.resultsMore.hidden = false;
  } else {
    elements.resultsMore.hidden = true;
  }

  elements.results.hidden = results.length === 0;
}

// 前の検索結果と選択を捨てる。置換対象が画面の表示とずれた状態を残さない。
function invalidateResults(message) {
  results = [];
  selectedIndex = -1;
  lastSearchedQuery = null;
  elements.results.hidden = true;
  elements.resultsList.replaceChildren();
  elements.resultsMore.hidden = true;
  elements.searchStatus.textContent = message;
  updateControls();
}

function runSearch() {
  const query = elements.searchInput.value;
  elements.editNotice.hidden = true;

  // 空文字はすべてのrunへ一致してしまうため、検索そのものを行わない。
  if (query.length === 0) {
    invalidateResults("検索する文字を入力してください");
    return;
  }

  results = findMatches(query);
  selectedIndex = -1;
  lastSearchedQuery = query;
  renderResults();

  elements.searchStatus.textContent = results.length === 0
    ? "一致する文字が見つかりませんでした"
    : `${counter(results.length)}件見つかりました`;

  updateControls();
}

/* ---------------------------------------------------------------- 置換 */

// 置換は現在のPDFへ直接変更を積まず、毎回作り直した一時editorで行う。
// save と reopen まで成功した場合だけ、編集状態を新しいPDFへ進める。
async function replaceSelected() {
  if (selectedIndex < 0 || selectedIndex >= results.length) return;

  const target = results[selectedIndex];
  const replacement = elements.replaceInput.value;

  hidePanels();
  elements.editNotice.hidden = true;

  // 置換前と置換後が同じなら、PDFを書き換えない。
  // 「変更 N件」は実際に変わった件数を示すため、ここで数えない。
  if (replacement === target.runText.slice(target.start, target.end)) {
    elements.editNotice.textContent = "置換前と置換後が同じです。変更していません。";
    elements.editNotice.hidden = false;
    return;
  }

  setState("busy");
  await nextFrame();

  try {
    const temporary = new PdfTextEditor(currentBytes);
    const temporaryRuns = await temporary.listTextRuns();
    const run = temporaryRuns.find((candidate) => candidate.id === target.runId);

    // 取り違えを防ぐため、選択時と同じ本文であることを確認してから置換する。
    if (!run || run.text !== target.runText) {
      throw new Error("Selected text could not be located in the current document");
    }

    // engineへはrun全体の新しい文字列を渡す。選択したoccurrenceだけを差し替える。
    const replaced = target.runText.slice(0, target.start)
      + replacement
      + target.runText.slice(target.end);

    await temporary.replaceText(run.id, replaced);
    const savedBytes = await temporary.save();

    // save しただけでは成功とみなさない。開き直せることまで確認する。
    const reopened = new PdfTextEditor(savedBytes);
    const reopenedRuns = await reopened.listTextRuns();

    // ここまで成功した場合だけ編集状態を進める。
    currentBytes = savedBytes;
    editor = reopened;
    runs = reopenedRuns;
    changeCount += 1;
    releaseObjectUrl();

    showRunCount(runs.length);
    showChangeCount();
    // 置換後の本文で検索し直し、残り件数を更新する。
    runSearch();
    setState("ok");
  } catch (error) {
    // 失敗しても currentBytes / runs / 変更件数はそのまま。編集状態を壊さない。
    const kind = error && error.message === "Selected text could not be located in the current document"
      ? "changed-under-us"
      : classifyError(error, { phase: "edit" });
    showError(kind, error);
    setState("ng");
  }
}

/* ---------------------------------------------------------------- 保存 */

// sample.pdf -> sample.edited.pdf
function editedFileName(name) {
  const base = name.replace(/\.pdf$/i, "");
  if (/\.edited$/i.test(base)) return `${base}.pdf`;
  return `${base}.edited.pdf`;
}

async function saveEdited() {
  if (changeCount === 0 || !currentBytes) return;

  hidePanels();
  setState("busy");
  await nextFrame();

  try {
    // ダウンロード直前にも、PDFとして開き直せることを確認する。
    const check = new PdfTextEditor(currentBytes);
    await check.listTextRuns();
  } catch (error) {
    showError(classifyError(error, { phase: "edit" }), error);
    setState("ng");
    return;
  }

  releaseObjectUrl();
  objectUrl = URL.createObjectURL(new Blob([currentBytes], { type: "application/pdf" }));

  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = editedFileName(fileName);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // ダウンロードが始まるまでの猶予を置いてから解放する。
  // 次の保存時とページ離脱時にも解放するため、URLは1本以上たまらない。
  objectUrlTimer = setTimeout(releaseObjectUrl, 60000);

  setState("ok");
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

// 前後の空白が意味を持つことがあるため、検索文字列は trim せずそのまま使う。
//
// 検索欄が書き換えられたら、前の検索結果と選択をその場で捨てる。
// 「令和6年度で選択 → 検索欄を令和7年度へ書き換え → 検索を押さずに置換」
// のような操作で、画面と実際の置換対象がずれるのを防ぐ。
elements.searchInput.addEventListener("input", () => {
  if (elements.searchInput.value === lastSearchedQuery) {
    updateControls();
    return;
  }
  elements.editNotice.hidden = true;
  invalidateResults(elements.searchInput.value.length === 0
    ? "検索する文字を入力してください"
    : "検索条件が変更されました。もう一度検索してください");
});

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (uiState === "busy") return;
  runSearch();
});

elements.resultsList.addEventListener("change", (event) => {
  const radio = event.target;
  if (radio && radio.name === "search-result") {
    selectedIndex = Number(radio.value);
    updateControls();
  }
});

elements.replaceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (uiState === "busy") return;
  replaceSelected();
});

elements.saveButton.addEventListener("click", () => {
  if (uiState === "busy") return;
  saveEdited();
});

window.addEventListener("pagehide", releaseObjectUrl);

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
showChangeCount();
setState("idle");

// index.html 側の起動失敗表示を取り消す（moduleがここまで到達できた＝読み込み成功）。
window.__idontlovepdfReady = true;
