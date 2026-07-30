export interface RenderPreviewMessage {
  readonly type: 'render';
  readonly revision: number;
  readonly html: string;
  readonly lineCount: number;
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

export interface PreviewScrollMessage {
  readonly type: 'scroll';
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
  | PreviewScrollMessage
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
        return hasExactKeys(value, [
          'type',
          'revision',
          'html',
          'lineCount',
        ])
          && isNonNegativeSafeInteger(value.revision)
          && typeof value.html === 'string'
          && isNonNegativeSafeInteger(value.lineCount);

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

      case 'scroll':
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
