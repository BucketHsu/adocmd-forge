import * as vscode from 'vscode';

const CONFIGURATION_SECTION = 'adocmdForge';
const DEFAULT_PREVIEW_UPDATE_DELAY = 200;
const MINIMUM_PREVIEW_UPDATE_DELAY = 50;
const MAXIMUM_PREVIEW_UPDATE_DELAY = 2_000;

export interface PreviewSettings {
  readonly allowRemoteImages: boolean;
  readonly openToSide: boolean;
  readonly scrollSync: boolean;
  readonly updateDelay: number;
}

export function getPreviewSettings(resource?: vscode.Uri): PreviewSettings {
  const configuration = vscode.workspace.getConfiguration(
    CONFIGURATION_SECTION,
    resource,
  );
  const requestedDelay = configuration.get(
    'preview.updateDelay',
    DEFAULT_PREVIEW_UPDATE_DELAY,
  );

  return {
    allowRemoteImages: configuration.get(
      'preview.allowRemoteImages',
      false,
    ),
    openToSide: configuration.get('preview.openToSide', true),
    scrollSync: configuration.get('preview.scrollSync', true),
    updateDelay: clampUpdateDelay(requestedDelay),
  };
}

function clampUpdateDelay(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PREVIEW_UPDATE_DELAY;
  }

  return Math.min(
    MAXIMUM_PREVIEW_UPDATE_DELAY,
    Math.max(MINIMUM_PREVIEW_UPDATE_DELAY, Math.round(value)),
  );
}
