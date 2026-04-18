import type { NormalizedTelemetryEvent } from "../types/telemetry.js";

export class Metrics {
  private readonly counts = new Map<string, number>();

  public observe(event: NormalizedTelemetryEvent): void {
    this.counts.set(event.eventType, (this.counts.get(event.eventType) ?? 0) + 1);
  }

  public snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}
