# Changelog

本專案的重要變更會記錄於此檔案。

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
