import * as vscode from 'vscode';

import { AsciiDocCompletionProvider } from './asciidocCompletionProvider';
import { AsciiDocHoverProvider } from './asciidocHoverProvider';

const ASCII_DOC_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
  {
    language: 'asciidoc',
    scheme: 'file',
  },
  {
    language: 'asciidoc',
    scheme: 'untitled',
  },
];

export function registerAsciiDocLanguageProviders(): vscode.Disposable[] {
  const completionProvider = new AsciiDocCompletionProvider();
  const hoverProvider = new AsciiDocHoverProvider();

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
  ];
}
