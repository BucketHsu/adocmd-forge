import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createAllowedRootPaths,
  isPathWithinRoot,
  resolvePreviewImage,
  resolvePreviewStylesheet,
} from '../../../src/preview/previewResource';

describe('resolvePreviewImage', () => {
  const workspaceRoot = path.resolve('workspace');
  const sourcePath = path.join(workspaceRoot, 'docs', 'guide.md');

  it('resolves an encoded relative image inside the workspace', () => {
    expect(resolvePreviewImage(
      sourcePath,
      [workspaceRoot],
      '../images/my%20image.png',
    )).toEqual({
      kind: 'local',
      path: path.join(workspaceRoot, 'images', 'my image.png'),
    });
  });

  it('keeps HTTPS images external', () => {
    expect(resolvePreviewImage(
      undefined,
      [],
      'HTTPS://example.com/image.png',
    )).toEqual({
      kind: 'external',
    });
  });

  it.each([
    '../../outside.png',
    '//example.com/image.png',
    'file:///secret.png',
    'javascript:alert(1)',
    '%00.png',
    '#fragment',
  ])('rejects unsafe image source %s', (imageSource) => {
    expect(resolvePreviewImage(
      sourcePath,
      [path.join(workspaceRoot, 'docs')],
      imageSource,
    )).toEqual({
      kind: 'rejected',
    });
  });
});

describe('createAllowedRootPaths', () => {
  it('combines workspace roots with the source directory without duplicates', () => {
    const workspaceRoot = path.resolve('workspace');
    expect(createAllowedRootPaths(
      path.join(workspaceRoot, 'guide.md'),
      [workspaceRoot],
    )).toEqual([
      workspaceRoot,
    ]);
  });
});

describe('resolvePreviewStylesheet', () => {
  const workspaceRoot = path.resolve('workspace');

  it('accepts an absolute CSS path inside an allowed root', () => {
    const stylesheetPath = path.join(
      workspaceRoot,
      'stylesheets',
      'colony.css',
    );

    expect(resolvePreviewStylesheet([workspaceRoot], stylesheetPath))
      .toBe(stylesheetPath);
  });

  it('accepts a Windows drive path without treating the drive as a URI scheme', () => {
    const windowsRoot = String.raw`D:\Project\NTPCLandFx\ntpclandfx`;
    const stylesheetPath = String.raw`D:\Project\NTPCLandFx\ntpclandfx\docs\stylesheets\colony.css`;

    expect(resolvePreviewStylesheet([windowsRoot], stylesheetPath))
      .toBe(stylesheetPath);
    expect(resolvePreviewStylesheet([
      String.raw`D:\Project\OtherWorkspace`,
    ], stylesheetPath)).toBeUndefined();
  });

  it.each([
    path.join(workspaceRoot, 'stylesheets', 'colony.scss'),
    path.join(path.dirname(workspaceRoot), 'stylesheets', 'colony.css'),
    'stylesheets/colony.css',
    'https://example.com/colony.css',
    `${path.join(workspaceRoot, 'stylesheets', 'colony.css')}\u0000`,
  ])('rejects an unsafe stylesheet path %s', (stylesheetPath) => {
    expect(resolvePreviewStylesheet([workspaceRoot], stylesheetPath))
      .toBeUndefined();
  });
});

describe('isPathWithinRoot', () => {
  it('does not confuse a sibling with a shared name prefix', () => {
    const parent = path.resolve('project');
    expect(isPathWithinRoot(
      path.join(parent, 'docs', 'image.png'),
      path.join(parent, 'docs'),
    )).toBe(true);
    expect(isPathWithinRoot(
      path.join(parent, 'docs-private', 'image.png'),
      path.join(parent, 'docs'),
    )).toBe(false);
  });
});
