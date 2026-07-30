import { describe, expect, it } from 'vitest';

import { findClosestSourceMarker } from '../../../src/preview/sourceLine';

describe('findClosestSourceMarker', (): void => {
  const markers = [
    {
      id: 'first',
      sourceLine: 0,
    },
    {
      id: 'second',
      sourceLine: 10,
    },
    {
      id: 'third',
      sourceLine: 30,
    },
  ] as const;

  it.each([
    [-1, 'first'],
    [0, 'first'],
    [5, 'first'],
    [6, 'second'],
    [20, 'second'],
    [21, 'third'],
    [100, 'third'],
  ])('maps source line %i to %s', (sourceLine, expectedId): void => {
    expect(findClosestSourceMarker(markers, sourceLine)?.id).toBe(expectedId);
  });

  it('returns undefined when no source markers exist', (): void => {
    const marker = findClosestSourceMarker<{
      readonly sourceLine: number;
    }>([], 10);
    expect(marker).toBeUndefined();
  });
});
