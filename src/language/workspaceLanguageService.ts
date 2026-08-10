import path from 'node:path';

import * as vscode from 'vscode';

import type { DocumentKind } from '../models/documentKind';
import { pathsEqual } from '../diagnostics/linkPathPolicy';
import { resolveDocumentKind } from '../preview/previewDocument';
import { getErrorMessage } from '../utility/errorMessage';
import {
  WorkspaceDocumentIndex,
  type IndexedDocument,
} from './workspaceDocumentIndex';
import { resolveAsciiDocImageBaseDirectory } from './asciidocAttributes';

const RESOURCE_GLOB = '**/*.{adoc,asciidoc,md,txt,java,kt,ts,tsx,js,jsx,json,yml,yaml,xml,sql,properties,css,html,htm,sh,bash,ps1,rb,py,go,c,cpp,h,hpp,cs,gradle,groovy,conf,ini,csv,tsv,toml,png,jpg,jpeg,gif,webp,svg}';
const EXCLUDE_GLOB = '**/{.git,node_modules,dist,coverage,artifacts,.vscode-test}/**';
const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  '.vscode-test',
  'artifacts',
  'coverage',
  'dist',
  'node_modules',
]);
const INDEX_BATCH_SIZE = 16;
const INDEX_UPDATE_DELAY = 120;
const WORKSPACE_RESOURCE_LIMIT = 10_000;

export type WorkspaceResourceKind = 'document' | 'image' | 'include';

/** VS Code 檔案系統與純資料 WorkspaceDocumentIndex 之間的生命週期 adapter。 */
export class WorkspaceLanguageService implements vscode.Disposable {
  public readonly index = new WorkspaceDocumentIndex();
  private readonly resourceChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly catalog = new Map<string, vscode.Uri>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly updateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposed = false;
  private initialized = false;
  private initialization: Promise<void> | undefined;
  private generation = 0;
  private resourceLimitReported = false;

  public readonly onDidChangeResource = this.resourceChangeEmitter.event;

  public constructor(private readonly outputChannel?: vscode.OutputChannel) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      RESOURCE_GLOB,
      false,
      false,
      false,
    );
    this.disposables.push(
      this.resourceChangeEmitter,
      watcher,
      watcher.onDidCreate((uri) => {
        void this.refreshUri(uri);
      }),
      watcher.onDidChange((uri) => {
        void this.refreshUri(uri);
      }),
      watcher.onDidDelete((uri) => {
        this.removeUri(uri);
      }),
      vscode.workspace.onDidOpenTextDocument((document) => {
        this.updateDocument(document);
      }),
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        this.scheduleDocumentUpdate(document);
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        this.updateDocument(document);
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme !== 'untitled') {
          void this.refreshUri(document.uri);
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.reset();
        void this.ensureReady();
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        this.reset();
        void this.ensureReady();
      }),
    );
  }

  public async ensureReady(): Promise<void> {
    if (
      this.disposed
      || this.initialized
      || !vscode.workspace.isTrusted
    ) {
      return;
    }
    this.initialization ??= this.createInitialization();
    await this.initialization;
  }

  public async prepareDocument(
    document: vscode.TextDocument,
  ): Promise<IndexedDocument | undefined> {
    await this.ensureReady();
    return this.updateDocument(document);
  }

  public getResourceUris(kind: WorkspaceResourceKind): readonly vscode.Uri[] {
    const uris = [...this.catalog.values()];
    if (kind === 'document') {
      return uris.filter((uri) => resolvePathKind(uri.fsPath) !== undefined);
    }
    if (kind === 'image') {
      return uris.filter((uri) => IMAGE_EXTENSION_PATTERN.test(uri.fsPath));
    }
    return uris.filter((uri) => !IMAGE_EXTENSION_PATTERN.test(uri.fsPath));
  }

  public getUriForPath(filePath: string): vscode.Uri | undefined {
    const indexed = this.index.findDocumentByPath(filePath);
    if (indexed !== undefined) {
      return vscode.Uri.parse(indexed.documentUri);
    }
    return [...this.catalog.values()].find((uri) => pathsEqual(uri.fsPath, filePath));
  }

  public createRelativePath(
    sourceDocument: vscode.TextDocument,
    targetUri: vscode.Uri,
  ): string | undefined {
    if (
      sourceDocument.uri.scheme === 'untitled'
      || sourceDocument.uri.fsPath.length === 0
      || targetUri.fsPath.length === 0
    ) {
      return undefined;
    }
    const relative = path.relative(
      path.dirname(sourceDocument.uri.fsPath),
      targetUri.fsPath,
    ).replaceAll(path.sep, '/');
    return relative.length === 0 ? path.basename(targetUri.fsPath) : relative;
  }

  public createReferencePath(
    sourceDocument: vscode.TextDocument,
    targetUri: vscode.Uri,
    kind: WorkspaceResourceKind,
  ): string | undefined {
    if (
      sourceDocument.uri.scheme === 'untitled'
      || sourceDocument.uri.fsPath.length === 0
      || targetUri.fsPath.length === 0
    ) {
      return undefined;
    }
    const sourceDirectory = kind === 'image'
      ? resolveAsciiDocImageBaseDirectory(
          sourceDocument.getText(),
          sourceDocument.uri.fsPath,
        )
      : path.dirname(sourceDocument.uri.fsPath);
    const relative = path.relative(
      sourceDirectory,
      targetUri.fsPath,
    ).replaceAll(path.sep, '/');
    return relative.length === 0 ? path.basename(targetUri.fsPath) : relative;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const timer of this.updateTimers.values()) {
      clearTimeout(timer);
    }
    this.updateTimers.clear();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.reset();
  }

  private createInitialization(): Promise<void> {
    const generation = this.generation;
    const initialization = this.initialize(generation);
    return initialization.finally((): void => {
      if (generation === this.generation) {
        this.initialization = undefined;
      }
    });
  }

  private async initialize(generation: number): Promise<void> {
    this.updateWorkspaceRoots();
    const uris = await vscode.workspace.findFiles(
      RESOURCE_GLOB,
      EXCLUDE_GLOB,
      WORKSPACE_RESOURCE_LIMIT,
    );
    if (!this.isCurrentGeneration(generation)) {
      return;
    }
    uris.forEach((uri) => this.addCatalogUri(uri));

    const documentUris = uris.filter((uri) => (
      resolvePathKind(uri.fsPath) !== undefined
    ));
    for (let index = 0; index < documentUris.length; index += INDEX_BATCH_SIZE) {
      const batch = documentUris.slice(index, index + INDEX_BATCH_SIZE);
      await Promise.all(batch.map(async (uri): Promise<void> => {
        await this.refreshUri(uri, false, generation);
      }));
      if (!this.isCurrentGeneration(generation)) {
        return;
      }
    }
    if (uris.length === WORKSPACE_RESOURCE_LIMIT) {
      this.reportResourceLimit();
    }
    if (this.isCurrentGeneration(generation)) {
      this.initialized = true;
    }
  }

  private scheduleDocumentUpdate(document: vscode.TextDocument): void {
    if (resolveDocumentKind(document.languageId, document.fileName) === undefined) {
      return;
    }
    const key = document.uri.toString();
    const previous = this.updateTimers.get(key);
    if (previous !== undefined) {
      clearTimeout(previous);
    }
    this.updateTimers.set(key, setTimeout((): void => {
      this.updateTimers.delete(key);
      this.updateDocument(document);
    }, INDEX_UPDATE_DELAY));
  }

  private updateDocument(
    document: vscode.TextDocument,
    notify = true,
    generation = this.generation,
  ): IndexedDocument | undefined {
    const kind = resolveDocumentKind(document.languageId, document.fileName);
    if (
      this.disposed
      || generation !== this.generation
      || !vscode.workspace.isTrusted
      || kind === undefined
      || document.uri.scheme === 'untitled'
      || document.uri.fsPath.length === 0
    ) {
      return undefined;
    }
    const source = document.getText();
    const existing = this.index.getDocument(document.uri.toString());
    if (
      existing?.version === document.version
      && existing.source === source
    ) {
      return existing;
    }
    this.addCatalogUri(document.uri);
    const indexed = this.index.upsert({
      documentUri: document.uri.toString(),
      filePath: document.uri.fsPath,
      kind,
      source,
      version: document.version,
    });
    if (notify) {
      this.resourceChangeEmitter.fire(document.uri);
    }
    return indexed;
  }

  private async refreshUri(
    uri: vscode.Uri,
    notify = true,
    generation = this.generation,
  ): Promise<void> {
    if (
      !this.isCurrentGeneration(generation)
      || this.isExcludedResource(uri)
    ) {
      return;
    }
    if (!vscode.workspace.isTrusted) {
      if (notify) {
        this.resourceChangeEmitter.fire(uri);
      }
      return;
    }
    if (!this.addCatalogUri(uri)) {
      if (notify) {
        this.resourceChangeEmitter.fire(uri);
      }
      return;
    }
    const kind = resolvePathKind(uri.fsPath);
    if (kind === undefined) {
      if (notify) {
        this.resourceChangeEmitter.fire(uri);
      }
      return;
    }
    const openDocument = vscode.workspace.textDocuments.find((document) => (
      document.uri.toString() === uri.toString()
    ));
    if (openDocument !== undefined) {
      this.updateDocument(openDocument, notify, generation);
      return;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (!this.isCurrentGeneration(generation)) {
        return;
      }
      const source = new TextDecoder().decode(bytes);
      const existing = this.index.getDocument(uri.toString());
      if (existing?.source === source) {
        return;
      }
      this.index.upsert({
        documentUri: uri.toString(),
        filePath: uri.fsPath,
        kind,
        source,
        version: 0,
      });
      if (notify) {
        this.resourceChangeEmitter.fire(uri);
      }
    } catch (error) {
      const existed = this.catalog.has(uri.toString())
        || this.index.getDocument(uri.toString()) !== undefined;
      this.catalog.delete(uri.toString());
      this.index.remove(uri.toString());
      if (notify && existed && this.isCurrentGeneration(generation)) {
        this.resourceChangeEmitter.fire(uri);
      }
      this.outputChannel?.appendLine(
        `[${new Date().toISOString()}] Workspace index skipped `
        + `${uri.toString()}: ${getErrorMessage(error)}`,
      );
    }
  }

  private removeUri(uri: vscode.Uri): void {
    const key = uri.toString();
    const existed = this.catalog.has(key)
      || this.index.getDocument(key) !== undefined;
    this.catalog.delete(key);
    this.index.remove(key);
    if (existed || !this.isExcludedResource(uri)) {
      this.resourceChangeEmitter.fire(uri);
    }
  }

  private addCatalogUri(uri: vscode.Uri): boolean {
    const key = uri.toString();
    if (this.catalog.has(key)) {
      this.catalog.set(key, uri);
      return true;
    }
    if (this.catalog.size >= WORKSPACE_RESOURCE_LIMIT) {
      this.reportResourceLimit();
      return false;
    }
    this.catalog.set(key, uri);
    return true;
  }

  private reportResourceLimit(): void {
    if (this.resourceLimitReported) {
      return;
    }
    this.resourceLimitReported = true;
    this.outputChannel?.appendLine(
      `[${new Date().toISOString()}] Workspace index reached the `
      + `${String(WORKSPACE_RESOURCE_LIMIT)}-file limit.`,
    );
  }

  private isExcludedResource(uri: vscode.Uri): boolean {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (workspaceFolder === undefined) {
      return true;
    }
    const relativePath = path.posix.relative(
      workspaceFolder.uri.path,
      uri.path,
    );
    if (
      relativePath === '..'
      || relativePath.startsWith('../')
      || path.posix.isAbsolute(relativePath)
    ) {
      return true;
    }
    return relativePath.split('/').some((segment) => (
      EXCLUDED_DIRECTORY_NAMES.has(segment.toLowerCase())
    ));
  }

  private updateWorkspaceRoots(): void {
    this.index.setWorkspaceRoots(
      vscode.workspace.workspaceFolders?.map(({ uri }) => uri.fsPath) ?? [],
    );
  }

  private reset(): void {
    this.generation += 1;
    for (const timer of this.updateTimers.values()) {
      clearTimeout(timer);
    }
    this.updateTimers.clear();
    this.initialized = false;
    this.initialization = undefined;
    this.resourceLimitReported = false;
    this.catalog.clear();
    this.index.clear();
    this.updateWorkspaceRoots();
  }

  private isCurrentGeneration(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }
}

function resolvePathKind(filePath: string): DocumentKind | undefined {
  return resolveDocumentKind('', filePath);
}

const IMAGE_EXTENSION_PATTERN = /\.(?:gif|jpe?g|png|svg|webp)$/iu;
