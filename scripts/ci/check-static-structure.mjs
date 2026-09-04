// CI: 静的Webアプリとしての本体構成が壊れていないことを確認する。
//
// - 必須の静的ファイルが揃っている
// - js/app.js がJavaScriptとして構文エラーなく読める
// - runtimeとなるHTML/CSS/JS（README等のドキュメントは対象外）に、
//   http(s):// で始まる外部URLへの参照が新たに増えていない
//   （fetch先はvendor/配下のローカルファイルだけ、という既存方針の回帰確認）
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

let failed = false;
function fail(message) {
  console.error(`✗ ${message}`);
  failed = true;
}
function ok(message) {
  console.log(`✓ ${message}`);
}

const REQUIRED_FILES = [
  "index.html",
  "css/style.css",
  "js/app.js",
  "vendor/idontlovepdf-engine.js",
  "vendor/fonts/BIZUDGothic-Regular.ttf",
  "vendor/fonts/BIZUDMincho-Regular.ttf"
];

for (const relativePath of REQUIRED_FILES) {
  if (existsSync(path.join(repoRoot, relativePath))) {
    ok(`必須ファイルが存在する: ${relativePath}`);
  } else {
    fail(`必須ファイルが存在しない: ${relativePath}`);
  }
}

// js/app.js の構文チェック。
try {
  execFileSync(process.execPath, ["--check", path.join(repoRoot, "js/app.js")], { stdio: "pipe" });
  ok("js/app.js: 構文チェックOK");
} catch (error) {
  fail(`js/app.js: 構文エラー\n${error.stderr?.toString() ?? error.message}`);
}

// runtimeのHTML/CSS/JSに外部URL参照が無いことを確認する。
// README/docsは対象外（説明用URLを許容するため、ここではrepository rootの
// index.html・css/style.css・js/app.js だけを見る）。
const RUNTIME_FILES = ["index.html", "css/style.css", "js/app.js"];
const EXTERNAL_URL_PATTERN = /https?:\/\//;

for (const relativePath of RUNTIME_FILES) {
  const filePath = path.join(repoRoot, relativePath);
  if (!existsSync(filePath)) continue; // 上のREQUIRED_FILESチェックで既に報告済み
  const content = readFileSync(filePath, "utf8");
  const matches = content.split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => EXTERNAL_URL_PATTERN.test(line));
  if (matches.length > 0) {
    for (const { line, number } of matches) {
      fail(`${relativePath}:${number}: 外部URLへの参照が見つかりました: ${line.trim()}`);
    }
  } else {
    ok(`${relativePath}: 外部URL参照なし`);
  }
}

if (failed) {
  console.error("\nstatic structure check: FAILED");
  process.exit(1);
} else {
  console.log("\nstatic structure check: OK");
}
