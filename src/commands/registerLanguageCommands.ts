import * as vscode from 'vscode';

import { ASCIIDOC_SYNTAX_GUIDE } from '../language/asciidocSyntaxGuide';
import type { CommandExecutor } from './commandExecutor';

export const OPEN_SYNTAX_GUIDE_COMMAND = 'adocmdForge.openSyntaxGuide';

export function registerLanguageCommands(
  commandExecutor: CommandExecutor,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      OPEN_SYNTAX_GUIDE_COMMAND,
      async (): Promise<void> => {
        await commandExecutor.run(
          'Open AsciiDoc Syntax Guide',
          openAsciiDocSyntaxGuide,
        );
      },
    ),
  ];
}

async function openAsciiDocSyntaxGuide(): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    content: ASCIIDOC_SYNTAX_GUIDE,
    language: 'asciidoc',
  });
  await vscode.window.showTextDocument(document, {
    preview: false,
  });
}
