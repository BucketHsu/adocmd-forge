import type { RenderMessage } from './renderMessage';

/**
 * Renderer 產生的安全預覽內容。
 *
 * `data-source-line` 與所有行號資料一律採 0-based。
 */
export interface RenderResult {
  readonly html: string;
  readonly lineCount: number;
  readonly messages?: readonly RenderMessage[];
  /**
   * AsciiDoc 文件宣告的本機 CSS 絕對路徑。
   *
   * 路徑只作為 Extension Host 內部的候選值，交給預覽資源邊界再次驗證
   * 後才會轉成 Webview URI；未受信任文件不會產生此欄位。
   */
  readonly stylesheets?: readonly string[];
  /**
   * 可辨識文件標題時回傳純文字，否則省略此欄位。
   */
  readonly title?: string;
}
