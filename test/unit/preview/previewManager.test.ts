import path from 'node:path';

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type * as vscode from 'vscode';

type Listener<T> = (event: T) => void;

interface FakeDisposable {
  readonly dispose: () => void;
}

class FakeEvent<T> {
  private readonly listeners = new Set<Listener<T>>();

  public readonly event = (listener: Listener<T>): FakeDisposable => {
    this.listeners.add(listener);
    return {
      dispose: (): void => {
        this.listeners.delete(listener);
      },
    };
  };

  public fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}

interface UriChange {
  readonly authority?: string;
  readonly fragment?: string;
  readonly path?: string;
  readonly query?: string;
  readonly scheme?: string;
}

class FakeUri {
  public constructor(
    private readonly value: string,
    public readonly scheme = 'untitled',
    public readonly fsPath = '',
    public readonly path = fsPath,
    public readonly authority = '',
    public readonly query = '',
    public readonly fragment = '',
  ) {}

  public toString(): string {
    return this.value;
  }

  public with(change: UriChange): FakeUri {
    const scheme = change.scheme ?? this.scheme;
    const authority = change.authority ?? this.authority;
    const uriPath = change.path ?? this.path;
    const query = change.query ?? this.query;
    const fragment = change.fragment ?? this.fragment;
    const suffix = (query.length > 0 ? `?${query}` : '')
      + (fragment.length > 0 ? `#${fragment}` : '');
    return new FakeUri(
      `${scheme}://${authority}${uriPath}${suffix}`,
      scheme,
      uriPath,
      uriPath,
      authority,
      query,
      fragment,
    );
  }
}

interface FakeTextDocument {
  readonly fileName: string;
  readonly languageId: string;
  readonly uri: FakeUri;
}

interface FakeTextEditor {
  readonly document: FakeTextDocument;
}

interface FakePanel {
  readonly reveal: ReturnType<typeof vi.fn>;
  readonly viewColumn: number;
}

interface FakePanelOptions {
  readonly enableFindWidget: boolean;
  readonly enableScripts: boolean;
  readonly localResourceRoots: readonly FakeUri[];
  readonly retainContextWhenHidden: boolean;
}

interface FakePanelShowOptions {
  readonly preserveFocus: boolean;
  readonly viewColumn: number;
}

interface FakeSessionOptions {
  readonly allowedResourceRootPaths: readonly string[];
  readonly allowedStylesheetRootPaths: readonly string[];
  readonly documentUri: FakeUri;
  readonly onActivate: (session: FakePreviewSession) => void;
  readonly onDispose: (session: FakePreviewSession) => void;
  readonly panel: FakePanel;
}

const documentChangeEvent = new FakeEvent<{
  readonly document: FakeTextDocument;
}>();
const editorScrollEvent = new FakeEvent<{
  readonly textEditor: FakeTextEditor;
}>();
const editorSelectionEvent = new FakeEvent<{
  readonly textEditor: FakeTextEditor;
}>();
const configurationEvent = new FakeEvent<unknown>();
const trustEvent = new FakeEvent<void>();
const dependencyEvent = new FakeEvent<FakeUri>();
const sessionInstances: FakePreviewSession[] = [];

class FakePreviewSession {
  public readonly dispose: ReturnType<typeof vi.fn>;
  public readonly documentUri: FakeUri;
  public readonly handleConfigurationChange = vi.fn();
  public readonly handleDocumentChange = vi.fn();
  public readonly handleEditorScroll = vi.fn();
  public readonly handleEditorSelection = vi.fn();
  public readonly panel: FakePanel;
  public readonly refresh = vi.fn();
  public readonly revealLayout = vi.fn();
  public readonly updateResourceRoots = vi.fn();

  public constructor(public readonly options: FakeSessionOptions) {
    this.documentUri = options.documentUri;
    this.panel = options.panel;
    this.dispose = vi.fn((): void => {
      options.onDispose(this);
    });
    sessionInstances.push(this);
  }

  public activate(): void {
    this.options.onActivate(this);
  }

  public close(): void {
    this.options.onDispose(this);
  }
}

let openToSide = true;
let workspaceFolder: { readonly uri: FakeUri } | undefined;
const fakeWorkspace = {
  getWorkspaceFolder: vi.fn(() => workspaceFolder),
  isTrusted: true,
  onDidChangeConfiguration: configurationEvent.event,
  onDidChangeTextDocument: documentChangeEvent.event,
  onDidGrantWorkspaceTrust: trustEvent.event,
  openTextDocument: vi.fn<(uri: FakeUri) => Promise<FakeTextDocument>>(),
};

const fakeWindow = {
  activeTextEditor: undefined as FakeTextEditor | undefined,
  createWebviewPanel: vi.fn<(
    viewType: string,
    title: string,
    showOptions: FakePanelShowOptions,
    options: FakePanelOptions,
  ) => FakePanel>(),
  onDidChangeTextEditorSelection: editorSelectionEvent.event,
  onDidChangeTextEditorVisibleRanges: editorScrollEvent.event,
  showTextDocument: vi.fn(() => Promise.resolve()),
};

function createFileUri(filePath: string): FakeUri {
  const normalizedPath = filePath.replaceAll('\\', '/');
  return new FakeUri(
    `file://${normalizedPath}`,
    'file',
    filePath,
    normalizedPath,
  );
}

vi.mock('vscode', () => ({
  Uri: {
    file: createFileUri,
    joinPath: (uri: FakeUri, ...parts: string[]): FakeUri => {
      const joinedPath = path.posix.join(uri.path, ...parts);
      return new FakeUri(
        `${uri.scheme}://${uri.authority}${joinedPath}`,
        uri.scheme,
        path.join(uri.fsPath, ...parts),
        joinedPath,
        uri.authority,
      );
    },
  },
  ViewColumn: {
    Active: 1,
    Beside: 2,
  },
  window: fakeWindow,
  workspace: fakeWorkspace,
}));

vi.mock('../../../src/settings/extensionSettings', () => ({
  getPreviewSettings: (): {
    readonly openToSide: boolean;
  } => ({
    openToSide,
  }),
}));

vi.mock('../../../src/preview/previewSession', () => ({
  PreviewSession: FakePreviewSession,
}));

let PreviewManagerClass: typeof import('../../../src/preview/previewManager').PreviewManager;
let createHostFileSystemUri: typeof import('../../../src/preview/hostFileSystemUri').createHostFileSystemUri;
let getContainingDirectoryUri: typeof import('../../../src/preview/hostFileSystemUri').getContainingDirectoryUri;
let isHostFileSystemUri: typeof import('../../../src/preview/hostFileSystemUri').isHostFileSystemUri;
let manager: InstanceType<typeof PreviewManagerClass> | undefined;

function createDocument(
  uri = new FakeUri('untitled:guide.md'),
  languageId = 'markdown',
  fileName = 'guide.md',
): FakeTextDocument {
  return {
    fileName,
    languageId,
    uri,
  };
}

function createPanel(viewColumn = 2): FakePanel {
  return {
    reveal: vi.fn(),
    viewColumn,
  };
}

function createManager(): InstanceType<typeof PreviewManagerClass> {
  manager = new PreviewManagerClass({
    extensionUri: createFileUri('/extension') as unknown as vscode.Uri,
    openLink: (): Promise<void> => Promise.resolve(),
    outputChannel: {} as vscode.OutputChannel,
    resourceChangeEvent: dependencyEvent.event as unknown as vscode.Event<vscode.Uri>,
    renderer: (): Promise<{
      readonly html: string;
      readonly lineCount: number;
    }> => Promise.resolve({
      html: '',
      lineCount: 0,
    }),
  });
  return manager;
}

async function openDocumentPreview(
  previewManager: InstanceType<typeof PreviewManagerClass>,
  document: FakeTextDocument,
  panel = createPanel(),
): Promise<FakePreviewSession> {
  fakeWorkspace.openTextDocument.mockResolvedValueOnce(document);
  fakeWindow.createWebviewPanel.mockReturnValueOnce(panel);
  await previewManager.openPreview(document.uri as unknown as vscode.Uri);
  const session = sessionInstances.at(-1);
  if (session === undefined) {
    throw new Error('Expected a preview session to be created.');
  }
  return session;
}

describe('PreviewManager', (): void => {
  beforeAll(async (): Promise<void> => {
    const managerModule = await import('../../../src/preview/previewManager');
    const uriModule = await import('../../../src/preview/hostFileSystemUri');
    PreviewManagerClass = managerModule.PreviewManager;
    createHostFileSystemUri = uriModule.createHostFileSystemUri;
    getContainingDirectoryUri = uriModule.getContainingDirectoryUri;
    isHostFileSystemUri = uriModule.isHostFileSystemUri;
  });

  beforeEach((): void => {
    documentChangeEvent.clear();
    editorScrollEvent.clear();
    editorSelectionEvent.clear();
    configurationEvent.clear();
    trustEvent.clear();
    dependencyEvent.clear();
    sessionInstances.splice(0);
    fakeWorkspace.getWorkspaceFolder.mockClear();
    fakeWorkspace.openTextDocument.mockReset();
    fakeWorkspace.isTrusted = true;
    fakeWindow.createWebviewPanel.mockReset();
    fakeWindow.showTextDocument.mockClear();
    fakeWindow.activeTextEditor = undefined;
    openToSide = true;
    workspaceFolder = undefined;
    manager = undefined;
  });

  afterEach((): void => {
    manager?.dispose();
    vi.useRealTimers();
  });

  it('routes document, viewport, caret, configuration and trust events', async (): Promise<void> => {
    const previewManager = createManager();
    const document = createDocument();
    const session = await openDocumentPreview(previewManager, document);
    const editor = { document };

    documentChangeEvent.fire({ document });
    editorScrollEvent.fire({ textEditor: editor });
    editorSelectionEvent.fire({ textEditor: editor });
    configurationEvent.fire({ affectsConfiguration: vi.fn() });
    trustEvent.fire();

    expect(session.handleDocumentChange).toHaveBeenCalledOnce();
    expect(session.handleEditorScroll).toHaveBeenCalledWith(editor);
    expect(session.handleEditorSelection).toHaveBeenCalledWith(editor);
    expect(session.handleConfigurationChange).toHaveBeenCalledOnce();
    expect(session.updateResourceRoots).toHaveBeenCalledOnce();

    const otherDocument = createDocument(new FakeUri('untitled:other.md'));
    const otherEditor = { document: otherDocument };
    documentChangeEvent.fire({ document: otherDocument });
    editorScrollEvent.fire({ textEditor: otherEditor });
    editorSelectionEvent.fire({ textEditor: otherEditor });
    expect(session.handleDocumentChange).toHaveBeenCalledOnce();
    expect(session.handleEditorScroll).toHaveBeenCalledOnce();
    expect(session.handleEditorSelection).toHaveBeenCalledOnce();
  });

  it('creates a side preview with deduplicated file and workspace roots', async (): Promise<void> => {
    const previewManager = createManager();
    const documentUri = createFileUri('/workspace/docs/guide.adoc');
    const document = createDocument(
      documentUri,
      'asciidoc',
      '/workspace/docs/guide.adoc',
    );
    workspaceFolder = {
      uri: createFileUri('/workspace'),
    };

    const session = await openDocumentPreview(previewManager, document);

    const panelCall = fakeWindow.createWebviewPanel.mock.calls[0];
    expect(panelCall?.[0]).toBe('adocmdForge.preview');
    expect(panelCall?.[1]).toBe('guide.adoc Preview');
    expect(panelCall?.[2]).toEqual({
      preserveFocus: true,
      viewColumn: 2,
    });
    expect(
      panelCall?.[3].localResourceRoots.map((uri) => uri.toString()),
    ).toEqual([
      'file:///extension/dist/media',
      'file:///workspace',
      'file:///workspace/docs',
    ]);
    expect(session.options.allowedResourceRootPaths).toEqual([
      path.resolve('/workspace'),
      path.resolve('/workspace/docs'),
    ]);
    expect(session.options.allowedStylesheetRootPaths).toEqual([
      path.resolve('/workspace'),
      path.resolve('/workspace/docs'),
    ]);
  });

  it('uses the active column and denies include roots in an untrusted workspace', async (): Promise<void> => {
    const previewManager = createManager();
    const documentUri = createFileUri('/workspace/guide.md');
    const document = createDocument(
      documentUri,
      'markdown',
      '/workspace/guide.md',
    );
    workspaceFolder = {
      uri: createFileUri('/workspace'),
    };
    fakeWorkspace.isTrusted = false;
    openToSide = false;

    const session = await openDocumentPreview(previewManager, document);

    expect(fakeWindow.createWebviewPanel.mock.calls[0]?.[2]).toEqual({
      preserveFocus: true,
      viewColumn: 1,
    });
    expect(session.options.allowedResourceRootPaths).toEqual([]);
    expect(session.options.allowedStylesheetRootPaths).toEqual([
      path.resolve('/workspace'),
    ]);
  });

  it('reuses an existing document session instead of creating another panel', async (): Promise<void> => {
    const previewManager = createManager();
    const document = createDocument();
    const panel = createPanel(7);
    const session = await openDocumentPreview(previewManager, document, panel);
    fakeWorkspace.openTextDocument.mockResolvedValueOnce(document);

    await previewManager.openPreview(document.uri as unknown as vscode.Uri);

    expect(sessionInstances).toHaveLength(1);
    expect(panel.reveal).toHaveBeenCalledWith(7, true);
    expect(session.refresh).toHaveBeenCalledOnce();
  });

  it('rejects missing and unsupported active documents', async (): Promise<void> => {
    const previewManager = createManager();

    await expect(previewManager.openPreview()).rejects.toThrow(
      'No active AsciiDoc or Markdown document is available.',
    );

    fakeWindow.activeTextEditor = {
      document: createDocument(
        new FakeUri('untitled:notes.txt'),
        'plaintext',
        'notes.txt',
      ),
    };
    await expect(previewManager.openPreview()).rejects.toThrow(
      'Open an .adoc, .asciidoc, or .md document before opening preview.',
    );
  });

  it('refreshes the source session, falls back to the active session, or opens one', async (): Promise<void> => {
    const previewManager = createManager();
    const firstDocument = createDocument(new FakeUri('untitled:first.md'));
    fakeWindow.activeTextEditor = { document: firstDocument };
    fakeWindow.createWebviewPanel.mockReturnValueOnce(createPanel());

    await previewManager.refreshPreview();
    const firstSession = sessionInstances[0];
    expect(firstSession).toBeDefined();

    await previewManager.refreshPreview();
    expect(firstSession?.refresh).toHaveBeenCalledOnce();

    fakeWindow.activeTextEditor = {
      document: createDocument(new FakeUri('untitled:other.md')),
    };
    await previewManager.refreshPreview();
    expect(firstSession?.refresh).toHaveBeenCalledTimes(2);
  });

  it('opens, reveals and closes source, split and preview layouts', async (): Promise<void> => {
    const previewManager = createManager();
    await previewManager.setLayout('source');

    const document = createDocument();
    fakeWindow.activeTextEditor = { document };
    fakeWindow.createWebviewPanel.mockReturnValueOnce(createPanel());
    await previewManager.setLayout('split');
    const session = sessionInstances[0];
    expect(session?.revealLayout).toHaveBeenCalledWith('split');

    await previewManager.setLayout('preview');
    expect(session?.revealLayout).toHaveBeenCalledWith('preview');

    await previewManager.setLayout('source');
    expect(session?.dispose).toHaveBeenCalledOnce();
    expect(fakeWindow.showTextDocument).toHaveBeenCalledWith(
      document.uri,
      { preview: false },
    );
  });

  it('tracks session activation and removal callbacks', async (): Promise<void> => {
    const previewManager = createManager();
    const first = await openDocumentPreview(
      previewManager,
      createDocument(new FakeUri('untitled:first.md')),
    );
    const second = await openDocumentPreview(
      previewManager,
      createDocument(new FakeUri('untitled:second.md')),
    );

    first.activate();
    await previewManager.refreshPreview();
    expect(first.refresh).toHaveBeenCalledOnce();
    expect(second.refresh).not.toHaveBeenCalled();

    first.close();
    second.activate();
    await previewManager.refreshPreview();
    expect(second.refresh).toHaveBeenCalledOnce();
  });

  it('debounces related include, image and stylesheet changes', async (): Promise<void> => {
    vi.useFakeTimers();
    const previewManager = createManager();
    workspaceFolder = {
      uri: createFileUri('/workspace'),
    };
    const documentUri = createFileUri('/workspace/docs/guide.adoc');
    const session = await openDocumentPreview(
      previewManager,
      createDocument(documentUri, 'asciidoc', documentUri.fsPath),
    );

    dependencyEvent.fire(createFileUri('/workspace/styles/colony.css'));
    dependencyEvent.fire(createFileUri('/workspace/partials/header.adoc'));
    vi.advanceTimersByTime(99);
    expect(session.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(session.refresh).toHaveBeenCalledOnce();

    dependencyEvent.fire(documentUri);
    dependencyEvent.fire(createFileUri('/outside/unrelated.css'));
    vi.advanceTimersByTime(100);
    expect(session.refresh).toHaveBeenCalledOnce();

    session.close();
    dependencyEvent.fire(createFileUri('/workspace/images/new.png'));
    vi.advanceTimersByTime(100);
    expect(session.refresh).toHaveBeenCalledOnce();
  });

  it('disposes sessions and rejects later operations idempotently', async (): Promise<void> => {
    const previewManager = createManager();
    const session = await openDocumentPreview(previewManager, createDocument());

    previewManager.dispose();
    previewManager.dispose();
    documentChangeEvent.fire({ document: session.options as unknown as FakeTextDocument });

    expect(session.dispose).toHaveBeenCalledOnce();
    await expect(previewManager.refreshPreview()).rejects.toThrow(
      'Preview manager has already been disposed.',
    );
    await expect(previewManager.setLayout('preview')).rejects.toThrow(
      'Preview manager has already been disposed.',
    );
  });

  it('converts host file-system URIs without losing remote authority', (): void => {
    const fileUri = createFileUri('/workspace/docs/guide.adoc');
    const remoteUri = new FakeUri(
      'vscode-remote://ssh-remote+server/workspace/docs/guide.adoc?x=1#L2',
      'vscode-remote',
      '/workspace/docs/guide.adoc',
      '/workspace/docs/guide.adoc',
      'ssh-remote+server',
      'x=1',
      'L2',
    );

    expect(isHostFileSystemUri(fileUri as unknown as vscode.Uri)).toBe(true);
    expect(isHostFileSystemUri(remoteUri as unknown as vscode.Uri)).toBe(true);
    expect(isHostFileSystemUri(
      new FakeUri('untitled:guide') as unknown as vscode.Uri,
    )).toBe(false);
    expect(getContainingDirectoryUri(
      remoteUri as unknown as vscode.Uri,
    )).toEqual(expect.objectContaining({
      authority: 'ssh-remote+server',
      fragment: '',
      path: '/workspace/docs',
      query: '',
      scheme: 'vscode-remote',
    }));
    expect(createHostFileSystemUri(
      fileUri as unknown as vscode.Uri,
      '/workspace/image.png',
    )).toEqual(createFileUri('/workspace/image.png'));
    expect(createHostFileSystemUri(
      remoteUri as unknown as vscode.Uri,
      '/workspace/image.png',
    )).toEqual(expect.objectContaining({
      authority: 'ssh-remote+server',
      path: '/workspace/image.png',
      scheme: 'vscode-remote',
    }));
  });
});
