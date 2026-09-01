# vendor/

`idontlovepdf` が利用するPDF処理エンジンの、正式Release成果物の置き場である。

外部OSSライブラリのコピーではなく、同一開発者による別リポジトリ `YanTKYS/idontlovepdf-engine` のRelease bundleを取り込んだものである。

ただし本リポジトリから見れば依存物であるため、どのversionを取り込んだかをここに記録する。

## 取り込み内容

| 項目 | 値 |
|---|---|
| library | idontlovepdf-engine |
| version | v0.2.0 |
| asset | `idontlovepdf-engine.js` |
| SHA-256 | `afb4bac7d304478606365c08728b345a5e51ad834c0716222098c116e09e8429` |
| 更新元 | `YanTKYS/idontlovepdf-engine` の GitHub Release |
| 取得日 | 2026-09-01 |

取得元URL:

- <https://github.com/YanTKYS/idontlovepdf-engine/releases/tag/v0.2.0>

## 取り扱いの原則

- 取り込むのは **Release assetのbundle 1ファイルのみ** とする。
- engineの `src/` をコピーしない。
- 内部モジュール（xref parser、Object Stream parser、Predictor、CMap、暗号化・AES実装等）を本体側へコピーしたり、直接importしたりしない。
- 本体側が利用してよいのは、bundleがexportする正式公開APIだけとする。
  - `PdfTextEditor`
  - `ENGINE_VERSION`
- bundleを手で編集しない。修正が必要な場合は `idontlovepdf-engine` 側で直し、新しいversionをReleaseしてから差し替える。
- version情報をJavaScriptコードへ書き写さない。実行時のversion表示には `ENGINE_VERSION` を使う。

## engineの更新手順

engineを新しいversionへ上げるときは、次の順で行う。

1. `idontlovepdf-engine` 側で新versionをReleaseする
2. Release assetの `idontlovepdf-engine.js` と `idontlovepdf-engine.js.sha256` を取得する
3. 取得したbundleのSHA-256が `.sha256` の値と一致することを確認する

   ```bash
   sha256sum idontlovepdf-engine.js
   cat idontlovepdf-engine.js.sha256
   ```

4. 一致していれば `vendor/idontlovepdf-engine.js` を差し替える（一致しない場合はコミットしない）
5. このファイルの「取り込み内容」表（version、SHA-256、取得日）を更新する
6. 静的HTTPサーバー経由でツールを開き、`ENGINE_VERSION` の表示が新しいversionになっていることを確認する
7. 通常PDF・日本語PDF・暗号化PDFで、実ブラウザ回帰確認を行う（`README.md` の「動作確認」を参照）

engine Releaseへ自動追従するGitHub Actionsは導入しない。当面は手動更新とする。

## 補足

- v0.2.0 の型定義（engine側 `src/index.d.ts`）では `listTextRuns()` に引数が宣言されていないが、実装・bundleともに `listTextRuns(password)` を受け付ける。本体側の暗号化PDF対応はこの引数を利用している。本体はJavaScriptのため動作上の問題は無いが、engineの次回版で `password?: string` へ型定義を合わせる（engine側の課題）。
- v0.2.0 の公開APIには `/P` permission（読み取り可否・変更可否）を取得する手段が無い。permission表示が必要になった場合は、engine側の公開API拡張として扱う。本体側からengine内部フィールドを参照して表示することはしない。
