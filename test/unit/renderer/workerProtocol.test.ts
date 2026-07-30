import { describe, expect, it } from 'vitest';

import {
  isRendererWorkerRequestMessage,
  isRendererWorkerResponseMessage,
  isRenderMessage,
  isRenderRequest,
  isRenderResult,
} from '../../../src/renderer/workerProtocol';

const MINIMAL_RENDER_REQUEST = {
  kind: 'markdown',
  source: '# 標題',
} as const;

const MINIMAL_RENDER_RESULT = {
  html: '<h1>標題</h1>',
  lineCount: 1,
} as const;

describe('isRenderRequest', () => {
  it.each([
    MINIMAL_RENDER_REQUEST,
    {
      allowLocalIncludes: true,
      kind: 'asciidoc',
      source: '= 標題',
      sourcePath: 'D:\\docs\\guide.adoc',
    },
    {
      allowLocalIncludes: false,
      kind: 'markdown',
      source: '',
      sourcePath: '',
    },
    Object.assign(Object.create(null) as Record<string, unknown>, {
      kind: 'markdown',
      source: '# 標題',
    }),
    Object.freeze({
      kind: 'asciidoc',
      source: '= 標題',
    }),
  ])('接受有效 RenderRequest', (request) => {
    expect(isRenderRequest(request)).toBe(true);
  });

  it.each([
    undefined,
    null,
    [],
    new Date(),
    {
      kind: 'text',
      source: '內容',
    },
    {
      kind: 'markdown',
      source: 42,
    },
    {
      allowLocalIncludes: undefined,
      kind: 'markdown',
      source: '內容',
    },
    {
      kind: 'markdown',
      source: '內容',
      sourcePath: null,
    },
    {
      injected: true,
      kind: 'markdown',
      source: '內容',
    },
  ])('拒絕型別錯誤或帶有多餘欄位的 RenderRequest', (request) => {
    expect(isRenderRequest(request)).toBe(false);
  });

  it('拒絕 symbol 欄位', () => {
    const request: Record<PropertyKey, unknown> = {
      ...MINIMAL_RENDER_REQUEST,
    };
    request[Symbol('injected')] = true;

    expect(isRenderRequest(request)).toBe(false);
  });

  it('拒絕由 accessor 提供必要欄位，且不執行 getter', () => {
    let getterExecuted = false;
    const request = Object.defineProperty({
      kind: 'markdown',
    }, 'source', {
      enumerable: true,
      get(): string {
        getterExecuted = true;
        return '# 不應讀取';
      },
    });

    expect(isRenderRequest(request)).toBe(false);
    expect(getterExecuted).toBe(false);
  });
});

describe('isRenderMessage', () => {
  it.each([
    {
      message: '',
      severity: 'warning',
    },
    {
      message: 'include 找不到',
      severity: 'error',
      sourceLine: 0,
    },
    {
      message: '最後一行',
      severity: 'warning',
      sourceLine: Number.MAX_SAFE_INTEGER,
    },
  ])('接受有效 RenderMessage', (message) => {
    expect(isRenderMessage(message)).toBe(true);
  });

  it.each([
    {
      message: 42,
      severity: 'error',
    },
    {
      message: '訊息',
      severity: 'info',
    },
    {
      message: '訊息',
      severity: 'warning',
      sourceLine: -1,
    },
    {
      message: '訊息',
      severity: 'warning',
      sourceLine: 1.5,
    },
    {
      message: '訊息',
      severity: 'warning',
      sourceLine: Number.POSITIVE_INFINITY,
    },
    {
      extra: true,
      message: '訊息',
      severity: 'warning',
    },
  ])('拒絕無效 RenderMessage', (message) => {
    expect(isRenderMessage(message)).toBe(false);
  });
});

describe('isRenderResult', () => {
  it.each([
    MINIMAL_RENDER_RESULT,
    {
      html: '',
      lineCount: 0,
      messages: [],
      title: '',
    },
    {
      html: '<p>內容</p>',
      lineCount: Number.MAX_SAFE_INTEGER,
      messages: [
        {
          message: '警告',
          severity: 'warning',
        },
        {
          message: '錯誤',
          severity: 'error',
          sourceLine: 2,
        },
      ],
      title: '文件',
    },
  ])('接受有效 RenderResult', (result) => {
    expect(isRenderResult(result)).toBe(true);
  });

  it.each([
    {
      html: 42,
      lineCount: 1,
    },
    {
      html: '',
      lineCount: -1,
    },
    {
      html: '',
      lineCount: Number.MAX_SAFE_INTEGER + 1,
    },
    {
      html: '',
      lineCount: 1,
      messages: {},
    },
    {
      html: '',
      lineCount: 1,
      messages: [
        {
          message: '訊息',
          severity: 'info',
        },
      ],
    },
    {
      html: '',
      lineCount: 1,
      title: undefined,
    },
    {
      html: '',
      injected: true,
      lineCount: 1,
    },
  ])('拒絕無效或帶有多餘欄位的 RenderResult', (result) => {
    expect(isRenderResult(result)).toBe(false);
  });

  it('拒絕稀疏的 messages 陣列', () => {
    const messages = new Array(1);

    expect(isRenderResult({
      ...MINIMAL_RENDER_RESULT,
      messages,
    })).toBe(false);
  });

  it('拒絕帶有多餘欄位的 messages 陣列', () => {
    const messages: Array<Record<string, unknown>> & {
      injected?: boolean;
    } = [
      {
        message: '訊息',
        severity: 'warning',
      },
    ];
    messages.injected = true;

    expect(isRenderResult({
      ...MINIMAL_RENDER_RESULT,
      messages,
    })).toBe(false);
  });

  it('拒絕帶有 symbol 欄位的 messages 陣列', () => {
    const messages: unknown[] = [
      {
        message: '訊息',
        severity: 'warning',
      },
    ];
    Object.defineProperty(messages, Symbol('injected'), {
      enumerable: true,
      value: true,
    });

    expect(isRenderResult({
      ...MINIMAL_RENDER_RESULT,
      messages,
    })).toBe(false);
  });
});

describe('isRendererWorkerRequestMessage', () => {
  it.each([
    {
      id: 0,
      request: MINIMAL_RENDER_REQUEST,
      type: 'render',
    },
    {
      id: Number.MAX_SAFE_INTEGER,
      request: {
        allowLocalIncludes: true,
        kind: 'asciidoc',
        source: '= 標題',
        sourcePath: '/workspace/guide.adoc',
      },
      type: 'render',
    },
  ])('接受有效 render request', (message) => {
    expect(isRendererWorkerRequestMessage(message)).toBe(true);
  });

  it.each([
    undefined,
    null,
    [],
    {
      id: -1,
      request: MINIMAL_RENDER_REQUEST,
      type: 'render',
    },
    {
      id: 1.5,
      request: MINIMAL_RENDER_REQUEST,
      type: 'render',
    },
    {
      id: Number.NaN,
      request: MINIMAL_RENDER_REQUEST,
      type: 'render',
    },
    {
      id: Number.POSITIVE_INFINITY,
      request: MINIMAL_RENDER_REQUEST,
      type: 'render',
    },
    {
      id: Number.MAX_SAFE_INTEGER + 1,
      request: MINIMAL_RENDER_REQUEST,
      type: 'render',
    },
    {
      id: 1n,
      request: MINIMAL_RENDER_REQUEST,
      type: 'render',
    },
    {
      id: 1,
      request: MINIMAL_RENDER_REQUEST,
      type: 'result',
    },
    {
      id: 1,
      request: {
        kind: 'unknown',
        source: '',
      },
      type: 'render',
    },
    {
      id: 1,
      injected: true,
      request: MINIMAL_RENDER_REQUEST,
      type: 'render',
    },
  ])('拒絕無效 render request', (message) => {
    expect(isRendererWorkerRequestMessage(message)).toBe(false);
  });
});

describe('isRendererWorkerResponseMessage', () => {
  it.each([
    {
      id: 0,
      result: MINIMAL_RENDER_RESULT,
      type: 'result',
    },
    {
      error: {
        message: '轉譯失敗',
        name: 'Error',
      },
      id: Number.MAX_SAFE_INTEGER,
      type: 'error',
    },
  ])('接受有效 render response', (message) => {
    expect(isRendererWorkerResponseMessage(message)).toBe(true);
  });

  it.each([
    {
      id: -1,
      result: MINIMAL_RENDER_RESULT,
      type: 'result',
    },
    {
      error: {
        message: '轉譯失敗',
        name: 'Error',
      },
      id: 1,
      result: MINIMAL_RENDER_RESULT,
      type: 'result',
    },
    {
      error: {
        message: '轉譯失敗',
        name: 'Error',
      },
      id: 1,
      result: MINIMAL_RENDER_RESULT,
      type: 'error',
    },
    {
      id: 1,
      result: {
        html: '',
        lineCount: Number.NaN,
      },
      type: 'result',
    },
    {
      error: new Error('不可直接傳遞 Error instance'),
      id: 1,
      type: 'error',
    },
    {
      error: {
        message: '轉譯失敗',
        name: 42,
      },
      id: 1,
      type: 'error',
    },
    {
      error: {
        injected: true,
        message: '轉譯失敗',
        name: 'Error',
      },
      id: 1,
      type: 'error',
    },
    {
      id: 1,
      result: MINIMAL_RENDER_RESULT,
      type: 'unknown',
    },
  ])('拒絕無效 render response', (message) => {
    expect(isRendererWorkerResponseMessage(message)).toBe(false);
  });
});

describe('worker protocol 防禦性驗證', () => {
  it.each([
    isRendererWorkerRequestMessage,
    isRendererWorkerResponseMessage,
    isRenderMessage,
    isRenderRequest,
    isRenderResult,
  ])('惡意 Proxy 不會讓 guard 向外拋出例外', (guard) => {
    const value = new Proxy({}, {
      getPrototypeOf(): never {
        throw new Error('不應向外傳播的 Proxy trap');
      },
    });

    expect(() => guard(value)).not.toThrow();
    expect(guard(value)).toBe(false);
  });

  it('response 的惡意巢狀 getter 不會被執行', () => {
    let getterExecuted = false;
    const result = Object.defineProperty({
      html: '',
    }, 'lineCount', {
      enumerable: true,
      get(): number {
        getterExecuted = true;
        return 1;
      },
    });

    expect(isRendererWorkerResponseMessage({
      id: 1,
      result,
      type: 'result',
    })).toBe(false);
    expect(getterExecuted).toBe(false);
  });
});
