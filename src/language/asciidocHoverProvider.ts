import * as vscode from 'vscode';

import { getAsciiDocHoverInfo } from './asciidocHover';

export class AsciiDocHoverProvider implements vscode.HoverProvider {
  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const lineText = document.lineAt(position.line).text;
    const hoverInfo = getAsciiDocHoverInfo({
      languageId: document.languageId,
      lineText,
      character: position.character,
    });

    if (hoverInfo === undefined) {
      return undefined;
    }

    const markdown = new vscode.MarkdownString(hoverInfo.markdown);
    markdown.isTrusted = false;
    const range = new vscode.Range(
      position.line,
      hoverInfo.start,
      position.line,
      hoverInfo.end,
    );
    return new vscode.Hover(markdown, range);
  }
}
