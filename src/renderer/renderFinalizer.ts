import type { RenderMessage } from '../models/renderMessage';
import type { RenderResult } from '../models/renderResult';
import { sanitizeRenderedHtml } from './htmlSanitizer';

export interface RenderedFragment {
  readonly html: string;
  readonly messages?: readonly RenderMessage[];
  readonly stylesheets?: readonly string[];
  readonly title?: string;
}

/**
 * 統一完成 HTML 消毒與來源行數計算，讓不同格式的 Worker 共用同一套輸出契約。
 */
export function finalizeRenderedDocument(
  rendered: RenderedFragment,
  source: string,
): RenderResult {
  return {
    html: sanitizeRenderedHtml(rendered.html),
    lineCount: countSourceLines(source),
    ...(rendered.messages === undefined ? {} : {
      messages: rendered.messages,
    }),
    ...(rendered.stylesheets === undefined ? {} : {
      stylesheets: rendered.stylesheets,
    }),
    ...(rendered.title === undefined ? {} : {
      title: rendered.title,
    }),
  };
}

function countSourceLines(source: string): number {
  return source.split(/\r\n|[\n\r]/u).length;
}
