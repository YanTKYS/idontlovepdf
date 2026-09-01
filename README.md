# idontlovepdf

自治体内で一般職員が利用することを想定した「PDF編集ツール」。

PDFの処理は、同一開発者による別リポジトリ `YanTKYS/idontlovepdf-engine` が担当する。

| リポジトリ | 責務 |
|---|---|
| `idontlovepdf`（本リポジトリ） | 一般職員向けPDF編集ツールのUI / UX |
| `idontlovepdf-engine` | PDF解析・暗号化認証／復号・本文抽出・検索・置換・保存 |

## 現在の段階

**エンジン統合PoC段階（実装済み・実機確認待ち）。**

`idontlovepdf-engine` v0.2.0 の正式Release bundleを同梱し、次を行う最小構成を実装した段階である。

- PDFの選択
- エンジンの読み込み
- PDF本文テキストの認識

engine単体の検証と、`idontlovepdf` へbundleした状態の検証は分けて扱う。

| 検証対象 | 状況 |
|---|---|
| engine単体（`idontlovepdf-engine`） | 実PDFで検証済み |
| bundle統合状態（本リポジトリ） | **未確認**（実装のみ） |

統合状態での実機確認は「動作確認」の項に従って行い、完了した時点でこの節と `docs/feasibility.md` を更新する。

本文の検索・置換・保存を一般職員向けUIとして提供するのは、その後の段階とする。

## 判定

技術的実現性と運用可否は分けて扱う。

| 区分 | 判定 | 根拠 |
|---|---|---|
| 技術的実現性 | **あり** | 自作browser engineによる実PDF検証で、本文抽出・日本語ToUnicode・暗号化PDF・検索・一部PDFでの置換／保存まで確認済み |
| 運用可否 | **未判定** | 複数の実PDFで動作したことと、一般職員が安定運用できることは別である |

検討の経緯と根拠は `docs/feasibility.md` に記録している。

## できること / できないこと

現時点でできること。

- PDFファイルを選択する（ボタン、またはドラッグ＆ドロップ）
- ブラウザ内でPDFを読み込む
- 本文テキストを認識し、認識件数を表示する
- パスワード保護されたPDFで、パスワードを入力して開く
- エラーの内容を区分して表示する（パスワード、非対応形式、破損 等）

現時点でできないこと。

- 本文の検索
- 本文の置換
- 編集したPDFの保存
- ページ回転・ページ挿入・ページ削除
- スキャンPDFのOCR

## 構成

```text
index.html                     ツール本体（PoC画面）
css/style.css                  画面のスタイル
js/app.js                      画面とエンジンの接続
vendor/idontlovepdf-engine.js  idontlovepdf-engine v0.2.0 の正式Release bundle
vendor/README.md               取り込んだengine versionと更新手順
docs/feasibility.md            実現可能性の検討記録
reference/guide_context.md     開発ガイド `lg_toolkit_guide` の最小ガイド（参照用）
.nojekyll                      GitHub PagesでJekyll処理を無効化する（後述）
```

npm、Node.js、esbuild、webpack、Vite、Parcel等のビルド環境は本リポジトリへ導入していない。

`idontlovepdf-engine` 側で生成済みのブラウザ向け1ファイルbundleを、そのままES Moduleとして読み込む。最終構成は静的ファイルのみである。

## 外部依存・通信

- 実行時に外部通信は発生しない。
- 外部CDN、外部フォント、外部API、ライセンスサーバー、analyticsのいずれも利用しない。
- エンジンbundleはリポジトリへ同梱している。実行時にGitHub Releaseから取得する方式は採らない。
- 選択したPDFはブラウザ内だけで処理する。サーバーへアップロードしない。

## 個人情報・機密情報の取り扱い

- PDFの内容を送信・保存しない。
- 入力したパスワードは処理中のメモリ内だけで扱う。localStorage、sessionStorage、IndexedDB、cookieのいずれにも保存しない。
- パスワードや暗号鍵を画面へ表示せず、ログにも出力しない。

## 利用環境

静的HTTPサーバーからの配信を前提とする。

- GitHub Pages
- IIS等の庁内静的Webサーバー（閉域運用を含む）

配置は、リポジトリの内容をそのまま公開ディレクトリへ置くだけでよい。サーバー側の設定要件は次の1点である。

- `.js` をJavaScriptのMIME type（`text/javascript` 等）で配信すること（IISの既定設定で満たされる）

GitHub Pagesでは既定でJekyllが動作し、`vendor/` ディレクトリが公開対象から除外される。これを避けるため、リポジトリ直下に `.nojekyll` を置いている。**削除しないこと。**

### `file://` での直接起動について

`index.html` を `file://` で直接開く方式は、正式な運用形態としない。

ES Moduleはブラウザのセキュリティ制約により `file://` から読み込めないためである。この場合は画面上に案内を表示する。

## 使い方

1. 静的HTTPサーバー経由で `index.html` を開く
2. 「PDFを選択」からPDFを選ぶ（ドラッグ＆ドロップも可）
3. 状態表示が「成功」になり、認識した本文の件数が表示される

パスワード保護されたPDFでは、まず空パスワードでの読み込みが自動的に試される。それで開けない場合のみパスワード入力欄が表示される。

## 動作確認

**未実施。** 下記を実ブラウザ（GitHub Pages、または静的HTTPサーバー経由）で確認し、結果をこのチェックリストへ反映する。

- [ ] `vendor/idontlovepdf-engine.js` がES Moduleとして読み込める（起動時の案内が表示されない）
- [ ] 「Engine」欄に、同梱したengine versionが表示される
- [ ] 通常PDFを選択し、状態が「成功」になり、本文の認識件数が表示される
- [ ] 日本語本文を含むPDFで本文を認識できる
- [ ] R4 / AESV2 の暗号化PDFを扱える
- [ ] R6 / AESV3 の暗号化PDFを扱える
- [ ] パスワード保護されたPDFで、パスワード入力欄が表示され、入力後に読み込める
- [ ] PDF以外のファイルを選んでも、画面がフリーズせずエラー表示になる
- [ ] 開発者ツールのネットワークタブに、外部への通信が記録されない
- [ ] IIS等の庁内静的Webサーバーへ配置して同様に動作する

チェックが埋まるまでは、READMEおよび `docs/feasibility.md` で「実機確認済み」と記載しない。

## エンジンの更新

`vendor/README.md` の「engineの更新手順」を参照する。要点は次のとおり。

1. `idontlovepdf-engine` で新versionをRelease
2. Release asset `idontlovepdf-engine.js` を取得
3. `.sha256` と照合
4. `vendor/idontlovepdf-engine.js` を差し替え
5. `ENGINE_VERSION` の表示を確認
6. `idontlovepdf` 側で実ブラウザ回帰確認

engine versionは `vendor/README.md` で管理する。JavaScriptコードへ版数を書き写さない。実行時のversion表示にはbundleがexportする `ENGINE_VERSION` を使う。

## 既知の制約

- bundle統合状態での実機確認が未実施（「動作確認」を参照）。
- 本文の検索・置換・保存のUIは未提供（次の段階）。
- 暗号化PDFの再保存はengine側で未対応。
- engine v0.2.0 の公開APIでは `/P` permission（読み取り可否・変更可否）を取得できないため、画面に表示していない。必要になった場合はengine側の公開API拡張として扱う。
- スキャンPDF（画像のみのPDF）は本文テキストを持たないため対象外。

## バージョン

| 区分 | 値 |
|---|---|
| 本ツール | v0.1.0（試作版・エンジン統合PoC実装済み／実機確認待ち） |
| 同梱engine | idontlovepdf-engine v0.2.0 |

## ドキュメント

| ファイル | 役割 |
|---|---|
| `docs/feasibility.md` | 実現可能性の検討経緯と技術判断の記録 |
| `vendor/README.md` | 同梱engineのversion管理と更新手順 |
| `reference/guide_context.md` | 開発ガイド `lg_toolkit_guide` の最小ガイド（参照用） |

過去の判断経緯は `docs/feasibility.md` に委ねる。本READMEは現在仕様を示すものとし、履歴を積み上げない。
