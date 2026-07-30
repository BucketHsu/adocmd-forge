export type RenderMessageSeverity = 'error' | 'warning';

export interface RenderMessage {
  readonly message: string;
  readonly severity: RenderMessageSeverity;
  /**
   * 若訊息屬於主文件，提供零起算行號。
   */
  readonly sourceLine?: number;
}
