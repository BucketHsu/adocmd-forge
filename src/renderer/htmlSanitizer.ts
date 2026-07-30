import sanitizeHtml from 'sanitize-html';

export const DEFAULT_ALLOWED_HTML_TAGS: readonly string[] = [
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'input',
  'ins',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
  'var',
];

export const DEFAULT_ALLOWED_HTML_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  '*': [
    'aria-hidden',
    'aria-label',
    'class',
    'data-source-line',
    'id',
    'role',
    'title',
  ],
  a: [
    'href',
    'rel',
  ],
  code: [
    'data-lang',
  ],
  img: [
    'alt',
    'height',
    'src',
    'width',
  ],
  input: [
    'checked',
    'disabled',
    'type',
  ],
  li: [
    'value',
  ],
  ol: [
    'reversed',
    'start',
    'type',
  ],
  td: [
    'colspan',
    'headers',
    'rowspan',
  ],
  th: [
    'abbr',
    'colspan',
    'headers',
    'rowspan',
    'scope',
  ],
};

export const DEFAULT_ALLOWED_HTML_SCHEMES: readonly string[] = [
  'http',
  'https',
  'mailto',
];

export interface SanitizeRenderedHtmlOptions {
  /**
   * 額外允許的 Webview 圖片 URI scheme，僅套用於 `img[src]`。
   *
   * 危險 scheme 與格式不合法的值一律忽略，不會放寬連結規則。
   */
  readonly additionalImageSchemes?: readonly string[];
  /**
   * 供 Preview 將相對資源改寫為 Webview URI。
   *
   * transformer 執行後仍會套用固定白名單與 URI scheme 檢查。
   */
  readonly transformTags?: sanitizeHtml.IOptions['transformTags'];
}

/**
 * 消毒 renderer 輸出的 HTML。呼叫端無法覆寫安全白名單。
 */
export function sanitizeRenderedHtml(
  html: string,
  options: SanitizeRenderedHtmlOptions = {},
): string {
  const allowedAttributes = Object.fromEntries(
    Object.entries(DEFAULT_ALLOWED_HTML_ATTRIBUTES).map(([tagName, attributes]) => [
      tagName,
      [...attributes],
    ]),
  );

  return sanitizeHtml(html, {
    allowProtocolRelative: false,
    allowedAttributes,
    allowedSchemes: [...DEFAULT_ALLOWED_HTML_SCHEMES],
    allowedSchemesByTag: {
      img: [
        'https',
        ...getSafeAdditionalImageSchemes(options.additionalImageSchemes),
      ],
    },
    allowedSchemesAppliedToAttributes: [
      'href',
      'src',
    ],
    allowedTags: [...DEFAULT_ALLOWED_HTML_TAGS],
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: false,
    parseStyleAttributes: false,
    transformTags: options.transformTags,
  });
}

const URI_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*$/iu;
const BLOCKED_ADDITIONAL_IMAGE_SCHEMES = new Set([
  'data',
  'file',
  'javascript',
  'vbscript',
]);

function getSafeAdditionalImageSchemes(schemes: readonly string[] | undefined): string[] {
  if (schemes === undefined) {
    return [];
  }

  return [...new Set(
    schemes
      .map((scheme) => scheme.toLowerCase())
      .filter((scheme) => (
        URI_SCHEME_PATTERN.test(scheme)
        && !BLOCKED_ADDITIONAL_IMAGE_SCHEMES.has(scheme)
      )),
  )];
}
