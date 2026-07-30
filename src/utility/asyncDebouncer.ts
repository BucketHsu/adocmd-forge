export type RevisionWork = (revision: number) => void;

/**
 * 將密集事件合併為最後一次工作，並提供 revision 供非同步結果判斷是否過期。
 */
export class RevisionDebouncer {
  private disposed = false;
  private revision = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  public invalidate(): number {
    this.ensureNotDisposed();
    this.revision += 1;
    this.clearTimer();
    return this.revision;
  }

  public schedule(delay: number, work: RevisionWork): number {
    const scheduledRevision = this.invalidate();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.disposed && this.isCurrent(scheduledRevision)) {
        work(scheduledRevision);
      }
    }, delay);
    return scheduledRevision;
  }

  public isCurrent(candidateRevision: number): boolean {
    return !this.disposed && candidateRevision === this.revision;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.revision += 1;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Revision debouncer has already been disposed.');
    }
  }
}
