import type { RenderRequest } from '../models/renderRequest';
import type { RenderResult } from '../models/renderResult';
import { renderAsciiDoc } from './asciidocRenderer';
import { renderMarkdown } from './markdownRenderer';
import { finalizeRenderedDocument } from './renderFinalizer';

export type { DocumentKind } from '../models/documentKind';
export type { RenderRequest } from '../models/renderRequest';
export type { RenderResult } from '../models/renderResult';
export {
  DEFAULT_ALLOWED_HTML_ATTRIBUTES,
  DEFAULT_ALLOWED_HTML_SCHEMES,
  DEFAULT_ALLOWED_HTML_TAGS,
  sanitizeRenderedHtml,
  type SanitizeRenderedHtmlOptions,
} from './htmlSanitizer';

/**
 * 將 Markdown 或 AsciiDoc 轉為已消毒、可放入 Webview 的 HTML。
 */
export function render(request: RenderRequest): Promise<RenderResult> {
  return Promise.resolve().then(() => renderDocument(request));
}

function renderDocument(request: RenderRequest): RenderResult {
  const rendered = request.kind === 'markdown'
    ? renderMarkdown(request.source)
    : renderAsciiDoc(request);
  return finalizeRenderedDocument(rendered, request.source);
}
