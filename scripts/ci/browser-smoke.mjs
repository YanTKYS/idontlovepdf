// CI: 本体UIの最小browser smoke test。
//
// engineのPDFアルゴリズムそのものは再テストしない（それはengine repository自身の
// CIの責務）。ここで確認するのは、静的配信した本体が最低限次を満たすことだけ:
//
//   - index.html がロードできる
//   - JavaScriptのuncaught errorがない
//   - engine bundleがロードできる
//   - Engine欄に vendor/manifest.json 記載のengine versionが表示される
//   - Gothic fontのHTTP取得が成功する
//   - Mincho fontのHTTP取得が成功する
//   - font読み込み完了後にPDF選択UIが利用可能になる
//   - 同一origin以外へのruntime requestが発生しない
//
// PDFを実際に読み込んでの検索・置換確認は行わない（22550.pdf等の実PDFでの
// 回帰確認は手動・開発環境の対象。CI fixtureとしてPDFをコミットしない方針は
// vendor/README.md・README.md を参照）。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ttf": "font/ttf"
};

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      let relativePath = decodeURIComponent(url.pathname);
      if (relativePath === "/") relativePath = "/index.html";
      const filePath = path.join(repoRoot, relativePath);

      if (!filePath.startsWith(repoRoot) || !existsSync(filePath)) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      try {
        const body = await readFile(filePath);
        const ext = path.extname(filePath);
        response.writeHead(200, {
          "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
          "Cache-Control": "no-cache"
        });
        response.end(body);
      } catch (error) {
        response.writeHead(500);
        response.end(String(error));
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

let failed = false;
function fail(message) {
  console.error(`✗ ${message}`);
  failed = true;
}
function ok(message) {
  console.log(`✓ ${message}`);
}

const manifest = JSON.parse(await readFile(path.join(repoRoot, "vendor", "manifest.json"), "utf8"));
const expectedEngineVersion = `v${manifest.engine.version}`;

const server = await startServer();
const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;

const nodeModules = execSync("npm root -g").toString().trim();
const localModules = path.join(repoRoot, "node_modules");
const playwrightPath = existsSync(path.join(localModules, "playwright"))
  ? path.join(localModules, "playwright", "index.mjs")
  : path.join(nodeModules, "playwright", "index.mjs");
const { chromium } = await import(`file://${playwrightPath}`);

const browser = await chromium.launch();
const page = await browser.newPage();

const consoleErrors = [];
const pageErrors = [];
const requests = [];
const fontResponses = new Map();

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(String(error)));
page.on("request", (request) => requests.push(request.url()));
page.on("response", (response) => {
  const url = response.url();
  if (url.includes("BIZUDGothic-Regular.ttf") || url.includes("BIZUDMincho-Regular.ttf")) {
    fontResponses.set(url, response.status());
  }
});

try {
  await page.goto(`${origin}/index.html`, { waitUntil: "networkidle", timeout: 15000 });
  ok("index.html をロードできた");

  await page.waitForFunction(() => window.__idontlovepdfReady === true, { timeout: 10000 })
    .then(() => ok("engine bundleをロードできた（module実行到達）"))
    .catch(() => fail("engine bundleのロードが確認できなかった（__idontlovepdfReady が立たない）"));

  await page.waitForFunction(() => window.__idontlovepdfFontReady === true, { timeout: 10000 })
    .then(() => ok("編集用フォント（2種類）の読み込みが完了した"))
    .catch(() => fail("編集用フォントの読み込み完了が確認できなかった（__idontlovepdfFontReady が立たない）"));

  const engineText = await page.locator("#debug-engine").textContent();
  if (engineText.includes(expectedEngineVersion)) {
    ok(`Engine欄に${expectedEngineVersion}が表示されている: "${engineText}"`);
  } else {
    fail(`Engine欄に${expectedEngineVersion}が表示されていない: "${engineText}"`);
  }

  const fileInputDisabled = await page.locator("#pdf-input").isDisabled();
  if (!fileInputDisabled) {
    ok("font読み込み完了後、PDF選択UIが利用可能になっている");
  } else {
    fail("font読み込み完了後もPDF選択UIが無効のまま");
  }

  for (const fontFile of ["BIZUDGothic-Regular.ttf", "BIZUDMincho-Regular.ttf"]) {
    const entry = [...fontResponses].find(([url]) => url.includes(fontFile));
    if (entry && entry[1] === 200) {
      ok(`${fontFile} のHTTP取得が成功した（200）`);
    } else {
      fail(`${fontFile} のHTTP取得を確認できなかった（${entry ? `status ${entry[1]}` : "requestが観測されなかった"}）`);
    }
  }

  const offOrigin = requests.filter((url) => !url.startsWith(origin));
  if (offOrigin.length === 0) {
    ok("同一origin以外へのruntime requestは発生していない");
  } else {
    fail(`同一origin以外へのrequestが発生した: ${offOrigin.join(", ")}`);
  }

  if (consoleErrors.length === 0) {
    ok("JavaScriptのconsole errorは発生していない");
  } else {
    fail(`console errorが発生した: ${consoleErrors.join(" | ")}`);
  }

  if (pageErrors.length === 0) {
    ok("JavaScriptのuncaught errorは発生していない");
  } else {
    fail(`uncaught errorが発生した: ${pageErrors.join(" | ")}`);
  }
} finally {
  await browser.close();
  server.close();
}

if (failed) {
  console.error("\nbrowser smoke test: FAILED");
  process.exit(1);
} else {
  console.log("\nbrowser smoke test: OK");
}
