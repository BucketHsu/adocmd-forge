import * as vscode from 'vscode';

import type {
  DocumentRange,
  DocumentReference,
} from '../models/documentAnalysis';
import {
  isExternalTarget,
  splitReferenceTarget,
} from '../diagnostics/linkPathPolicy';
import { LINK_DIAGNOSTIC_COLLECTION_NAME } from '../diagnostics/linkDiagnosticProvider';
import {
  anchorsEqual,
  createReferenceFragmentRange,
  rangeContains,
  type IndexedDocument,
  type WorkspaceAnchorTarget,
} from './workspaceDocumentIndex';
import {
  getAsciiDocReferenceCompletionContext,
  type AsciiDocReferenceCompletionContext,
} from './asciidocReferenceContext';
import {
  WorkspaceLanguageService,
  type WorkspaceResourceKind,
} from './workspaceLanguageService';
import {
  rankQuickFixCandidates,
  replaceReferencePath,
} from './linkQuickFix';

export class AsciiDocWorkspaceCompletionProvider
implements vscode.CompletionItemProvider {
  public constructor(private readonly service: WorkspaceLanguageService) {}

  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.CompletionItem[]> {
    const context = getAsciiDocReferenceCompletionContext(
      document.lineAt(position.line).text,
      position.character,
    );
    if (context === undefined || isCancelled(token)) {
      return [];
    }
    const indexedDocument = await this.service.prepareDocument(document);
    if (indexedDocument === undefined || isCancelled(token)) {
      return [];
    }

    const range = new vscode.Range(
      position.line,
      context.replacementStart,
      position.line,
      context.replacementEnd,
    );
    return context.kind === 'xref'
      ? this.createXrefItems(document, indexedDocument, context, range)
      : this.createPathItems(
          document,
          context,
          range,
          context.kind === 'image' ? 'image' : 'include',
        );
  }

  private createXrefItems(
    document: vscode.TextDocument,
    indexedDocument: IndexedDocument,
    context: AsciiDocReferenceCompletionContext,
    range: vscode.Range,
  ): vscode.CompletionItem[] {
    const hashIndex = context.target.indexOf('#');
    const pathPart = hashIndex < 0 ? context.target : context.target.slice(0, hashIndex);
    const fragmentPrefix = hashIndex < 0
      ? context.shorthand ? context.target : ''
      : context.target.slice(hashIndex + 1);
    const anchorDocument = pathPart.length === 0 || context.shorthand
      ? indexedDocument
      : this.findDocumentByRelativePath(document, pathPart);
    const anchorItems = anchorDocument === undefined
      ? []
      : anchorDocument.anchors
          .filter(({ id }) => id.startsWith(fragmentPrefix))
          .map(({ id, title }) => {
            const item = new vscode.CompletionItem(
              id,
              vscode.CompletionItemKind.Reference,
            );
            item.detail = title === undefined
              ? 'AsciiDoc Anchor'
              : `AsciiDoc Anchor — ${title}`;
            item.insertText = context.shorthand
              ? id
              : `${pathPart}#${id}`;
            item.range = range;
            item.sortText = `0-${id}`;
            return item;
          });

    if (hashIndex >= 0 || context.shorthand) {
      return anchorItems;
    }
    return [
      ...anchorItems,
      ...this.createPathItems(document, context, range, 'document'),
    ];
  }

  private createPathItems(
    document: vscode.TextDocument,
    context: AsciiDocReferenceCompletionContext,
    range: vscode.Range,
    resourceKind: WorkspaceResourceKind,
  ): vscode.CompletionItem[] {
    const seen = new Set<string>();
    return this.service.getResourceUris(resourceKind).flatMap((uri) => {
      const relativePath = this.service.createReferencePath(
        document,
        uri,
        resourceKind,
      );
      if (
        relativePath === undefined
        || seen.has(relativePath)
        || !matchesPathPrefix(relativePath, context.target)
      ) {
        return [];
      }
      seen.add(relativePath);
      const item = new vscode.CompletionItem(
        relativePath,
        resourceKind === 'image'
          ? vscode.CompletionItemKind.File
          : vscode.CompletionItemKind.Reference,
      );
      item.detail = resourceKind === 'image'
        ? 'Workspace image'
        : resourceKind === 'include'
          ? 'Workspace include target'
          : 'Workspace document';
      item.insertText = relativePath;
      item.filterText = relativePath;
      item.range = range;
      item.sortText = `1-${relativePath}`;
      return [item];
    });
  }

  private findDocumentByRelativePath(
    sourceDocument: vscode.TextDocument,
    relativePath: string,
  ): IndexedDocument | undefined {
    return this.service.index.getDocuments().find((candidate) => {
      const uri = this.service.getUriForPath(candidate.filePath);
      return uri !== undefined
        && this.service.createRelativePath(sourceDocument, uri) === relativePath;
    });
  }
}

export class AsciiDocDefinitionProvider implements vscode.DefinitionProvider {
  public constructor(private readonly service: WorkspaceLanguageService) {}

  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location | undefined> {
    const indexed = await this.service.prepareDocument(document);
    if (indexed === undefined || isCancelled(token)) {
      return undefined;
    }
    const reference = findReferenceAt(indexed, position);
    if (reference === undefined) {
      return undefined;
    }
    const resolved = this.service.index.resolveReference(
      indexed.documentUri,
      reference,
    );
    if (resolved === undefined) {
      return undefined;
    }
    const targetUri = resolved.targetDocument === undefined
      ? this.service.getUriForPath(resolved.path)
      : vscode.Uri.parse(resolved.targetDocument.documentUri);
    if (targetUri === undefined) {
      return undefined;
    }
    return new vscode.Location(
      targetUri,
      resolved.definition === undefined
        ? new vscode.Position(0, 0)
        : toVscodeRange(resolved.definition.range),
    );
  }
}

export class AsciiDocDocumentLinkProvider implements vscode.DocumentLinkProvider {
  public constructor(private readonly service: WorkspaceLanguageService) {}

  public async provideDocumentLinks(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.DocumentLink[]> {
    const indexed = await this.service.prepareDocument(document);
    if (indexed === undefined || isCancelled(token)) {
      return [];
    }
    return indexed.analysis.references.flatMap((reference) => {
      if (isExternalTarget(reference.target)) {
        const link = new vscode.DocumentLink(
          toVscodeRange(reference.range),
          vscode.Uri.parse(reference.target),
        );
        link.tooltip = 'Open external link';
        return [link];
      }
      const resolved = this.service.index.resolveReference(
        indexed.documentUri,
        reference,
      );
      if (resolved === undefined) {
        return [];
      }
      const uri = resolved.targetDocument === undefined
        ? this.service.getUriForPath(resolved.path)
        : vscode.Uri.parse(resolved.targetDocument.documentUri);
      if (uri === undefined) {
        return [];
      }
      const link = new vscode.DocumentLink(
        toVscodeRange(reference.range),
        resolved.fragment === undefined
          ? uri
          : uri.with({ fragment: resolved.fragment }),
      );
      link.tooltip = 'Open referenced file or Anchor';
      return [link];
    });
  }
}

export class AsciiDocReferenceProvider implements vscode.ReferenceProvider {
  public constructor(private readonly service: WorkspaceLanguageService) {}

  public async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location[]> {
    const indexed = await this.service.prepareDocument(document);
    if (indexed === undefined || isCancelled(token)) {
      return [];
    }
    const target = this.service.index.findTargetAt(
      indexed.documentUri,
      toDocumentPosition(position),
    );
    if (target === undefined) {
      return [];
    }
    const references = this.service.index.findReferences(
      target.document.filePath,
      target.definition.id,
    ).map(({ document: source, fragmentRange }) => new vscode.Location(
      vscode.Uri.parse(source.documentUri),
      toVscodeRange(fragmentRange),
    ));
    if (context.includeDeclaration) {
      references.unshift(new vscode.Location(
        vscode.Uri.parse(target.document.documentUri),
        toVscodeRange(target.definition.range),
      ));
    }
    return references;
  }
}

export class AsciiDocRenameProvider implements vscode.RenameProvider {
  public constructor(private readonly service: WorkspaceLanguageService) {}

  public async prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<{ readonly placeholder: string; readonly range: vscode.Range } | undefined> {
    const context = await this.getRenameContext(document, position, token);
    return context === undefined
      ? undefined
      : {
          range: toVscodeRange(context.renameRange),
          placeholder: context.target.definition.id,
        };
  }

  public async provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string,
    token: vscode.CancellationToken,
  ): Promise<vscode.WorkspaceEdit | undefined> {
    if (!isValidAnchorName(newName)) {
      throw new Error('Anchor 名稱只能包含文字、數字、底線、句點、冒號或連字號。');
    }
    const context = await this.getRenameContext(document, position, token);
    if (context === undefined) {
      return undefined;
    }
    if (context.target.document.anchors.some((anchor) => (
      anchor !== context.target.definition
      && anchorsEqual(anchor.id, newName)
    ))) {
      throw new Error(`Anchor「${newName}」已存在於目標文件。`);
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      vscode.Uri.parse(context.target.document.documentUri),
      toVscodeRange(context.target.definition.range),
      newName,
    );
    for (const reference of this.service.index.findReferences(
      context.target.document.filePath,
      context.target.definition.id,
    )) {
      edit.replace(
        vscode.Uri.parse(reference.document.documentUri),
        toVscodeRange(reference.fragmentRange),
        newName,
      );
    }
    return edit;
  }

  private async getRenameContext(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<RenameContext | undefined> {
    const indexed = await this.service.prepareDocument(document);
    if (indexed === undefined || isCancelled(token)) {
      return undefined;
    }
    const target = this.service.index.findTargetAt(
      indexed.documentUri,
      toDocumentPosition(position),
    );
    if (target === undefined) {
      return undefined;
    }
    if (!target.definition.explicit) {
      throw new Error('自動產生的標題 Anchor 無法安全改名；請先宣告明確 Anchor。');
    }
    const ownDefinition = indexed.documentUri === target.document.documentUri
      && rangeContains(target.definition.range, toDocumentPosition(position));
    if (ownDefinition) {
      return {
        target,
        renameRange: target.definition.range,
      };
    }
    const reference = findReferenceAt(indexed, position);
    return reference === undefined
      ? undefined
      : {
          target,
          renameRange: createReferenceFragmentRange(reference),
        };
  }
}

export class AsciiDocLinkCodeActionProvider
implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  public constructor(private readonly service: WorkspaceLanguageService) {}

  public async provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeAction[]> {
    const diagnostics = context.diagnostics.filter((diagnostic) => (
      diagnostic.source === LINK_DIAGNOSTIC_COLLECTION_NAME
    ));
    if (diagnostics.length === 0 || isCancelled(token)) {
      return [];
    }
    const indexed = await this.service.prepareDocument(document);
    if (indexed === undefined || isCancelled(token)) {
      return [];
    }

    return diagnostics.flatMap((diagnostic) => {
      const reference = findReferenceAt(indexed, diagnostic.range.start);
      if (reference === undefined) {
        return [];
      }
      const code = readDiagnosticCode(diagnostic);
      if (code === 'missing-anchor') {
        return this.createAnchorActions(document, indexed, reference, diagnostic);
      }
      if (code === 'missing-file') {
        return this.createPathActions(document, reference, diagnostic);
      }
      return [];
    });
  }

  private createAnchorActions(
    document: vscode.TextDocument,
    indexed: IndexedDocument,
    reference: DocumentReference,
    diagnostic: vscode.Diagnostic,
  ): vscode.CodeAction[] {
    const resolved = this.service.index.resolveReference(
      indexed.documentUri,
      reference,
    );
    if (resolved?.targetDocument === undefined) {
      return [];
    }
    const currentFragment = splitReferenceTarget(reference.target).fragment ?? '';
    const candidates = rankQuickFixCandidates(
      resolved.targetDocument.anchors.map(({ id }) => id),
      currentFragment,
    );
    return candidates.map((anchor, index) => createReplacementAction({
      diagnostic,
      documentUri: document.uri,
      isPreferred: index === 0,
      range: toVscodeRange(createReferenceFragmentRange(reference)),
      replacement: anchor,
      title: `將 Anchor 改為 #${anchor}`,
    }));
  }

  private createPathActions(
    document: vscode.TextDocument,
    reference: DocumentReference,
    diagnostic: vscode.Diagnostic,
  ): vscode.CodeAction[] {
    const resourceKind = getReferenceResourceKind(reference);
    const candidates = this.service.getResourceUris(resourceKind).flatMap((uri) => {
      const relativePath = this.service.createReferencePath(
        document,
        uri,
        resourceKind,
      );
      return relativePath === undefined ? [] : [relativePath];
    });
    const currentPath = splitReferenceTarget(reference.target).path;
    return rankQuickFixCandidates(candidates, currentPath).map(
      (candidate, index) => createReplacementAction({
        diagnostic,
        documentUri: document.uri,
        isPreferred: index === 0,
        range: toVscodeRange(reference.range),
        replacement: replaceReferencePath(reference.target, candidate),
        title: `將路徑改為 ${candidate}`,
      }),
    );
  }
}

export function registerAsciiDocWorkspaceProviders(
  selector: vscode.DocumentSelector,
  service: WorkspaceLanguageService,
): vscode.Disposable[] {
  const completion = new AsciiDocWorkspaceCompletionProvider(service);
  const definition = new AsciiDocDefinitionProvider(service);
  const documentLink = new AsciiDocDocumentLinkProvider(service);
  const reference = new AsciiDocReferenceProvider(service);
  const rename = new AsciiDocRenameProvider(service);
  const codeAction = new AsciiDocLinkCodeActionProvider(service);
  return [
    vscode.languages.registerCompletionItemProvider(
      selector,
      completion,
      '/',
      '#',
    ),
    vscode.languages.registerDefinitionProvider(selector, definition),
    vscode.languages.registerDocumentLinkProvider(selector, documentLink),
    vscode.languages.registerReferenceProvider(selector, reference),
    vscode.languages.registerRenameProvider(selector, rename),
    vscode.languages.registerCodeActionsProvider(selector, codeAction, {
      providedCodeActionKinds: AsciiDocLinkCodeActionProvider.providedCodeActionKinds,
    }),
  ];
}

interface RenameContext {
  readonly renameRange: DocumentRange;
  readonly target: WorkspaceAnchorTarget;
}

function findReferenceAt(
  document: IndexedDocument,
  position: vscode.Position,
): DocumentReference | undefined {
  const documentPosition = toDocumentPosition(position);
  return document.analysis.references.find(({ range }) => (
    rangeContains(range, documentPosition)
  ));
}

function toDocumentPosition(position: vscode.Position): {
  readonly character: number;
  readonly line: number;
} {
  return { line: position.line, character: position.character };
}

function toVscodeRange(range: DocumentRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  );
}

function matchesPathPrefix(candidate: string, target: string): boolean {
  return target.length === 0
    || candidate.toLocaleLowerCase().includes(target.toLocaleLowerCase());
}

function isValidAnchorName(value: string): boolean {
  return value.length > 0 && /^[\p{L}\p{N}_.:-]+$/u.test(value);
}

function getReferenceResourceKind(
  reference: DocumentReference,
): WorkspaceResourceKind {
  if (reference.kind === 'image') {
    return 'image';
  }
  return reference.kind === 'xref' ? 'document' : 'include';
}

function readDiagnosticCode(diagnostic: vscode.Diagnostic): string | undefined {
  if (typeof diagnostic.code === 'string') {
    return diagnostic.code;
  }
  return typeof diagnostic.code === 'object'
    ? String(diagnostic.code.value)
    : undefined;
}

interface ReplacementActionInput {
  readonly diagnostic: vscode.Diagnostic;
  readonly documentUri: vscode.Uri;
  readonly isPreferred: boolean;
  readonly range: vscode.Range;
  readonly replacement: string;
  readonly title: string;
}

function createReplacementAction(
  input: ReplacementActionInput,
): vscode.CodeAction {
  const action = new vscode.CodeAction(input.title, vscode.CodeActionKind.QuickFix);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(input.documentUri, input.range, input.replacement);
  action.edit = edit;
  action.diagnostics = [input.diagnostic];
  action.isPreferred = input.isPreferred;
  return action;
}

function isCancelled(token: vscode.CancellationToken): boolean {
  return token.isCancellationRequested;
}
