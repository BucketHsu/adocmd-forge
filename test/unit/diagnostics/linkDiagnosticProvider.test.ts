import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { DiagnosticCollection, OutputChannel } from 'vscode';

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
  public readonly uri: FakeUri;

  public constructor(
    private readonly source: string,
    public readonly languageId: string,
    uriValue: string,
    uriScheme = 'untitled',
    uriPath = '',
  ) {
    this.fileName = uriValue;
    this.uri = new FakeUri(uriValue, uriScheme, uriPath);
  }

  public getText(): string {
    return this.source;
  }
}

class FakeRange {
  public constructor(
    public readonly start: { readonly line: number; readonly character: number },
    public readonly end: { readonly line: number; readonly character: number },
  ) {}
}

class FakeDiagnostic {
  public code: string | undefined;
  public source: string | undefined;

  public constructor(
    public readonly range: FakeRange,
    public readonly message: string,
    public readonly severity: number,
  ) {}
}

class FakeDiagnosticCollection {
  public disposed = false;
  private readonly values = new Map<string, readonly FakeDiagnostic[]>();

  public set(uri: FakeUri, diagnostics: readonly FakeDiagnostic[]): void {
    this.values.set(uri.toString(), diagnostics);
  }

  public get(uri: FakeUri): readonly FakeDiagnostic[] | undefined {
    return this.values.get(uri.toString());
  }

  public delete(uri: FakeUri): void {
    this.values.delete(uri.toString());
  }

  public clear(): void {
    this.values.clear();
  }

  public dispose(): void {
    this.disposed = true;
    this.clear();
  }
}

function asDiagnosticCollection(
  collection: FakeDiagnosticCollection,
): DiagnosticCollection {
  return collection as unknown as DiagnosticCollection;
}

const activeEditorEmitter = new FakeEventEmitter<unknown>();
const documentChangeEmitter = new FakeEventEmitter<{ readonly document: FakeDocument }>();
const documentCloseEmitter = new FakeEventEmitter<FakeDocument>();
const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
const fakeFileSystem = {
  stat: vi.fn().mockResolvedValue({ type: 1 }),
  readFile: vi.fn().mockResolvedValue(new TextEncoder().encode('# Target\n')),
};
const fakeWindow = {
  activeTextEditor: undefined as { readonly document: FakeDocument } | undefined,
  onDidChangeActiveTextEditor: activeEditorEmitter.event,
};
const fakeWorkspace = {
  isTrusted: true,
  workspaceFolders: [] as readonly { readonly uri: FakeUri }[],
  onDidChangeTextDocument: documentChangeEmitter.event,
  onDidCloseTextDocument: documentCloseEmitter.event,
  fs: fakeFileSystem,
  getConfiguration: (): { get: (key: string, fallback: unknown) => unknown } => ({
    get: (_key: string, fallback: unknown): unknown => fallback,
  }),
};

vi.mock('vscode', () => ({
  Diagnostic: FakeDiagnostic,
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
  },
  Range: class {
    public constructor(
      public readonly start: { readonly line: number; readonly character: number },
      public readonly end: { readonly line: number; readonly character: number },
    ) {}
  },
  Uri: {
    file: (value: string): FakeUri => new FakeUri(`file://${value}`, 'file', value),
    parse: (value: string): FakeUri => new FakeUri(value),
  },
  languages: {
    createDiagnosticCollection: (): FakeDiagnosticCollection => new FakeDiagnosticCollection(),
  },
  window: fakeWindow,
  workspace: fakeWorkspace,
  FileType: {
    File: 1,
  },
  commands: {
    registerCommand: (
      command: string,
      callback: (...args: unknown[]) => unknown,
    ): FakeDisposable => {
      registeredCommands.set(command, callback);
      return new FakeDisposable();
    },
  },
}));

let ProviderClass: typeof import('../../../src/diagnostics/linkDiagnosticProvider').LinkDiagnosticProvider;
let registerFunction: typeof import('../../../src/diagnostics/linkDiagnosticProvider').registerLinkDiagnostics;
let serviceCheck: ReturnType<typeof vi.fn>;

describe('LinkDiagnosticProvider', (): void => {
  beforeAll(async (): Promise<void> => {
    const module = await import('../../../src/diagnostics/linkDiagnosticProvider');
    ProviderClass = module.LinkDiagnosticProvider;
    registerFunction = module.registerLinkDiagnostics;
  });

  beforeEach((): void => {
    vi.useFakeTimers();
    activeEditorEmitter.dispose();
    documentChangeEmitter.dispose();
    documentCloseEmitter.dispose();
    registeredCommands.clear();
    fakeWindow.activeTextEditor = undefined;
    fakeWorkspace.isTrusted = true;
    fakeWorkspace.workspaceFolders = [];
    fakeFileSystem.stat.mockReset();
    fakeFileSystem.stat.mockResolvedValue({ type: 1 });
    fakeFileSystem.readFile.mockReset();
    fakeFileSystem.readFile.mockResolvedValue(new TextEncoder().encode('# Target\n'));
    serviceCheck = vi.fn().mockResolvedValue([
      {
        code: 'missing-file',
        message: '找不到引用檔案：missing.md',
        severity: 'error',
        range: {
          start: { line: 2, character: 4 },
          end: { line: 2, character: 15 },
        },
        reference: {
          kind: 'link',
          target: 'missing.md',
          range: {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 15 },
          },
        },
      },
    ]);
  });

  afterEach((): void => {
    vi.useRealTimers();
  });

  it('依 debounce 分析 active editor 並轉成 Diagnostic，變更前清除舊結果', async (): Promise<void> => {
    const document = new FakeDocument('# Main\n[broken](missing.md)', 'markdown', 'untitled:diagnostic');
    const collection = new FakeDiagnosticCollection();
    fakeWindow.activeTextEditor = { document };
    const provider = new ProviderClass({
      updateDelay: 100,
      collection: asDiagnosticCollection(collection),
      service: {
        check: serviceCheck,
      } as never,
    });

    expect(collection.get(document.uri)).toBeUndefined();
    vi.advanceTimersByTime(99);
    await Promise.resolve();
    expect(serviceCheck).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();
    const diagnostics = collection.get(document.uri);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics?.[0]).toMatchObject({
      message: '找不到引用檔案：missing.md',
      severity: 0,
      code: 'missing-file',
      source: 'adocmd-forge',
    });

    activeEditorEmitter.fire({ document: new FakeDocument('# Other', 'markdown', 'untitled:other') });
    expect(collection.get(document.uri)).toBeUndefined();
    provider.dispose();
    expect(collection.disposed).toBe(true);
  });

  it('active editor 切換、文件修改與取消不會讓過期結果覆蓋新文件', async (): Promise<void> => {
    const first = new FakeDocument('[first](one.md)', 'markdown', 'untitled:first');
    const second = new FakeDocument('[second](two.md)', 'markdown', 'untitled:second');
    fakeWindow.activeTextEditor = { document: first };
    let resolveFirst: (() => void) | undefined;
    const firstCheck = new Promise<readonly never[]>((resolve): void => {
      resolveFirst = (): void => resolve([]);
    });
    serviceCheck.mockReturnValueOnce(firstCheck);
    const collection = new FakeDiagnosticCollection();
    const provider = new ProviderClass({
      updateDelay: 50,
      collection: asDiagnosticCollection(collection),
      service: { check: serviceCheck } as never,
    });
    vi.advanceTimersByTime(50);
    await Promise.resolve();

    fakeWindow.activeTextEditor = { document: second };
    activeEditorEmitter.fire({ document: second });
    vi.advanceTimersByTime(50);
    await Promise.resolve();
    await Promise.resolve();
    expect(serviceCheck).toHaveBeenCalledTimes(2);
    resolveFirst?.();
    await Promise.resolve();
    expect(collection.get(second.uri)).toBeDefined();
    expect(collection.get(first.uri)).toBeUndefined();

    documentChangeEmitter.fire({ document: second });
    provider.dispose();
    vi.runAllTimers();
    expect(serviceCheck).toHaveBeenCalledTimes(2);
  });

  it('validateLinks command 使用 CommandExecutor，dispose 後移除 command/listener', async (): Promise<void> => {
    const document = new FakeDocument('# Main', 'markdown', 'untitled:command');
    fakeWindow.activeTextEditor = { document };
    const collection = new FakeDiagnosticCollection();
    const provider = new ProviderClass({
      updateDelay: 50,
      collection: asDiagnosticCollection(collection),
      service: { check: serviceCheck } as never,
    });
    const commandExecutor = {
      run: vi.fn(async (_title: string, action: () => Promise<void>): Promise<void> => {
        await action();
      }),
    };
    const registration = registerFunction(commandExecutor);
    const command = registeredCommands.get('adocmdForge.validateLinks');
    expect(command).toBeDefined();
    await command?.();
    expect(commandExecutor.run).toHaveBeenCalledWith('Validate Links', expect.any(Function));
    provider.dispose();
    registration.provider.dispose();
    for (const disposable of registration.disposables) {
      disposable.dispose();
    }
  });

  it('將 warning 與 information severity 轉換為 VS Code Diagnostic', async (): Promise<void> => {
    const document = new FakeDocument('# Main', 'markdown', 'untitled:severity');
    const collection = new FakeDiagnosticCollection();
    fakeWindow.activeTextEditor = { document };
    const service = {
      check: vi.fn().mockResolvedValue([
        {
          code: 'missing-file',
          message: 'warning',
          severity: 'warning',
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          reference: {
            kind: 'link',
            target: 'warning.md',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
          },
        },
        {
          code: 'missing-anchor',
          message: 'information',
          severity: 'information',
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 1 },
          },
          reference: {
            kind: 'link',
            target: '#info',
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 1 },
            },
          },
        },
      ]),
    };
    const provider = new ProviderClass({
      updateDelay: 50,
      collection: asDiagnosticCollection(collection),
      service: service as never,
    });
    vi.advanceTimersByTime(50);
    await Promise.resolve();
    await Promise.resolve();

    expect(collection.get(document.uri)).toEqual([
      expect.objectContaining({ severity: 1, source: 'adocmd-forge' }),
      expect.objectContaining({ severity: 2, source: 'adocmd-forge' }),
    ]);
    provider.dispose();
  });

  it('非同步檢查失敗時寫入 OutputChannel，不拋出未處理例外', async (): Promise<void> => {
    const document = new FakeDocument('# Main', 'markdown', 'untitled:error');
    const collection = new FakeDiagnosticCollection();
    const appendLine = vi.fn();
    const outputChannel = { appendLine } as unknown as OutputChannel;
    fakeWindow.activeTextEditor = { document };
    const provider = new ProviderClass({
      updateDelay: 50,
      collection: asDiagnosticCollection(collection),
      outputChannel,
      service: {
        check: vi.fn().mockRejectedValue(new Error('service failed')),
      } as never,
    });
    vi.advanceTimersByTime(50);
    await Promise.resolve();
    await Promise.resolve();

    expect(appendLine).toHaveBeenCalledWith(
      expect.stringContaining('Link Checker: service failed'),
    );
    provider.dispose();
  });

  it('註冊的 provider 可使用唯讀 VS Code workspace.fs 檢查 file URI', async (): Promise<void> => {
    const document = new FakeDocument(
      '[target](target.md#target)',
      'markdown',
      'file:///workspace/main.md',
      'file',
      '/workspace/main.md',
    );
    fakeWindow.activeTextEditor = { document };
    fakeWorkspace.workspaceFolders = [
      { uri: new FakeUri('file:///workspace', 'file', '/workspace') },
    ];
    const commandExecutor = {
      run: async (_title: string, action: () => Promise<void>): Promise<void> => {
        await action();
      },
    };
    const registration = registerFunction(commandExecutor);
    await registeredCommands.get('adocmdForge.validateLinks')?.();

    expect(fakeFileSystem.stat).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/workspace/target.md' }),
    );
    expect(fakeFileSystem.readFile).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/workspace/target.md' }),
    );
    for (const disposable of registration.disposables) {
      disposable.dispose();
    }
  });

  it('workspace.fs stat 失敗時由 service 安全回傳 unknown', async (): Promise<void> => {
    const document = new FakeDocument(
      '[missing](missing.md)',
      'markdown',
      'file:///workspace/main.md',
      'file',
      '/workspace/main.md',
    );
    fakeWindow.activeTextEditor = { document };
    fakeWorkspace.workspaceFolders = [
      { uri: new FakeUri('file:///workspace', 'file', '/workspace') },
    ];
    fakeFileSystem.stat.mockRejectedValueOnce(new Error('stat failed'));
    const commandExecutor = {
      run: async (_title: string, action: () => Promise<void>): Promise<void> => {
        await action();
      },
    };
    const registration = registerFunction(commandExecutor);
    await registeredCommands.get('adocmdForge.validateLinks')?.();
    expect(fakeFileSystem.stat).toHaveBeenCalled();
    for (const disposable of registration.disposables) {
      disposable.dispose();
    }
  });

  it('檢查工作已取消時不寫入錯誤訊息', async (): Promise<void> => {
    const document = new FakeDocument('# Main', 'markdown', 'untitled:cancelled');
    const appendLine = vi.fn();
    const outputChannel = { appendLine } as unknown as OutputChannel;
    fakeWindow.activeTextEditor = { document };
    const serviceCheckWithCancellation = vi.fn().mockImplementation(
      (_input: unknown, signal: AbortSignal): Promise<never> => new Promise((_resolve, reject): void => {
        signal.addEventListener('abort', (): void => reject(new Error('cancelled')));
      }),
    );
    const provider = new ProviderClass({
      updateDelay: 50,
      collection: asDiagnosticCollection(new FakeDiagnosticCollection()),
      outputChannel,
      service: { check: serviceCheckWithCancellation } as never,
    });
    vi.advanceTimersByTime(50);
    await Promise.resolve();
    provider.dispose();
    await Promise.resolve();
    expect(appendLine).not.toHaveBeenCalled();
  });
});
