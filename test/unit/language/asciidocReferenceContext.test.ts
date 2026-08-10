import { describe, expect, it } from 'vitest';

import {
  getAsciiDocReferenceCompletionContext,
} from '../../../src/language/asciidocReferenceContext';

describe('AsciiDoc reference completion context', (): void => {
  it.each([
    ['include::parts/cha', 'include', 'parts/cha'],
    ['image::images/lo', 'image', 'images/lo'],
    ['image:icons/lo', 'image', 'icons/lo'],
    ['xref:guide.adoc#in', 'xref', 'guide.adoc#in'],
  ] as const)('parses %s', (line, kind, target): void => {
    expect(getAsciiDocReferenceCompletionContext(line, line.length)).toEqual({
      kind,
      target,
      shorthand: false,
      replacementStart: line.length - target.length,
      replacementEnd: line.length,
    });
  });

  it('parses shorthand xrefs without replacing the delimiters', (): void => {
    const line = 'See <<intro';

    expect(getAsciiDocReferenceCompletionContext(line, line.length)).toEqual({
      kind: 'xref',
      target: 'intro',
      shorthand: true,
      replacementStart: 6,
      replacementEnd: 11,
    });
  });

  it('does not offer path completion in normal prose or completed macros', (): void => {
    expect(getAsciiDocReferenceCompletionContext('normal prose', 12)).toBeUndefined();
    expect(getAsciiDocReferenceCompletionContext('include::part.adoc[]', 20)).toBeUndefined();
  });
});
