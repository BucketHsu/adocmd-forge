// @vitest-environment jsdom
/// <reference lib="dom" />

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  initializePreview,
  PreviewRuntime,
  readPreviewState,
  type PreviewState,
  type VsCodeApi,
} from '../../../src/webview/previewRuntime';
import { isWebviewToExtensionMessage } from '../../../src/preview/previewMessage';

interface RuntimeHarness {
  readonly contentElement: HTMLElement;
  readonly postedMessages: unknown[];
  readonly runtime: PreviewRuntime;
  readonly savedStates: unknown[];
}

let scrollIntoViewMock: ReturnType<typeof vi.fn>;
let windowScrollToMock: ReturnType<typeof vi.fn>;

describe('PreviewRuntime', (): void => {
  beforeEach((): void => {
    document.body.innerHTML = [
      '<header id="preview-toolbar">',
      '<button type="button" data-toolbar-action="formatBold"><span>B</span></button>',
      '<button type="button" data-toolbar-action="exportPdf">PDF</button>',
      '<button type="button" data-toolbar-action="invalidAction">Invalid</button>',
      '</header>',
      '<div id="preview-status" hidden></div>',
      '<main id="preview-content"></main>',
    ].join('');

    scrollIntoViewMock = vi.fn();
    windowScrollToMock = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
      writable: true,
    });
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: windowScrollToMock,
      writable: true,
    });
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
      function getClientRects(this: HTMLElement): DOMRectList {
        return this.dataset.hidden === 'true'
          ? [] as unknown as DOMRectList
          : [
              createDomRect(0),
            ] as unknown as DOMRectList;
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function getBoundingClientRect(this: HTMLElement): DOMRect {
        return createDomRect(Number(this.dataset.top ?? 0));
      },
    );
  });

  afterEach((): void => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    Reflect.deleteProperty(window, 'scrollTo');
  });

  it('renders only the newest revision and acknowledges it', (): void => {
    const harness = createRuntimeHarness();
    harness.runtime.start();

    sendExtensionMessage({
      type: 'render',
      revision: 2,
      html: '<h1 data-source-line="0">Newest</h1>',
      lineCount: 1,
    });
    sendExtensionMessage({
      type: 'render',
      revision: 1,
      html: '<h1 data-source-line="0">Stale</h1>',
      lineCount: 1,
    });

    expect(harness.contentElement.textContent).toBe('Newest');
    expect(harness.postedMessages).toEqual([
      {
        type: 'ready',
      },
      {
        type: 'rendered',
        revision: 2,
      },
    ]);
    harness.runtime.dispose();
  });

  it('posts preview actions and ignores editor formatting or unknown controls', (): void => {
    const harness = createRuntimeHarness();
    harness.runtime.start();
    harness.postedMessages.splice(0);

    document.querySelector<HTMLButtonElement>(
      '[data-toolbar-action="formatBold"] span',
    )?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));
    document.querySelector<HTMLButtonElement>(
      '[data-toolbar-action="invalidAction"]',
    )?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));
    document.querySelector<HTMLButtonElement>(
      '[data-toolbar-action="exportPdf"]',
    )?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));

    expect(harness.postedMessages).toEqual([
      {
        type: 'toolbarAction',
        action: 'exportPdf',
      },
    ]);
    harness.runtime.dispose();
  });

  it('loads document stylesheets after each render and removes stale links', (): void => {
    const harness = createRuntimeHarness();
    harness.runtime.start();

    sendExtensionMessage({
      type: 'render',
      revision: 1,
      html: '<p data-source-line="0">Styled</p>',
      lineCount: 1,
      stylesheets: [
        'https://file%2B.vscode-resource.vscode-cdn.net/workspace/stylesheets/colony.css',
        'https://file%2B.vscode-resource.vscode-cdn.net/workspace/stylesheets/colony.css',
      ],
    });

    let stylesheetLinks = document.head.querySelectorAll(
      'link[data-adocmd-forge-document-stylesheet]',
    );
    expect(stylesheetLinks).toHaveLength(1);
    expect(stylesheetLinks[0]?.getAttribute('rel')).toBe('stylesheet');
    expect(stylesheetLinks[0]?.getAttribute('href')).toBe(
      'https://file%2B.vscode-resource.vscode-cdn.net/workspace/stylesheets/colony.css',
    );
    stylesheetLinks[0]?.dispatchEvent(new Event('load'));
    expect(harness.postedMessages).toContainEqual({
      type: 'stylesheetStatus',
      href: 'https://file%2B.vscode-resource.vscode-cdn.net/workspace/stylesheets/colony.css',
      status: 'loaded',
    });

    sendExtensionMessage({
      type: 'render',
      revision: 2,
      html: '<p data-source-line="0">Updated</p>',
      lineCount: 1,
      stylesheets: [
        'vscode-webview://workspace/stylesheets/other.css',
      ],
    });

    stylesheetLinks = document.head.querySelectorAll(
      'link[data-adocmd-forge-document-stylesheet]',
    );
    expect(stylesheetLinks).toHaveLength(1);
    expect(stylesheetLinks[0]?.getAttribute('href')).toBe(
      'vscode-webview://workspace/stylesheets/other.css',
    );

    harness.runtime.dispose();
    expect(document.head.querySelectorAll(
      'link[data-adocmd-forge-document-stylesheet]',
    )).toHaveLength(0);
  });

  it('sends #Lx to the Extension Host but handles a normal anchor locally', (): void => {
    const harness = createRuntimeHarness();
    harness.runtime.start();
    sendExtensionMessage({
      type: 'render',
      revision: 1,
      html: [
        '<a id="source-link" href="#L2">Source line</a>',
        '<a id="section-link" href="#section">Section</a>',
        '<h2 id="section" data-source-line="1">Heading</h2>',
      ].join(''),
      lineCount: 2,
    });
    harness.postedMessages.splice(0);
    scrollIntoViewMock.mockClear();

    document.getElementById('source-link')?.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );
    document.getElementById('section-link')?.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(harness.postedMessages).toEqual([
      {
        type: 'openLink',
        href: '#L2',
      },
    ]);
    expect(scrollIntoViewMock).toHaveBeenCalledOnce();
    harness.runtime.dispose();
  });

  it('cancels a pending user-scroll report before programmatic scrolling', (): void => {
    vi.useFakeTimers();
    const harness = createRuntimeHarness();
    harness.runtime.start();
    sendExtensionMessage({
      type: 'render',
      revision: 1,
      html: [
        '<p data-source-line="0" data-top="-100">First</p>',
        '<p data-source-line="5" data-top="20">Second</p>',
      ].join(''),
      lineCount: 6,
    });
    harness.postedMessages.splice(0);

    window.dispatchEvent(new WheelEvent('wheel'));
    window.dispatchEvent(new Event('scroll'));
    sendExtensionMessage({
      type: 'scrollToSourceLine',
      line: 5,
      sequence: 123,
    });
    vi.advanceTimersByTime(500);

    expect(harness.postedMessages).toEqual([]);
    harness.runtime.dispose();
  });

  it('reports the closest source marker and consumes the matching round-trip sequence', (): void => {
    vi.useFakeTimers();
    const harness = createRuntimeHarness();
    harness.runtime.start();
    sendExtensionMessage({
      type: 'render',
      revision: 1,
      html: [
        '<p data-source-line="0" data-top="-100">First</p>',
        '<p data-source-line="5" data-top="20">Second</p>',
      ].join(''),
      lineCount: 6,
    });
    harness.postedMessages.splice(0);
    harness.savedStates.splice(0);
    scrollIntoViewMock.mockClear();

    window.dispatchEvent(new WheelEvent('wheel'));
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(80);

    expect(harness.postedMessages).toHaveLength(1);
    const scrollMessage = harness.postedMessages[0];
    if (
      !isWebviewToExtensionMessage(scrollMessage)
      || scrollMessage.type !== 'scroll'
    ) {
      throw new Error('Expected a validated Webview scroll message.');
    }
    expect(scrollMessage.sourceLine).toBe(5);
    expect(harness.savedStates.at(-1)).toEqual({
      scrollSourceLine: 5,
      sequence: scrollMessage.sequence,
    });

    sendExtensionMessage({
      type: 'scrollToSourceLine',
      line: 5,
      sequence: scrollMessage.sequence,
    });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    harness.runtime.dispose();
  });

  it('keeps programmatic scrolling suppressed until a scroll key signals user intent', (): void => {
    vi.useFakeTimers();
    const harness = createRuntimeHarness();
    harness.runtime.start();
    sendExtensionMessage({
      type: 'render',
      revision: 1,
      html: [
        '<p data-source-line="0" data-top="20">First</p>',
        '<p data-source-line="5" data-top="100">Second</p>',
      ].join(''),
      lineCount: 6,
    });
    harness.postedMessages.splice(0);

    sendExtensionMessage({
      type: 'scrollToSourceLine',
      line: 5,
      sequence: 100,
    });
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'a',
    }));
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(80);
    expect(harness.postedMessages).toEqual([]);

    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
    }));
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(80);
    expect(harness.postedMessages).toEqual([
      expect.objectContaining({
        sourceLine: 0,
        type: 'scroll',
      }),
    ]);
    harness.runtime.dispose();
  });

  it('shows only current errors and ignores malformed host messages', (): void => {
    const harness = createRuntimeHarness();
    const statusElement = document.getElementById('preview-status');
    if (!(statusElement instanceof HTMLElement)) {
      throw new Error('Preview status element is missing.');
    }
    harness.runtime.start();

    sendExtensionMessage({
      type: 'render',
      revision: 3,
      html: '<p data-source-line="0">Current</p>',
      lineCount: 1,
    });
    sendExtensionMessage({
      type: 'showError',
      revision: 2,
      message: 'Stale failure',
    });
    sendExtensionMessage({
      type: 'render',
      revision: -1,
      html: '<script>invalid</script>',
      lineCount: 1,
    });
    expect(statusElement.hidden).toBe(true);

    sendExtensionMessage({
      type: 'showError',
      revision: 4,
      message: 'Current failure',
    });
    expect(statusElement.hidden).toBe(false);
    expect(statusElement.textContent).toBe('Current failure');
    expect(harness.contentElement.getAttribute('aria-busy')).toBe('false');
    harness.runtime.dispose();
  });

  it('validates links and keeps document fragments inside the Webview', (): void => {
    const harness = createRuntimeHarness();
    harness.runtime.start();
    sendExtensionMessage({
      type: 'render',
      revision: 1,
      html: [
        '<a id="external" href="https://example.com">External</a>',
        '<a id="blank" href="   ">Blank</a>',
        '<a id="top" href="#">Top</a>',
        '<a id="encoded" href="#section%20two">Encoded</a>',
        '<a id="malformed" href="#%zz">Malformed</a>',
        '<h2 id="section two" data-source-line="1">Section</h2>',
        '<h2 id="%zz" data-source-line="2">Malformed target</h2>',
      ].join(''),
      lineCount: 3,
    });
    harness.postedMessages.splice(0);
    scrollIntoViewMock.mockClear();

    clickElement('external');
    clickElement('blank');
    clickElement('top');
    clickElement('encoded');
    clickElement('malformed');
    const plainText = document.createTextNode('Plain text');
    harness.contentElement.append(plainText);
    plainText.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(harness.postedMessages).toEqual([
      {
        href: 'https://example.com',
        type: 'openLink',
      },
    ]);
    expect(windowScrollToMock).toHaveBeenCalledOnce();
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
    harness.runtime.dispose();
  });

  it('ignores invalid, out-of-range, and invisible source markers', (): void => {
    vi.useFakeTimers();
    const harness = createRuntimeHarness();
    harness.runtime.start();
    sendExtensionMessage({
      type: 'render',
      revision: 1,
      html: [
        '<p data-source-line="-1">Negative</p>',
        '<p data-source-line="01">Leading zero</p>',
        '<p data-source-line="5">Out of range</p>',
        '<p data-source-line="2" data-hidden="true">Hidden</p>',
      ].join(''),
      lineCount: 5,
    });
    harness.postedMessages.splice(0);
    scrollIntoViewMock.mockClear();

    window.dispatchEvent(new WheelEvent('wheel'));
    window.dispatchEvent(new Event('scroll'));
    vi.runAllTimers();

    expect(harness.postedMessages).toEqual([]);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    harness.runtime.dispose();
  });

  it('removes listeners and timers when disposed', (): void => {
    vi.useFakeTimers();
    const harness = createRuntimeHarness();
    harness.runtime.start();
    harness.runtime.start();
    expect(harness.postedMessages).toEqual([
      {
        type: 'ready',
      },
    ]);
    harness.postedMessages.splice(0);

    harness.runtime.dispose();
    harness.runtime.dispose();
    harness.runtime.start();
    sendExtensionMessage({
      type: 'render',
      revision: 1,
      html: '<p data-source-line="0">Unexpected</p>',
      lineCount: 1,
    });
    window.dispatchEvent(new Event('scroll'));
    vi.runAllTimers();

    expect(harness.contentElement.textContent).toBe('');
    expect(harness.postedMessages).toEqual([]);
  });
});

describe('initializePreview', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('does not initialize when the Webview shell is incomplete', (): void => {
    document.body.innerHTML = '<main id="preview-content"></main>';

    expect(initializePreview()).toBeUndefined();
  });

  it('restores persisted state and starts the runtime', (): void => {
    document.body.innerHTML = [
      '<div id="preview-status" hidden></div>',
      '<main id="preview-content"></main>',
    ].join('');
    const contentElement = document.getElementById('preview-content');
    const postedMessages: unknown[] = [];
    const api: VsCodeApi<unknown> = {
      getState: () => ({
        scrollSourceLine: 4,
        sequence: 12,
      }),
      postMessage: (message): void => {
        postedMessages.push(message);
      },
      setState: (state) => state,
    };
    vi.stubGlobal('acquireVsCodeApi', (): VsCodeApi<unknown> => api);

    const runtime = initializePreview();

    expect(runtime).toBeInstanceOf(PreviewRuntime);
    expect(contentElement).toBeInstanceOf(HTMLElement);
    expect(postedMessages).toEqual([
      {
        type: 'ready',
      },
    ]);
    runtime?.dispose();
  });
});

describe('readPreviewState', (): void => {
  it('restores valid values and rejects inherited or invalid data', (): void => {
    expect(readPreviewState({
      scrollSourceLine: 8,
      sequence: 13,
    })).toEqual({
      scrollSourceLine: 8,
      sequence: 13,
    });
    expect(readPreviewState({
      scrollSourceLine: -1,
      sequence: Number.POSITIVE_INFINITY,
    })).toEqual({
      scrollSourceLine: 0,
      sequence: 0,
    });
    expect(readPreviewState(null)).toEqual({
      scrollSourceLine: 0,
      sequence: 0,
    });
    const inheritedState: Record<string, unknown> = {};
    Object.setPrototypeOf(inheritedState, {
      scrollSourceLine: 8,
      sequence: 13,
    });
    expect(readPreviewState(inheritedState)).toEqual({
      scrollSourceLine: 0,
      sequence: 0,
    });
  });
});

function createRuntimeHarness(
  state: PreviewState = {
    scrollSourceLine: 0,
    sequence: 0,
  },
): RuntimeHarness {
  const contentElement = document.getElementById('preview-content');
  const statusElement = document.getElementById('preview-status');
  const toolbarElement = document.getElementById('preview-toolbar');
  if (
    !(contentElement instanceof HTMLElement)
    || !(statusElement instanceof HTMLElement)
    || !(toolbarElement instanceof HTMLElement)
  ) {
    throw new Error('Preview test shell is incomplete.');
  }

  const postedMessages: unknown[] = [];
  const savedStates: unknown[] = [];
  const api: VsCodeApi<unknown> = {
    getState: (): undefined => undefined,
    postMessage: (message): void => {
      postedMessages.push(message);
    },
    setState: (newState) => {
      savedStates.push(newState);
      return newState;
    },
  };
  return {
    contentElement,
    postedMessages,
    runtime: new PreviewRuntime(
      api,
      contentElement,
      statusElement,
      state,
      toolbarElement,
    ),
    savedStates,
  };
}

function sendExtensionMessage(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', {
    data,
  }));
}

function clickElement(identifier: string): void {
  document.getElementById(identifier)?.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }),
  );
}

function createDomRect(top: number): DOMRect {
  return {
    bottom: top + 20,
    height: 20,
    left: 0,
    right: 100,
    toJSON: (): Record<string, number> => ({
      top,
    }),
    top,
    width: 100,
    x: 0,
    y: top,
  };
}
