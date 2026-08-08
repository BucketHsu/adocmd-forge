import * as vscode from 'vscode';

const CONFIGURATION_SECTION = 'adocmdForge';
const DEFAULT_PREVIEW_UPDATE_DELAY = 200;
const DEFAULT_OUTLINE_UPDATE_DELAY = 150;
const DEFAULT_LINK_CHECKER_UPDATE_DELAY = 150;
const MINIMUM_PREVIEW_UPDATE_DELAY = 50;
const MAXIMUM_PREVIEW_UPDATE_DELAY = 2_000;

export interface PreviewSettings {
  readonly allowRemoteImages: boolean;
  readonly openToSide: boolean;
  readonly scrollSync: boolean;
  readonly updateDelay: number;
}

export interface ImageSettings {
  readonly directory: string;
  readonly promptForPath: boolean;
  readonly defaultAltText: string;
}

export interface OutlineSettings {
  readonly updateDelay: number;
}

export interface LinkCheckerSettings {
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

export function getImageSettings(resource?: vscode.Uri): ImageSettings {
  const configuration = vscode.workspace.getConfiguration(
    CONFIGURATION_SECTION,
    resource,
  );

  return {
    directory: configuration.get('images.directory', 'images'),
    promptForPath: configuration.get('images.promptForPath', true),
    defaultAltText: configuration.get('images.defaultAltText', 'filename'),
  };
}

export function getOutlineSettings(resource?: vscode.Uri): OutlineSettings {
  const configuration = vscode.workspace.getConfiguration(
    CONFIGURATION_SECTION,
    resource,
  );
  const requestedDelay = configuration.get(
    'outline.updateDelay',
    DEFAULT_OUTLINE_UPDATE_DELAY,
  );

  return {
    updateDelay: clampOutlineUpdateDelay(requestedDelay),
  };
}

export function getLinkCheckerSettings(resource?: vscode.Uri): LinkCheckerSettings {
  const configuration = vscode.workspace.getConfiguration(
    CONFIGURATION_SECTION,
    resource,
  );
  const requestedDelay = configuration.get(
    'diagnostics.updateDelay',
    DEFAULT_LINK_CHECKER_UPDATE_DELAY,
  );

  return {
    updateDelay: clampLinkCheckerUpdateDelay(requestedDelay),
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

function clampOutlineUpdateDelay(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_OUTLINE_UPDATE_DELAY;
  }

  return Math.min(
    MAXIMUM_PREVIEW_UPDATE_DELAY,
    Math.max(MINIMUM_PREVIEW_UPDATE_DELAY, Math.round(value)),
  );
}

function clampLinkCheckerUpdateDelay(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_LINK_CHECKER_UPDATE_DELAY;
  }

  return Math.min(
    MAXIMUM_PREVIEW_UPDATE_DELAY,
    Math.max(MINIMUM_PREVIEW_UPDATE_DELAY, Math.round(value)),
  );
}
