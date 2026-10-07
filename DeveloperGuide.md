# AdocMD Forge Developer Guide

## 1. 開發環境

建議環境：

- Node.js 24
- npm 12
- VS Code 1.97.0 以上
- Git 2.45 以上

Extension 的執行期仍以 VS Code 1.97 所附 Node 20 相容範圍為準。不得因開發機使用 Node 24，就在 Extension Host bundle 中使用只存在於 Node 24 的 API。

## 2. 安裝

```powershell
npm install
```

正式驗證與 CI 使用 lockfile：

```powershell
npm ci
```

npm 12 可能封鎖具有 install script 的相依套件。不得直接全面允許；應先以 `npm install-scripts ls` 確認套件、腳本與實際用途。esbuild 若已由平台 optional package 正常提供二進位檔，不需要額外允許 postinstall。

## 3. 常用指令

| 指令 | 用途 |
| --- | --- |
| `npm run typecheck` | TypeScript 嚴格型別檢查 |
| `npm run lint` | ESLint typed lint |
| `npm run test:unit` | 執行純 Node 單元測試 |
| `npm run test:unit:coverage` | 產生單元測試 coverage |
| `npm run build` | 產生 production Extension Host bundle |
| `npm run watch` | 持續重建開發 bundle |
| `npm run test:integration` | 啟動隔離的 VS Code 1.97.2 Extension Host |
| `npm run check` | typecheck、lint、unit test、build、VSIX 封裝清單檢查 |
| `npm run verify` | 完整 check 與 Extension Host 整合測試 |
| `npm run package:list` | 列出 VSIX 封裝內容 |
| `npm run package:vsix` | 執行品質檢查並建立 VSIX |

## 4. F5 偵錯

1. 在 VS Code 開啟 repository 根目錄。
2. 執行 `npm install`。
3. 從 Run and Debug 選擇 **Run AdocMD Forge**。
4. 按 F5。
5. 設定會先執行 `npm: build`，再啟動 Extension Development Host。

Extension 執行期紀錄寫入 **Output > AdocMD Forge**，正式程式不得以 `console.log` 代替 OutputChannel。

## 5. 架構規則

完整決策見 [Architecture.md](./Architecture.md)。

開發時遵守：

1. `src/extension.ts` 只建立物件、注入依賴與註冊 Disposable。
2. Parser、Renderer、Resolver、HTML Builder 不得匯入 `vscode`。
3. VS Code Provider 保持輕薄，只轉換 VS Code 型別與呼叫應用服務。
4. 不為單一簡單功能建立多層無作用抽象；介面必須有測試替身、邊界隔離或多實作的實際需求。
5. 新增非同步工作時，必須定義取消、過期結果與錯誤傳遞方式。
6. 新增 Event、Timer、Panel 或 Collection 時，必須同時定義 dispose 路徑。
7. URI 與檔案操作使用 `vscode.Uri`、`Uri.joinPath()` 與 `workspace.fs`。

## 6. 功能開發流程

每項功能依下列順序處理：

1. 確認需求、錯誤案例與安全邊界。
2. 先建立核心型別與可測試邏輯。
3. 新增單元測試。
4. 實作 VS Code adapter 或 provider。
5. 新增 Extension Host 整合測試。
6. 執行 `npm run check`。
7. Review 命名、重複邏輯、錯誤處理、Disposable 與競態。
8. 重構後再次執行 `npm run check` 與 `npm run test:integration`。
9. 更新 README、CHANGELOG、Architecture 或設定說明。

Bug 修正必須先加入能重現問題的 regression test，並確認測試在修正前會失敗。

## 7. AsciiDoc 語法輔助

語法輔助的公開範圍固定在 `asciidoc` 語言。`.adoc` 與 `.asciidoc` 由 VS Code language contribution 統一識別，provider 另外限制 `file` 與 `untitled` scheme；Markdown 不會註冊相同 provider。

新增語法時，先更新 `src/language/asciidocSyntax.ts` 的目錄，再由補全、Hover 與語法說明共用該資料。補全必須新增對應的游標前綴測試，Hover 必須測試 Range 與非語法文字，避免在一般段落顯示大量無關項目。

`syntaxes/asciidoc.tmLanguage.json` 是 VS Code 原生語法醒目提示來源，`snippets/asciidoc.json` 是編輯器 Snippet 來源。兩者都會直接封裝進 VSIX，新增或改名時必須同步更新 manifest、`scripts/package-list.mjs` 與 manifest／資產測試。TextMate grammar 中 raw 或 literal block 的規則必須早於一般行內規則。

`AsciiDocDocumentProvider` 由 `documentStructure.ts` 的純資料結果建立 Document Symbol 與 Folding Range。符號層級、Range 與選取 Range 必須同時以單元測試及 `vscode.executeDocumentSymbolProvider`／`vscode.executeFoldingRangeProvider` 整合測試驗證。

`AdocMD Forge: Open AsciiDoc Syntax Guide` 會開啟可編輯的 untitled AsciiDoc 說明文件；它不寫入工作區，也不需要檔案權限。

AsciiDoc 預覽在受信任且已儲存的文件中使用 renderer worker 內的單次 IncludeProcessor registry。來源文件目錄與 Extension Host 傳入的 workspace roots 會先經 `realpath` 邊界檢查，再由 `SecureIncludeResolver` 解析相對 `include::`；未受信任 workspace、絕對／外部 URI、workspace 外路徑、symbolic link 逸出、循環與超過深度的 include 都不會讀取。`lines`、`tag` 與 `tags` 由 `selectIncludeContent` 套用，問題會寫入 renderer message 與 Output Channel。每次 render 都建立獨立 registry，不共享其他文件的 include 狀態。

## 8. 圖片工作流

圖片功能使用 VS Code 1.97 以上的 `DocumentPasteEditProvider` 與 `DocumentDropEditProvider`。兩個 Provider 都將 `DataTransfer` 轉換成共用的圖片來源，再交給 `ImageService` 處理；`Copy Image` 指令也使用相同服務。

`ImagePathPolicy` 負責 MIME／副檔名白名單、檔名清理、工作區根目錄與重名檔案規則；`ImageSyntaxBuilder` 負責 POSIX 相對路徑與 AsciiDoc／Markdown 語法。Provider 在檔案建立編輯中先建立圖片，再由 VS Code 同一個 WorkspaceEdit 插入語法；任何準備階段錯誤都不會回傳文字編輯。

目前支援 PNG、JPG／JPEG、GIF、WebP 與 SVG。未儲存文件、未受信任工作區、工作區外目的地、路徑穿越與取消操作都會被拒絕。VS Code API 無法保證每個平台都將系統剪貼簿二進位圖片放入 DataTransfer；若貼上沒有圖片 DataTransfer，請使用拖曳或 `Copy Image`。

## 9. 單元測試

單元測試放在 `test/unit/`，檔名使用 `*.test.ts`。測試對象應是沒有 VS Code runtime 依賴的模組。

測試至少涵蓋：

- 正常輸入
- 空輸入
- 邊界值
- 無效語法
- 路徑穿越
- 取消與過期 revision
- 失敗時不留下部分狀態

Mock 只用於明確的外部邊界。不要 mock 被測模組內部實作細節。

## 10. Outline 與文件分析

`src/models/documentAnalysis.ts` 定義 Renderer、Outline 與後續 Link Checker 共用的 `DocumentAnalysis`、`Heading`、`OutlineNode`、`DocumentRange` 與 `DocumentReference`。行號與字元位置採零起算，與 VS Code `Position` 一致；`Heading.documentUri` 使用 `Uri.toString()` 形式保存來源身份。

`src/outline/outlineParser.ts` 不依賴 VS Code API：

- AsciiDoc 使用 Asciidoctor AST 解析文件標題與章節，不以正規表示式掃描章節，因此 source block 內容不會成為 Outline 節點。
- Markdown 使用 markdown-it token 解析 ATX 與 Setext 標題，token map 提供來源 Range，程式碼區塊內容不會被誤判。
- Heading ID 由文件 URI、來源行與層級產生；anchor 集合先提供標題 ID，供後續 Link Checker 共用。
- Parser 發生例外時回傳帶有 `error` 的空分析結果，不捏造節點，也不把例外丟入 Tree View 更新流程。

`OutlineProvider` 只維護目前 active editor。文件切換、文件修改與文件關閉都會更新或清除節點；修改事件由 `adocmdForge.outline.updateDelay` debounce。所有 Event、Timer、TreeView 與 Command registration 都由 Extension context 統一 dispose。

若文件沒有標題，Outline View 顯示空狀態；Explorer 不建立全工作區多文件樹，Link Checker 與匯出仍只處理目前 active editor。這不影響下節的工作區語意索引。

### 10.1 工作區語意索引與 Provider

`WorkspaceDocumentIndex` 是不匯入 VS Code 的核心，集中保存文件分析、明確與自動 anchor、引用及解析結果。`WorkspaceLanguageService` 負責受信任工作區內的檔案目錄、批次初始化、開啟文件覆蓋、FileSystemWatcher、debounce、generation 與 dispose；Completion、Definition、Document Link、References、Rename 及 Quick Fix 共用這個 service，不得各自重新掃描工作區。

新增或修改語意 Provider 時至少驗證：

- `xref`、`include::`、`image::` 的游標情境與取代 Range。
- 同文件及跨文件 anchor、標題產生 anchor 與 `:imagesdir:` 路徑。
- Definition、Document Link 與 References 的目標 URI 及 Range。
- Rename 僅接受明確 anchor，會拒絕無效名稱、自動 anchor 與同文件碰撞，並以單一 `WorkspaceEdit` 更新所有已索引引用。
- `missing-file`、`missing-anchor` Quick Fix 只對本擴充套件 Diagnostic 生效，保留原本 query／fragment，且不提供不會改變文件的候選。
- 未受信任工作區、取消、初始掃描與監看事件的排除目錄、10,000 筆索引硬上限、workspace folder 切換、過期 generation、資源刪除與完整 dispose。

工作區資源事件同時供 Link Checker 與 PreviewManager 使用。相依文件、CSS、圖片或 include 變更時需 debounce，來源文件自身的編輯事件不得造成額外重複渲染。

## 11. HTML 匯出

`src/export/exportService.ts` 是不依賴 VS Code 的匯出核心，接收注入的 Renderer 與檔案系統。`ExportProvider` 只負責目前 editor、儲存對話框、覆寫確認與 VS Code `workspace.fs` adapter。

三種格式的契約如下：

- `html`：完整 HTML5 文件，CSS 內嵌；工作區內的相對圖片與連結改寫為相對於輸出檔案的可攜路徑。
- `standalone-html`：完整 HTML5 文件，可讀取的工作區圖片轉為 base64 data URI；無法安全讀取的圖片會移除 `src`，不會探查網路。
- `embedded-html`：只輸出已消毒的內容 fragment，不包含 `doctype`、`html`、`head` 或 `body`。

匯出寫入前必須確認工作區受信任、來源文件已儲存且來源與目的地位於同一 workspace root。目的地不可等於來源；既有目的檔案需由 UI 先取得覆寫確認。取消儲存對話框或覆寫確認不會 render、建立目錄或寫入檔案。

Renderer 先以既有 worker 產生安全 HTML，再由 export service 執行資源路徑轉換與最後一次 sanitizer。只有由已讀取且限制在 workspace 內的圖片 bytes 建立的 data URI 才會在 Standalone 模式放行。

## 12. Extension Host 整合測試

整合測試放在 `test/integration/suite/`。`suite/index.ts` 匯出 `run()`，由 `@vscode/test-electron` 在 VS Code 1.97.2 中呼叫。

整合測試採具名的非同步測試清單，依序在同一個 Extension Host 執行。這可直接存取 `vscode` 模組，並避免目前 Mocha 相依樹尚無安全升級路徑的已知弱點。Runner 每次建立獨立的暫存 `--user-data-dir` 與空白基底 workspace，並於結束後清除，避免使用者日常設定、工作區備份或移除最後一個測試資料夾所造成的視窗重新載入影響結果。

每個測試必須：

- 清除自己建立的文件、Panel、設定與暫存資源。
- 不依賴使用者已安裝的 Extension。
- 可重複執行。
- 失敗時保留足以定位問題的 stack。

下載的 VS Code 放在 `.vscode-test/`，不納入 Git、ESLint 或 VSIX。

## 13. Webview 開發

Webview runtime 與 Extension Host 是不同信任邊界。

- CSP 預設為 `default-src 'none'`。
- Script 使用外部 bundle 與 nonce。
- 不把文件內容串接進 inline script。
- 所有 Extension 至 Webview 訊息都使用可辨識的 union type。
- Webview 收到訊息後仍要做 runtime validation。
- Webview 送出的 URI、行號、revision 與 command 不可直接信任。
- 本機資源只透過 `webview.asWebviewUri()`。
- AsciiDoc `:stylesheet:`／`:stylesdir:` 只對已儲存的本機文件啟用；候選路徑必須通過 workspace root、realpath、`.css` 檔案與 `localResourceRoots` 檢查。未受信任工作區仍可套用這個文件 CSS，但 include、圖片、連結導航與遠端圖片維持停用。
- 文件 stylesheet 由 Webview runtime 建立與清理 `<link>`，不把 CSS 內容內嵌到訊息或 inline script；訊息驗證同時支援舊式 Webview scheme 與 VS Code 1.97+ 的 `https://*.vscode-resource.vscode-cdn.net` URI，仍拒絕一般外部 HTTPS。
- 樣式使用 VS Code theme token，並驗證高對比模式。
- Preview Webview 不提供工具列或 command bridge，只接收預覽內容與捲動同步訊息；格式命令由 Quick Pick 浮動面板或來源編輯器右鍵選單執行，版面、重新整理、語法說明與匯出命令則由來源編輯器標題列執行。
- `PreviewManager` 集中監聽來源編輯器的 selection 與 visible-range 事件；`PreviewSession` 優先以 selection active line 定位 Preview，來源編輯器捲動則使用可見範圍起始行。預覽純捲動只更新目前區塊標示與保存位置，不反向驅動編輯器；點擊預覽內容才會以 `revealSourceLine` 訊息定位來源編輯器，並透過 sequence 避免回捲循環。
- Preview runtime 會移除上一個 `adocmd-forge-current-source` 標記，再標示最接近目前來源行的區塊；遇到 AsciiDoc section wrapper 時只標示直接標題，避免整個章節背景被改變。
- `WorkspaceLanguageService.onDidChangeResource` 觸發相依預覽更新；PreviewManager 必須對資源事件 debounce，並在 dispose 時清除所有 pending timer。

## 13.1 浮動格式面板與 PDF

格式命令由 `Show Formatting Palette` Quick Pick 浮動面板與選取文字右鍵選單提供，不在編輯器標題列常駐七個按鈕；命令不直接拼接游標文字，先由 `textFormattingCore` 以 offset 計算結果，再由 adapter 套用單一 edit，避免多游標造成行號與選取位置漂移。Preview Webview 不提供操作工具列，避免使用者切換焦點後失去來源選取範圍。所有 `editor/title` 與 `view/title` 操作必須宣告 VS Code Codicon，命令 `title` 則提供滑鼠提示與命令面板文字。

`Export PDF` 只適用已儲存、受信任本機工作區的 AsciiDoc。執行前驗證來源／目的地 workspace 邊界與覆寫確認，並使用不經 shell 的外部程序；使用者需在設定中提供本機 `asciidoctor-pdf` 與必要的 `asciidoctor-diagram` 等元件。

`editor/title` 執行命令時會自動傳入目前文件 URI。匯出命令必須先以支援的來源副檔名辨識此參數；只有非來源文件 URI 才能作為程式化呼叫指定的輸出位置，避免將 `.adoc`／`.md` 誤判成匯出目的地。

Windows 的 RubyGems CLI 通常同時提供無副檔名腳本與 `.bat` 包裝檔，但 Node `spawn` 無法直接執行它們。`asciidocCli` 以 `where.exe` 找出命令與 `ruby.exe`，只接受位於相同 Ruby `bin` 目錄的配對，並直接呼叫 Ruby 腳本；不得為了支援 `.bat` 改用 `shell: true`。

`PdfExportProvider` 必須以來源文件目錄作為 CLI `cwd`。Asciidoctor PDF 預設從目前工作目錄解析相對 `pdf-theme`、`pdf-themesdir` 與 `pdf-fontsdir`；改用 workspace root 會讓既有文件的 `:pdf-theme: ../pdf-theme.yml` 指向錯誤位置並退回預設 theme。

## 14. 相依套件

新增套件前確認：

1. 是否已有平台 API 或既有套件可以完成。
2. 專案是否仍有維護。
3. License 是否允許 Marketplace 發行。
4. Node 與 VS Code 最低版本是否相容。
5. bundle 後大小。
6. `npm audit` 結果。
7. 是否需要 native module 或 install script。

執行期套件必須由 esbuild bundle。`vscode` 必須維持 external。

## 15. 安全檢查

- Markdown raw HTML 預設關閉。
- Renderer 產出進入 Webview 或 Export 前必須消毒。
- 不跟隨未驗證 scheme。
- 寫檔前驗證目的 URI 位於允許根目錄。
- 不靜默覆寫使用者檔案。
- 不在紀錄中輸出文件全文、圖片 bytes、token 或 URI query。
- 不用 `npm audit fix --force` 取代相依風險分析。

## 16. 封裝

先執行：

```powershell
npm run verify
npm audit
npm run package:list
npm run package:vsix
```

檢查 VSIX 內容：

- 必須包含 `dist/extension.js`、`package.json`、由 `README.adoc` 暫時產生的 Marketplace `README.md`、CHANGELOG、LICENSE、PNG 圖示、必要媒體與第三方授權。
- 不得包含 `README.adoc`、Architecture、DeveloperGuide、CONTRIBUTING、`src/`、`test/`、`.vscode-test/`、coverage、開發設定或完整 `node_modules/`。
- `package-list.mjs` 使用明確白名單；正式封裝新增檔案時，必須先確認它是執行或 Marketplace 顯示所需內容。
- 圖示使用 PNG。

安裝測試使用隔離目錄，避免變更開發者日常 VS Code：

```powershell
code --extensions-dir .vscode-test/installed-extensions --install-extension artifacts/adocmd-forge-<version>.vsix --force
```

## 17. 發行

發行前同步更新：

- `package.json`
- `package-lock.json`
- `CHANGELOG.md`
- `README.adoc`（唯一可編輯的 README 來源；封裝時會暫時產生 `README.md`）
- VSIX 版本
- Git tag

Publisher 為 `BucketHsu`。正式發行憑證只放在受保護的 CI secret，不寫入 repository、設定檔或 VSIX。

## 18. 參考專案原則

目前參考路徑：

```text
D:\Project\legacy-javascript-toolkit\legacy-javascript-toolkit
```

可以分析其流程、生命週期與失敗案例，但不得直接複製程式碼。採納設計時要記錄：

- 可驗證的原始行為
- 適用於 AdocMD Forge 的原因
- 不採用的限制
- 對測試與文件的影響
