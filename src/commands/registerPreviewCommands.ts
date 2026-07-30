import * as vscode from 'vscode';

import type { PreviewManager } from '../preview/previewManager';
import type { CommandExecutor } from './commandExecutor';

export const OPEN_PREVIEW_COMMAND = 'adocmdForge.openPreview';
export const REFRESH_PREVIEW_COMMAND = 'adocmdForge.refreshPreview';

export function registerPreviewCommands(
  previewManager: PreviewManager,
  commandExecutor: CommandExecutor,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      OPEN_PREVIEW_COMMAND,
      async (resource?: vscode.Uri): Promise<void> => {
        await commandExecutor.run(
          'Open Preview',
          async () => previewManager.openPreview(resource),
        );
      },
    ),
    vscode.commands.registerCommand(
      REFRESH_PREVIEW_COMMAND,
      async (): Promise<void> => {
        await commandExecutor.run(
          'Refresh Preview',
          async () => previewManager.refreshPreview(),
        );
      },
    ),
  ];
}
