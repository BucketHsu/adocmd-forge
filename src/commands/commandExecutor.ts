import * as vscode from 'vscode';

import { getErrorMessage } from '../utility/errorMessage';

export class CommandExecutor {
  public constructor(private readonly outputChannel: vscode.OutputChannel) {}

  public async run(
    commandTitle: string,
    action: () => Promise<void>,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      if (error instanceof vscode.CancellationError) {
        return;
      }

      const message = getErrorMessage(error);
      this.outputChannel.appendLine(
        `[${new Date().toISOString()}] ${commandTitle}: ${message}`,
      );
      await vscode.window.showErrorMessage(`${commandTitle} failed: ${message}`);
    }
  }
}
