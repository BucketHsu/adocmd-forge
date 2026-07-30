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
   * 可辨識文件標題時回傳純文字，否則省略此欄位。
   */
  readonly title?: string;
}
