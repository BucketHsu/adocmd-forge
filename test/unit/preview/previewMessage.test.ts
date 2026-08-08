import { describe, expect, it } from 'vitest';

import {
  isExtensionToWebviewMessage,
  isWebviewToExtensionMessage,
} from '../../../src/preview/previewMessage';

describe('isExtensionToWebviewMessage', () => {
  it.each([
    {
      type: 'render',
      revision: 0,
      html: '',
      lineCount: 0,
    },
    {
      type: 'render',
      revision: Number.MAX_SAFE_INTEGER,
      html: '<h1 data-source-line="0">文件</h1>',
      lineCount: Number.MAX_SAFE_INTEGER,
      stylesheets: [
        'vscode-webview://workspace/stylesheets/colony.css',
        'https://file+.vscode-resource.vscode-cdn.net/workspace/stylesheets/colony.css',
        'https://file%2B.vscode-resource.vscode-cdn.net/workspace/stylesheets/colony.css',
      ],
    },
    {
      type: 'scrollToSourceLine',
      line: 0,
      sequence: Number.MAX_SAFE_INTEGER,
    },
    {
      type: 'showError',
      revision: 1,
      message: '',
    },
  ])('接受有效訊息：$type', (message) => {
    expect(isExtensionToWebviewMessage(message)).toBe(true);
  });

  it.each([
    undefined,
    null,
    [],
    'render',
    {
      type: 'unknown',
    },
    {
      type: 'render',
      revision: -1,
      html: '',
      lineCount: 1,
    },
    {
      type: 'render',
      revision: 1.5,
      html: '',
      lineCount: 1,
    },
    {
      type: 'render',
      revision: 1,
      html: 42,
      lineCount: 1,
    },
    {
      type: 'render',
      revision: 1,
      html: '',
      lineCount: Number.POSITIVE_INFINITY,
    },
    {
      type: 'render',
      revision: 1,
      html: '',
      lineCount: 1,
      stylesheets: ['https://example.com/colony.css'],
    },
    {
      type: 'render',
      revision: 1,
      html: '',
      lineCount: 1,
      stylesheets: [
        'https://vscode-resource.vscode-cdn.net/workspace/stylesheets/colony.css',
      ],
    },
    {
      type: 'render',
      revision: 1,
      html: '',
      lineCount: 1,
      stylesheets: [
        'https://file+.vscode-resource.vscode-cdn.net.evil.example/colony.css',
      ],
    },
    {
      type: 'render',
      revision: 1,
      html: '',
      lineCount: 1,
      stylesheets: ['vscode-webview://safe.css', ''],
    },
    {
      type: 'render',
      revision: Number.MAX_SAFE_INTEGER + 1,
      html: '',
      lineCount: 1,
    },
    {
      type: 'scrollToSourceLine',
      line: Number.NaN,
      sequence: 1,
    },
    {
      type: 'scrollToSourceLine',
      line: 1,
      sequence: -1,
    },
    {
      type: 'showError',
      revision: 1,
      message: {},
    },
    {
      type: 'showError',
      revision: 1,
      message: '失敗',
      injected: true,
    },
  ])('拒絕無效或越界訊息', (message) => {
    expect(isExtensionToWebviewMessage(message)).toBe(false);
  });

  it('拒絕由 prototype 提供欄位的訊息', () => {
    const message = Object.create({
      type: 'render',
      revision: 1,
      html: '',
      lineCount: 1,
    }) as unknown;

    expect(isExtensionToWebviewMessage(message)).toBe(false);
  });

  it('遇到惡意 getter 時不會向外拋出例外', () => {
    const message = Object.defineProperty({}, 'type', {
      get(): never {
        throw new Error('不應執行的 getter');
      },
    });

    expect(() => isExtensionToWebviewMessage(message)).not.toThrow();
    expect(isExtensionToWebviewMessage(message)).toBe(false);
  });

  it('遇到惡意 Proxy 時不會向外拋出例外', () => {
    const message = new Proxy({}, {
      getPrototypeOf(): never {
        throw new Error('不應執行的 Proxy trap');
      },
    });

    expect(() => isExtensionToWebviewMessage(message)).not.toThrow();
    expect(isExtensionToWebviewMessage(message)).toBe(false);
  });
});

describe('isWebviewToExtensionMessage', () => {
  it.each([
    {
      type: 'ready',
    },
    {
      type: 'rendered',
      revision: Number.MAX_SAFE_INTEGER,
    },
    {
      type: 'stylesheetStatus',
      href: 'https://file%2B.vscode-resource.vscode-cdn.net/workspace/stylesheets/colony.css',
      status: 'loaded',
    },
    {
      type: 'scroll',
      sourceLine: 0,
      sequence: 0,
    },
    {
      type: 'openLink',
      href: '#安裝',
    },
    {
      type: 'openLink',
      href: '../guide/intro.adoc#安裝',
    },
    {
      type: 'openLink',
      href: 'https://example.com/guide',
    },
    {
      type: 'toolbarAction',
      action: 'previewSplit',
    },
  ])('接受有效訊息：$type', (message) => {
    expect(isWebviewToExtensionMessage(message)).toBe(true);
  });

  it.each([
    {
      type: 'ready',
      revision: 1,
    },
    {
      type: 'rendered',
      revision: -1,
    },
    {
      type: 'stylesheetStatus',
      href: 'https://file%2B.vscode-resource.vscode-cdn.net/workspace/stylesheets/colony.css',
      status: 'pending',
    },
    {
      type: 'stylesheetStatus',
      href: 'https://example.com/colony.css',
      status: 'loaded',
    },
    {
      type: 'scroll',
      sourceLine: Number.POSITIVE_INFINITY,
      sequence: 1,
    },
    {
      type: 'scroll',
      sourceLine: 1,
      sequence: 0.1,
    },
    {
      type: 'openLink',
      href: '',
    },
    {
      type: 'openLink',
      href: ' javascript:alert(1)',
    },
    {
      type: 'openLink',
      href: 'JaVaScRiPt:alert(1)',
    },
    {
      type: 'openLink',
      href: 'data:text/html,unsafe',
    },
    {
      type: 'openLink',
      href: 'command:workbench.action.closeWindow',
    },
    {
      type: 'openLink',
      href: 'vbscript:msgbox(1)',
    },
    {
      type: 'openLink',
      href: 'guide\u0000.adoc',
    },
    {
      type: 'toolbarAction',
      action: 'runArbitraryCommand',
    },
    {
      type: 'toolbarAction',
      action: 'formatBold',
    },
  ])('拒絕無效或危險訊息', (message) => {
    expect(isWebviewToExtensionMessage(message)).toBe(false);
  });

  it('拒絕 symbol 形式的多餘欄位', () => {
    const message: Record<PropertyKey, unknown> = {
      type: 'ready',
    };
    message[Symbol('injected')] = true;

    expect(isWebviewToExtensionMessage(message)).toBe(false);
  });
});
