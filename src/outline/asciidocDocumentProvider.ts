import * as vscode from 'vscode';

import type { DocumentAnalysis } from '../models/documentAnalysis';
import { analyzeDocument } from './outlineParser';
import {
  createAsciiDocFoldingRanges,
  createDocumentSections,
  type DocumentSection,
} from './documentStructure';

export class AsciiDocDocumentProvider
implements vscode.DocumentSymbolProvider, vscode.FoldingRangeProvider {
  public provideDocumentSymbols(
    document: vscode.TextDocument,
  ): vscode.DocumentSymbol[] {
    const analysis = analyzeAsciiDocDocument(document);
    return createDocumentSections(analysis, document.getText()).map(
      (section) => toDocumentSymbol(section),
    );
  }

  public provideFoldingRanges(
    document: vscode.TextDocument,
  ): vscode.FoldingRange[] {
    const analysis = analyzeAsciiDocDocument(document);
    return createAsciiDocFoldingRanges(analysis, document.getText()).map(
      ({ startLine, endLine, kind }) => new vscode.FoldingRange(
        startLine,
        endLine,
        kind === 'comment'
          ? vscode.FoldingRangeKind.Comment
          : vscode.FoldingRangeKind.Region,
      ),
    );
  }
}

function analyzeAsciiDocDocument(
  document: vscode.TextDocument,
): DocumentAnalysis {
  return analyzeDocument({
    documentUri: document.uri.toString(),
    kind: 'asciidoc',
    source: document.getText(),
    version: document.version,
    ...(document.uri.scheme === 'file'
      ? { sourcePath: document.uri.fsPath }
      : {}),
  });
}

function toDocumentSymbol(section: DocumentSection): vscode.DocumentSymbol {
  const symbol = new vscode.DocumentSymbol(
    section.title,
    section.anchor === undefined ? '' : `#${section.anchor}`,
    section.level === 0 ? vscode.SymbolKind.File : vscode.SymbolKind.Namespace,
    toVscodeRange(section.range),
    toVscodeRange(section.selectionRange),
  );
  symbol.children = section.children.map(toDocumentSymbol);
  return symbol;
}

function toVscodeRange(range: {
  readonly start: { readonly character: number; readonly line: number };
  readonly end: { readonly character: number; readonly line: number };
}): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  );
}
