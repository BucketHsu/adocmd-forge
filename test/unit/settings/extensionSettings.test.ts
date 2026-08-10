import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Uri } from 'vscode';

const { configurationValues, getConfiguration } = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const configuration = {
    get: (key: string, fallback: unknown): unknown => (
      values.has(key) ? values.get(key) : fallback
    ),
  };
  return {
    configurationValues: values,
    getConfiguration: vi.fn(() => configuration),
  };
});

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration,
  },
}));

import {
  getImageSettings,
  getLinkCheckerSettings,
  getOutlineSettings,
  getPreviewSettings,
} from '../../../src/settings/extensionSettings';

describe('extension settings', (): void => {
  beforeEach((): void => {
    configurationValues.clear();
    getConfiguration.mockClear();
  });

  it('returns documented defaults for preview, image and Outline settings', (): void => {
    expect(getPreviewSettings()).toEqual({
      allowRemoteImages: false,
      openToSide: true,
      scrollSync: true,
      updateDelay: 200,
    });
    expect(getImageSettings()).toEqual({
      directory: 'images',
      promptForPath: true,
      defaultAltText: 'filename',
    });
    expect(getOutlineSettings()).toEqual({
      updateDelay: 150,
    });
    expect(getLinkCheckerSettings()).toEqual({
      updateDelay: 150,
    });
  });

  it('reads values from the requested resource and clamps preview delay', (): void => {
    const resource = { scheme: 'untitled' };
    configurationValues.set('preview.allowRemoteImages', true);
    configurationValues.set('preview.openToSide', false);
    configurationValues.set('preview.scrollSync', false);
    configurationValues.set('preview.updateDelay', 123.6);
    configurationValues.set('images.directory', 'assets');
    configurationValues.set('images.promptForPath', false);
    configurationValues.set('images.defaultAltText', 'figure');

    expect(getPreviewSettings(resource as unknown as Uri)).toEqual({
      allowRemoteImages: true,
      openToSide: false,
      scrollSync: false,
      updateDelay: 124,
    });
    expect(getImageSettings(resource as unknown as Uri)).toEqual({
      directory: 'assets',
      promptForPath: false,
      defaultAltText: 'figure',
    });
    expect(getConfiguration).toHaveBeenCalledWith('adocmdForge', resource);
  });

  it.each([
    [0, 50],
    [50, 50],
    [2000, 2000],
    [9999, 2000],
    [Number.NaN, 200],
  ])('clamps preview update delay %s to %s', (requested, expected): void => {
    configurationValues.set('preview.updateDelay', requested);
    expect(getPreviewSettings().updateDelay).toBe(expected);
  });

  it.each([
    [0, 50],
    [50, 50],
    [2000, 2000],
    [9999, 2000],
    [Number.NaN, 150],
  ])('clamps Outline update delay %s to %s', (requested, expected): void => {
    configurationValues.set('outline.updateDelay', requested);
    expect(getOutlineSettings().updateDelay).toBe(expected);
  });

  it.each([
    [0, 50],
    [50, 50],
    [2000, 2000],
    [9999, 2000],
    [Number.NaN, 150],
  ])('clamps Link Checker update delay %s to %s', (requested, expected): void => {
    configurationValues.set('diagnostics.updateDelay', requested);
    expect(getLinkCheckerSettings().updateDelay).toBe(expected);
  });
});
