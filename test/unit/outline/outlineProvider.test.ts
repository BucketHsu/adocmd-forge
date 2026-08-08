import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

type Listener<T> = (value: T) => void;

class FakeDisposable {
  public disposed = false;

  public dispose(): void {
    this.disposed = true;
  }
}

class FakeEventEmitter<T> {
  private readonly listeners = new Set<Listener<T>>();
  public readonly event = (listener: Listener<T>): FakeDisposable => {
    this.listeners.add(listener);
    const disposable = new FakeDisposable();
    const originalDispose = disposable.dispose.bind(disposable);
    disposable.dispose = (): void => {
      this.listeners.delete(listener);
      originalDispose();
    };
    return disposable;
  };

  public fire(value: T): void {
    for (const listener of this.listeners) {
      listener(value);
    }
  }

  public dispose(): void {
    this.listeners.clear();
  }
}

class FakeTreeItem {
  public id: string | undefined;
  public contextValue: string | undefined;
  public description: string | undefined;
  public tooltip: string | undefined;
  public command: unknown;

  public constructor(
    public readonly label: string,
    public readonly collapsibleState: number,
  ) {}
}

const activeEditorEmitter = new FakeEventEmitter<unknown>();
const documentChangeEmitter = new FakeEventEmitter<{ readonly document: FakeDocument }>();
const documentCloseEmitter = new FakeEventEmitter<FakeDocument>();
const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
const fakeWindow = {
  activeTextEditor: undefined as { readonly document: FakeDocument } | undefined,
  onDidChangeActiveTextEditor: activeEditorEmitter.event,
  createTreeView: (): { message: string | undefined; dispose: () => void } => ({
    message: undefined,
    dispose: (): void => undefined,
  }),
  showTextDocument: (): Promise<{
    selection: unknown;
    revealRange: () => void;
  }> => Promise.resolve({
    selection: undefined,
    revealRange: (): void => undefined,
  }),
};
const fakeWorkspace = {
  onDidChangeTextDocument: documentChangeEmitter.event,
  onDidCloseTextDocument: documentCloseEmitter.event,
  getConfiguration: (): { get: (key: string, fallback: unknown) => unknown } => ({
    get: (_key: string, fallback: unknown): unknown => fallback,
  }),
  openTextDocument: (): Promise<FakeDocument> => {
    const activeEditor = fakeWindow.activeTextEditor;
    if (activeEditor === undefined) {
      return Promise.reject(new Error('No active document'));
    }
    return Promise.resolve(activeEditor.document);
  },
};

vi.mock('vscode', () => ({
  EventEmitter: FakeEventEmitter,
  TreeItem: FakeTreeItem,
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
  window: fakeWindow,
  workspace: fakeWorkspace,
  commands: {
    registerCommand: (
      command: string,
      callback: (...args: unknown[]) => unknown,
    ): FakeDisposable => {
      registeredCommands.set(command, callback);
      return new FakeDisposable();
    },
  },
  Uri: {
    parse: (value: string): FakeUri => new FakeUri(value),
  },
  Position: class {
    public constructor(
      public readonly line: number,
      public readonly character: number,
    ) {}
  },
  Range: class {
    public constructor(
      public readonly start: unknown,
      public readonly end: unknown,
    ) {}
  },
  Selection: class {
    public constructor(
      public readonly start: unknown,
      public readonly end: unknown,
    ) {}
  },
  TextEditorRevealType: {
    InCenterIfOutsideViewport: 0,
  },
}));

let OutlineProviderClass: typeof import('../../../src/outline/outlineProvider').OutlineProvider;
let OutlineTreeItemClass: typeof import('../../../src/outline/outlineProvider').OutlineTreeItem;
let registerOutlineProviderFunction: typeof import('../../../src/outline/outlineProvider').registerOutlineProvider;
let revealOutlineCommand: string;

class FakeUri {
  public constructor(
    private readonly value: string,
    public readonly scheme = 'untitled',
    public readonly fsPath = '',
  ) {}

  public toString(): string {
    return this.value;
  }
}

class FakeDocument {
  public version = 1;
  public readonly fileName: string;

  public constructor(
    private source: string,
    public readonly languageId: string,
    uriValue: string,
    uriScheme = 'untitled',
    uriPath = '',
  ) {
    this.fileName = uriValue;
    this.uri = new FakeUri(uriValue, uriScheme, uriPath);
  }

  public readonly uri: FakeUri;

  public getText(): string {
    return this.source;
  }

  public setText(source: string): void {
    this.source = source;
    this.version += 1;
  }
}

describe('OutlineProvider', (): void => {
  beforeAll(async (): Promise<void> => {
    const module = await import('../../../src/outline/outlineProvider');
    OutlineProviderClass = module.OutlineProvider;
    OutlineTreeItemClass = module.OutlineTreeItem;
    registerOutlineProviderFunction = module.registerOutlineProvider;
    revealOutlineCommand = module.REVEAL_OUTLINE_COMMAND;
  });

  beforeEach((): void => {
    vi.useFakeTimers();
    activeEditorEmitter.dispose();
    documentChangeEmitter.dispose();
    documentCloseEmitter.dispose();
    registeredCommands.clear();
    fakeWindow.activeTextEditor = undefined;
  });

  afterEach((): void => {
    vi.useRealTimers();
  });

  it('建立 TreeDataProvider 節點、父子關係與 TreeItem', (): void => {
    const document = new FakeDocument(
      '# Root\n\n## Child\n\n### Grandchild',
      'markdown',
      'untitled:outline-tree',
    );
    fakeWindow.activeTextEditor = { document };
    const provider = new OutlineProviderClass({ updateDelay: 50 });
    vi.advanceTimersByTime(50);

    const roots = provider.getChildren();
    expect(roots).toHaveLength(1);
    const root = roots[0];
    if (root === undefined) {
      throw new Error('Expected one Outline root.');
    }
    expect(root).toBeInstanceOf(OutlineTreeItemClass);
    expect(root.label).toBe('Root');
    expect(provider.getTreeItem(root)).toBe(root);

    const children = provider.getChildren(root);
    expect(children.map(({ label }) => label)).toEqual(['Child']);
    const child = children[0];
    if (child === undefined) {
      throw new Error('Expected one Outline child.');
    }
    expect(provider.getParent(child)).toBe(root);
    expect(provider.getChildren(child).map(({ label }) => label)).toEqual([
      'Grandchild',
    ]);
    provider.dispose();
  });

  it('文件切換與修改會 debounce 更新，關閉後清除舊節點', (): void => {
    const first = new FakeDocument('# First', 'markdown', 'untitled:first');
    const second = new FakeDocument('= Second\n\n== Section', 'asciidoc', 'untitled:second');
    fakeWindow.activeTextEditor = { document: first };
    const provider = new OutlineProviderClass({ updateDelay: 100 });
    vi.advanceTimersByTime(100);
    expect(provider.getAnalysis()?.documentUri).toBe('untitled:first');

    first.setText('# Updated');
    documentChangeEmitter.fire({ document: first });
    documentChangeEmitter.fire({ document: second });
    documentCloseEmitter.fire(second);
    expect(provider.getAnalysis()?.headings[0]?.title).toBe('First');
    vi.advanceTimersByTime(99);
    expect(provider.getAnalysis()?.headings[0]?.title).toBe('First');
    vi.advanceTimersByTime(1);
    expect(provider.getAnalysis()?.headings[0]?.title).toBe('Updated');

    fakeWindow.activeTextEditor = { document: second };
    activeEditorEmitter.fire({ document: second });
    vi.advanceTimersByTime(100);
    expect(provider.getAnalysis()?.documentUri).toBe('untitled:second');
    expect(provider.getChildren().map(({ label }) => label)).toEqual(['Second']);

    documentCloseEmitter.fire(second);
    expect(provider.getAnalysis()).toBeUndefined();
    expect(provider.getChildren()).toEqual([]);
    expect(provider.getMessage()).toContain('請開啟');
    provider.dispose();
  });

  it('不支援文件與無標題文件顯示清楚空狀態，dispose 後不再更新', (): void => {
    const unsupported = new FakeDocument('plain text', 'plaintext', 'untitled:plain');
    fakeWindow.activeTextEditor = { document: unsupported };
    const provider = new OutlineProviderClass({ updateDelay: 50 });
    vi.advanceTimersByTime(100);
    expect(provider.getChildren()).toEqual([]);
    expect(provider.getMessage()).toContain('請開啟');

    const empty = new FakeDocument('paragraph only', 'markdown', 'untitled:empty');
    fakeWindow.activeTextEditor = { document: empty };
    activeEditorEmitter.fire({ document: empty });
    vi.advanceTimersByTime(50);
    expect(provider.getChildren()).toEqual([]);
    expect(provider.getMessage()).toContain('沒有標題');

    provider.dispose();
    empty.setText('# after dispose');
    documentChangeEmitter.fire({ document: empty });
    vi.runAllTimers();
    expect(provider.getChildren()).toEqual([]);
  });

  it('refresh 會依目前 active editor 重新分析，解析錯誤會顯示清楚訊息', (): void => {
    const document = new FakeDocument('# Heading', 'markdown', 'untitled:refresh');
    const analysisService = {
      analyze: (): {
        readonly documentUri: string;
        readonly version: number;
        readonly kind: 'markdown';
        readonly headings: readonly [];
        readonly outline: readonly [];
        readonly anchors: ReadonlySet<string>;
        readonly references: readonly [];
        readonly error: string;
      } => ({
        documentUri: document.uri.toString(),
        version: document.version,
        kind: 'markdown',
        headings: [],
        outline: [],
        anchors: new Set<string>(),
        references: [],
        error: '解析失敗',
      }),
    };
    fakeWindow.activeTextEditor = { document };
    const provider = new OutlineProviderClass({
      analysisService,
      updateDelay: Number.NaN,
    });
    vi.advanceTimersByTime(150);
    expect(provider.getMessage()).toContain('解析失敗');

    fakeWindow.activeTextEditor = undefined;
    provider.refresh();
    expect(provider.getMessage()).toContain('請開啟');
    provider.refresh();
    provider.dispose();
    provider.dispose();
    provider.refresh();

    const fileDocument = new FakeDocument(
      '# File',
      'markdown',
      'file:///workspace/file.md',
      'file',
      '/workspace/file.md',
    );
    fakeWindow.activeTextEditor = { document: fileDocument };
    const fileProvider = new OutlineProviderClass({ updateDelay: 50 });
    vi.advanceTimersByTime(50);
    expect(fileProvider.getAnalysis()?.documentUri).toBe('file:///workspace/file.md');
    fileProvider.dispose();
  });

  it('registers TreeView and commands, and rejects an invalid reveal item', async (): Promise<void> => {
    const registration = registerOutlineProviderFunction({
      run: async (_title: string, action: () => Promise<void>): Promise<void> => {
        await action();
      },
    });
    expect(registration.treeView).toBeDefined();
    expect(registeredCommands.has('adocmdForge.refreshOutline')).toBe(true);
    expect(registeredCommands.has(revealOutlineCommand)).toBe(true);

    const document = new FakeDocument('# Registered', 'markdown', 'untitled:registered');
    fakeWindow.activeTextEditor = { document };
    registration.provider.refresh();
    vi.advanceTimersByTime(150);
    const root = registration.provider.getChildren()[0];
    if (root === undefined) {
      throw new Error('Expected a registered Outline root.');
    }

    const refresh = registeredCommands.get('adocmdForge.refreshOutline');
    refresh?.();
    const reveal = registeredCommands.get(revealOutlineCommand);
    await reveal?.(root);
    await expect(Promise.resolve(reveal?.(undefined))).rejects.toThrow(
      '無法識別要跳轉的 Outline 節點。',
    );
    for (const disposable of registration.disposables) {
      disposable.dispose();
    }
  });
});
