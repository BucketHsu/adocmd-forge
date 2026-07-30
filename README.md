# AdocMD Forge

![AdocMD Forge](images/icon.png)

[AsciiDoc README](README.adoc)

AdocMD Forge 是提供 AsciiDoc 與 Markdown 撰寫體驗的 VS Code 擴充套件。`0.0.1` 是可安裝的預覽功能開發版。

## 支援格式

- AsciiDoc：`.adoc`、`.asciidoc`
- Markdown：`.md`

## 0.0.1 功能

- 使用 Asciidoctor.js 與 markdown-it 產生安全的即時預覽。
- 編輯文件後自動更新。
- 來源編輯器與預覽畫面雙向同步捲動。
- 自動套用 VS Code 深色、淺色與高對比佈景主題。
- 支援允許範圍內的本機圖片、相對連結與 AsciiDoc include。
- 未受信任工作區會停用本機資源；HTTPS 遠端圖片預設停用。

## 指令

| 指令 | 用途 |
| --- | --- |
| `AdocMD Forge: Open Preview` | 開啟目前文件的預覽 |
| `AdocMD Forge: Refresh Preview` | 立即重新產生目前預覽 |

## 設定

| 設定 | 預設值 | 說明 |
| --- | --- | --- |
| `adocmdForge.preview.allowRemoteImages` | `false` | 允許受信任工作區載入 HTTPS 圖片 |
| `adocmdForge.preview.openToSide` | `true` | 在目前編輯器旁開啟預覽 |
| `adocmdForge.preview.scrollSync` | `true` | 啟用雙向同步捲動 |
| `adocmdForge.preview.updateDelay` | `200` | 編輯後更新預覽的延遲毫秒數 |

## 安裝

```bash
code --install-extension artifacts/adocmd-forge-0.0.1.vsix
```

也可以在 VS Code 的 Extensions 檢視中選擇 `Install from VSIX...`。

## 開發與封裝

建議使用 Node.js 22 以上與 VS Code 1.96 以上。

```bash
npm ci
npm run verify
npm run package:vsix
```

按 `F5` 可啟動 Extension Development Host。完整說明請參閱 [README.adoc](README.adoc)、[DeveloperGuide.md](DeveloperGuide.md) 與 [Architecture.md](Architecture.md)。

## 0.0.1 已知限制

本版本以預覽核心為範圍，尚未包含：

- Outline Tree View
- Link Checker 與 Problems Diagnostic
- 圖片拖放、貼上、複製與自動插入語法
- HTML、Standalone HTML 與 Embedded HTML 匯出
- AsciiDoc 語法完成、Hover 與語法說明

## 授權

MIT
