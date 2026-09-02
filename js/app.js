// PDF編集ツール
//
// idontlovepdf-engine の正式Release bundle（vendor/idontlovepdf-engine.js）だけを
// 利用して、PDFの読み込み・本文の検索・1件ずつの置換・編集済みPDFの保存・
// 変更前／編集中PDFのプレビューを行う。
//
// 方針:
//   - PDFはブラウザ内だけで処理する。サーバーや外部サービスへ送らない。
//   - engineの内部モジュール・内部プロパティは参照しない。正式公開APIのみを使う。
//   - 検索と置換対象の判断は engine の高レベルAPI（searchText /
//     checkTextMatchReplacement / replaceTextMatch）へ一本化する。
//     run の連結・continuityの判断・PDF描画命令の解釈を本体側で行わない。
//     置換できるかどうかを、文字数・font・PDF内部構造から本体側で推測しない。
//   - 元のPDFのフォントに無い文字は、engineへ渡した編集用フォント（fallback font）
//     で置き換えられる。どちらのフォントを使うかの判断はengineへ委ねる。
//   - 編集用フォントはリポジトリへ同梱したローカルファイルだけを使う。
//     実行時に外部（Google Fonts、GitHub等）から取得しない。
//   - engineのversionはbundleがexportする ENGINE_VERSION から取得し、
//     この本体側へ版数をハードコードしない。
//   - パスワードは処理中のメモリ内だけで扱い、保存もログ出力もしない。
//   - PDF内部構造（object番号・text run・match ID等）は一般利用者向け画面へ出さない。

import { PdfTextEditor, ENGINE_VERSION } from "../vendor/idontlovepdf-engine.js";

/* ------------------------------------------------------------------ 要素 */

const elements = {
  picker:          document.getElementById("picker"),
  fileInput:       document.getElementById("pdf-input"),
  state:           document.getElementById("state"),
  stateValue:      document.getElementById("state-value"),
  result:          document.getElementById("result"),
  resultFile:      document.getElementById("result-file"),
  resultEngine:    document.getElementById("result-engine"),
  resultLoad:      document.getElementById("result-load"),
  resultText:      document.getElementById("result-text"),
  password:        document.getElementById("password"),
  passwordForm:    document.getElementById("password-form"),
  passwordInput:   document.getElementById("password-input"),
  error:           document.getElementById("error"),
  errorTitle:      document.getElementById("error-title"),
  errorLead:       document.getElementById("error-lead"),
  errorRaw:        document.getElementById("error-raw"),
  errorCharacters: document.getElementById("error-characters"),
  workspace:       document.getElementById("workspace"),
  searchForm:      document.getElementById("search-form"),
  searchInput:     document.getElementById("search-input"),
  searchSubmit:    document.getElementById("search-submit"),
  searchStatus:    document.getElementById("search-status"),
  results:         document.getElementById("results"),
  resultsList:     document.getElementById("results-list"),
  resultsMore:     document.getElementById("results-more"),
  replaceForm:     document.getElementById("replace-form"),
  replaceInput:    document.getElementById("replace-input"),
  replaceSubmit:   document.getElementById("replace-submit"),
  editNotice:      document.getElementById("edit-notice"),
  previewOriginal: document.getElementById("preview-original"),
  previewCurrent:  document.getElementById("preview-current"),
  previewCaption:  document.getElementById("preview-caption"),
  previewFrame:    document.getElementById("preview-frame"),
  previewViewer:   document.getElementById("preview-viewer"),
  previewFallback: document.getElementById("preview-fallback"),
  previewOpen:     document.getElementById("preview-open"),
  editChanges:     document.getElementById("edit-changes"),
  changesList:     document.getElementById("changes-list"),
  changesEmpty:    document.getElementById("changes-empty"),
  saveButton:      document.getElementById("save-button"),
  debugEngine:     document.getElementById("debug-engine"),
  debugRuns:       document.getElementById("debug-runs"),
  debugChanges:    document.getElementById("debug-changes"),
  debugState:      document.getElementById("debug-state"),
  debugFont:       document.getElementById("debug-font"),
  debugMode:       document.getElementById("debug-mode")
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
//
// 処理中はボタンだけでなく、検索欄・置換欄・検索結果の選択も止める。
// 処理の途中でこれらを変えられると、画面の表示と実際の処理対象がずれる。
// 検索結果は fieldset なので、fieldset を無効にすれば配下のradioがまとめて止まる。
//
// 置換ボタンは「検索結果が選ばれているか」だけで決める。
// 置換文字数・run数・フォント・PDF内部構造から置換可否を本体側で推測しない。
// 実際に置換できるかどうかは、置換を押した時点でengineの
// checkTextMatchReplacement() が判断する。
function updateControls() {
  const busy = uiState === "busy";
  // 編集用フォントを読み込めていない間・読み込めなかった場合はPDFを受け付けない。
  const ready = fallbackFontBytes !== null;
  elements.fileInput.disabled = busy || !ready;
  elements.searchInput.disabled = busy;
  elements.replaceInput.disabled = busy;
  elements.results.disabled = busy;
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
  "char-unsupported": {
    title: "置換できません",
    lead: "置換後の文字列に、このツールでは使用できない文字が含まれています。別の文字でお試しいただくか、元のファイル（Word等）からの修正をご検討ください。"
  },
  "replace-unsafe": {
    title: "この箇所は置き換えられません",
    lead: "このPDFでは、選択した箇所を安全に置換できません。別の箇所を選んでお試しいただくか、元のファイル（Word等）からの修正をご検討ください。"
  },
  "requires-reopen": {
    title: "この箇所は続けて置き換えられません",
    lead: "一度置き換えた箇所です。編集済みPDFを保存してから、保存したPDFを開き直すと、もう一度置き換えられます。"
  },
  "font-load-failed": {
    title: "編集用フォントを読み込めませんでした",
    lead: "編集用フォントを読み込めませんでした。配置を確認してください。vendor/fonts/BIZUDGothic-Regular.ttf がサーバーへ配置され、配信できる状態かを情報担当へご確認ください。"
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
    lead: "検索結果が変化しました。もう一度検索してください。"
  },
  "empty-query": {
    title: "検索する文字を入力してください",
    lead: "検索する文字が空欄です。直したい文字を入力してから検索してください。"
  },
  "length-change-unsupported": {
    title: "この箇所は置き換えられません",
    lead: "このPDFでは、選択した箇所を今の文字数のままでは安全に置換できません。同じ文字数の文字列や、空欄にしての削除であれば置き換えられる場合があります。"
  },
  "mixed-font-unsupported": {
    title: "この箇所はまとめて置き換えられません",
    lead: "この箇所は途中で文字の書体が変わっているため、まとめて置き換えられません。別の箇所を選ぶか、元のファイル（Word等）からの修正をご検討ください。"
  },
  other: {
    title: "処理中に問題が発生しました",
    lead: "もう一度お試しください。繰り返し発生する場合は、情報担当へご連絡ください。"
  }
};

// engineの高レベルAPIが返す安定したerror code。
// message文字列より、こちらの一致を優先して分類する。
//
// 画面へ出すのは一般利用者向けの言い換えだけで、code が示すPDF内部の事情
// （CMap、glyph、Tj / TJ、text matrix、writing mode、run、object番号）は出さない。
const ERROR_CODE_KINDS = {
  EMPTY_QUERY: "empty-query",
  UNKNOWN_MATCH: "changed-under-us",
  MATCH_STALE: "changed-under-us",
  REPLACEMENT_NOT_A_STRING: "other",
  MODIFICATION_NOT_PERMITTED: "modify-denied",

  // 置換後の文字列を、元のフォントでも編集用フォントでも書けない。
  FONT_ENCODING_UNSUPPORTED: "char-unsupported",
  FALLBACK_FONT_MISSING_GLYPH: "char-unsupported",

  // PDFの作りの都合で、その箇所を安全に書き換えられない（engineのfail closed）。
  FALLBACK_FOLLOWING_TEXT_POSITION_UNSAFE: "replace-unsafe",
  FALLBACK_OPERATOR_UNSUPPORTED: "replace-unsafe",
  FALLBACK_MULTI_RUN_UNSUPPORTED: "replace-unsafe",
  FALLBACK_WORD_SPACING_UNSUPPORTED: "replace-unsafe",
  FALLBACK_LAYOUT_UNSUPPORTED: "replace-unsafe",
  FALLBACK_WRITING_MODE_UNSUPPORTED: "replace-unsafe",
  MULTI_RUN_LENGTH_CHANGE_UNSUPPORTED: "length-change-unsupported",
  MULTI_RUN_FONT_CHANGE_UNSUPPORTED: "mixed-font-unsupported",

  // 保存して開き直せば続けられる（本ツールは1置換ごとに保存・開き直しを行うため、
  // 通常の操作では発生しない）。
  FALLBACK_EDIT_REQUIRES_SAVE: "requires-reopen",
  FALLBACK_FONT_ALREADY_IN_USE: "requires-reopen",

  // 同梱した編集用フォントを読めない（配置・ファイル破損の疑い）。
  FALLBACK_FONT_INVALID: "font-load-failed",

  // 本体側で付ける印。編集用フォントを読み込めないまま編集しようとした場合。
  FONT_NOT_LOADED: "font-load-failed"
};

const FONT_MISSING_PATTERN = /has no ToUnicode code for|String replacements are limited to single-byte characters/;

const UNSUPPORTED_PATTERN = /Unsupported|not supported|Security Handler|requires the browser|is not available in this environment/;

const BROKEN_PATTERN = /Malformed|Unterminated|invalid|Invalid|not found|must contain|must start after|does not (?:match|end|start)|Expected|Circular|has no |is missing|out of the safe integer range|is too large|failed/;

// 本体側で検出した「検索結果が変化した」を、engineのerrorと同じ経路で扱うための印。
const STALE_SELECTION = "idontlovepdf: search results changed";

// `phase` は "load"（PDFを開く）と "edit"（検索結果を置換する）を区別する。
// 置換中に暗号化PDFのパスワードを求められた場合は、パスワードを聞き直すのではなく
// 「保存できないPDF」として案内する（現在のengineは暗号化PDFを再保存できない）。
function classifyError(error, { phase = "load", passwordAttempted = false } = {}) {
  // 高レベルAPIのerror codeを最優先で使う。message文字列は将来変わりうる。
  if (error && typeof error.code === "string" && ERROR_CODE_KINDS[error.code]) {
    return ERROR_CODE_KINDS[error.code];
  }

  const message = errorMessage(error);

  if (message === STALE_SELECTION) return "changed-under-us";
  if (message.startsWith("Document modification is not permitted")) return "modify-denied";
  if (message.startsWith("Saving edits to an encrypted PDF")) return "encrypted-save";
  if (FONT_MISSING_PATTERN.test(message)) return "char-unsupported";

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
  elements.errorCharacters.hidden = true;
  elements.errorCharacters.textContent = "";
}

// `characters` は engine が構造化して返した「元のPDFのフォントで書けなかった文字」。
// message文字列を解析して文字を取り出すことはしない。
//
// engineは、文字が原因ではない拒否（PDFの構造上安全に置換できない場合）にも
// 参考情報として characters を添えることがある。その文字を書けないことが
// 原因ではないため、原因が文字である区分のときだけ画面へ出す。
function showError(kind, error, characters) {
  const message = ERROR_KINDS[kind];
  elements.errorTitle.textContent = message.title;
  elements.errorLead.textContent = message.lead;
  elements.errorRaw.textContent = errorMessage(error);

  const listed = kind === "char-unsupported" && Array.isArray(characters)
    ? [...new Set(characters)]
    : [];
  elements.errorCharacters.textContent = listed.length > 0
    ? `使用できない文字: ${listed.join("、")}`
    : "";
  elements.errorCharacters.hidden = listed.length === 0;

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
  elements.workspace.hidden = true;
}

// listTextRuns() は概況表示（何件の本文を認識したか）にだけ使う。
// 検索・置換の対象を判断するためには使わない。
function showRunCount(count) {
  elements.resultLoad.textContent = "✓ 成功";
  elements.resultText.textContent = `${counter(count)}件のテキストを認識`;
  elements.debugRuns.textContent = `text run ${counter(count)}件`;
}

function showChangeCount() {
  elements.editChanges.textContent = `変更 ${counter(changeCount)}件`;
  elements.debugChanges.textContent = String(changeCount);
}

/* -------------------------------------------------------- 編集用フォント */

// PDFのフォントに無い文字を書くために、engineへ渡す編集用フォント（fallback font）。
//
// リポジトリへ同梱したローカルファイルだけを使う。相対URLで自分自身（このmodule）の
// 位置から解決するため、要求先は必ず本ツールと同一originになる。外部URLは使わない。
// 取得は起動時の1回だけで、以降はこのバイト列を使い回す。
const FALLBACK_FONT_PATH = "../vendor/fonts/BIZUDGothic-Regular.ttf";

let fallbackFontBytes = null;

async function loadFallbackFont() {
  const url = new URL(FALLBACK_FONT_PATH, import.meta.url);
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Failed to fetch the editing font (${FALLBACK_FONT_PATH}): HTTP ${response.status} ${response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error(`The editing font file is empty (${FALLBACK_FONT_PATH})`);
  }
  return bytes;
}

// 置換に使うeditorへ、必ず編集用フォントを渡してから置換を行う。
// どのフォントで書くか（元のフォントか編集用フォントか）はengineが決める。
// 本体側でPDF内部のフォントを調べて判断しない。
async function withFallbackFont(target) {
  if (!fallbackFontBytes) {
    // 起動時に読み込めていればここへは来ない（読み込めなければPDF自体を受け付けない）。
    // 念のため、engineへ渡さずに編集用フォントのエラーとして扱う。
    const error = new Error("The editing font is not loaded; the tool must not edit a PDF without it");
    error.code = "FONT_NOT_LOADED";
    throw error;
  }
  await target.setFallbackFont(fallbackFontBytes);
  return target;
}

/* -------------------------------------------------------- ドキュメント状態 */

// originalBytes は選択時のPDFそのもの。編集しても失わない。
// currentBytes は編集後の最新PDF。保存対象・「編集中」プレビュー対象はこちら。
// engineは入力バイト列を読み取るだけで書き換えないため、初回は同じ配列を指してよい。
let originalBytes = null;
let currentBytes = null;
let fileName = "";

let editor = null;
let runs = [];
let passwordAttempted = false;

// matches は editor.searchText() が返した検索結果。
// この中の id は、発行した editor インスタンス専用である。別editorへ渡さない。
let matches = [];
let selectedIndex = -1;
let changeCount = 0;

// 成功した置換の記録（セッション内の表示のみ。保存もlocalStorageへの書き出しもしない）。
let changeLog = [];

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
  matches = [];
  selectedIndex = -1;
  lastSearchedQuery = null;
  changeCount = 0;
  changeLog = [];
  releaseObjectUrl();
  releasePreviewUrls();

  elements.result.hidden = false;
  elements.resultFile.textContent = name;
  elements.resultEngine.textContent = `v${ENGINE_VERSION}`;
  elements.resultLoad.textContent = "処理中…";
  elements.resultText.textContent = "—";
  elements.debugRuns.textContent = "—";

  elements.workspace.hidden = true;
  elements.searchInput.value = "";
  elements.replaceInput.value = "";
  elements.searchStatus.textContent = "検索する文字を入力してください";
  elements.results.hidden = true;
  elements.resultsList.replaceChildren();
  elements.resultsMore.hidden = true;
  elements.debugMode.textContent = "—";
  clearReplaceNotice();
  showChangeCount();
  renderChangeLog();
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
    // ここでの listTextRuns() は「読み込めたこと」と本文件数の確認にだけ使う。
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
  elements.workspace.hidden = false;

  // 読み込み直後は変更が無いため、変更前と編集中は同じ内容になる。
  buildPreviews();

  setState("ok");
}

/* ------------------------------------------------------------ プレビュー */

// 変更前（originalBytes）と編集中（currentBytes）のBlob URLを、別々に持つ。
// 保存用の objectUrl とは独立して管理する。
let originalPreviewUrl = null;
let currentPreviewUrl = null;
let previewSide = "original";

function pdfBlobUrl(bytes) {
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

function releasePreviewUrls() {
  if (originalPreviewUrl) {
    URL.revokeObjectURL(originalPreviewUrl);
    originalPreviewUrl = null;
  }
  releaseCurrentPreviewUrl();
  previewSide = "original";
  elements.previewViewer.src = "about:blank";
}

function releaseCurrentPreviewUrl() {
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = null;
  }
}

// ブラウザ標準のPDF viewerが使えるかどうか。
// 判定できないブラウザでは、まず表示を試みる（過剰に機能を止めない）。
function canPreviewPdf() {
  if (typeof navigator.pdfViewerEnabled === "boolean") return navigator.pdfViewerEnabled;
  if (navigator.mimeTypes && navigator.mimeTypes["application/pdf"]) return true;
  return true;
}

function previewUrl() {
  return previewSide === "current" ? currentPreviewUrl : originalPreviewUrl;
}

// ブラウザ標準PDF viewerへの表示指定（PDFの「開くときのパラメータ」）。
// 横幅に合わせて表示し、サムネイル欄を開かないことで、確認用の表示を広く取る。
// 対応していないブラウザでは単に無視される。外部への要求は発生しない。
const PREVIEW_VIEW = "#view=FitH&navpanes=0";

// PDF選択時に、変更前・編集中の両方を作る。初回はどちらも同じ内容になる。
function buildPreviews() {
  originalPreviewUrl = pdfBlobUrl(originalBytes);
  currentPreviewUrl = pdfBlobUrl(currentBytes);
  showPreview("original");
}

// 置換に成功したときだけ呼ぶ。古いBlob URLを解放し、新しいPDFへ差し替える。
// 同じURLを使い回さないため、ブラウザのキャッシュで古い内容が残ることはない。
function refreshCurrentPreview() {
  releaseCurrentPreviewUrl();
  currentPreviewUrl = pdfBlobUrl(currentBytes);
  showPreview("current");
}

function showPreview(side) {
  previewSide = side === "current" ? "current" : "original";

  const showingCurrent = previewSide === "current";
  elements.previewOriginal.setAttribute("aria-pressed", String(!showingCurrent));
  elements.previewCurrent.setAttribute("aria-pressed", String(showingCurrent));
  elements.previewCaption.textContent = showingCurrent
    ? "編集中のPDFを表示しています。"
    : "変更前のPDFを表示しています。";

  const url = previewUrl();
  const available = Boolean(url) && canPreviewPdf();

  elements.previewViewer.hidden = !available;
  elements.previewFallback.hidden = available;
  // 表示できないときは、空の大きな枠を残さない。
  elements.previewFrame.classList.toggle("is-fallback", !available);
  elements.previewOpen.disabled = !url;

  if (available) {
    const target = url + PREVIEW_VIEW;
    if (elements.previewViewer.src !== target) elements.previewViewer.src = target;
  }
}

/* ---------------------------------------------------------------- 検索 */

// 一度に描画する検索結果の上限。件数そのものは全件数を表示する。
const MAX_RESULTS_SHOWN = 100;

// 検索は engine の searchText() へ一本化する。
// 本体側で run を連結したり、run の続きかどうかを判断したりしない。
// 検索結果の id は engine が発行する不透明な値として扱い、解析しない。
function renderResults() {
  const list = elements.resultsList;
  list.replaceChildren();

  const shown = Math.min(matches.length, MAX_RESULTS_SHOWN);
  for (let index = 0; index < shown; index += 1) {
    const match = matches[index];

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "search-result";
    radio.className = "results__radio";
    radio.id = `search-result-${index}`;
    radio.value = String(index);

    const text = document.createElement("span");
    text.className = "results__text";
    // PDFの本文はテキストノードとして組み立てる（HTMLとして解釈させない）。
    // 画面へ出すのは前後の文脈だけで、PDF内部の情報は出さない。
    text.append(match.before ? `…${match.before}` : "");
    const mark = document.createElement("mark");
    mark.textContent = match.text;
    text.append(mark);
    text.append(match.after ? `${match.after}…` : "");

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

  if (matches.length > shown) {
    elements.resultsMore.textContent =
      `全${counter(matches.length)}件のうち、先頭${counter(shown)}件を表示しています。`
      + "検索する文字を長くすると絞り込めます。";
    elements.resultsMore.hidden = false;
  } else {
    elements.resultsMore.hidden = true;
  }

  elements.results.hidden = matches.length === 0;
}

// 前の検索結果と選択を捨てる。置換対象が画面の表示とずれた状態を残さない。
function invalidateResults(message) {
  matches = [];
  selectedIndex = -1;
  lastSearchedQuery = null;
  elements.results.hidden = true;
  elements.resultsList.replaceChildren();
  elements.resultsMore.hidden = true;
  elements.searchStatus.textContent = message;
  updateControls();
}

// 検索そのもの。画面状態（busy / ok / ng）は呼び出し側が決める。
//
// 検索文字は呼び出し時のものを引数で受け取り、途中で画面から読み直さない。
// 完了時にも検索欄が同じ文字のままかを確認し、違っていれば結果を画面へ出さない。
// 処理中は検索欄を止めているが、UIを変えたときにも古い結果が表示されないようにする。
// 反映しなかった場合は false を返す。
async function performSearch(query) {
  const found = await editor.searchText(query);

  if (elements.searchInput.value !== query) {
    invalidateResults("検索条件が変更されました。もう一度検索してください");
    return false;
  }

  matches = found;
  selectedIndex = -1;
  lastSearchedQuery = query;
  renderResults();

  elements.searchStatus.textContent = matches.length === 0
    ? "一致する文字が見つかりませんでした"
    : `${counter(matches.length)}件見つかりました`;

  updateControls();
  return true;
}

async function runSearch() {
  const query = elements.searchInput.value;
  clearReplaceNotice();
  hidePanels();

  // 空文字はengine側でも拒否される。画面では検索そのものを行わない。
  if (query.length === 0) {
    invalidateResults("検索する文字を入力してください");
    return;
  }

  setState("busy");
  await nextFrame();

  try {
    await performSearch(query);
    setState("ok");
  } catch (error) {
    const kind = classifyError(error, { phase: "edit" });
    invalidateResults("検索できませんでした");
    showError(kind, error);
    setState("ng");
  }
}

/* ------------------------------------------------------------ 置換の案内 */

// 置換できるかどうかを、文字数・run数・フォント・PDF内部構造から本体側で推測しない。
// 置換可否の判断は engine の checkTextMatchReplacement() / replaceTextMatch() に
// 一本化している。ここでは案内の消去だけを行う。
function clearReplaceNotice() {
  elements.editNotice.hidden = true;
  elements.editNotice.textContent = "";
}

/* ---------------------------------------------------------------- 置換 */

// 検索結果を突き合わせるときに見る、前後の文脈の文字数。
const CONTEXT_CHECK = 4;

const leadingPoints = (text, count) => [...text].slice(0, count).join("");
const trailingPoints = (text, count) => [...text].slice(-count).join("");

// 一時editorで取り直した検索結果が、画面で選んでいたものと同じ箇所かを確かめる。
// match ID の文字列を解析して対応付けることはしない。
function sameOccurrence(fresh, chosen) {
  if (!fresh || !chosen) return false;
  if (fresh.text !== chosen.text) return false;
  if (trailingPoints(fresh.before, CONTEXT_CHECK) !== trailingPoints(chosen.before, CONTEXT_CHECK)) return false;
  if (leadingPoints(fresh.after, CONTEXT_CHECK) !== leadingPoints(chosen.after, CONTEXT_CHECK)) return false;
  return true;
}

// engine が置換を断ったときの表示。
// checkTextMatchReplacement() は errorを投げず判定結果を返すため、
// error と同じ経路（区分・詳細欄）へ載せ替えて案内する。
function showRefusal(verdict) {
  const kind = ERROR_CODE_KINDS[verdict.code] ?? "replace-unsafe";
  const detail = new Error(`${verdict.code}: ${verdict.reason}`);
  showError(kind, detail, verdict.characters);
}

// 置換は現在のPDFへ直接変更を積まず、毎回作り直した一時editorで行う。
// save と reopen まで成功した場合だけ、編集状態を新しいPDFへ進める。
async function replaceSelected() {
  if (selectedIndex < 0 || selectedIndex >= matches.length) return;
  if (lastSearchedQuery === null) return;

  // 処理の対象は、この時点の値だけで決める。
  // 検索文字・選択位置・置換文字を局所変数へ写し取り、途中で画面から読み直さない。
  // 非同期処理の間に選択が変わっても、置換するのは利用者が押した時点の1件である。
  const query = lastSearchedQuery;
  const targetIndex = selectedIndex;
  const chosen = matches[targetIndex];
  const replacement = elements.replaceInput.value;

  hidePanels();
  clearReplaceNotice();

  // 置換前と置換後が同じなら、PDFを書き換えない。
  // 「変更 N件」は実際に変わった件数を示すため、ここで数えない。
  if (replacement === chosen.text) {
    elements.editNotice.textContent = "置換前と置換後が同じです。変更していません。";
    elements.editNotice.hidden = false;
    return;
  }

  setState("busy");
  await nextFrame();

  try {
    // match ID は、それを発行したeditorだけで有効である。
    // 一時editorでは同じ検索文字で検索し直し、同じ順番の結果を取り直す。
    //
    // 置換に使うeditorには、置換の前に必ず編集用フォントを渡す。
    // 元のPDFのフォントで書けるかどうかの判断も、編集用フォントを使うかどうかの
    // 判断も、engine側が行う。
    const temporary = new PdfTextEditor(currentBytes);
    await withFallbackFont(temporary);
    const temporaryMatches = await temporary.searchText(query);

    // 並びや内容が変わっていたら、取り違えを避けて中止する。
    if (temporaryMatches.length !== matches.length) throw new Error(STALE_SELECTION);
    const fresh = temporaryMatches[targetIndex];
    if (!sameOccurrence(fresh, chosen)) throw new Error(STALE_SELECTION);

    // 置換できるかどうかは engine の事前確認へ一本化する。
    // allowed が true のときだけ置換する。
    const verdict = await temporary.checkTextMatchReplacement(fresh.id, replacement);
    elements.debugMode.textContent = verdict.mode ?? `拒否（${verdict.code}）`;
    if (!verdict.allowed) {
      // mode / code / reason は開発者向け詳細にとどめ、画面へは言い換えだけを出す。
      showRefusal(verdict);
      setState("ng");
      return;
    }

    await temporary.replaceTextMatch(fresh.id, replacement);
    const savedBytes = await temporary.save();

    // save しただけでは成功とみなさない。開き直せることまで確認する。
    const reopened = new PdfTextEditor(savedBytes);
    const reopenedRuns = await reopened.listTextRuns();

    // ここまで成功した場合だけ編集状態を進める。
    currentBytes = savedBytes;
    editor = reopened;
    runs = reopenedRuns;
    changeCount += 1;
    changeLog.push({ from: chosen.text, to: replacement });
    releaseObjectUrl();

    showRunCount(runs.length);
    showChangeCount();
    renderChangeLog();

    // 編集中PDFのプレビューを新しいBlob URLへ差し替え、「編集中」へ切り替える。
    refreshCurrentPreview();

    // 置換後の本文で検索し直し、残り件数を更新する。
    // 検索結果は、置換後のPDFを開き直した editor が発行し直したものになる。
    await performSearch(query);
    setState("ok");
  } catch (error) {
    // 失敗しても currentBytes / editor / 変更件数・変更履歴・プレビューはそのまま。
    // 編集状態を壊さない。
    const kind = classifyError(error, { phase: "edit" });
    // engine が構造化して返した「書けなかった文字」をそのまま使う。
    showError(kind, error, error && error.characters);
    setState("ng");
  }
}

/* ---------------------------------------------------------- 変更履歴 */

// 現在の編集中PDFへ成功して反映された置換だけを並べる。
// 失敗した置換・同じ文字への置換は含めない。PDF内部の情報も出さない。
function renderChangeLog() {
  const list = elements.changesList;
  list.replaceChildren();

  for (const change of changeLog) {
    const item = document.createElement("li");
    item.className = "changes__item";
    if (change.to.length === 0) {
      item.textContent = `「${change.from}」→ 削除`;
    } else {
      item.textContent = `「${change.from}」→「${change.to}」`;
    }
    list.append(item);
  }

  list.hidden = changeLog.length === 0;
  elements.changesEmpty.hidden = changeLog.length > 0;
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

  // 保存対象も、この時点のバイト列とファイル名で確定させる。
  const bytes = currentBytes;
  const name = fileName;

  hidePanels();
  setState("busy");
  await nextFrame();

  try {
    // ダウンロード直前にも、PDFとして開き直せることを確認する。
    const check = new PdfTextEditor(bytes);
    await check.listTextRuns();
  } catch (error) {
    showError(classifyError(error, { phase: "edit" }), error);
    setState("ng");
    return;
  }

  releaseObjectUrl();
  objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));

  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = editedFileName(name);
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
  clearReplaceNotice();
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

// 置換文字の入力中に、本体側で置換可否を判定することはしない。
// 入力し直したら、前回の置換についての案内だけを消す。
elements.replaceInput.addEventListener("input", () => {
  clearReplaceNotice();
  updateControls();
});

elements.replaceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (uiState === "busy") return;
  replaceSelected();
});

elements.previewOriginal.addEventListener("click", () => showPreview("original"));
elements.previewCurrent.addEventListener("click", () => showPreview("current"));

// 現在選んでいる（変更前／編集中の）PDFを、そのままブラウザの別タブで開く。
// 開くのはBlob URLだけで、外部サイトへは送らない。
elements.previewOpen.addEventListener("click", () => {
  const url = previewUrl();
  if (url) window.open(url, "_blank", "noopener");
});

elements.saveButton.addEventListener("click", () => {
  if (uiState === "busy") return;
  saveEdited();
});

window.addEventListener("pagehide", () => {
  releaseObjectUrl();
  releasePreviewUrls();
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
elements.debugFont.textContent = "読み込み中…";
elements.debugMode.textContent = "—";
showChangeCount();
renderChangeLog();

// index.html 側の起動失敗表示を取り消す（moduleがここまで到達できた＝読み込み成功）。
window.__idontlovepdfReady = true;

// 編集用フォントは起動時に一度だけ読み込む。
//
// 読み込めなかった場合、fallbackなしで通常起動したように見せない。
// 代わりのフォントを外部から取りに行くこともしない。原因が分かる案内を出し、
// PDFの受け付けを止める（配置を直してページを再読み込みしてもらう）。
async function start() {
  setState("busy");
  try {
    fallbackFontBytes = await loadFallbackFont();
  } catch (error) {
    elements.debugFont.textContent = "✗ 読み込み失敗";
    showError("font-load-failed", error);
    setState("ng");
    return;
  }
  elements.debugFont.textContent = `BIZ UDGothic Regular（${counter(fallbackFontBytes.length)} bytes）`;
  setState("idle");
  window.__idontlovepdfFontReady = true;
}

start();
