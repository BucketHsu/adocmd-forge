import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { RevisionDebouncer } from '../../../src/utility/asyncDebouncer';

describe('RevisionDebouncer', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
  });

  it('runs only the newest scheduled work', (): void => {
    vi.useFakeTimers();
    const debouncer = new RevisionDebouncer();
    const completedRevisions: number[] = [];

    const firstRevision = debouncer.schedule(200, (revision): void => {
      completedRevisions.push(revision);
    });
    const secondRevision = debouncer.schedule(50, (revision): void => {
      completedRevisions.push(revision);
    });
    vi.advanceTimersByTime(200);

    expect(firstRevision).toBe(1);
    expect(secondRevision).toBe(2);
    expect(completedRevisions).toEqual([
      secondRevision,
    ]);
    expect(debouncer.isCurrent(firstRevision)).toBe(false);
    expect(debouncer.isCurrent(secondRevision)).toBe(true);
  });

  it('invalidates pending work without scheduling another callback', (): void => {
    vi.useFakeTimers();
    const debouncer = new RevisionDebouncer();
    const work = vi.fn();
    const scheduledRevision = debouncer.schedule(100, work);

    const currentRevision = debouncer.invalidate();
    vi.runAllTimers();

    expect(work).not.toHaveBeenCalled();
    expect(debouncer.isCurrent(scheduledRevision)).toBe(false);
    expect(debouncer.isCurrent(currentRevision)).toBe(true);
  });

  it('cancels pending work and rejects reuse after disposal', (): void => {
    vi.useFakeTimers();
    const debouncer = new RevisionDebouncer();
    const work = vi.fn();
    const scheduledRevision = debouncer.schedule(100, work);

    debouncer.dispose();
    vi.runAllTimers();

    expect(work).not.toHaveBeenCalled();
    expect(debouncer.isCurrent(scheduledRevision)).toBe(false);
    expect(() => debouncer.schedule(0, work)).toThrow(
      'Revision debouncer has already been disposed.',
    );
  });
});
