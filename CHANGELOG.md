# Changelog

本專案的重要變更會記錄於此檔案。

## Unreleased

目前沒有尚未歸入版本的變更。

## 1.2.5 - 2026-08-09

### Changed

- 將七個常駐於編輯器右上角的格式按鈕改為 `Show Formatting Palette` 浮動選單，使用 VS Code Quick Pick 顯示粗體、斜體、注目、等寬、刪除線、上標與下標；原有選取文字右鍵操作仍保留。
- Preview 新增不受文件 `body` stylesheet 覆寫的外層 viewport padding，避免 `body { padding: 0 }` 讓文件內容貼齊面板邊緣。

## 1.2.4 - 2026-08-08

### Fixed

- 修正 Windows `D:\...` stylesheet 絕對路徑被誤判為 `D:` URI scheme，導致已存在且位於工作區內的 CSS 顯示 `Preview stylesheet skipped`。
- 新增 Windows drive path 回歸測試，確認 `:stylesheet: ../stylesheets/colony.css` 可通過副檔名、工作區與路徑邊界檢查。
- 移除 Preview Webview 工具列；格式、預覽版面、重新整理、語法說明與匯出操作統一放在來源編輯器標題列，格式按鈕在 AsciiDoc／Markdown 編輯器中持續顯示。

## 1.2.3 - 2026-08-08

### Fixed

- 修正 Open Preview 不會套用文件 `:stylesheet:`／`:stylesdir:` 的問題；已儲存文件的本機 CSS 不再因 Workspace Trust 被直接略過，仍會限制於文件／工作區範圍與 Webview 安全資源政策。
- 保留未受信任 workspace 對 include、圖片、連結與遠端圖片的限制，並在 Output Channel 記錄 stylesheet 實際載入或失敗狀態，方便診斷 VS Code Webview 資源問題。

## 1.2.2 - 2026-08-08

### Fixed

- 強化 VS Code 1.97+ Webview stylesheet URI 驗證，兼容 `file%2B.vscode-resource.vscode-cdn.net` 這類百分比編碼 authority，避免安全驗證誤略過文件的 `:stylesheet:`。
- 格式化命令固定放在來源編輯器標題列與右鍵選單；Preview Webview 僅保留預覽操作，避免在不可編輯的預覽區選取文字後失去來源選取範圍。

## 1.2.1 - 2026-08-08

### Fixed

- 格式化操作移至來源編輯器標題列與右鍵選單；只有在 AsciiDoc／Markdown 選取文字時顯示，拖選後可直接套用粗體、斜體、注目、等寬、刪除線、上標與下標。
- 預覽面板工具列不再承擔來源文件格式化，避免在 Preview Webview 與來源編輯器之間切換焦點而失去選取範圍。
- 預覽 Webview 的 `toolbarAction` 白名單只保留預覽、版面、語法說明與匯出動作。
- 修正 VS Code 1.97+ 使用 HTTPS Webview resource URI 時，本機 `:stylesheet:` 不會載入的問題。

## 1.2.0 - 2026-08-08

### Added

- 預覽面板新增 IDEA 類文件工具列，可直接執行文字格式化、預覽版面切換、重新整理、AsciiDoc 語法說明與 HTML／PDF 匯出。
- 工具列操作會綁定目前預覽來源文件，即使 Preview Only 模式沒有文字編輯器焦點，也能正確修改與匯出來源文件。
- AsciiDoc `include::` 預覽改由受 workspace root 與 realpath 保護的 IncludeProcessor 處理，支援巢狀 include、`lines`、`tag`／`tags`，並拒絕循環與越界路徑。
- Link Checker 支援 AsciiDoc `link:` macro，並對引用目標保留精確 Problems Range。
- VSIX 封裝清單納入 PNG 與 ICO 圖示；`npm run check` 會驗證暫時 Marketplace README 與封裝內容。

## 1.1.0 - 2026-08-08

### Added

- 新增編輯器標題列快速格式工具：粗體、斜體、注目、等寬、刪除線、上標與下標，支援 AsciiDoc／Markdown 對應語法。
- 新增「僅文字、文字／預覽分割、僅預覽」版面切換命令。
- 新增 `Export PDF` 命令，透過本機 `asciidoctor-pdf` 產生 PDF，支援 `{source}`、`{destination}`、`{workspace}` 參數佔位符與自訂 diagram／theme 參數。
- 修正 AsciiDoc Open Preview 套用文件層級 `:stylesheet:` 與 `:stylesdir:` 的問題。

### Compatibility

- PDF 匯出需要使用者自行安裝 `asciidoctor-pdf`；VSIX 不會攜帶 Ruby、PDF converter、字型或 diagram extension。

## 1.0.1 - 2026-08-08

### Fixed

- 修正 AsciiDoc Open Preview 忽略文件層級 `:stylesheet:` 與 `:stylesdir:` 的問題。
- 受信任 workspace 會依來源文件位置載入允許範圍內的本機 CSS；未受信任、未儲存、缺少或 workspace 外的 stylesheet 會安全略過。
- 新增完整書籍手冊標頭與 Webview stylesheet 生命週期的回歸測試。

## 1.0.0 - 2026-08-08

### Release

- 完成第一版 AsciiDoc／Markdown 文件工作台：即時預覽、語法輔助、圖片工作流、Outline、Link Checker 與 HTML 匯出。
- 完成單元測試、Extension Host 整合測試、TypeScript 型別檢查、ESLint、Build、`npm audit`、VSIX 清單與隔離安裝驗證。
- VSIX 僅包含 production bundle、必要文件、圖示與第三方授權資訊，不包含原始碼、測試、coverage 或 `node_modules`。

### Compatibility

- 最低 VS Code 版本為 `1.97.0`，以支援 `DocumentPasteEditProvider`。
- Marketplace 實際上架仍需 Publisher 憑證與上架操作；本版本的 VSIX 已完成自動化發行前檢查。

## 0.5.0 - 2026-08-08

### Added

- 新增 `adocmdForge.exportHtml`、`adocmdForge.exportStandaloneHtml` 與 `adocmdForge.exportEmbeddedHtml` 指令。
- AsciiDoc 與 Markdown 共用 renderer 與 sanitizer 產生 HTML5、Standalone HTML 與可嵌入 HTML fragment。
- Standalone HTML 會將工作區內可讀取的本機圖片轉成 base64 data URI；一般 HTML 保留可攜的相對資源路徑。
- 新增匯出路徑政策、來源文件保護、既有檔案覆寫確認與取消無副作用測試。

### Security and compatibility

- 匯出只允許受信任 workspace，目的地不可離開 workspace 或覆蓋來源文件；不執行遠端網路讀取。
- 未能安全解析或讀取的圖片不會被嵌入 Standalone HTML，避免任意本機／網路讀取。

### Changed

- 版本更新為 `0.5.0`。

### Not included

- Marketplace 正式發行與完整 1.0.0 發行前人工驗證尚未完成。

## 0.4.0 - 2026-08-08

### Added

- 新增 Link Checker 核心服務與 AsciiDoc／Markdown 引用 parser。
- 檢查 AsciiDoc `xref:`、`<<...>>`、`include::`、`image::`、explicit anchor 與自動標題 anchor。
- 檢查 Markdown inline link、image、heading anchor 與 `{#anchor}`。
- 新增 `adocmdForge.validateLinks` 指令與 `adocmd-forge` DiagnosticCollection，Problems Panel 會顯示精確 Range、code、severity 與來源。
- 新增 `adocmdForge.diagnostics.updateDelay` 設定與取消、debounce、dispose 測試。

### Security and compatibility

- 本機引用限制於受信任 workspace root，拒絕 path traversal、workspace 外路徑與非檔案目標。
- 未受信任 workspace、untitled 文件與未解析的 AsciiDoc 動態屬性不讀取本機檔案。
- `http(s)`、mailto 與其他外部 URI 不執行網路探測，避免 Link Checker 產生非預期網路請求。

### Changed

- 版本更新為 `0.4.0`。
- `DocumentAnalysis.references` 改由共用 reference parser 提供，供 Outline 與 Diagnostics 使用。

### Not included

- HTML、Standalone HTML 與 Embedded HTML 匯出仍未完成。

## 0.3.0 - 2026-08-08

### Added

- 新增 Explorer `Outline` View，顯示目前 AsciiDoc／Markdown 文件的標題階層。
- 新增 AsciiDoc AST 與 Markdown markdown-it token 的共用 `DocumentAnalysis`、`Heading` 與 `OutlineNode` 模型。
- 支援 AsciiDoc 文件標題、章節、Markdown ATX／Setext 標題、標題來源 Range 與穩定節點 ID。
- 支援點擊 Outline 節點跳至標題來源位置與 `Refresh Outline` 命令。
- 新增 `adocmdForge.outline.updateDelay` 設定，並以 debounce 更新目前文件的 Outline。
- 新增 Outline parser、TreeDataProvider 與 Extension Host 整合測試。

### Changed

- 版本更新為 `0.3.0`。
- Outline 只維護目前 active editor；切換文件或關閉文件時會清除過期節點。

### Not included

- Link Checker、Problems Diagnostic 與 HTML 匯出仍未完成。

## 0.2.0 - 2026-08-08

### Added

- 新增 AsciiDoc／Markdown 圖片拖曳與圖片貼上工作流。
- 新增 `Copy Image` 指令，可選擇本機圖片並插入文件語法。
- 新增 `ImageService`、`ImagePathPolicy` 與 `ImageSyntaxBuilder` 共用圖片處理核心。
- 新增圖片目錄、是否詢問儲存路徑與預設替代文字設定。
- 支援 PNG、JPG／JPEG、GIF、WebP 與 SVG。

### Security

- 圖片目的地限制於目前文件所在的工作區資料夾。
- 拒絕未受信任工作區、未儲存文件、路徑穿越、不支援格式與同名覆蓋。

### Compatibility

- 最低 VS Code 版本提高至 1.97，以使用 `DocumentPasteEditProvider`。
- 若平台未提供二進位剪貼簿 DataTransfer，請使用拖曳或 `Copy Image`。

### Not included

- Outline Tree View、Link Checker、Problems Diagnostic 與 HTML 匯出仍未完成。

## 0.1.0 - 2026-08-08

### Added

- 新增 AsciiDoc 語法目錄與繁體中文說明。
- 新增 AsciiDoc CompletionItemProvider，支援標題、段落、文字樣式、清單、Checklist、Source Block、Admonition、表格、link、xref、anchor、image、include、attribute 與 TOC。
- 新增 AsciiDoc HoverProvider，顯示語法用途、範例與穩定來源範圍。
- 新增 `AdocMD Forge: Open AsciiDoc Syntax Guide` 命令。
- 新增語法補全、Hover、語法說明與 Extension Host 整合測試。

### Changed

- 語法 provider 僅註冊於 AsciiDoc 文件，不影響 Markdown 編輯體驗。
- 版本與 VSIX 更新為 `0.1.0`。

## 0.0.2 - 2026-08-08

### Added

- 新增 AsciiDoc 標題、清單、表格、xref、圖片、attribute 與 source block 的預覽回歸測試。
- 新增不完整或無法取得 AST source location 時的安全預覽回歸測試。

### Fixed

- 修正 Asciidoctor AST 或 logger source location 缺少 `getLineNumber`、`getFile` 或 getter 拋出例外時，預覽會中斷的問題。
- 修正單一 AST 節點 metadata 失效時整份文件無法產生預覽的問題。

## 0.0.1 - 2026-07-30

### Added

- 新增 `.adoc`、`.asciidoc` 與 `.md` Webview 即時預覽。
- 新增來源編輯器與預覽畫面雙向同步捲動。
- 新增 VS Code 深色、淺色與高對比佈景主題支援。
- 新增受信任工作區、本機資源、遠端圖片與連結安全限制。
- 新增 AsciiDoc 安全 include 處理。
- 新增單元測試與 VS Code Extension Host 整合測試。
- 新增 AsciiDoc 與 Marketplace Markdown README。

### Fixed

- 修正 Asciidoctor 訊息或 AST 區塊缺少來源位置時，預覽會因讀取 `getLineNumber` 而失敗的問題。
