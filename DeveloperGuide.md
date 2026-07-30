# AdocMD Forge Developer Guide

## 1. 開發環境

建議環境：

- Node.js 24
- npm 12
- VS Code 1.96.2 以上
- Git 2.45 以上

Extension 的執行期仍以 VS Code 1.96 所附 Node 20 相容範圍為準。不得因開發機使用 Node 24，就在 Extension Host bundle 中使用只存在於 Node 24 的 API。

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
| `npm run test:integration` | 啟動隔離的 VS Code 1.96.2 Extension Host |
| `npm run check` | typecheck、lint、unit test、build |
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

## 7. 單元測試

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

## 8. Extension Host 整合測試

整合測試放在 `test/integration/suite/`。`suite/index.ts` 匯出 `run()`，由 `@vscode/test-electron` 在 VS Code 1.96.2 中呼叫。

整合測試採具名的非同步測試清單，依序在同一個 Extension Host 執行。這可直接存取 `vscode` 模組，並避免目前 Mocha 相依樹尚無安全升級路徑的已知弱點。

每個測試必須：

- 清除自己建立的文件、Panel、設定與暫存資源。
- 不依賴使用者已安裝的 Extension。
- 可重複執行。
- 失敗時保留足以定位問題的 stack。

下載的 VS Code 放在 `.vscode-test/`，不納入 Git、ESLint 或 VSIX。

## 9. Webview 開發

Webview runtime 與 Extension Host 是不同信任邊界。

- CSP 預設為 `default-src 'none'`。
- Script 使用外部 bundle 與 nonce。
- 不把文件內容串接進 inline script。
- 所有 Extension 至 Webview 訊息都使用可辨識的 union type。
- Webview 收到訊息後仍要做 runtime validation。
- Webview 送出的 URI、行號、revision 與 command 不可直接信任。
- 本機資源只透過 `webview.asWebviewUri()`。
- 樣式使用 VS Code theme token，並驗證高對比模式。

## 10. 相依套件

新增套件前確認：

1. 是否已有平台 API 或既有套件可以完成。
2. 專案是否仍有維護。
3. License 是否允許 Marketplace 發行。
4. Node 與 VS Code 最低版本是否相容。
5. bundle 後大小。
6. `npm audit` 結果。
7. 是否需要 native module 或 install script。

執行期套件必須由 esbuild bundle。`vscode` 必須維持 external。

## 11. 安全檢查

- Markdown raw HTML 預設關閉。
- Renderer 產出進入 Webview 或 Export 前必須消毒。
- 不跟隨未驗證 scheme。
- 寫檔前驗證目的 URI 位於允許根目錄。
- 不靜默覆寫使用者檔案。
- 不在紀錄中輸出文件全文、圖片 bytes、token 或 URI query。
- 不用 `npm audit fix --force` 取代相依風險分析。

## 12. 封裝

先執行：

```powershell
npm run verify
npm audit
npm run package:list
npm run package:vsix
```

檢查 VSIX 內容：

- 必須包含 `dist/extension.js`、`package.json`、README、CHANGELOG、LICENSE、必要媒體與第三方授權。
- 不得包含 `src/`、`test/`、`.vscode-test/`、coverage、開發設定或完整 `node_modules/`。
- 圖示使用 PNG。

安裝測試使用隔離目錄，避免變更開發者日常 VS Code：

```powershell
code --extensions-dir .vscode-test/installed-extensions --install-extension artifacts/adocmd-forge.vsix --force
```

## 13. 發行

發行前同步更新：

- `package.json`
- `package-lock.json`
- `CHANGELOG.md`
- `README.md`
- VSIX 版本
- Git tag

Publisher 為 `BucketHsu`。正式發行憑證只放在受保護的 CI secret，不寫入 repository、設定檔或 VSIX。

## 14. 參考專案原則

目前參考路徑：

```text
D:\Project\legacy-javascript-toolkit\legacy-javascript-toolkit
```

可以分析其流程、生命週期與失敗案例，但不得直接複製程式碼。採納設計時要記錄：

- 可驗證的原始行為
- 適用於 AdocMD Forge 的原因
- 不採用的限制
- 對測試與文件的影響
