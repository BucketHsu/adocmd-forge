import * as vscode from 'vscode';

import type {
  DocumentAnalysis,
  Heading,
  OutlineNode,
} from '../models/documentAnalysis';
import { DocumentAnalysisService } from '../services/documentAnalysisService';
import { getOutlineSettings } from '../settings/extensionSettings';
import { RevisionDebouncer } from '../utility/asyncDebouncer';
import { resolveDocumentKind } from '../preview/previewDocument';

export const OUTLINE_VIEW_ID = 'adocmdForge.outline';
export const REVEAL_OUTLINE_COMMAND = 'adocmdForge.revealOutline';
const OUTLINE_UPDATE_DELAY = 150;

export interface OutlineCommandExecutor {
  run(commandTitle: string, action: () => Promise<void>): Promise<void>;
}

export interface OutlineProviderOptions {
  readonly analysisService?: DocumentAnalysisService;
  readonly updateDelay?: number;
}

export interface OutlineRegistration {
  readonly provider: OutlineProvider;
  readonly treeView: vscode.TreeView<OutlineTreeItem>;
  readonly disposables: readonly vscode.Disposable[];
}

/** Outline 中代表單一標題的 TreeItem。 */
export class OutlineTreeItem extends vscode.TreeItem {
  public readonly heading: Heading;
  public readonly parent: OutlineTreeItem | undefined;
  public readonly children: readonly OutlineTreeItem[];

  public constructor(
    node: OutlineNode,
    parent: OutlineTreeItem | undefined,
  ) {
    super(
      node.title,
      node.children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    this.heading = node;
    this.parent = parent;
    this.children = node.children.map((child) => new OutlineTreeItem(child, this));
    this.id = node.id;
    this.contextValue = 'adocmdForge.outlineNode';
    this.description = `第 ${String(node.sourceLine + 1)} 行`;
    this.tooltip = `${node.title}（第 ${String(node.sourceLine + 1)} 行）`;
    this.command = {
      command: REVEAL_OUTLINE_COMMAND,
      title: '跳至標題',
      arguments: [this],
    };
  }
}

/**
 * 只維護目前 active editor 的 Outline，避免在切換文件時顯示上一份文件內容。
 */
export class OutlineProvider implements vscode.TreeDataProvider<OutlineTreeItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<OutlineTreeItem | undefined>();
  private readonly stateEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly debouncer = new RevisionDebouncer();
  private readonly analysisService: DocumentAnalysisService;
  private readonly updateDelay: number;
  private rootItems: readonly OutlineTreeItem[] = [];
  private currentDocumentUri: string | undefined;
  private currentAnalysis: DocumentAnalysis | undefined;
  private message = '請開啟 AsciiDoc 或 Markdown 文件以檢視 Outline。';
  private disposed = false;

  public readonly onDidChangeTreeData = this.changeEmitter.event;
  public readonly onDidChangeState = this.stateEmitter.event;

  public constructor(options: OutlineProviderOptions = {}) {
    this.analysisService = options.analysisService ?? new DocumentAnalysisService();
    this.updateDelay = normalizeDelay(options.updateDelay ?? OUTLINE_UPDATE_DELAY);
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.setActiveDocument(editor?.document);
      }),
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        if (document.uri.toString() === this.currentDocumentUri) {
          this.scheduleAnalysis(document);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.toString() === this.currentDocumentUri) {
          this.clearActiveDocument();
        }
      }),
    );

    this.setActiveDocument(vscode.window.activeTextEditor?.document);
  }

  public getTreeItem(element: OutlineTreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: OutlineTreeItem): OutlineTreeItem[] {
    return element === undefined
      ? [...this.rootItems]
      : [...element.children];
  }

  public getParent(element: OutlineTreeItem): OutlineTreeItem | undefined {
    return element.parent;
  }

  public getAnalysis(): DocumentAnalysis | undefined {
    return this.currentAnalysis;
  }

  public getMessage(): string {
    return this.message;
  }

  /** 供 View title 的 Refresh 命令使用。 */
  public refresh(): void {
    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument === undefined) {
      this.clearActiveDocument();
      return;
    }
    this.setActiveDocument(activeDocument);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.debouncer.dispose();
    this.changeEmitter.dispose();
    this.stateEmitter.dispose();
    this.rootItems = [];
    this.currentAnalysis = undefined;
    this.currentDocumentUri = undefined;
  }

  private setActiveDocument(document: vscode.TextDocument | undefined): void {
    if (this.disposed) {
      return;
    }

    const kind = document === undefined
      ? undefined
      : resolveDocumentKind(document.languageId, document.fileName);
    if (document === undefined || kind === undefined) {
      this.clearActiveDocument();
      return;
    }

    this.currentDocumentUri = document.uri.toString();
    this.currentAnalysis = undefined;
    this.rootItems = [];
    this.setMessage('正在分析目前文件的標題…');
    this.fireTreeChange();
    this.scheduleAnalysis(document, kind);
  }

  private clearActiveDocument(): void {
    if (this.disposed) {
      return;
    }
    this.debouncer.invalidate();
    this.currentDocumentUri = undefined;
    this.currentAnalysis = undefined;
    this.rootItems = [];
    this.setMessage('請開啟 AsciiDoc 或 Markdown 文件以檢視 Outline。');
    this.fireTreeChange();
  }

  private scheduleAnalysis(
    document: vscode.TextDocument,
    knownKind?: 'asciidoc' | 'markdown',
  ): void {
    if (this.disposed) {
      return;
    }

    const kind = knownKind ?? resolveDocumentKind(document.languageId, document.fileName);
    if (kind === undefined) {
      this.clearActiveDocument();
      return;
    }

    const documentUri = document.uri.toString();
    this.debouncer.schedule(this.updateDelay, (revision): void => {
      if (
        !this.debouncer.isCurrent(revision)
        || this.currentDocumentUri !== documentUri
      ) {
        return;
      }

      const analysis = this.analysisService.analyze({
        documentUri,
        kind,
        source: document.getText(),
        version: document.version,
        ...(document.uri.scheme === 'file' ? { sourcePath: document.uri.fsPath } : {}),
      });
      if (!this.debouncer.isCurrent(revision)) {
        return;
      }

      this.currentAnalysis = analysis;
      this.rootItems = analysis.outline.map((node) => new OutlineTreeItem(node, undefined));
      this.setMessage(createOutlineMessage(analysis));
      this.fireTreeChange();
    });
  }

  private setMessage(message: string | undefined): void {
    if (this.message === message) {
      return;
    }
    this.message = message ?? '';
    this.stateEmitter.fire();
  }

  private fireTreeChange(): void {
    this.changeEmitter.fire(undefined);
  }
}

export function registerOutlineProvider(
  commandExecutor: OutlineCommandExecutor,
): OutlineRegistration {
  const provider = new OutlineProvider({
    updateDelay: getOutlineSettings().updateDelay,
  });
  const treeView = vscode.window.createTreeView(OUTLINE_VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  const stateSubscription = provider.onDidChangeState(() => {
    treeView.message = provider.getMessage();
  });
  treeView.message = provider.getMessage();

  const revealCommand = vscode.commands.registerCommand(
    REVEAL_OUTLINE_COMMAND,
    async (value: unknown): Promise<void> => {
      await commandExecutor.run('跳至 Outline 標題', async (): Promise<void> => {
        await revealOutlineItem(value);
      });
    },
  );

  const refreshCommand = vscode.commands.registerCommand(
    'adocmdForge.refreshOutline',
    (): void => {
      provider.refresh();
    },
  );

  return {
    provider,
    treeView,
    disposables: [provider, treeView, stateSubscription, revealCommand, refreshCommand],
  };
}

async function revealOutlineItem(value: unknown): Promise<void> {
  if (!(value instanceof OutlineTreeItem)) {
    throw new Error('無法識別要跳轉的 Outline 節點。');
  }

  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(value.heading.documentUri),
    );
  } catch (error) {
    throw new Error(`無法開啟 Outline 文件：${getErrorMessage(error)}`);
  }

  const editor = await vscode.window.showTextDocument(document, {
    preserveFocus: false,
  });
  const position = new vscode.Position(
    value.heading.range.start.line,
    value.heading.range.start.character,
  );
  const range = new vscode.Range(
    position,
    new vscode.Position(
      value.heading.range.end.line,
      value.heading.range.end.character,
    ),
  );
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function createOutlineMessage(analysis: DocumentAnalysis): string | undefined {
  if (analysis.error !== undefined) {
    return `Outline 無法解析目前文件：${analysis.error}`;
  }
  return analysis.headings.length === 0 ? '目前文件沒有標題。' : undefined;
}

function normalizeDelay(value: number): number {
  return Number.isFinite(value) ? Math.min(2_000, Math.max(50, Math.round(value))) : OUTLINE_UPDATE_DELAY;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : String(error);
}
