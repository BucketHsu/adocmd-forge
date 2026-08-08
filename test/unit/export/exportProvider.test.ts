import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

type Callback = (...args: unknown[]) => unknown;

class FakeDisposable {
  public disposed = false;

  public dispose(): void {
    this.disposed = true;
  }
}

class FakeUri {
  public constructor(
    public readonly fsPath: string,
    public readonly scheme = 'file',
  ) {}

  public toString(): string {
    return `${this.scheme}://${this.fsPath}`;
  }
}

const commands = new Map<string, Callback>();
const files = new Map<string, 'file' | 'directory'>();
const shownSaveOptions: unknown[] = [];
const fakeWindow = {
  activeTextEditor: undefined as {
    readonly document: {
      readonly languageId: string;
      readonly fileName: string;
      readonly uri: FakeUri;
      getText(): string;
    };
  } | undefined,
  showSaveDialog: vi.fn((options: unknown): Promise<FakeUri | undefined> => {
    shownSaveOptions.push(options);
    return Promise.resolve(undefined);
  }),
  showWarningMessage: vi.fn((): Promise<string | undefined> => Promise.resolve(undefined)),
  showInformationMessage: vi.fn((): Promise<string | undefined> => Promise.resolve(undefined)),
};
const fakeWorkspace = {
  isTrusted: true,
  getConfiguration: vi.fn(() => ({
    get: <T>(_key: string, defaultValue: T): T => defaultValue,
  })),
  getWorkspaceFolder: vi.fn((): { readonly uri: FakeUri } | undefined => ({
    uri: new FakeUri('/workspace'),
  })),
  fs: {
    readFile: vi.fn((uri: FakeUri): Promise<Uint8Array> => Promise.resolve(
      new TextEncoder().encode(`data:${uri.fsPath}`),
    )),
    writeFile: vi.fn((): Promise<void> => Promise.resolve()),
    createDirectory: vi.fn((): Promise<void> => Promise.resolve()),
    stat: vi.fn((uri: FakeUri): Promise<{ type: number }> => Promise.resolve({
      type: files.get(uri.fsPath) === 'directory' ? 2 : files.has(uri.fsPath) ? 1 : 0,
    })),
  },
};

vi.mock('vscode', () => ({
  FileType: {
    File: 1,
    Directory: 2,
  },
  Uri: {
    file: (value: string): FakeUri => new FakeUri(value),
    joinPath: (base: FakeUri, ...parts: string[]): FakeUri => new FakeUri(
      `${base.fsPath}/${parts.join('/')}`,
    ),
  },
  commands: {
    registerCommand: (name: string, callback: Callback): FakeDisposable => {
      commands.set(name, callback);
      return new FakeDisposable();
    },
  },
  window: fakeWindow,
  workspace: fakeWorkspace,
}));

const { ExportProvider, registerExportCommands } = await import(
  '../../../src/export/exportProvider'
);
const { PdfExportProvider } = await import(
  '../../../src/export/pdfExportProvider'
);

function createDocument(
  languageId = 'markdown',
  uri = new FakeUri('/workspace/docs/guide.md'),
): { readonly languageId: string; readonly fileName: string; readonly uri: FakeUri; getText(): string } {
  return {
    languageId,
    fileName: uri.fsPath,
    uri,
    getText: (): string => '# 標題',
  };
}

function createService(): {
  export: ReturnType<typeof vi.fn>;
} {
  return {
    export: vi.fn((input: unknown): Promise<{ content: string }> => Promise.resolve({
      content: JSON.stringify(input),
    })),
  };
}

function asVscodeUri(uri: FakeUri): import('vscode').Uri {
  return uri as unknown as import('vscode').Uri;
}

describe('ExportProvider', (): void => {
  beforeEach((): void => {
    commands.clear();
    files.clear();
    shownSaveOptions.length = 0;
    fakeWorkspace.isTrusted = true;
    fakeWorkspace.getConfiguration.mockClear();
    fakeWorkspace.getWorkspaceFolder.mockReset();
    fakeWorkspace.getWorkspaceFolder.mockReturnValue({ uri: new FakeUri('/workspace') });
    fakeWindow.activeTextEditor = { document: createDocument() };
    fakeWindow.showSaveDialog.mockReset();
    fakeWindow.showSaveDialog.mockImplementation((options: unknown): Promise<FakeUri | undefined> => {
      shownSaveOptions.push(options);
      return Promise.resolve(undefined);
    });
    fakeWindow.showWarningMessage.mockReset();
    fakeWindow.showWarningMessage.mockResolvedValue(undefined);
    fakeWindow.showInformationMessage.mockReset();
    fakeWindow.showInformationMessage.mockResolvedValue(undefined);
  });

  it('validates active editor, trust and local workspace before exporting', async (): Promise<void> => {
    const service = createService();
    const provider = new ExportProvider(service as never);

    fakeWindow.activeTextEditor = undefined;
    await expect(provider.exportActive('html')).rejects.toThrow('開啟');
    fakeWindow.activeTextEditor = { document: createDocument('plaintext', new FakeUri('/workspace/docs/notes.txt')) };
    await expect(provider.exportActive('html')).rejects.toThrow('只支援');
    fakeWindow.activeTextEditor = { document: createDocument() };
    fakeWorkspace.isTrusted = false;
    await expect(provider.exportActive('html')).rejects.toThrow('受信任');
    fakeWorkspace.isTrusted = true;
    fakeWindow.activeTextEditor = { document: createDocument('markdown', new FakeUri('/workspace/docs/guide.md', 'untitled')) };
    await expect(provider.exportActive('html')).rejects.toThrow('本機工作區');
    provider.dispose();
    await expect(provider.exportActive('html')).rejects.toThrow('已停止');
  });

  it('returns without side effect when save dialog is cancelled', async (): Promise<void> => {
    const service = createService();
    const provider = new ExportProvider(service as never);

    await expect(provider.exportActive('embedded-html')).resolves.toBeUndefined();
    expect(service.export).not.toHaveBeenCalled();
    expect(fakeWindow.showSaveDialog).toHaveBeenCalledTimes(1);
    expect(shownSaveOptions[0]).toMatchObject({ filters: { HTML: ['html'] } });
  });

  it('exports an explicitly selected new destination and supports every format', async (): Promise<void> => {
    const service = createService();
    const provider = new ExportProvider(service as never);
    const destination = new FakeUri('/workspace/out/result.html');

    const result = await provider.exportActive('html', asVscodeUri(destination));
    expect(result?.content).toEqual(expect.any(String));
    await provider.exportActive('standalone-html', asVscodeUri(new FakeUri('/workspace/out/standalone.html')));
    await provider.exportActive('embedded-html', asVscodeUri(new FakeUri('/workspace/out/embedded.html')));
    expect(service.export).toHaveBeenCalledTimes(3);
    expect(service.export).toHaveBeenNthCalledWith(1, expect.objectContaining({ format: 'html' }));
    expect(service.export).toHaveBeenNthCalledWith(2, expect.objectContaining({ format: 'standalone-html' }));
    expect(service.export).toHaveBeenNthCalledWith(3, expect.objectContaining({ format: 'embedded-html' }));
    expect(fakeWindow.showInformationMessage).toHaveBeenCalledTimes(3);
  });

  it('protects existing files and directories with an explicit confirmation', async (): Promise<void> => {
    const service = createService();
    const provider = new ExportProvider(service as never);
    files.set('/workspace/out/existing.html', 'file');
    const existing = new FakeUri('/workspace/out/existing.html');

    fakeWindow.showWarningMessage.mockResolvedValueOnce(undefined);
    await expect(provider.exportActive('html', asVscodeUri(existing))).resolves.toBeUndefined();
    expect(service.export).not.toHaveBeenCalled();
    fakeWindow.showWarningMessage.mockResolvedValueOnce('覆寫');
    await provider.exportActive('html', asVscodeUri(existing));
    expect(service.export).toHaveBeenCalledTimes(1);

    files.set('/workspace/out/directory.html', 'directory');
    await expect(provider.exportActive('html', asVscodeUri(new FakeUri('/workspace/out/directory.html')))).resolves.toBeUndefined();
    expect(service.export).toHaveBeenCalledTimes(1);
  });

  it('rejects workspace-outside destinations before querying their file metadata', async (): Promise<void> => {
    const service = createService();
    const provider = new ExportProvider(service as never);
    await expect(provider.exportActive('html', asVscodeUri(new FakeUri('/outside/result.html')))).rejects.toThrow('目前工作區');
    expect(fakeWorkspace.fs.stat).not.toHaveBeenCalledWith(expect.objectContaining({ fsPath: '/outside/result.html' }));
    expect(service.export).not.toHaveBeenCalled();
  });

  it('runs the configured Asciidoctor PDF command and verifies its output', async (): Promise<void> => {
    const run = vi.fn((options: {
      readonly args: readonly string[];
      readonly command: string;
    }): Promise<void> => {
      expect(options.command).toBe('asciidoctor-pdf');
      expect(options.args).toEqual([
        '-o',
        '/workspace/out/guide.pdf',
        '/workspace/docs/guide.adoc',
      ]);
      files.set('/workspace/out/guide.pdf', 'file');
      return Promise.resolve();
    });
    fakeWindow.activeTextEditor = {
      document: createDocument(
        'asciidoc',
        new FakeUri('/workspace/docs/guide.adoc'),
      ),
    };
    const provider = new PdfExportProvider({
      runner: { run },
    });

    await provider.exportActive(asVscodeUri(new FakeUri('/workspace/out/guide.pdf')));

    expect(run).toHaveBeenCalledOnce();
    expect(fakeWindow.showInformationMessage).toHaveBeenCalledWith(
      'PDF 已匯出：guide.pdf',
    );
  });

  it('registers all export commands through the command executor', (): void => {
    const executor = { run: vi.fn((_title: string, action: () => Promise<void>): Promise<void> => action()) };
    const registration = registerExportCommands(
      executor,
      (): Promise<never> => Promise.reject(new Error('not called')),
    );

    expect(commands.has('adocmdForge.exportHtml')).toBe(true);
    expect(commands.has('adocmdForge.exportStandaloneHtml')).toBe(true);
    expect(commands.has('adocmdForge.exportEmbeddedHtml')).toBe(true);
    expect(commands.has('adocmdForge.exportPdf')).toBe(true);
    expect(registration.disposables).toHaveLength(6);
    for (const disposable of registration.disposables) {
      disposable.dispose();
    }
    expect((registration.provider as unknown as { disposed: boolean }).disposed).toBe(true);
  });
});
