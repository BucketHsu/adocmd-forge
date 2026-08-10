import { describe, expect, it } from 'vitest';

import { getAsciiDocHoverInfo } from '../../../src/language/asciidocHover';

describe('AsciiDoc hover core', (): void => {
  it('describes a heading when the cursor is on its marker', (): void => {
    const hover = getAsciiDocHoverInfo({
      languageId: 'asciidoc',
      lineText: '== 第一章',
      character: 1,
    });

    expect(hover).toMatchObject({
      id: 'heading',
      start: 0,
      end: 2,
    });
    expect(hover?.markdown).toContain('範例：');
    expect(hover?.markdown).toContain('文件標題');
  });

  it('describes macros over their complete invocation', (): void => {
    const lineText = 'image::images/example.png[範例]';
    const hover = getAsciiDocHoverInfo({
      languageId: 'asciidoc',
      lineText,
      character: lineText.indexOf('example'),
    });

    expect(hover?.id).toBe('image');
    expect(hover?.start).toBe(0);
    expect(hover?.end).toBe(lineText.length);
    expect(hover?.markdown).toContain('區塊圖片');
  });

  it('recognizes checklist, admonition and table markers', (): void => {
    expect(getAsciiDocHoverInfo({
      languageId: 'asciidoc',
      lineText: '* [ ] 待辦事項',
      character: 2,
    })?.id).toBe('checklist');
    expect(getAsciiDocHoverInfo({
      languageId: 'asciidoc',
      lineText: 'WARNING: 小心',
      character: 2,
    })?.id).toBe('admonition');
    expect(getAsciiDocHoverInfo({
      languageId: 'asciidoc',
      lineText: '|===',
      character: 1,
    })?.id).toBe('table');
  });

  it('does not return AsciiDoc help for Markdown', (): void => {
    expect(getAsciiDocHoverInfo({
      languageId: 'markdown',
      lineText: '= 標題',
      character: 1,
    })).toBeUndefined();
  });

  it('returns no hover outside a known syntax marker', (): void => {
    expect(getAsciiDocHoverInfo({
      languageId: 'asciidoc',
      lineText: '一般段落文字',
      character: 3,
    })).toBeUndefined();
  });
});
