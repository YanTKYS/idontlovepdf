# vendor/

`idontlovepdf` が実行時に読み込む、外部から取り込んだファイルの置き場である。

| ファイル | 内容 |
|---|---|
| `idontlovepdf-engine.js` | PDF処理エンジンの正式Release bundle |
| `fonts/BIZUDGothic-Regular.ttf` | PDF編集時のfallback font（編集用フォント） |
| `fonts/OFL.txt` | 上記フォントのライセンス文書（SIL Open Font License 1.1） |

いずれも**リポジトリへ同梱**する。実行時にGitHub ReleaseやGoogle Fonts等から取得することはしない。

## 1. idontlovepdf-engine

外部OSSライブラリのコピーではなく、同一開発者による別リポジトリ `YanTKYS/idontlovepdf-engine` のRelease bundleを取り込んだものである。本リポジトリから見れば依存物であるため、どのversionを取り込んだかをここに記録する。

| 項目 | 値 |
|---|---|
| library | idontlovepdf-engine |
| version | v0.4.0 |
| asset | `idontlovepdf-engine.js` |
| SHA-256 | `e6cf82538b33b1fee84539d0889ac7a123d8e893e3d387811e7335e1157c03f7` |
| 更新元 | `YanTKYS/idontlovepdf-engine` の GitHub Release |
| 取得日 | 2026-09-02 |

取得元URL:

- <https://github.com/YanTKYS/idontlovepdf-engine/releases/tag/v0.4.0>

### 取り扱いの原則

- 取り込むのは **Release assetのbundle 1ファイルのみ** とする。
- engineの `src/` をコピーしない。
- 内部モジュール（xref parser、Object Stream parser、Predictor、CMap、暗号化・AES実装、フォント埋め込み処理等）を本体側へコピーしたり、直接importしたりしない。
- 本体側が利用してよいのは、bundleがexportする正式公開APIだけとする。
  - `PdfTextEditor`
    - `listTextRuns(password?)`（読み込み確認・本文件数の概況表示に使う）
    - `searchText(query, password?)`（本文検索。検索・置換対象の判断はこれに一本化する）
    - `setFallbackFont(fontBytes)`（元PDFのフォントで書けない文字用のフォントを渡す）
    - `checkTextMatchReplacement(matchId, replacement)`（置換可否の事前確認。何も変更しない）
    - `replaceTextMatch(matchId, replacement)`（検索結果1件の置換）
    - `save()`
  - `ENGINE_VERSION`
- bundleを手で編集しない。修正が必要な場合は `idontlovepdf-engine` 側で直し、新しいversionをReleaseしてから差し替える。
- version情報をJavaScriptコードへ書き写さない。実行時のversion表示には `ENGINE_VERSION` を使う。

### v0.4.0 の要点（本体側の設計に関わるもの）

- `setFallbackFont()` で渡したフォントを、engineが必要なときだけPDFへ埋め込む。**元PDFのフォントで書ける場合は従来どおりそのフォントを使う。** 本体側でPDF内部のフォントを調べて「fallbackが必要か」を判断しない。
- フォントは1つの文書につき1回だけ埋め込まれる。保存・再openを挟んで置換を繰り返しても、そのたびにフォント全体が追加されることはない（engineが埋め込み済みのフォントを引き継ぐ）。
- 置換可否は `checkTextMatchReplacement()` が `{ allowed, mode }` または `{ allowed: false, code, reason, characters? }` で返す。errorを投げない。本体側は `allowed: true` のときだけ `replaceTextMatch()` を呼ぶ。
- `mode` は engine が選んだ書き方（`single-run` / `same-length` / `delete` / `variable-length-safe` / `fallback-font` / `fallback-font-partial` / `fallback-font-multi-run`）である。**開発者向け情報であり、一般利用者向け画面へ出さない。**
- 安全に置換できない構造は、推測で埋めずに拒否する（fail closed）。本体側でこれを迂回する実装を作らない。

### error code

高レベルAPIのerrorは `error.code` に安定した識別子を持つ。`checkTextMatchReplacement()` の戻り値も同じ `code` を使う。本体側の分類はmessage文字列より `error.code` を優先する。

| code | 意味（要約） |
|---|---|
| `EMPTY_QUERY` | 検索文字が空 |
| `UNKNOWN_MATCH` / `MATCH_STALE` | 検索結果が古い・別editorのID |
| `REPLACEMENT_NOT_A_STRING` | 置換文字が文字列でない |
| `MODIFICATION_NOT_PERMITTED` | `/P` permissionで変更が禁止されている |
| `FONT_ENCODING_UNSUPPORTED` | 元のPDFのフォントでその文字を書けない |
| `FALLBACK_FONT_MISSING_GLYPH` | fallback fontにもその文字が無い |
| `FALLBACK_FOLLOWING_TEXT_POSITION_UNSAFE` | 置換箇所の直後の文字がずれるおそれがある |
| `FALLBACK_OPERATOR_UNSUPPORTED` | fallback fontで書けない描画命令で描かれている |
| `FALLBACK_MULTI_RUN_UNSUPPORTED` | 複数の描画単位が単純に隣接していない |
| `FALLBACK_WORD_SPACING_UNSUPPORTED` | 単語間隔の指定があり、空白を含む置換が別扱いになる |
| `FALLBACK_LAYOUT_UNSUPPORTED` | フォント指定・サイズ等を元へ戻せない |
| `FALLBACK_WRITING_MODE_UNSUPPORTED` | 縦書き等、横書きのfallback fontで代替できない |
| `FALLBACK_EDIT_REQUIRES_SAVE` | 同じ箇所を続けて置換しようとした（保存して開き直せば可） |
| `FALLBACK_FONT_ALREADY_IN_USE` | 置換後に別のfallback fontへ差し替えようとした |
| `FALLBACK_FONT_INVALID` | fallback fontのバイト列を読めない |
| `MULTI_RUN_LENGTH_CHANGE_UNSUPPORTED` | 複数の描画単位にまたがる箇所の異文字数置換で、間隔指定があり安全に書けない |
| `MULTI_RUN_FONT_CHANGE_UNSUPPORTED` | 箇所の途中で書体が変わっている |

`FALLBACK_FONT_MISSING_GLYPH` と `FONT_ENCODING_UNSUPPORTED` は、対象文字を `characters`（1文字ずつの配列）で返す。画面へ文字を出すときはこれを使い、message文字列を解析して取り出さない。構造上の拒否にも参考情報として `characters` が付くことがあるが、その場合の原因は文字ではないため画面へ出さない。

### engineの更新手順

engineを新しいversionへ上げるときは、次の順で行う。

1. `idontlovepdf-engine` 側で新versionをReleaseする
2. Release assetの `idontlovepdf-engine.js` と `idontlovepdf-engine.js.sha256` を取得する
3. 取得したbundleのSHA-256が `.sha256` の値と一致することを確認する

   ```bash
   sha256sum idontlovepdf-engine.js
   cat idontlovepdf-engine.js.sha256
   ```

4. 一致していれば `vendor/idontlovepdf-engine.js` を差し替える（一致しない場合はコミットしない）
5. このファイルの表（version、SHA-256、取得日）を更新する
6. 静的HTTPサーバー経由でツールを開き、`ENGINE_VERSION` の表示が新しいversionになっていることを確認する
7. 通常PDF・日本語PDF・暗号化PDFで、実ブラウザ回帰確認を行う（`README.md` の「動作確認」を参照）

engine Releaseへ自動追従するGitHub Actionsは導入しない。当面は手動更新とする。

## 2. BIZ UDGothic（編集用フォント）

元のPDFに埋め込まれたフォントは、その文書で使った文字だけを含むサブセットであることが多い。そのため「元のPDFに無い文字」へ置き換えようとすると、元のフォントでは書けない。engine v0.4.0 はこの場合に、呼び出し側が渡したフォントで置換後の文字を書く。本ツールがそのフォントとして同梱しているのが BIZ UDGothic である。

| 項目 | 値 |
|---|---|
| フォント名 | BIZ UDGothic Regular |
| version | 1.05 |
| ファイル | `fonts/BIZUDGothic-Regular.ttf` |
| 配布元 | <https://github.com/googlefonts/morisawa-biz-ud-gothic>（tag `v1.05` の `fonts/ttf/BIZUDGothic-Regular.ttf`） |
| license | SIL Open Font License 1.1（`fonts/OFL.txt` に全文を同梱） |
| SHA-256 | `709fcd41e3209fb765da750472f55ccdf925653e9fa7e1eb007cb65c8f749c75` |
| 用途 | 本ツールでPDFを編集するときの fallback font（元PDFのフォントに無い文字を書くため） |
| 取得日 | 2026-09-02 |

- engine v0.4.0 の開発・テストで使われているものと同じフォント・同じversionである。**別のversionや別のフォントへ勝手に置き換えない。**
- 利用者が選ぶ設定ではない。フォント選択UIは設けない。
- 実行時にGoogle FontsやGitHubから取得しない。同一originのローカルファイルとして読み込む。
- 置換の結果、このフォントが実際に使われた場合だけ、保存するPDFへ埋め込まれる（約3MB増える）。元のフォントで書けた場合は埋め込まれない。

### フォントの更新手順

1. 配布元の該当tagから `fonts/ttf/BIZUDGothic-Regular.ttf` を取得する
2. SHA-256が上表と一致することを確認する（versionを上げる場合は、新しい値へ表を更新する）

   ```bash
   sha256sum vendor/fonts/BIZUDGothic-Regular.ttf
   ```

3. 同じtagの `OFL.txt` も一緒に更新する
4. engine側の開発・テストで使われているversionと食い違わないか確認する
5. 実ブラウザで、元PDFのフォントに無い文字への置換を回帰確認する

### 配信時の注意（IIS等）

`.ttf` を配信できないサーバー設定では、編集用フォントを読み込めず、ツールは起動時にエラーを表示する（黙って機能を落とさない）。IISの既定では `.ttf` は配信できるが、MIME typeを絞った構成の場合は `.ttf` → `font/ttf` の設定を確認する。
