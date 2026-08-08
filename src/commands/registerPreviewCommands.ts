import * as vscode from 'vscode';

import type { PreviewManager } from '../preview/previewManager';
import type { CommandExecutor } from './commandExecutor';

export const OPEN_PREVIEW_COMMAND = 'adocmdForge.openPreview';
export const REFRESH_PREVIEW_COMMAND = 'adocmdForge.refreshPreview';
export const PREVIEW_ONLY_COMMAND = 'adocmdForge.previewOnly';
export const PREVIEW_SOURCE_COMMAND = 'adocmdForge.previewSource';
export const PREVIEW_SPLIT_COMMAND = 'adocmdForge.previewSplit';

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
    vscode.commands.registerCommand(
      PREVIEW_SOURCE_COMMAND,
      async (): Promise<void> => {
        await commandExecutor.run(
          'Show Source Only',
          async () => previewManager.setLayout('source'),
        );
      },
    ),
    vscode.commands.registerCommand(
      PREVIEW_SPLIT_COMMAND,
      async (): Promise<void> => {
        await commandExecutor.run(
          'Show Source and Preview',
          async () => previewManager.setLayout('split'),
        );
      },
    ),
    vscode.commands.registerCommand(
      PREVIEW_ONLY_COMMAND,
      async (): Promise<void> => {
        await commandExecutor.run(
          'Show Preview Only',
          async () => previewManager.setLayout('preview'),
        );
      },
    ),
  ];
}
