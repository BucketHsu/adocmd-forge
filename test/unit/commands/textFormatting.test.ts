import { describe, expect, it } from 'vitest';

import { wrapTextSelections } from '../../../src/commands/textFormattingCore';

describe('wrapTextSelections', (): void => {
  it('wraps selected text and keeps the selection inside the markers', (): void => {
    const result = wrapTextSelections(
      'Alpha Beta',
      [{ end: 10, start: 6 }],
      { close: '*', open: '*' },
    );

    expect(result.text).toBe('Alpha *Beta*');
    expect(result.selections).toEqual([
      { end: 11, start: 7 },
    ]);
  });

  it('inserts an empty pair and places the cursor between markers', (): void => {
    const result = wrapTextSelections(
      'Alpha',
      [{ end: 5, start: 5 }],
      { close: '`', open: '`' },
    );

    expect(result.text).toBe('Alpha``');
    expect(result.selections).toEqual([
      { end: 6, start: 6 },
    ]);
  });

  it('supports multiple non-overlapping selections', (): void => {
    const result = wrapTextSelections(
      'one two three',
      [
        { end: 3, start: 0 },
        { end: 13, start: 8 },
      ],
      { close: '**', open: '**' },
    );

    expect(result.text).toBe('**one** two **three**');
    expect(result.selections).toEqual([
      { end: 5, start: 2 },
      { end: 19, start: 14 },
    ]);
  });

  it('does not apply overlapping selections twice', (): void => {
    const result = wrapTextSelections(
      'one two',
      [
        { end: 7, start: 0 },
        { end: 7, start: 4 },
      ],
      { close: '#', open: '#' },
    );

    expect(result.text).toBe('#one two#');
  });
});
