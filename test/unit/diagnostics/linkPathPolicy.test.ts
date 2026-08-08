import { describe, expect, it } from 'vitest';

import {
  isExternalTarget,
  pathsEqual,
  resolveLinkTarget,
  splitReferenceTarget,
} from '../../../src/diagnostics/linkPathPolicy';

describe('link path policy', (): void => {
  it('分離 URL query、fragment 並解碼 URI', (): void => {
    expect(splitReferenceTarget('guide%20one.md?cache=1#section%202')).toEqual({
      path: 'guide one.md',
      fragment: 'section 2',
    });
    expect(splitReferenceTarget('#local?display=true')).toEqual({
      path: '',
      fragment: 'local',
    });
    expect(splitReferenceTarget('%E0%A4%A')).toEqual({
      path: '%E0%A4%A',
      fragment: undefined,
    });
  });

  it('區分外部 URI、file URI 與 Windows 路徑', (): void => {
    expect(isExternalTarget('https://example.com/a')).toBe(true);
    expect(isExternalTarget('mailto:test@example.com')).toBe(true);
    expect(isExternalTarget('ftp://example.com/a')).toBe(true);
    expect(isExternalTarget('custom:resource')).toBe(true);
    expect(isExternalTarget('//example.com/resource')).toBe(true);
    expect(isExternalTarget('file:///workspace/docs/a.md')).toBe(false);
    expect(isExternalTarget('C:\\workspace\\docs\\a.md')).toBe(false);
  });

  it('解析 workspace 內相對路徑與 internal anchor', (): void => {
    expect(resolveLinkTarget(
      '/workspace/docs/main.md',
      'parts/guide.md#intro',
      ['/workspace'],
    )).toEqual({
      kind: 'local',
      path: '/workspace/docs/parts/guide.md',
      fragment: 'intro',
    });
    expect(resolveLinkTarget(
      '/workspace/docs/main.md',
      '#intro',
      ['/workspace'],
    )).toEqual({
      kind: 'internal',
      path: '/workspace/docs/main.md',
      fragment: 'intro',
    });
  });

  it('拒絕 path traversal、外部絕對路徑與動態屬性', (): void => {
    expect(resolveLinkTarget(
      '/workspace/docs/main.md',
      '../../../secret.md',
      ['/workspace'],
    ).kind).toBe('unsafe');
    expect(resolveLinkTarget(
      '/workspace/docs/main.md',
      '/etc/passwd',
      ['/workspace'],
    ).kind).toBe('unsafe');
    expect(resolveLinkTarget(
      '/workspace/docs/main.md',
      '{doc-name}.md',
      ['/workspace'],
    ).kind).toBe('unavailable');
  });

  it('支援 Windows path 並只在 Windows 比較時忽略大小寫', (): void => {
    expect(resolveLinkTarget(
      'C:\\workspace\\docs\\main.md',
      '..\\images\\logo.png',
      ['C:\\workspace'],
    )).toEqual({
      kind: 'local',
      path: 'C:\\workspace\\images\\logo.png',
      fragment: undefined,
    });
    expect(pathsEqual('C:\\Workspace\\Docs\\a.md', 'c:\\workspace\\docs\\A.md')).toBe(true);
    expect(pathsEqual('/Workspace/a.md', '/workspace/a.md')).toBe(false);
  });

  it('file URI 仍套用 workspace 安全邊界', (): void => {
    expect(resolveLinkTarget(
      '/workspace/docs/main.md',
      'file:///workspace/docs/other.md#intro',
      ['/workspace'],
    )).toEqual({
      kind: 'local',
      path: '/workspace/docs/other.md',
      fragment: 'intro',
    });
    expect(resolveLinkTarget(
      '/workspace/docs/main.md',
      'file:///tmp/other.md',
      ['/workspace'],
    ).kind).toBe('unsafe');
  });

  it('混合平台輸入仍以 workspace root 作為唯一邊界', (): void => {
    expect(resolveLinkTarget(
      '/workspace/docs/main.md',
      'C:\\workspace\\docs\\other.md',
      ['C:\\workspace'],
    ).kind).toBe('local');
    expect(resolveLinkTarget(
      '/workspace/docs/main.md',
      'C:\\outside\\other.md',
      ['C:\\workspace'],
    ).kind).toBe('unsafe');
  });

  it('沒有可解析 workspace 時跳過本機檔案，錯誤 file URI 不放行', (): void => {
    expect(resolveLinkTarget(undefined, 'guide.md', []).kind).toBe('unavailable');
    expect(resolveLinkTarget('/workspace/main.md', 'file://%', ['/workspace']).kind)
      .toBe('unsafe');
    expect(resolveLinkTarget(
      '/workspace/main.md',
      'file://localhost/workspace/other.md',
      ['/workspace'],
    ).kind).toBe('local');
    expect(resolveLinkTarget(
      'C:\\workspace\\main.md',
      'file://server/share/other.md',
      ['\\\\server\\share'],
    ).kind).toBe('local');
  });
});
