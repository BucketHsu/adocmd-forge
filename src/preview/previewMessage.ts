export interface RenderPreviewMessage {
  readonly type: 'render';
  readonly revision: number;
  readonly html: string;
  readonly lineCount: number;
  readonly stylesheets?: readonly string[];
}

export interface ScrollToSourceLineMessage {
  readonly type: 'scrollToSourceLine';
  readonly line: number;
  readonly sequence: number;
}

export interface ShowPreviewErrorMessage {
  readonly type: 'showError';
  readonly revision: number;
  readonly message: string;
}

export type ExtensionToWebviewMessage =
  | RenderPreviewMessage
  | ScrollToSourceLineMessage
  | ShowPreviewErrorMessage;

export interface PreviewReadyMessage {
  readonly type: 'ready';
}

export interface PreviewRenderedMessage {
  readonly type: 'rendered';
  readonly revision: number;
}

export interface PreviewStylesheetStatusMessage {
  readonly type: 'stylesheetStatus';
  readonly href: string;
  readonly status: 'loaded' | 'error';
}

export interface PreviewRevealSourceLineMessage {
  readonly type: 'revealSourceLine';
  readonly sourceLine: number;
  readonly sequence: number;
}

export interface PreviewOpenLinkMessage {
  readonly type: 'openLink';
  readonly href: string;
}

export type WebviewToExtensionMessage =
  | PreviewReadyMessage
  | PreviewRenderedMessage
  | PreviewStylesheetStatusMessage
  | PreviewRevealSourceLineMessage
  | PreviewOpenLinkMessage;

type MessageRecord = Readonly<Record<PropertyKey, unknown>>;

const DANGEROUS_LINK_SCHEMES = new Set([
  'command',
  'data',
  'javascript',
  'vbscript',
]);
const LINK_SCHEME_PATTERN = /^([a-z][a-z\d+.-]*):/iu;
const LINK_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;
const WEBVIEW_STYLESHEET_SCHEMES = new Set([
  'vscode-resource',
  'vscode-webview',
  'vscode-webview-resource',
]);
const WEBVIEW_RESOURCE_HOST_PATTERN = /^[a-z][a-z\d+.-]*\.vscode-resource\.vscode-cdn\.net$/iu;
function isMessageRecord(value: unknown): value is MessageRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: MessageRecord,
  expectedKeys: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isSafeLinkHref(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || LINK_CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return false;
  }

  const scheme = LINK_SCHEME_PATTERN.exec(value)?.[1]?.toLowerCase();
  return scheme === undefined || !DANGEROUS_LINK_SCHEMES.has(scheme);
}

function isSafeStylesheetUri(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || LINK_CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return false;
  }

  const scheme = LINK_SCHEME_PATTERN.exec(value)?.[1]?.toLowerCase();
  if (scheme === undefined) {
    return false;
  }
  if (WEBVIEW_STYLESHEET_SCHEMES.has(scheme)) {
    return true;
  }
  if (scheme !== 'https') {
    return false;
  }

  try {
    const uri = new URL(value);
    const hostname = decodeURIComponent(uri.hostname);
    return uri.protocol === 'https:'
      && WEBVIEW_RESOURCE_HOST_PATTERN.test(hostname)
      && uri.username.length === 0
      && uri.password.length === 0
      && uri.port.length === 0
      && uri.search.length === 0
      && uri.hash.length === 0
      && uri.pathname.startsWith('/');
  } catch {
    return false;
  }
}

function isStylesheetUriArray(value: unknown): value is readonly string[] {
  if (
    !Array.isArray(value)
    || Reflect.getPrototypeOf(value) !== Array.prototype
  ) {
    return false;
  }

  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined
    || !Object.hasOwn(lengthDescriptor, 'value')
    || typeof lengthDescriptor.value !== 'number'
  ) {
    return false;
  }

  const length = lengthDescriptor.value;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1) {
    return false;
  }

  for (let index = 0; index < length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(
      value,
      String(index),
    );
    if (
      descriptor === undefined
      || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')
      || !isSafeStylesheetUri(descriptor.value)
    ) {
      return false;
    }
  }

  return ownKeys.every((key) => (
    key === 'length'
    || (
      typeof key === 'string'
      && /^(?:0|[1-9]\d*)$/u.test(key)
      && Number(key) < length
      && String(Number(key)) === key
    )
  ));
}

/**
 * 在訊息進入 Webview runtime 前驗證其結構。
 *
 * 僅接受純物件本身的預期欄位，避免 prototype 值或多餘資料進入訊息處理流程。
 */
export function isExtensionToWebviewMessage(
  value: unknown,
): value is ExtensionToWebviewMessage {
  try {
    if (!isMessageRecord(value) || typeof value.type !== 'string') {
      return false;
    }

    switch (value.type) {
      case 'render':
        return (
          hasExactKeys(value, [
            'type',
            'revision',
            'html',
            'lineCount',
          ])
          || hasExactKeys(value, [
            'type',
            'revision',
            'html',
            'lineCount',
            'stylesheets',
          ])
        )
          && isNonNegativeSafeInteger(value.revision)
          && typeof value.html === 'string'
          && isNonNegativeSafeInteger(value.lineCount)
          && (
            !Object.hasOwn(value, 'stylesheets')
            || isStylesheetUriArray(value.stylesheets)
          );

      case 'scrollToSourceLine':
        return hasExactKeys(value, [
          'type',
          'line',
          'sequence',
        ])
          && isNonNegativeSafeInteger(value.line)
          && isNonNegativeSafeInteger(value.sequence);

      case 'showError':
        return hasExactKeys(value, [
          'type',
          'revision',
          'message',
        ])
          && isNonNegativeSafeInteger(value.revision)
          && typeof value.message === 'string';

      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * 驗證 Extension Host 從 Webview 收到的訊息。
 */
export function isWebviewToExtensionMessage(
  value: unknown,
): value is WebviewToExtensionMessage {
  try {
    if (!isMessageRecord(value) || typeof value.type !== 'string') {
      return false;
    }

    switch (value.type) {
      case 'ready':
        return hasExactKeys(value, [
          'type',
        ]);

      case 'rendered':
        return hasExactKeys(value, [
          'type',
          'revision',
        ])
          && isNonNegativeSafeInteger(value.revision);

      case 'stylesheetStatus':
        return hasExactKeys(value, [
          'type',
          'href',
          'status',
        ])
          && isSafeStylesheetUri(value.href)
          && (value.status === 'loaded' || value.status === 'error');

      case 'revealSourceLine':
        return hasExactKeys(value, [
          'type',
          'sourceLine',
          'sequence',
        ])
          && isNonNegativeSafeInteger(value.sourceLine)
          && isNonNegativeSafeInteger(value.sequence);

      case 'openLink':
        return hasExactKeys(value, [
          'type',
          'href',
        ])
          && isSafeLinkHref(value.href);

      default:
        return false;
    }
  } catch {
    return false;
  }
}
