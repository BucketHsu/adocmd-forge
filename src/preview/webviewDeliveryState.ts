/**
 * 追蹤目前 Webview runtime 世代，避免舊訊息的非同步結果覆蓋新 runtime 狀態。
 */
export class WebviewDeliveryState {
  private disposed = false;
  private generation = 0;
  private ready = false;

  public get currentGeneration(): number {
    return this.generation;
  }

  public get isReady(): boolean {
    return !this.disposed && this.ready;
  }

  public markReady(): number {
    if (this.disposed) {
      return this.generation;
    }

    this.generation += 1;
    this.ready = true;
    return this.generation;
  }

  public markReloading(): number {
    if (this.disposed) {
      return this.generation;
    }

    this.generation += 1;
    this.ready = false;
    return this.generation;
  }

  public markDeliveryFailed(generation: number): void {
    if (!this.disposed && generation === this.generation) {
      this.ready = false;
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.generation += 1;
    this.ready = false;
  }
}
