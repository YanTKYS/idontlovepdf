# vendor/

`idontlovepdf` が利用するPDF処理エンジンの、正式Release成果物の置き場である。

外部OSSライブラリのコピーではなく、同一開発者による別リポジトリ `YanTKYS/idontlovepdf-engine` のRelease bundleを取り込んだものである。

ただし本リポジトリから見れば依存物であるため、どのversionを取り込んだかをここに記録する。

## 取り込み内容

| 項目 | 値 |
|---|---|
| library | idontlovepdf-engine |
| version | v0.2.1 |
| asset | `idontlovepdf-engine.js` |
| SHA-256 | `798f586fd4fbdb35bf509aceb20ffd878c4785af702ec732dd83c73742d4a53d` |
| 更新元 | `YanTKYS/idontlovepdf-engine` の GitHub Release |
| 取得日 | 2026-09-02 |

取得元URL:

- <https://github.com/YanTKYS/idontlovepdf-engine/releases/tag/v0.2.1>

## 取り扱いの原則

- 取り込むのは **Release assetのbundle 1ファイルのみ** とする。
- engineの `src/` をコピーしない。
- 内部モジュール（xref parser、Object Stream parser、Predictor、CMap、暗号化・AES実装等）を本体側へコピーしたり、直接importしたりしない。
- 本体側が利用してよいのは、bundleがexportする正式公開APIだけとする。
  - `PdfTextEditor`
    - `listTextRuns(password?)`（読み込み確認・本文件数の概況表示に使う）
    - `searchText(query, password?)`（本文検索。検索・置換対象の判断はこれに一本化する）
    - `replaceTextMatch(matchId, replacement)`（検索結果1件の置換）
    - `save()`
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

- v0.2.1 で高レベルAPI `searchText()` / `replaceTextMatch()` が追加された。複数の text run へ分割された語句の検索と、同文字数の置換をengine側で扱う。本体側は run の連結・continuityの判断・PDF描画命令の解釈を行わない。
- `replaceTextMatch()` が返す match ID は、発行した `PdfTextEditor` インスタンス専用である。別インスタンスへ流用してはならない。ID文字列を解析して対応付けることもしない。
- 高レベルAPIのerrorは `error.code` に安定した識別子を持つ。本体側の分類は message文字列より `error.code` を優先する。
  - `EMPTY_QUERY` / `UNKNOWN_MATCH` / `MATCH_STALE` / `MULTI_RUN_LENGTH_CHANGE_UNSUPPORTED` / `MULTI_RUN_FONT_CHANGE_UNSUPPORTED`
- 複数runにまたがる一致の置換は、同文字数の置換と削除（空文字）に対応する。異文字数の置換は `MULTI_RUN_LENGTH_CHANGE_UNSUPPORTED` として明示的に拒否される（engineの安全仕様であり、不具合ではない）。
- v0.2.1 の公開APIにも `/P` permission（読み取り可否・変更可否）を事前取得する手段は無い。permission表示が必要になった場合は、engine側の公開API拡張として扱う。本体側からengine内部フィールドを参照して表示することはしない。
