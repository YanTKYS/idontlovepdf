// CI: vendor/ に同梱したengine bundleと編集用フォントが、vendor/manifest.json に
// 記録した期待値（SHA-256・サイズ）と一致することを確認する。
//
// engine bundleについては、ES Moduleとして実際に読み込めることと、
// ENGINE_VERSION が manifest の記載と一致することも確認する。
//
// PDF処理そのもののテスト（engine内部のSerif/Sans判定・置換安全性判定等）は
// ここでは行わない。それはengine repository自身のCIの責務である。
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
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

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

const manifestPath = path.join(repoRoot, "vendor", "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function checkAsset(label, entry) {
  const filePath = path.join(repoRoot, entry.path);
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    fail(`${label}: ${entry.path} が存在しません`);
    return;
  }
  if (stat.size !== entry.size) {
    fail(`${label}: サイズが manifest と一致しません（実際 ${stat.size} bytes / manifest ${entry.size} bytes）`);
  } else {
    ok(`${label}: サイズ一致（${stat.size} bytes）`);
  }
  const actualSha = sha256(filePath);
  if (actualSha !== entry.sha256) {
    fail(`${label}: SHA-256 が manifest と一致しません（実際 ${actualSha} / manifest ${entry.sha256}）`);
  } else {
    ok(`${label}: SHA-256 一致（${actualSha}）`);
  }
}

checkAsset("engine bundle", manifest.engine);
checkAsset("BIZ UDGothic", manifest.fonts.gothic);
checkAsset("BIZ UDMincho", manifest.fonts.mincho);

// engine bundleをES Moduleとして実際に読み込み、ENGINE_VERSIONと公開APIを確認する。
try {
  const enginePath = path.join(repoRoot, manifest.engine.path);
  const mod = await import(pathToFileURL(enginePath).href);
  if (mod.ENGINE_VERSION !== manifest.engine.version) {
    fail(`engine bundle: ENGINE_VERSION が一致しません（実際 "${mod.ENGINE_VERSION}" / manifest "${manifest.engine.version}"）`);
  } else {
    ok(`engine bundle: ES Moduleとして読み込み成功、ENGINE_VERSION === "${mod.ENGINE_VERSION}"`);
  }
  if (typeof mod.PdfTextEditor !== "function") {
    fail("engine bundle: PdfTextEditor がexportされていません");
  } else {
    const proto = mod.PdfTextEditor.prototype;
    if (typeof proto.setFallbackFonts !== "function") {
      fail("engine bundle: setFallbackFonts() がexportされていません（v0.5.0の公開APIとして必須）");
    } else {
      ok("engine bundle: PdfTextEditor.setFallbackFonts() を確認");
    }
  }
} catch (error) {
  fail(`engine bundle: ES Moduleとして読み込めません（${error.message}）`);
}

if (failed) {
  console.error("\nvendor integrity check: FAILED");
  process.exit(1);
} else {
  console.log("\nvendor integrity check: OK");
}
