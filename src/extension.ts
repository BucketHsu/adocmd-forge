import path from 'node:path';

import * as vscode from 'vscode';

import { CommandExecutor } from './commands/commandExecutor';
import { registerLanguageCommands } from './commands/registerLanguageCommands';
import { registerFormattingCommands } from './commands/registerFormattingCommands';
import { registerPreviewCommands } from './commands/registerPreviewCommands';
import {
  registerLinkDiagnostics,
  type LinkDiagnosticRegistration,
} from './diagnostics/linkDiagnosticProvider';
import {
  registerImageProviders,
  type ImageProviderRegistration,
} from './images/registerImageProviders';
import { registerAsciiDocLanguageProviders } from './language/registerAsciiDocLanguage';
import type { RenderResult } from './models/renderResult';
import {
  registerExportCommands,
  type ExportRegistration,
} from './export/exportProvider';
import {
  registerOutlineProvider,
  type OutlineRegistration,
} from './outline/outlineProvider';
import { PreviewLinkOpener } from './preview/previewLinkOpener';
import { PreviewManager } from './preview/previewManager';
import {
  createNodeRendererWorkerFactory,
  RendererWorkerService,
} from './services/rendererWorkerService';

const OUTPUT_CHANNEL_NAME = 'AdocMD Forge';

export function activate(context: vscode.ExtensionContext): {
  readonly imageProviders: ImageProviderRegistration;
  readonly outline: {
    readonly viewRegistered: true;
    readonly provider: OutlineRegistration['provider'];
  };
  readonly diagnostics: {
    readonly collectionName: string;
    readonly provider: LinkDiagnosticRegistration['provider'];
  };
  readonly export: {
    readonly commandsRegistered: true;
    readonly provider: ExportRegistration['provider'];
  };
} {
  const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  const commandExecutor = new CommandExecutor(outputChannel);
  const linkOpener = new PreviewLinkOpener(outputChannel);
  const rendererWorkerService = new RendererWorkerService(
    createNodeRendererWorkerFactory({
      asciidoc: context.asAbsolutePath(
        path.join('dist', 'workers', 'asciidocRenderer.js'),
      ),
      markdown: context.asAbsolutePath(
        path.join('dist', 'workers', 'markdownRenderer.js'),
      ),
    }),
  );
  const previewManager = new PreviewManager({
    extensionUri: context.extensionUri,
    openLink: async (documentUri, href): Promise<void> => {
      await linkOpener.open(documentUri, href);
    },
    outputChannel,
    renderer: (request, signal): Promise<RenderResult> => (
      rendererWorkerService.render(request, signal)
    ),
  });

  const imageProviders = registerImageProviders(commandExecutor);
  const outlineRegistration = registerOutlineProvider(commandExecutor);
  const diagnosticRegistration = registerLinkDiagnostics(commandExecutor, outputChannel);
  const exportRegistration = registerExportCommands(
    commandExecutor,
    (request, signal): Promise<RenderResult> => (
      rendererWorkerService.render(request, signal)
    ),
    outputChannel,
  );
  context.subscriptions.push(
    outputChannel,
    previewManager,
    rendererWorkerService,
    ...registerAsciiDocLanguageProviders(),
    ...imageProviders.disposables,
    ...outlineRegistration.disposables,
    ...diagnosticRegistration.disposables,
    ...exportRegistration.disposables,
    ...registerLanguageCommands(commandExecutor),
    ...registerFormattingCommands(commandExecutor),
    ...registerPreviewCommands(previewManager, commandExecutor),
  );
  outputChannel.appendLine('AdocMD Forge activated.');
  return {
    imageProviders,
    outline: {
      viewRegistered: true,
      provider: outlineRegistration.provider,
    },
    diagnostics: {
      collectionName: 'adocmd-forge',
      provider: diagnosticRegistration.provider,
    },
    export: {
      commandsRegistered: true,
      provider: exportRegistration.provider,
    },
  };
}
