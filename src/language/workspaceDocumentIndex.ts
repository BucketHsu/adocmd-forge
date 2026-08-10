import type {
  DocumentAnalysis,
  DocumentPosition,
  DocumentRange,
  DocumentReference,
} from '../models/documentAnalysis';
import type { DocumentKind } from '../models/documentKind';
import { analyzeDocument } from '../outline/outlineParser';
import {
  parseExplicitAnchorDefinitions,
} from '../diagnostics/linkReferenceParser';
import {
  pathsEqual,
  resolveLinkTarget,
  splitReferenceTarget,
} from '../diagnostics/linkPathPolicy';
import { createAsciiDocImageReferenceSourcePath } from './asciidocAttributes';

export interface WorkspaceDocumentInput {
  readonly documentUri: string;
  readonly filePath: string;
  readonly kind: DocumentKind;
  readonly source: string;
  readonly version: number;
}

export interface IndexedAnchorDefinition {
  readonly explicit: boolean;
  readonly id: string;
  readonly range: DocumentRange;
  readonly title?: string;
}

export interface IndexedDocument {
  readonly analysis: DocumentAnalysis;
  readonly anchors: readonly IndexedAnchorDefinition[];
  readonly documentUri: string;
  readonly filePath: string;
  readonly kind: DocumentKind;
  readonly source: string;
  readonly version: number;
}

export interface ResolvedWorkspaceReference {
  readonly definition?: IndexedAnchorDefinition;
  readonly fragment?: string;
  readonly path: string;
  readonly reference: DocumentReference;
  readonly sourceDocument: IndexedDocument;
  readonly targetDocument?: IndexedDocument;
}

export interface IndexedReferenceLocation {
  readonly document: IndexedDocument;
  readonly fragmentRange: DocumentRange;
  readonly reference: DocumentReference;
}

export interface WorkspaceAnchorTarget {
  readonly definition: IndexedAnchorDefinition;
  readonly document: IndexedDocument;
}

/**
 * 不依賴 VS Code API 的工作區文件索引。所有 Provider 共用同一份 AST 與引用
 * 結果，避免補全、定義、參照與改名各自重複解析整個工作區。
 */
export class WorkspaceDocumentIndex {
  private readonly documents = new Map<string, IndexedDocument>();
  private workspaceRoots: readonly string[];

  public constructor(workspaceRoots: readonly string[] = []) {
    this.workspaceRoots = [...workspaceRoots];
  }

  public setWorkspaceRoots(workspaceRoots: readonly string[]): void {
    this.workspaceRoots = [...workspaceRoots];
  }

  public upsert(input: WorkspaceDocumentInput): IndexedDocument {
    const analysis = analyzeDocument({
      documentUri: input.documentUri,
      kind: input.kind,
      source: input.source,
      sourcePath: input.filePath,
      version: input.version,
    });
    const explicitAnchors = parseExplicitAnchorDefinitions(
      input.source,
      input.kind,
    ).map((definition): IndexedAnchorDefinition => ({
      ...definition,
      explicit: true,
    }));
    const explicitIds = new Set(explicitAnchors.map(({ id }) => id));
    const headingAnchors = analysis.headings.flatMap(
      (heading): IndexedAnchorDefinition[] => (
        heading.anchor === undefined || explicitIds.has(heading.anchor)
          ? []
          : [{
              id: heading.anchor,
              explicit: false,
              range: heading.range,
              title: heading.title,
            }]
      ),
    );
    const document: IndexedDocument = {
      analysis,
      anchors: [...explicitAnchors, ...headingAnchors],
      documentUri: input.documentUri,
      filePath: input.filePath,
      kind: input.kind,
      source: input.source,
      version: input.version,
    };
    this.documents.set(input.documentUri, document);
    return document;
  }

  public remove(documentUri: string): void {
    this.documents.delete(documentUri);
  }

  public clear(): void {
    this.documents.clear();
  }

  public getDocuments(): readonly IndexedDocument[] {
    return [...this.documents.values()];
  }

  public getDocument(documentUri: string): IndexedDocument | undefined {
    return this.documents.get(documentUri);
  }

  public findDocumentByPath(filePath: string): IndexedDocument | undefined {
    return this.getDocuments().find((document) => (
      pathsEqual(document.filePath, filePath)
    ));
  }

  public findAnchor(
    filePath: string,
    anchor: string,
  ): WorkspaceAnchorTarget | undefined {
    const document = this.findDocumentByPath(filePath);
    if (document === undefined) {
      return undefined;
    }
    const definition = document.anchors.find(({ id }) => (
      anchorsEqual(id, anchor)
    ));
    return definition === undefined ? undefined : { document, definition };
  }

  public findTargetAt(
    documentUri: string,
    position: DocumentPosition,
  ): WorkspaceAnchorTarget | undefined {
    const document = this.documents.get(documentUri);
    if (document === undefined) {
      return undefined;
    }
    const ownAnchor = document.anchors.find(({ range }) => (
      rangeContains(range, position)
    ));
    if (ownAnchor !== undefined) {
      return { document, definition: ownAnchor };
    }

    const reference = document.analysis.references.find(({ range }) => (
      rangeContains(range, position)
    ));
    if (reference === undefined) {
      return undefined;
    }
    const resolved = this.resolveReference(documentUri, reference);
    if (
      resolved?.fragment === undefined
      || resolved.definition === undefined
      || resolved.targetDocument === undefined
    ) {
      return undefined;
    }
    return {
      document: resolved.targetDocument,
      definition: resolved.definition,
    };
  }

  public resolveReference(
    documentUri: string,
    reference: DocumentReference,
  ): ResolvedWorkspaceReference | undefined {
    const sourceDocument = this.documents.get(documentUri);
    if (sourceDocument === undefined) {
      return undefined;
    }
    const sourcePath = sourceDocument.kind === 'asciidoc'
      && reference.kind === 'image'
      ? createAsciiDocImageReferenceSourcePath(
          sourceDocument.source,
          sourceDocument.filePath,
        )
      : sourceDocument.filePath;
    const target = resolveLinkTarget(
      sourcePath,
      reference.target,
      this.workspaceRoots,
    );
    if (
      (target.kind !== 'internal' && target.kind !== 'local')
      || target.path === undefined
    ) {
      return undefined;
    }
    const targetDocument = this.findDocumentByPath(target.path);
    const definition = target.fragment === undefined
      ? undefined
      : this.findAnchor(target.path, target.fragment)?.definition;
    return {
      path: target.path,
      reference,
      sourceDocument,
      ...(target.fragment === undefined ? {} : { fragment: target.fragment }),
      ...(targetDocument === undefined ? {} : { targetDocument }),
      ...(definition === undefined ? {} : { definition }),
    };
  }

  public findReferences(
    targetPath: string,
    anchor: string,
  ): readonly IndexedReferenceLocation[] {
    const locations: IndexedReferenceLocation[] = [];
    for (const document of this.documents.values()) {
      for (const reference of document.analysis.references) {
        const resolved = this.resolveReference(document.documentUri, reference);
        if (
          resolved?.fragment === undefined
          || !pathsEqual(resolved.path, targetPath)
          || !anchorsEqual(resolved.fragment, anchor)
        ) {
          continue;
        }
        locations.push({
          document,
          reference,
          fragmentRange: createReferenceFragmentRange(reference),
        });
      }
    }
    return locations;
  }
}

export function createReferenceFragmentRange(
  reference: DocumentReference,
): DocumentRange {
  const { fragment } = splitReferenceTarget(reference.target);
  if (fragment === undefined || fragment.length === 0) {
    return reference.range;
  }
  const hashIndex = reference.target.indexOf('#');
  const rangeLength = reference.range.end.character
    - reference.range.start.character;
  const addedShorthandHash = hashIndex === 0
    && rangeLength === reference.target.length - 1;
  const offset = addedShorthandHash ? 0 : Math.max(0, hashIndex + 1);
  return {
    start: {
      line: reference.range.start.line,
      character: reference.range.start.character + offset,
    },
    end: {
      line: reference.range.start.line,
      character: reference.range.start.character + offset + fragment.length,
    },
  };
}

export function rangeContains(
  range: DocumentRange,
  position: DocumentPosition,
): boolean {
  if (position.line < range.start.line || position.line > range.end.line) {
    return false;
  }
  if (
    position.line === range.start.line
    && position.character < range.start.character
  ) {
    return false;
  }
  return position.line !== range.end.line
    || position.character < range.end.character;
}

export function anchorsEqual(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replace(/^_/u, '');
  return normalize(left) === normalize(right);
}
