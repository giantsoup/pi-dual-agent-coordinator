import { randomUUID } from "node:crypto";

export function createRequestId(): string {
  return randomUUID();
}

export class CorrelationState {
  private readonly turnIndexes = new Map<string, number>();
  private readonly requestIds = new Map<string, string>();

  public setRequestId(roleKey: string, requestId: string | undefined): void {
    if (requestId) {
      this.requestIds.set(roleKey, requestId);
    } else {
      this.requestIds.delete(roleKey);
    }
  }

  public getRequestId(roleKey: string): string | undefined {
    return this.requestIds.get(roleKey);
  }

  public observeTurnEnd(sessionKey: string): number {
    const next = (this.turnIndexes.get(sessionKey) ?? 0) + 1;
    this.turnIndexes.set(sessionKey, next);
    return next;
  }

  public getTurnIndex(sessionKey: string): number | undefined {
    return this.turnIndexes.get(sessionKey);
  }
}
