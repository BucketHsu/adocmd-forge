import { describe, expect, it } from 'vitest';

import {
  createPortableRelativePath,
  isPathWithinRoot,
  resolveExportPath,
  resolveLocalResource,
  validateWorkspacePath,
} from '../../../src/export/exportPathPolicy';

describe('exportPathPolicy', (): void => {
  it('accepts workspace destination and rejects source overwrite', (): void => {
    expect(resolveExportPath(
      '/workspace/docs/guide.adoc',
      '/workspace',
      '/workspace/out/guide.html',
    )).toEqual({
      destinationPath: '/workspace/out/guide.html',
      destinationDirectory: '/workspace/out',
    });
    expect(() => resolveExportPath(
      '/workspace/docs/guide.adoc',
      '/workspace',
      '/workspace/docs/guide.adoc',
    )).toThrow('不可覆蓋來源');
  });

  it.each([
    ['/outside/result.html', '目前工作區'],
    ['/workspace/docs/../..//result.html', '目前工作區'],
    ['/workspace/docs/guide.adoc\0.html', '有效'],
  ])('rejects unsafe destination %s', (destination, message): void => {
    expect(() => resolveExportPath(
      '/workspace/docs/guide.adoc',
      '/workspace',
      destination,
    )).toThrow(message);
  });

  it('validates source roots and local resources without reading files', (): void => {
    expect(() => validateWorkspacePath('/workspace/guide.md', '/workspace', '來源文件')).not.toThrow();
    expect(() => validateWorkspacePath('/outside/guide.md', '/workspace', '來源文件')).toThrow();
    expect(resolveLocalResource(
      '/workspace/docs/guide.md',
      '/workspace',
      'images/圖.png?size=1#top',
    )).toEqual({
      absolutePath: '/workspace/docs/images/圖.png',
      suffix: '?size=1#top',
    });
    expect(resolveLocalResource('/workspace/docs/guide.md', '/workspace', '#top')).toBeUndefined();
    expect(resolveLocalResource('/workspace/docs/guide.md', '/workspace', 'https://example.test/a.png')).toBeUndefined();
    expect(resolveLocalResource('/workspace/docs/guide.md', '/workspace', '../../outside.png')).toBeUndefined();
    expect(resolveLocalResource('/workspace/docs/guide.md', '/workspace', 'data:image/png;base64,AA==')).toBeUndefined();
  });

  it('creates portable encoded paths and handles root boundary', (): void => {
    expect(createPortableRelativePath('/workspace/out', '/workspace/docs/圖.png')).toBe('../docs/%E5%9C%96.png');
    expect(isPathWithinRoot('/workspace', '/workspace')).toBe(true);
    expect(isPathWithinRoot('/workspace/docs/a', '/workspace')).toBe(true);
    expect(isPathWithinRoot('/workspace-other/a', '/workspace')).toBe(false);
  });
});
