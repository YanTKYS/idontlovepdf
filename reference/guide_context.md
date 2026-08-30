# guide_context.md（最小ガイド文書）

この文書は、Vibe-coding実行環境でGitHub URLを直接参照できない場合に、対象リポジトリへ同梱して使う最小ガイドです。

想定配置先:

- `reference/guide_context.md`

raw URL（直接参照）:

- `https://raw.githubusercontent.com/YanTKYS/lg_toolkit_guide/main/exports/guide_context.md`

補足:

- GitHub Pagesが読めない場合の代替参照経路として、raw URL を利用できる環境があります。
- Pagesとrawの両方が読めない場合は、同梱方式を採用してください。


MCP Fetch（補助手段）:

- MCP Fetchを使ってPages/raw URLを取得できる環境があります。
- ただし、必ず成功するわけではありません（MCP利用可否・ネットワーク経路・設定依存）。
- MCP Fetchは補助手段であり、最も確実なのは同梱方式です。


---

## 1. lg_toolkit_guide の目的

- 閉域または庁内ネットワークで使う小規模内部ツール開発を、方針・テンプレート・チェックリストで安定化する。
- 実装前に設計・README・テスト・運用引継ぎ文書を揃える。
- 外部依存や個人情報取扱いのリスクを抑え、安全に継続開発する。

## 2. このガイドの使い方

1. Vibe-coding開始時に、このファイルをAIへ提示する。
2. 次に、対象タスクに必要な詳細（設計、チェック、手順書）を追加で提示する。
3. ガイド未参照状態では、実装を開始しない。
4. このファイルのみで進める場合は、本書の「標準ディレクトリ構成」と「標準成果物ファイル名」を優先する。
5. この文書は最小ガイドであり、必要に応じて追加ガイドを同梱して補完する。

## 3. 閉域自治体向け内部ツールの基本方針

- 外部通信を前提にしない。
- 外部API / 外部CDN / クラウド依存を避ける。
- 追加インストールや管理者権限を当然の前提にしない。
- 基幹システムや最終業務判断を代替しない。

## 4. AIコーディングルールの要点

- `guides/00_policy.md` と `guides/01_ai_coding_rules.md` を最優先する。
- 個人情報を保存・送信・ログ出力しない。
- 元ファイル上書きや削除など破壊的処理を避ける。
- 小さく安全な変更を優先し、不要な大規模改修を避ける。

## 5. 設計時に確認する項目

- ツール名、目的、対象利用者
- 入力、処理、出力
- 保存するデータ / 保存しないデータ
- 利用環境（閉域、Windows、配布方式）
- できること / できないこと
- エラー時挙動、再実行時挙動

## 6. セキュリティ・個人情報の要点

- 個人情報は原則保存しない。
- 外部送信しない。
- ログに個人情報を残さない。
- 一時ファイルの保存場所と削除手順を明確にする。
- 出力ファイルは利用者が内容確認し、運用ルールに沿って管理する。

## 7. UI/UXの要点

- 職員が短時間で使えることを優先する。
- 入力欄・実行ボタン・結果表示欄を分ける。
- エラー時は原因と対処を短文で示す。
- 成功時は完了と次操作を示す。
- 専門用語を避ける。
- 小規模Webツールでは、ツール名 / 概要 / 注意事項 / 入力 / 実行 / 結果 / 補助操作（コピー等） / エラー表示の標準構成を意識する。
- コピー機能などの補助機能は、成功・失敗表示を用意する。

## 8. READMEに書くべき項目

- ツール名、概要、目的、対象利用者
- 利用環境
- できること / できないこと
- 使い方、入力データ、出力データ
- 個人情報の取扱い
- 注意事項
- 動作確認方法
- バージョン、更新履歴、既知の制約、保守範囲

## 9. リリース前チェックの要点

- 閉域で動作するか。
- 外部依存がないか。
- 個人情報・破壊的処理の安全策があるか。
- README、チェックリスト、注意事項が揃っているか。
- 試作版 / 検証版 / 本番相当版の区分を明記したか。
- バージョン区分（例: `v0.x.x` / `v0.9.x` / `v1.0.0` / `v1.x.x` / `deprecated`）をREADMEまたは開発報告書に記載したか。

## 10. テストシナリオの要点

- 正常系、異常系、境界値、再実行系を確認する。
- ファイル入出力、個人情報、外部通信、UI/UXも確認する。
- テスト結果は表形式で残し、未確認事項を明記する。

## 11. 運用引継ぎの要点

- 通常運用手順、定期作業、更新作業を明記する。
- 障害時の確認事項と連絡先を明記する。
- 保守範囲（DX担当 / 利用部署 / 所管部署判断 / 対象外）を分ける。
- C# WinForms等の非Webツールでは、運用引継ぎ文書に配置場所、実行方法、利用端末の前提、障害時の一次確認、保守範囲を記載する。
- 詳細は `guides/09_operation_handover_template.md` と `guides/12_office_interop_checklist.md` を参照する。

## 12. 手順書の役割分担

- 管理者向け手順書: 配置、更新、ロールバック、障害対応、権限管理を示す。
- 運用担当部署向け手順書: 一次対応、業務判断、DX担当への相談境界を示す。
- 利用者向け手順書: 日常操作、エラー時の基本対応、注意事項を短く示す。
- 手順書は原則として次の3種類を分けて作成し、省略しない。
  - `manuals/admin_manual.md`
  - `manuals/operator_manual.md`（省略禁止）
  - `manuals/user_manual.md`

## 13. 作成先ツールリポジトリの標準ディレクトリ構成

次を標準構成とする。

```text
README.md
development_report.md

docs/
  tool_design.md
  release_checklist.md
  test_scenarios.md
  operation_handover.md

manuals/
  admin_manual.md
  operator_manual.md
  user_manual.md

src/
  （実装方式に応じたファイルを配置）

reference/
  guide_context.md
```

補足:

- `lg_toolkit_guide` 本体では中核ガイド文書は `guides/` に置く。
- 実ツール側では、設計・チェック・引継ぎ文書置き場として `docs/` を使用してよい。
- `reference/guide_context.md` は同梱方式で実施する場合のみ必須。Pages/rawなど外部参照方式では必須ではない。

## 14. 標準成果物ファイル名

実ツール作成時は、原則として次のファイル名を使用する。

```text
README.md
development_report.md
docs/tool_design.md
docs/release_checklist.md
docs/test_scenarios.md
docs/operation_handover.md
manuals/admin_manual.md
manuals/operator_manual.md
manuals/user_manual.md
src/（実装方式に応じた実装ファイル）
```

- `docs/design.md`、`docs/checklist.md`、`docs/test.md` のような短縮名は原則使わない。
- 開発報告書は原則として、ルート直下の `development_report.md` に作成する。
- 同一リポジトリ内に複数の `development_report.md` を作成しない。
- 文書成果物は上記を標準とし、実装ファイルは実装方式に応じて `src/` 配下へ配置する。

実装方式別の `src/` 構成例:

```text
静的Webツール:
  src/
    index.html
    script.js
    style.css

PowerShellツール:
  src/
    main.ps1

C# WinFormsツール:
  src/
    <ProjectName>/
      <ProjectName>.csproj
      Program.cs
      MainForm.cs
      （必要に応じてその他クラス）
```

詳細は `guides/11_non_web_tool_patterns.md` を参照する。
- 非Web系では `11_non_web_tool_patterns.md` を追加同梱することを検討する。
- Office Interop系では `12_office_interop_checklist.md` を追加同梱することを検討する。
- 配布zip、GitHub Actions通常ビルド、リリースビルド、GitHub Releaseが必要なツールでは `14_github_actions_build_release.md` を追加同梱・参照することを検討する。
- GitHub Actions / Release方針の詳細は `guides/14_github_actions_build_release.md` を参照する。

## 15. Markdown品質条件（作成先成果物にも適用）

- 見出し、本文、箇条書き、表、チェックボックスを適切に改行する。
- 1つの文書全体を1行または数行に圧縮しない。
- raw表示でも読みやすいMarkdownにする。
- 表はMarkdown表で整形し、チェックは `- [ ]` を使う。
- 作成後に、raw表示相当で読みやすいか自己点検する。
- この品質条件は、`lg_toolkit_guide` 本体だけでなく作成先ツールの成果物にも適用する。
  - `README.md`
  - `docs/*.md`
  - `manuals/*.md`
  - `reference/guide_context.md`
  - `development_report.md` などの報告書

Markdown整形の実確認ルール:

- 「raw表示でも読みやすい」と自己申告するだけでなく、実ファイルを開いて確認する。
- 見出し、本文、箇条書き、表、チェックボックスが適切に改行されていることを確認する。
- `README.md`、`docs/*.md`、`manuals/*.md`、`development_report.md` が数行だけに圧縮されていないことを確認する。
- Markdown文書が3〜5行程度しかない場合は、原則として整形不備を疑い、再整形する。
- 箇条書き、チェックリスト、表は1項目または1行ごとに改行する。

## 16. HTML / CSS / JavaScript の整形条件

- `src/index.html`、`src/script.js`、`src/style.css` は、保守しやすいように適切な改行とインデントで記述する。
- `src/script.js` や `src/style.css` を1行に圧縮しない。
- 作成後に、raw表示相当で可読性を自己点検する。
- `.cs` ファイルはクラス、メソッド、条件分岐ごとに改行・インデントし、1行化しない。
- `.csproj` は通常のXML構造として作成し、1行の要約文にしない。
- 可能であれば `dotnet build` 相当でビルド確認する。未確認の場合は理由と未確認事項を報告する。
- Office Interopを使う場合は、Office依存、プロセス残存対策、上書き確認、ログ保存禁止をREADMEや手順書に明記する。
- Office Interop系ツールでは、Office導入確認、ライセンス、ビット数、COM例外、プロセス残留などの実機確認が必要。
- Office Interop系ツールの詳細チェックは `guides/12_office_interop_checklist.md` を利用する。
- Office Interop系ツールでは、実機未確認項目を「確認済み」と扱わない。
- 未確認項目は、未確認理由・想定リスク・次アクションとともに記録する。
- 32bit / 64bit差異は重要確認項目として扱い、未確認構成は未確認として明示する。
- `development_report.md` には、実際に作成・更新したファイルのみを記載する。
- 作業報告前に、git差分または同等の方法で記録内容を確認する。
- 実際には変更していないファイルを「更新したファイル」として記載しない。

コード整形の実確認ルール:

- HTML / CSS / JavaScript も、作成後に実ファイルを開いて確認する。
- `src/index.html`、`src/script.js`、`src/style.css` が1行または数行に圧縮されていないことを確認する。
- 関数、条件分岐、イベント処理、CSSルールごとに適切に改行・インデントする。
- JavaScript / CSS / HTML が3〜5行程度しかない場合は、原則として整形不備を疑い、再整形する。

確認コマンド例（可能な場合）:

```bash
wc -l README.md docs/*.md manuals/*.md development_report.md
wc -l src/*.html src/*.css src/*.js
```

- `wc` が使えない環境では、同等の確認（raw表示相当での目視確認）でよい。

## 17. 新規ツール開発時の標準的な流れ

1. `guides/00` と `guides/01` を前提化する。
2. 設計書、README、チェックリスト、テスト、運用引継ぎ文書を先に作る。
3. 関係者承認後に実装へ進む。
4. 実装後はリリース前チェックとテスト結果を更新する。

## 18. guide_context単体参照時の注意

- `reference/guide_context.md` のみを参照する比較テストでは、外部URLや追加参照先を見に行かない。
- 本書に記載の標準構成と標準成果物名を維持し、成果物を省略しない。
- 特に `manuals/operator_manual.md` は省略しない。
- 判断材料が不足している場合は、推測で省略せず「判断しづらかった点」として報告する。
- Office Interopを使う場合は、上記の実機確認観点を省略しない。
- 追加ガイドが同梱されていない場合は、詳細事項を推測しすぎず「判断しづらかった点」として報告する。

## 19. 重要（推測実装の禁止）

ガイド本文を読めない場合は、推測で実装を進めない。  
必ず `guide_context.md` の提示または同梱を求めること。

## 20. 作業後に報告すべきこと

- 作成したファイル
- 更新したファイル
- 方針適合の確認結果
- 整形確認結果
- 判断しづらかった点
- 未対応事項と対応予定
- 今回あえて作成しなかったもの
