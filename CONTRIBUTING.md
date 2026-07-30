# Contributing to AdocMD Forge

感謝協助改善 AdocMD Forge。提交變更前，請先閱讀 [Architecture.md](./Architecture.md) 與 [DeveloperGuide.md](./DeveloperGuide.md)。

## 開始之前

- Issue 應描述使用情境、實際結果、預期結果、VS Code 版本與可重現步驟。
- 安全性問題不要公開可利用細節，請使用 GitHub repository 的 private vulnerability reporting。
- 大幅修改公開命令、設定、資料格式或架構前，先以 Issue 說明相容性與遷移方案。

## 開發

```powershell
npm ci
npm run check
npm run test:integration
```

所有程式碼與文件使用 UTF-8、LF 與 2 個空白縮排。正式內容不得留下待辦標記、停用程式碼、假資料或未使用模組。

## Pull Request 要求

每個 Pull Request 應：

- 聚焦單一可說明的變更。
- 不夾帶無關格式化或換行差異。
- 新功能附單元測試與必要的 Extension Host 整合測試。
- Bug 修正附 regression test。
- 公開 API、命令或設定變更同步更新文件與 CHANGELOG。
- 通過 TypeScript、ESLint、單元測試、整合測試與 production build。
- 不降低型別、安全性或測試品質來通過檢查。

## Commit

Commit 訊息使用祈使語氣，清楚說明變更目的。不要在 author、committer 或 co-author 使用自動化助理名稱。

## Review 重點

Review 會特別檢查：

- 文件解析結果是否一致
- Webview CSP、HTML 消毒與訊息驗證
- 路徑穿越、靜默覆寫與非本機 URI
- 非同步競態、取消與過期 revision
- Event、Timer、Panel 與 Provider 是否完整 dispose
- VSIX 內容、相依套件授權與 bundle 大小

## License

提交程式碼即表示你同意依本 repository 的 MIT License 發行該貢獻。
