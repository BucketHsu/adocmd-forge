import path from 'node:path';

import * as vscode from 'vscode';

import { getImageSettings } from '../settings/extensionSettings';
import { ImageDropProvider } from './imageDropProvider';
import { ImageService } from './imageService';
import type {
  ImageDocumentContext,
  ImageFileSystem,
  ImageOperation,
  ImageTargetPicker,
} from './imageTypes';
import { ImageWorkflowError } from './imageService';

export const COPY_IMAGE_COMMAND = 'adocmdForge.copyImage';

export interface ImageProviderRegistration {
  readonly disposables: readonly vscode.Disposable[];
  readonly dropProviderRegistered: true;
  readonly pasteProviderRegistered: true;
}

const IMAGE_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
  { language: 'asciidoc', scheme: 'file' },
  { language: 'asciidoc', scheme: 'untitled' },
  { language: 'markdown', scheme: 'file' },
  { language: 'markdown', scheme: 'untitled' },
];

const IMAGE_FILTERS = {
  Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
};

export function registerImageProviders(
  commandExecutor: {
    run(commandTitle: string, action: () => Promise<void>): Promise<void>;
  },
): ImageProviderRegistration {
  const fileSystem = new VscodeImageFileSystem();
  const targetPicker = new VscodeImageTargetPicker();
  const readUri = createTransferUriReader(fileSystem);
  const dropProvider: vscode.DocumentDropEditProvider = {
    provideDocumentDropEdits: async (
      document,
      _position,
      dataTransfer,
      token,
    ): Promise<vscode.DocumentDropEdit | undefined> => {
      try {
        const service = createImageService(
          document,
          fileSystem,
          targetPicker,
        );
        const provider = new ImageDropProvider(service, readUri);
        const operation = await provider.prepare(
          createDocumentContext(document),
          toImageTransfer(dataTransfer),
          token,
        );
        if (operation === undefined) {
          return undefined;
        }

        const workspaceEdit = await createImageWorkspaceEdit(
          fileSystem,
          operation,
        );

        const dropEdit = new vscode.DocumentDropEdit(operation.syntax);
        dropEdit.additionalEdit = workspaceEdit;
        return dropEdit;
      } catch (error) {
        await showImageError(error);
        return undefined;
      }
    },
  };

  const pasteProvider: vscode.DocumentPasteEditProvider = {
    provideDocumentPasteEdits: async (
      document,
      _ranges,
      dataTransfer,
      _pasteContext,
      token,
    ): Promise<vscode.DocumentPasteEdit[] | undefined> => {
      try {
        const service = createImageService(
          document,
          fileSystem,
          targetPicker,
        );
        const provider = new ImageDropProvider(service, readUri);
        const operation = await provider.prepare(
          createDocumentContext(document),
          toImageTransfer(dataTransfer),
          token,
        );
        if (operation === undefined) {
          return undefined;
        }

        const workspaceEdit = await createImageWorkspaceEdit(
          fileSystem,
          operation,
        );
        const pasteEdit = new vscode.DocumentPasteEdit(
          operation.syntax,
          'Insert image syntax',
          vscode.DocumentDropOrPasteEditKind.Text,
        );
        pasteEdit.additionalEdit = workspaceEdit;
        return [pasteEdit];
      } catch (error) {
        await showImageError(error);
        return undefined;
      }
    },
  };

  const disposables = [
    vscode.languages.registerDocumentDropEditProvider(
      IMAGE_DOCUMENT_SELECTOR,
      dropProvider,
      {
        dropMimeTypes: ['image/*', 'files', 'text/uri-list'],
        providedDropEditKinds: [vscode.DocumentDropOrPasteEditKind.Text],
      },
    ),
    vscode.languages.registerDocumentPasteEditProvider(
      IMAGE_DOCUMENT_SELECTOR,
      pasteProvider,
      {
        pasteMimeTypes: ['image/*', 'files', 'text/uri-list'],
        providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Text],
      },
    ),
    vscode.commands.registerCommand(
      COPY_IMAGE_COMMAND,
      async (): Promise<void> => {
        await commandExecutor.run('Copy Image', async (): Promise<void> => {
          await copyImageFromFilePicker(fileSystem, targetPicker);
        });
      },
    ),
  ];

  return {
    disposables,
    dropProviderRegistered: true,
    pasteProviderRegistered: true,
  };
}

async function createImageWorkspaceEdit(
  fileSystem: ImageFileSystem,
  operation: ImageOperation,
): Promise<vscode.WorkspaceEdit> {
  await fileSystem.createDirectory(path.posix.dirname(operation.targetPath));
  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.createFile(
    vscode.Uri.file(operation.targetPath),
    {
      overwrite: false,
      contents: operation.data,
    },
  );
  return workspaceEdit;
}

async function copyImageFromFilePicker(
  fileSystem: ImageFileSystem,
  targetPicker: ImageTargetPicker,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined || !isSupportedLanguage(editor.document.languageId)) {
    throw new ImageWorkflowError('請在 AsciiDoc 或 Markdown 編輯器中執行 Copy Image。');
  }

  const sourceUris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: true,
    canSelectFolders: false,
    openLabel: '選擇圖片',
    filters: IMAGE_FILTERS,
  });
  const sourceUri = sourceUris?.[0];
  if (sourceUri === undefined) {
    return;
  }

  const context = createDocumentContext(editor.document);
  const service = createImageService(editor.document, fileSystem, targetPicker);
  const source = await service.readSource(context, sourceUri.fsPath);
  const operation = await service.prepare(context, source);
  if (operation === undefined) {
    return;
  }

  await service.save(operation);
  const inserted = await editor.edit((editBuilder): void => {
    editBuilder.insert(editor.selection.active, operation.syntax);
  });
  if (!inserted) {
    await service.remove(operation);
    throw new ImageWorkflowError('圖片已儲存，但插入文件語法失敗；已清理圖片檔案。');
  }
}

function createImageService(
  document: vscode.TextDocument,
  fileSystem: ImageFileSystem,
  targetPicker: ImageTargetPicker,
): ImageService {
  return new ImageService(
    fileSystem,
    targetPicker,
    getImageSettings(document.uri),
  );
}

function createDocumentContext(
  document: vscode.TextDocument,
): ImageDocumentContext {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  return {
    documentPath: document.uri.scheme === 'file'
      ? document.uri.fsPath
      : undefined,
    workspaceRootPath: workspaceFolder?.uri.fsPath,
    language: document.languageId === 'asciidoc' ? 'asciidoc' : 'markdown',
    isTrusted: vscode.workspace.isTrusted,
  };
}

function isSupportedLanguage(languageId: string): boolean {
  return languageId === 'asciidoc' || languageId === 'markdown';
}

function toImageTransfer(dataTransfer: vscode.DataTransfer): import('./imageDataTransfer').ImageTransfer {
  return {
    get: (mimeType: string): import('./imageDataTransfer').ImageTransferItem | undefined => {
      const item = dataTransfer.get(mimeType);
      if (item === undefined) {
        return undefined;
      }

      const file = item.asFile();
      return {
        asFile: (): import('./imageDataTransfer').ImageTransferFile | undefined => (
          file === undefined
            ? undefined
            : {
              name: file.name,
              data: async (): Promise<Uint8Array> => file.data(),
            }
        ),
        asString: async (): Promise<string> => item.asString(),
      };
    },
    entries: (): Iterable<readonly [string, import('./imageDataTransfer').ImageTransferItem]> => (
      [...dataTransfer].map(([mimeType, item]) => {
        const file = item.asFile();
        return [mimeType, {
          asFile: (): import('./imageDataTransfer').ImageTransferFile | undefined => (
            file === undefined
              ? undefined
              : {
                name: file.name,
                data: async (): Promise<Uint8Array> => file.data(),
              }
          ),
          asString: async (): Promise<string> => item.asString(),
        }] as const;
      })
    ),
  };
}

function createTransferUriReader(
  fileSystem: ImageFileSystem,
): (uri: string) => Promise<{ readonly name: string; readonly data: Uint8Array } | undefined> {
  return async (uriString: string) => {
    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(uriString);
    } catch {
      return undefined;
    }

    if (uri.scheme !== 'file') {
      return undefined;
    }

    return {
      name: path.basename(uri.fsPath),
      data: await fileSystem.readFile(uri.fsPath),
    };
  };
}

class VscodeImageFileSystem implements ImageFileSystem {
  public async exists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch (error) {
      if (isFileNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  public async createDirectory(directoryPath: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(directoryPath));
  }

  public async writeFile(filePath: string, data: Uint8Array): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), data);
  }

  public async deleteFile(filePath: string): Promise<void> {
    await vscode.workspace.fs.delete(vscode.Uri.file(filePath), {
      useTrash: false,
      recursive: false,
    });
  }

  public async readFile(filePath: string): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  }
}

class VscodeImageTargetPicker implements ImageTargetPicker {
  public async pick(
    defaultPath: string,
    suggestedName: string,
  ): Promise<string | undefined> {
    const selected = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(defaultPath),
      saveLabel: '儲存圖片',
      title: `儲存圖片（建議檔名：${suggestedName}）`,
      filters: IMAGE_FILTERS,
    });
    return selected?.fsPath;
  }
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError
    && error.code === 'FileNotFound';
}

async function showImageError(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : '圖片處理失敗。';
  await vscode.window.showErrorMessage(`圖片處理失敗：${message}`);
}
