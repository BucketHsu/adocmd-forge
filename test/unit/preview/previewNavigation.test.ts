import { describe, expect, it } from 'vitest';

import {
  resolvePreviewNavigation,
} from '../../../src/preview/previewNavigation';

describe('resolvePreviewNavigation', () => {
  describe('外部連結', () => {
    it('不要求未儲存文件先具有實體來源路徑', () => {
      expect(resolvePreviewNavigation({
        allowedRootPaths: [],
        href: 'https://example.com/guide',
      })).toEqual({
        href: 'https://example.com/guide',
        kind: 'external',
        scheme: 'https',
      });
    });

    it.each([
      [
        'https://example.com/guide?q=1#intro',
        'https',
        'https://example.com/guide?q=1#intro',
      ],
      [
        'http://example.com/',
        'http',
        'http://example.com/',
      ],
      [
        'mailto:writer@example.com?subject=Guide',
        'mailto',
        'mailto:writer@example.com?subject=Guide',
      ],
    ] as const)('接受允許的外部 URI：%s', (href, scheme, normalizedHref) => {
      expect(resolvePreviewNavigation({
        sourceFilePath: '/workspace/docs/index.md',
        allowedRootPaths: [
          '/workspace',
        ],
        href,
      })).toEqual({
        kind: 'external',
        href: normalizedHref,
        scheme,
      });
    });

    it.each([
      'command:workbench.action.closeWindow',
      'data:text/html,unsafe',
      'file:///workspace/secret.txt',
      'ftp://example.com/file',
      'javascript:alert(1)',
      'vbscript:msgbox(1)',
      'custom:value',
      'https:example.com',
      'https:///missing-host',
    ])('拒絕未允許或格式含糊的 scheme：%s', (href) => {
      expect(resolvePreviewNavigation({
        sourceFilePath: '/workspace/docs/index.md',
        allowedRootPaths: [
          '/workspace',
        ],
        href,
      })).toEqual({
        kind: 'rejected',
        reason: 'unsupported-scheme',
      });
    });
  });

  describe('POSIX 本機路徑', () => {
    it('依來源檔案目錄解析相對路徑，並保留 query 與一般 fragment', () => {
      expect(resolvePreviewNavigation({
        sourceFilePath: '/workspace/docs/chapter/index.md',
        allowedRootPaths: [
          '/workspace',
        ],
        href: '../guide/intro%20one.adoc?mode=raw#安裝',
      })).toEqual({
        kind: 'local',
        filePath: '/workspace/docs/guide/intro one.adoc',
        query: 'mode=raw',
        fragment: '安裝',
        sourceLine: null,
      });
    });

    it('將 #Lx 轉成零起算來源行號', () => {
      expect(resolvePreviewNavigation({
        sourceFilePath: '/workspace/docs/index.md',
        allowedRootPaths: [
          '/workspace',
        ],
        href: '#L42',
      })).toEqual({
        kind: 'local',
        filePath: '/workspace/docs/index.md',
        query: '',
        fragment: 'L42',
        sourceLine: 41,
      });
    });

    it('支援 query-only 的目前來源檔案連結', () => {
      expect(resolvePreviewNavigation({
        sourceFilePath: '/workspace/docs/index.md',
        allowedRootPaths: [
          '/workspace',
        ],
        href: '?view=plain',
      })).toEqual({
        kind: 'local',
        filePath: '/workspace/docs/index.md',
        query: 'view=plain',
        fragment: '',
        sourceLine: null,
      });
    });

    it('接受落在任一允許根目錄內的目標', () => {
      expect(resolvePreviewNavigation({
        sourceFilePath: '/workspace-one/docs/index.md',
        allowedRootPaths: [
          '/workspace-one',
          '/shared-docs',
        ],
        href: '../../shared-docs/guide.md',
      })).toMatchObject({
        kind: 'local',
        filePath: '/shared-docs/guide.md',
      });
    });

    it.each([
      '../../../outside.md',
      '..%2F..%2F..%2Foutside.md',
    ])('拒絕正規化後逃出所有允許根目錄的路徑：%s', (href) => {
      expect(resolvePreviewNavigation({
        sourceFilePath: '/workspace/docs/chapter/index.md',
        allowedRootPaths: [
          '/workspace',
        ],
        href,
      })).toEqual({
        kind: 'rejected',
        reason: 'outside-allowed-root',
      });
    });

    it.each([
      '/workspace/absolute.md',
      '\\workspace\\ambiguous.md',
      'folder\\ambiguous.md',
    ])('拒絕絕對或跨平台含糊的 POSIX path：%s', (href) => {
      expect(resolvePreviewNavigation({
        sourceFilePath: '/workspace/docs/index.md',
        allowedRootPaths: [
          '/workspace',
        ],
        href,
      })).toEqual({
        kind: 'rejected',
        reason: 'invalid-local-reference',
      });
    });
  });

  describe('Windows 本機路徑', () => {
    it.each([
      [
        '../guide/intro.adoc#L3',
        'C:\\Workspace\\docs\\guide\\intro.adoc',
      ],
      [
        '..\\guide\\intro.adoc#L3',
        'C:\\Workspace\\docs\\guide\\intro.adoc',
      ],
    ] as const)('支援 Markdown 與 Windows 分隔符號：%s', (href, filePath) => {
      expect(resolvePreviewNavigation({
        sourceFilePath: 'C:\\Workspace\\docs\\chapter\\index.md',
        allowedRootPaths: [
          'c:\\workspace',
        ],
        href,
      })).toEqual({
        kind: 'local',
        filePath,
        query: '',
        fragment: 'L3',
        sourceLine: 2,
      });
    });

    it('拒絕逃出 Windows workspace 的路徑', () => {
      expect(resolvePreviewNavigation({
        sourceFilePath: 'C:\\Workspace\\docs\\index.md',
        allowedRootPaths: [
          'C:\\Workspace',
        ],
        href: '..\\..\\outside.md',
      })).toEqual({
        kind: 'rejected',
        reason: 'outside-allowed-root',
      });
    });

    it.each([
      'C:\\Workspace\\docs\\absolute.md',
      'C:drive-relative.md',
      '\\root-relative.md',
      'folder\\file.md:stream',
    ])('拒絕絕對、drive-relative 或 ADS path：%s', (href) => {
      expect(resolvePreviewNavigation({
        sourceFilePath: 'C:\\Workspace\\docs\\index.md',
        allowedRootPaths: [
          'C:\\Workspace',
        ],
        href,
      })).toMatchObject({
        kind: 'rejected',
      });
    });
  });

  describe('共同拒絕條件', () => {
    it.each([
      '//example.com/guide',
      '\\\\server\\share\\guide.md',
      '%2F%2Fexample.com%2Fguide',
      '%5C%5Cserver%5Cshare%5Cguide.md',
    ])('拒絕 protocol-relative 與 UNC 參照：%s', (href) => {
      expect(resolvePreviewNavigation({
        sourceFilePath: 'C:\\Workspace\\docs\\index.md',
        allowedRootPaths: [
          'C:\\Workspace',
        ],
        href,
      })).toEqual({
        kind: 'rejected',
        reason: 'protocol-relative',
      });
    });

    it.each([
      '',
      '   ',
    ])('拒絕空連結：%j', (href) => {
      expect(resolvePreviewNavigation({
        sourceFilePath: '/workspace/docs/index.md',
        allowedRootPaths: [
          '/workspace',
        ],
        href,
      })).toEqual({
        kind: 'rejected',
        reason: 'empty-href',
      });
    });

    it.each([
      ' guide.md',
      'guide.md ',
      'guide\u0000.md',
      'https://example.com/\u007F',
    ])('拒絕空白邊界或控制字元：%j', (href) => {
      expect(resolvePreviewNavigation({
        sourceFilePath: '/workspace/docs/index.md',
        allowedRootPaths: [
          '/workspace',
        ],
        href,
      })).toEqual({
        kind: 'rejected',
        reason: 'control-character',
      });
    });

    it('拒絕無法解碼的 percent-encoding', () => {
      expect(resolvePreviewNavigation({
        sourceFilePath: '/workspace/docs/index.md',
        allowedRootPaths: [
          '/workspace',
        ],
        href: 'guide%ZZ.md',
      })).toEqual({
        kind: 'rejected',
        reason: 'invalid-local-reference',
      });
    });

    it.each([
      {
        sourceFilePath: 'docs/index.md',
        allowedRootPaths: [
          '/workspace',
        ],
      },
      {
        sourceFilePath: '/workspace/docs/index.md',
        allowedRootPaths: [],
      },
      {
        sourceFilePath: '/workspace/docs/index.md',
        allowedRootPaths: [
          'relative-root',
        ],
      },
      {
        sourceFilePath: '\\\\server\\share\\index.md',
        allowedRootPaths: [
          '\\\\server\\share',
        ],
      },
    ])('拒絕不完整或含糊的路徑政策輸入', ({
      sourceFilePath,
      allowedRootPaths,
    }) => {
      expect(resolvePreviewNavigation({
        sourceFilePath,
        allowedRootPaths,
        href: 'guide.md',
      })).toEqual({
        kind: 'rejected',
        reason: 'invalid-input',
      });
    });

    it('極大 #Lx 不會產生不安全整數行號', () => {
      expect(resolvePreviewNavigation({
        sourceFilePath: '/workspace/docs/index.md',
        allowedRootPaths: [
          '/workspace',
        ],
        href: '#L999999999999999999999999',
      })).toMatchObject({
        kind: 'local',
        fragment: 'L999999999999999999999999',
        sourceLine: null,
      });
    });
  });
});
