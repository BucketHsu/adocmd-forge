import type { RenderMessage } from '../models/renderMessage';
import type { RenderRequest } from '../models/renderRequest';
import type { RenderResult } from '../models/renderResult';

/**
 * Worker 可安全傳回 Extension Host 的錯誤資料。
 *
 * 不傳遞 Error instance 或 stack，避免跨執行緒後型別不一致，
 * 也避免把不必要的執行環境細節寫入記錄。
 */
export interface RendererWorkerErrorData {
  readonly message: string;
  readonly name: string;
}

export interface RendererWorkerRenderRequestMessage {
  readonly id: number;
  readonly request: RenderRequest;
  readonly type: 'render';
}

export interface RendererWorkerRenderResultMessage {
  readonly id: number;
  readonly result: RenderResult;
  readonly type: 'result';
}

export interface RendererWorkerRenderErrorMessage {
  readonly error: RendererWorkerErrorData;
  readonly id: number;
  readonly type: 'error';
}

export type RendererWorkerRequestMessage =
  RendererWorkerRenderRequestMessage;

export type RendererWorkerResponseMessage =
  | RendererWorkerRenderErrorMessage
  | RendererWorkerRenderResultMessage;

type DataRecord = Readonly<Record<string, unknown>>;

const RENDER_REQUEST_REQUIRED_KEYS = [
  'kind',
  'source',
] as const;
const RENDER_REQUEST_OPTIONAL_KEYS = [
  'allowLocalIncludes',
  'sourcePath',
] as const;
const RENDER_RESULT_REQUIRED_KEYS = [
  'html',
  'lineCount',
] as const;
const RENDER_RESULT_OPTIONAL_KEYS = [
  'messages',
  'stylesheets',
  'title',
] as const;
const RENDER_MESSAGE_REQUIRED_KEYS = [
  'message',
  'severity',
] as const;
const RENDER_MESSAGE_OPTIONAL_KEYS = [
  'sourceLine',
] as const;

/**
 * 驗證由 Extension Host 傳入 Worker 的 render 訊息。
 */
export function isRendererWorkerRequestMessage(
  value: unknown,
): value is RendererWorkerRequestMessage {
  try {
    const properties = readDataRecord(value, [
      'id',
      'request',
      'type',
    ]);
    return properties?.type === 'render'
      && isRequestId(properties.id)
      && isRenderRequestValue(properties.request);
  } catch {
    return false;
  }
}

/**
 * 驗證 Worker 傳回 Extension Host 的 result 或 error 訊息。
 */
export function isRendererWorkerResponseMessage(
  value: unknown,
): value is RendererWorkerResponseMessage {
  try {
    const properties = readDataRecord(value, [
      'id',
      'type',
    ], [
      'error',
      'result',
    ]);
    if (
      properties === undefined
      || !isRequestId(properties.id)
    ) {
      return false;
    }

    switch (properties.type) {
      case 'error':
        return hasExactPresentKeys(properties, [
          'error',
          'id',
          'type',
        ])
          && isRendererWorkerErrorDataValue(properties.error);

      case 'result':
        return hasExactPresentKeys(properties, [
          'id',
          'result',
          'type',
        ])
          && isRenderResultValue(properties.result);

      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * 驗證可跨 Worker 邊界傳遞的 RenderRequest。
 */
export function isRenderRequest(value: unknown): value is RenderRequest {
  try {
    return isRenderRequestValue(value);
  } catch {
    return false;
  }
}

/**
 * 驗證可跨 Worker 邊界傳遞的 RenderResult。
 */
export function isRenderResult(value: unknown): value is RenderResult {
  try {
    return isRenderResultValue(value);
  } catch {
    return false;
  }
}

/**
 * 驗證 renderer 所產生的單一訊息。
 */
export function isRenderMessage(value: unknown): value is RenderMessage {
  try {
    return isRenderMessageValue(value);
  } catch {
    return false;
  }
}

function isRenderRequestValue(value: unknown): value is RenderRequest {
  const properties = readDataRecord(
    value,
    RENDER_REQUEST_REQUIRED_KEYS,
    RENDER_REQUEST_OPTIONAL_KEYS,
  );
  if (
    properties === undefined
    || (
      properties.kind !== 'asciidoc'
      && properties.kind !== 'markdown'
    )
    || typeof properties.source !== 'string'
  ) {
    return false;
  }

  return (
    !Object.hasOwn(properties, 'allowLocalIncludes')
    || typeof properties.allowLocalIncludes === 'boolean'
  ) && (
    !Object.hasOwn(properties, 'sourcePath')
    || typeof properties.sourcePath === 'string'
  );
}

function isRenderResultValue(value: unknown): value is RenderResult {
  const properties = readDataRecord(
    value,
    RENDER_RESULT_REQUIRED_KEYS,
    RENDER_RESULT_OPTIONAL_KEYS,
  );
  if (
    properties === undefined
    || typeof properties.html !== 'string'
    || !isNonNegativeSafeInteger(properties.lineCount)
    || (
      Object.hasOwn(properties, 'title')
      && typeof properties.title !== 'string'
    )
    || (
      Object.hasOwn(properties, 'stylesheets')
      && !isStylesheetPathArray(properties.stylesheets)
    )
  ) {
    return false;
  }

  return !Object.hasOwn(properties, 'messages')
    || isRenderMessageArray(properties.messages);
}

function isStylesheetPathArray(value: unknown): value is readonly string[] {
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
      || typeof descriptor.value !== 'string'
      || descriptor.value.length === 0
    ) {
      return false;
    }
  }

  return ownKeys.every((key) => (
    key === 'length'
    || (
      typeof key === 'string'
      && isCanonicalArrayIndex(key, length)
    )
  ));
}

function isRenderMessageValue(value: unknown): value is RenderMessage {
  const properties = readDataRecord(
    value,
    RENDER_MESSAGE_REQUIRED_KEYS,
    RENDER_MESSAGE_OPTIONAL_KEYS,
  );
  return properties !== undefined
    && typeof properties.message === 'string'
    && (
      properties.severity === 'error'
      || properties.severity === 'warning'
    )
    && (
      !Object.hasOwn(properties, 'sourceLine')
      || isNonNegativeSafeInteger(properties.sourceLine)
    );
}

function isRenderMessageArray(value: unknown): value is readonly RenderMessage[] {
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
      || !isRenderMessageValue(descriptor.value)
    ) {
      return false;
    }
  }

  return ownKeys.every((key) => (
    key === 'length'
    || (
      typeof key === 'string'
      && isCanonicalArrayIndex(key, length)
    )
  ));
}

function isCanonicalArrayIndex(value: string, length: number): boolean {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    return false;
  }

  const index = Number(value);
  return Number.isSafeInteger(index)
    && index >= 0
    && index < length
    && String(index) === value;
}

function isRendererWorkerErrorDataValue(
  value: unknown,
): value is RendererWorkerErrorData {
  const properties = readDataRecord(value, [
    'message',
    'name',
  ]);
  return properties !== undefined
    && typeof properties.message === 'string'
    && typeof properties.name === 'string';
}

function isRequestId(value: unknown): value is number {
  return isNonNegativeSafeInteger(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

/**
 * 只讀取純物件本身、可列舉的 data property。
 *
 * Accessor、symbol 欄位、非預期欄位與自訂 prototype 都不屬於協定資料。
 * 使用 property descriptor 可避免驗證期間執行外部 getter。
 */
function readDataRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): DataRecord | undefined {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
  ) {
    return undefined;
  }

  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return undefined;
  }

  const allowedKeys = new Set([
    ...requiredKeys,
    ...optionalKeys,
  ]);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((key) => (
      typeof key !== 'string'
      || !allowedKeys.has(key)
    ))
    || requiredKeys.some((key) => !Object.hasOwn(value, key))
  ) {
    return undefined;
  }

  const properties: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys) {
    if (typeof key !== 'string') {
      return undefined;
    }

    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')
    ) {
      return undefined;
    }
    properties[key] = descriptor.value;
  }

  return properties;
}

function hasExactPresentKeys(
  properties: DataRecord,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(properties);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.hasOwn(properties, key));
}
