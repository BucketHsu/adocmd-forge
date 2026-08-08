import * as vscode from 'vscode';

import {
  getAsciiDocCompletionSuggestions,
} from './asciidocCompletion';

export class AsciiDocCompletionProvider
implements vscode.CompletionItemProvider {
  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const lineText = document.lineAt(position.line).text;
    const suggestions = getAsciiDocCompletionSuggestions({
      languageId: document.languageId,
      lineText,
      character: position.character,
    });

    return suggestions.map(({ entry, replacementStart, replacementEnd }) => {
      const item = new vscode.CompletionItem(
        entry.label,
        vscode.CompletionItemKind.Snippet,
      );
      item.detail = entry.detail;
      item.documentation = new vscode.MarkdownString(entry.documentation);
      item.insertText = new vscode.SnippetString(entry.insertText);
      item.range = new vscode.Range(
        position.line,
        replacementStart,
        position.line,
        replacementEnd,
      );
      item.sortText = entry.id;
      return item;
    });
  }
}
