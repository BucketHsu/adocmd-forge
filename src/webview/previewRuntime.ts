/// <reference lib="dom" />

import {
  isExtensionToWebviewMessage,
  isWebviewToExtensionMessage,
  type ExtensionToWebviewMessage,
  type WebviewToExtensionMessage,
} from '../preview/previewMessage';
import { findClosestSourceMarker } from '../preview/sourceLine';
import { parseSourceLineFragment } from '../preview/sourceLineFragment';

export interface VsCodeApi<State> {
  getState(): State | undefined;
  postMessage(message: unknown): void;
  setState(newState: State): State;
}

export interface PreviewState {
  readonly scrollSourceLine: number;
  readonly sequence: number;
}

interface SourceMarker {
  readonly element: HTMLElement;
  readonly highlightElement: HTMLElement;
  readonly sourceLine: number;
}

declare function acquireVsCodeApi<State = unknown>(): VsCodeApi<State>;

const CONTENT_ELEMENT_ID = 'preview-content';
const STATUS_ELEMENT_ID = 'preview-status';
const SOURCE_LINE_ATTRIBUTE = 'data-source-line';
const SOURCE_LINE_PATTERN = /^(?:0|[1-9]\d*)$/u;
const CURRENT_SOURCE_CLASS = 'adocmd-forge-current-source';
const DOCUMENT_STYLESHEET_ATTRIBUTE = 'data-adocmd-forge-document-stylesheet';
const SCROLL_THROTTLE_MILLISECONDS = 80;
const PROGRAMMATIC_SCROLL_IDLE_MILLISECONDS = 180;
const MAX_TRACKED_OUTBOUND_SEQUENCES = 16;
const SCROLL_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
]);

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

export function readPreviewState(value: unknown): PreviewState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      scrollSourceLine: 0,
      sequence: 0,
    };
  }

  const state = value as Readonly<Record<string, unknown>>;
  return {
    scrollSourceLine: Object.hasOwn(state, 'scrollSourceLine')
      && isNonNegativeSafeInteger(state.scrollSourceLine)
      ? state.scrollSourceLine
      : 0,
    sequence: Object.hasOwn(state, 'sequence')
      && isNonNegativeSafeInteger(state.sequence)
      ? state.sequence
      : 0,
  };
}

function parseSourceLine(value: string | null, lineCount: number): number | undefined {
  if (value === null || !SOURCE_LINE_PATTERN.test(value)) {
    return undefined;
  }

  const sourceLine = Number(value);
  if (
    !Number.isSafeInteger(sourceLine)
    || sourceLine < 0
    || sourceLine >= lineCount
  ) {
    return undefined;
  }

  return sourceLine;
}

function decodeFragment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export class PreviewRuntime {
  private disposed = false;
  private started = false;
  private currentLineCount = 0;
  private currentRevision = -1;
  private currentSourceLine: number;
  private currentHighlightElement: HTMLElement | undefined;
  private isProgrammaticScroll = false;
  private markersBySourceLine: readonly SourceMarker[] = [];
  private markersInDocumentOrder: readonly SourceMarker[] = [];
  private nextSequence: number;
  private programmaticScrollTimer: number | undefined;
  private readonly recentOutboundSequences: number[] = [];
  private documentStylesheetElements: readonly HTMLLinkElement[] = [];
  private scrollThrottleTimer: number | undefined;

  public constructor(
    private readonly api: VsCodeApi<unknown>,
    private readonly contentElement: HTMLElement,
    private readonly statusElement: HTMLElement,
    state: PreviewState,
  ) {
    this.currentSourceLine = state.scrollSourceLine;
    this.nextSequence = Math.max(state.sequence, Date.now());
  }

  public start(): void {
    if (this.disposed || this.started) {
      return;
    }

    this.started = true;
    window.addEventListener('message', this.handleWindowMessage);
    window.addEventListener('scroll', this.handleWindowScroll, {
      passive: true,
    });
    window.addEventListener('wheel', this.handleUserScrollIntent, {
      passive: true,
    });
    window.addEventListener('touchstart', this.handleUserScrollIntent, {
      passive: true,
    });
    window.addEventListener('pointerdown', this.handleUserScrollIntent, {
      passive: true,
    });
    window.addEventListener('keydown', this.handleKeyDown);
    this.contentElement.addEventListener('click', this.handleContentClick);

    this.postMessage({
      type: 'ready',
    });
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.started = false;
    window.removeEventListener('message', this.handleWindowMessage);
    window.removeEventListener('scroll', this.handleWindowScroll);
    window.removeEventListener('wheel', this.handleUserScrollIntent);
    window.removeEventListener('touchstart', this.handleUserScrollIntent);
    window.removeEventListener('pointerdown', this.handleUserScrollIntent);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.contentElement.removeEventListener('click', this.handleContentClick);
    this.clearSourceHighlight();
    this.removeDocumentStylesheets();
    if (this.scrollThrottleTimer !== undefined) {
      window.clearTimeout(this.scrollThrottleTimer);
      this.scrollThrottleTimer = undefined;
    }
    this.endProgrammaticScroll();
  }

  private readonly handleWindowMessage = (
    event: MessageEvent<unknown>,
  ): void => {
    if (!isExtensionToWebviewMessage(event.data)) {
      return;
    }

    this.handleMessage(event.data);
  };

  private readonly handleWindowScroll = (): void => {
    if (this.isProgrammaticScroll) {
      this.scheduleProgrammaticScrollRelease();
      return;
    }

    if (this.scrollThrottleTimer !== undefined) {
      return;
    }

    this.scrollThrottleTimer = window.setTimeout(() => {
      this.scrollThrottleTimer = undefined;
      if (!this.isProgrammaticScroll) {
        this.updateScrollPosition();
      }
    }, SCROLL_THROTTLE_MILLISECONDS);
  };

  private readonly handleUserScrollIntent = (): void => {
    this.endProgrammaticScroll();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (SCROLL_KEYS.has(event.key)) {
      this.endProgrammaticScroll();
    }
  };

  private readonly handleContentClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const link = target.closest<HTMLAnchorElement>('a[href]');
    if (link === null || !this.contentElement.contains(link)) {
      this.revealSourceLineFromClick(target);
      return;
    }

    event.preventDefault();
    const href = link.getAttribute('href')?.trim();
    if (href === undefined || href.length === 0) {
      return;
    }

    if (href.startsWith('#')) {
      const fragment = href.slice(1);
      if (parseSourceLineFragment(fragment) === null) {
        const fragmentTarget = this.scrollToFragment(fragment);
        this.revealSourceLineFromClick(fragmentTarget ?? link);
        return;
      }
    }

    const message = {
      type: 'openLink',
      href,
    } satisfies WebviewToExtensionMessage;
    if (isWebviewToExtensionMessage(message)) {
      this.postMessage(message);
    }
  };

  private handleMessage(message: ExtensionToWebviewMessage): void {
    switch (message.type) {
      case 'render':
        this.render(
          message.revision,
          message.html,
          message.lineCount,
          message.stylesheets ?? [],
        );
        break;

      case 'scrollToSourceLine':
        this.handleSourceLineScroll(message.line, message.sequence);
        break;

      case 'showError':
        this.showError(message.revision, message.message);
        break;
    }
  }

  private render(
    revision: number,
    html: string,
    lineCount: number,
    stylesheets: readonly string[],
  ): void {
    if (revision < this.currentRevision) {
      return;
    }

    const sourceLineBeforeRender = this.findClosestViewportMarker()?.sourceLine
      ?? this.currentSourceLine;

    this.currentRevision = revision;
    this.currentLineCount = lineCount;
    this.clearSourceHighlight();
    this.contentElement.innerHTML = html;
    this.updateDocumentStylesheets(stylesheets);
    this.contentElement.removeAttribute('aria-busy');
    this.statusElement.hidden = true;
    this.statusElement.textContent = '';
    this.collectSourceMarkers();

    this.scrollToSourceLine(sourceLineBeforeRender, 'auto');
    this.postMessage({
      type: 'rendered',
      revision,
    });
  }

  private updateDocumentStylesheets(stylesheets: readonly string[]): void {
    this.removeDocumentStylesheets();

    const elements: HTMLLinkElement[] = [];
    const seenStylesheets = new Set<string>();
    for (const stylesheet of stylesheets) {
      if (seenStylesheets.has(stylesheet)) {
        continue;
      }
      seenStylesheets.add(stylesheet);

      const element = document.createElement('link');
      element.setAttribute('rel', 'stylesheet');
      element.setAttribute(DOCUMENT_STYLESHEET_ATTRIBUTE, 'true');
      element.addEventListener('load', () => {
        this.postMessage({
          type: 'stylesheetStatus',
          href: stylesheet,
          status: 'loaded',
        });
      }, { once: true });
      element.addEventListener('error', () => {
        this.postMessage({
          type: 'stylesheetStatus',
          href: stylesheet,
          status: 'error',
        });
      }, { once: true });
      element.href = stylesheet;
      document.head.append(element);
      elements.push(element);
    }
    this.documentStylesheetElements = elements;
  }

  private removeDocumentStylesheets(): void {
    for (const element of this.documentStylesheetElements) {
      element.remove();
    }
    this.documentStylesheetElements = [];
  }

  private showError(revision: number, message: string): void {
    if (revision < this.currentRevision) {
      return;
    }

    this.currentRevision = revision;
    this.statusElement.textContent = message;
    this.statusElement.hidden = false;
    this.contentElement.setAttribute('aria-busy', 'false');
  }

  private collectSourceMarkers(): void {
    const markers: SourceMarker[] = [];
    const elements = this.contentElement.querySelectorAll<HTMLElement>(
      `[${SOURCE_LINE_ATTRIBUTE}]`,
    );

    elements.forEach((element) => {
      const sourceLine = parseSourceLine(
        element.getAttribute(SOURCE_LINE_ATTRIBUTE),
        this.currentLineCount,
      );
      if (sourceLine !== undefined && element.getClientRects().length > 0) {
        markers.push({
          element,
          highlightElement: getHighlightElement(element),
          sourceLine,
        });
      }
    });

    this.markersInDocumentOrder = markers;
    this.markersBySourceLine = [...markers].sort(
      (left, right) => left.sourceLine - right.sourceLine,
    );
  }

  private handleSourceLineScroll(sourceLine: number, sequence: number): void {
    this.nextSequence = Math.max(this.nextSequence, sequence);
    if (this.consumeOutboundSequence(sequence)) {
      this.updateSourceHighlight(sourceLine);
      return;
    }

    this.currentSourceLine = sourceLine;
    this.persistState();
    this.scrollToSourceLine(sourceLine, 'smooth');
  }

  private scrollToSourceLine(
    sourceLine: number,
    behavior: ScrollBehavior,
  ): void {
    const marker = findClosestSourceMarker(
      this.markersBySourceLine,
      sourceLine,
    );
    if (marker === undefined) {
      return;
    }

    this.currentSourceLine = marker.sourceLine;
    this.updateSourceHighlight(marker.sourceLine);
    this.persistState();
    this.beginProgrammaticScroll();
    marker.element.scrollIntoView({
      behavior,
      block: 'center',
    });
  }

  private findClosestViewportMarker(): SourceMarker | undefined {
    if (this.markersInDocumentOrder.length === 0) {
      return undefined;
    }

    let lowerBound = 0;
    let upperBound = this.markersInDocumentOrder.length;
    while (lowerBound < upperBound) {
      const middle = Math.floor((lowerBound + upperBound) / 2);
      const marker = this.markersInDocumentOrder[middle];
      if (
        marker !== undefined
        && marker.element.getBoundingClientRect().top < 0
      ) {
        lowerBound = middle + 1;
      } else {
        upperBound = middle;
      }
    }

    const nextMarker = this.markersInDocumentOrder[lowerBound];
    const previousMarker = this.markersInDocumentOrder[lowerBound - 1];
    if (nextMarker === undefined) {
      return previousMarker;
    }
    if (previousMarker === undefined) {
      return nextMarker;
    }

    return Math.abs(previousMarker.element.getBoundingClientRect().top)
      <= Math.abs(nextMarker.element.getBoundingClientRect().top)
      ? previousMarker
      : nextMarker;
  }

  private updateScrollPosition(): void {
    const marker = this.findClosestViewportMarker();
    if (marker === undefined || marker.sourceLine === this.currentSourceLine) {
      return;
    }

    this.currentSourceLine = marker.sourceLine;
    this.updateSourceHighlight(marker.sourceLine);
    this.persistState();
  }

  private revealSourceLineFromClick(element: Element): void {
    const marker = this.findMarkerForElement(element);
    if (marker === undefined) {
      return;
    }

    this.currentSourceLine = marker.sourceLine;
    this.updateSourceHighlight(marker.sourceLine);
    const sequence = this.createSequence();
    this.trackOutboundSequence(sequence);
    this.persistState();
    this.postMessage({
      type: 'revealSourceLine',
      sourceLine: marker.sourceLine,
      sequence,
    });
  }

  private findMarkerForElement(element: Element): SourceMarker | undefined {
    let current: Element | null = element;
    while (current !== null && current !== this.contentElement) {
      const marker = this.markersInDocumentOrder.find(({ element: markerElement }) => (
        markerElement === current
      ));
      if (marker !== undefined) {
        return marker;
      }
      current = current.parentElement;
    }
    return undefined;
  }

  private scrollToFragment(fragment: string): Element | undefined {
    const identifier = decodeFragment(fragment);
    if (identifier.length === 0) {
      window.scrollTo({
        behavior: 'smooth',
        top: 0,
      });
      return undefined;
    }

    const target = document.getElementById(identifier);
    target?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
    return target ?? undefined;
  }

  private createSequence(): number {
    this.nextSequence = this.nextSequence >= Number.MAX_SAFE_INTEGER
      ? 0
      : this.nextSequence + 1;
    return this.nextSequence;
  }

  private trackOutboundSequence(sequence: number): void {
    this.recentOutboundSequences.push(sequence);
    if (
      this.recentOutboundSequences.length
      > MAX_TRACKED_OUTBOUND_SEQUENCES
    ) {
      this.recentOutboundSequences.shift();
    }
  }

  private consumeOutboundSequence(sequence: number): boolean {
    const index = this.recentOutboundSequences.indexOf(sequence);
    if (index < 0) {
      return false;
    }

    this.recentOutboundSequences.splice(index, 1);
    return true;
  }

  private beginProgrammaticScroll(): void {
    if (this.scrollThrottleTimer !== undefined) {
      window.clearTimeout(this.scrollThrottleTimer);
      this.scrollThrottleTimer = undefined;
    }
    this.isProgrammaticScroll = true;
    this.scheduleProgrammaticScrollRelease();
  }

  private scheduleProgrammaticScrollRelease(): void {
    if (this.programmaticScrollTimer !== undefined) {
      window.clearTimeout(this.programmaticScrollTimer);
    }

    this.programmaticScrollTimer = window.setTimeout(() => {
      this.programmaticScrollTimer = undefined;
      this.isProgrammaticScroll = false;
    }, PROGRAMMATIC_SCROLL_IDLE_MILLISECONDS);
  }

  private endProgrammaticScroll(): void {
    if (this.programmaticScrollTimer !== undefined) {
      window.clearTimeout(this.programmaticScrollTimer);
      this.programmaticScrollTimer = undefined;
    }
    this.isProgrammaticScroll = false;
  }

  private persistState(): void {
    this.api.setState({
      scrollSourceLine: this.currentSourceLine,
      sequence: this.nextSequence,
    });
  }

  private updateSourceHighlight(sourceLine: number): void {
    const marker = findClosestSourceMarker(
      this.markersBySourceLine,
      sourceLine,
    );
    if (marker?.highlightElement === this.currentHighlightElement) {
      return;
    }
    this.clearSourceHighlight();
    marker?.highlightElement.classList.add(CURRENT_SOURCE_CLASS);
    this.currentHighlightElement = marker?.highlightElement;
  }

  private clearSourceHighlight(): void {
    this.currentHighlightElement?.classList.remove(CURRENT_SOURCE_CLASS);
    this.currentHighlightElement = undefined;
  }

  private postMessage(message: WebviewToExtensionMessage): void {
    this.api.postMessage(message);
  }
}

function getHighlightElement(element: HTMLElement): HTMLElement {
  if (!/^sect\d+$/u.test(element.className)) {
    return element;
  }
  return Array.from(element.children).find((child): child is HTMLElement => (
    child instanceof HTMLElement && /^H[1-6]$/u.test(child.tagName)
  )) ?? element;
}

export function initializePreview(): PreviewRuntime | undefined {
  const contentElement = document.getElementById(CONTENT_ELEMENT_ID);
  const statusElement = document.getElementById(STATUS_ELEMENT_ID);
  if (
    !(contentElement instanceof HTMLElement)
    || !(statusElement instanceof HTMLElement)
  ) {
    return undefined;
  }

  const api = acquireVsCodeApi();
  const state = readPreviewState(api.getState());
  const runtime = new PreviewRuntime(
    api,
    contentElement,
    statusElement,
    state,
  );
  runtime.start();
  return runtime;
}
