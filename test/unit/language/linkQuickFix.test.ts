import { describe, expect, it } from 'vitest';

import {
  rankQuickFixCandidates,
  replaceReferencePath,
} from '../../../src/language/linkQuickFix';

describe('linkQuickFix', (): void => {
  it('ranks exact prefixes, file-name prefixes and fuzzy values deterministically', (): void => {
    expect(rankQuickFixCandidates([
      '../chapters/installation.adoc',
      'images/install.png',
      'intro.adoc',
      'install-guide.adoc',
      'install-guide.adoc',
    ], 'inst')).toEqual([
      'install-guide.adoc',
      'images/install.png',
      '../chapters/installation.adoc',
      'intro.adoc',
    ]);
  });

  it('excludes unchanged values and applies a safe default limit', (): void => {
    expect(rankQuickFixCandidates([
      'intro',
      'introduction',
      'install',
      'index',
      'inside',
      'integer',
      'integration',
    ], 'intro', 0)).not.toContain('intro');
    expect(rankQuickFixCandidates([
      'a', 'b', 'c', 'd', 'e', 'f',
    ], '', 2)).toHaveLength(2);
  });

  it('replaces only a reference path and preserves query and fragment', (): void => {
    expect(replaceReferencePath(
      'old.adoc?role=guide#overview',
      '../guide.adoc',
    )).toBe('../guide.adoc?role=guide#overview');
    expect(replaceReferencePath('missing.png', 'images/present.png'))
      .toBe('images/present.png');
  });
});
