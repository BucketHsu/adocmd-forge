import * as vscode from 'vscode';

import { AsciiDocCompletionProvider } from './asciidocCompletionProvider';
import { AsciiDocHoverProvider } from './asciidocHoverProvider';
import { AsciiDocDocumentProvider } from '../outline/asciidocDocumentProvider';
import {
  registerAsciiDocWorkspaceProviders,
} from './asciidocWorkspaceProviders';
import type { WorkspaceLanguageService } from './workspaceLanguageService';

export const ASCII_DOC_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
  {
    language: 'asciidoc',
    scheme: 'file',
  },
  {
    language: 'asciidoc',
    scheme: 'untitled',
  },
];

export function registerAsciiDocLanguageProviders(
  workspaceService?: WorkspaceLanguageService,
): vscode.Disposable[] {
  const completionProvider = new AsciiDocCompletionProvider();
  const hoverProvider = new AsciiDocHoverProvider();
  const documentProvider = new AsciiDocDocumentProvider();

  return [
    vscode.languages.registerCompletionItemProvider(
      ASCII_DOC_DOCUMENT_SELECTOR,
      completionProvider,
      '=',
      '*',
      '_',
      '`',
      '[',
      ':',
      '<',
    ),
    vscode.languages.registerHoverProvider(
      ASCII_DOC_DOCUMENT_SELECTOR,
      hoverProvider,
    ),
    vscode.languages.registerDocumentSymbolProvider(
      ASCII_DOC_DOCUMENT_SELECTOR,
      documentProvider,
    ),
    vscode.languages.registerFoldingRangeProvider(
      ASCII_DOC_DOCUMENT_SELECTOR,
      documentProvider,
    ),
    ...(workspaceService === undefined
      ? []
      : registerAsciiDocWorkspaceProviders(
          ASCII_DOC_DOCUMENT_SELECTOR,
          workspaceService,
        )),
  ];
}
