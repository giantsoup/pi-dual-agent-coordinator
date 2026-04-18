import { mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

import type { NormalizedTelemetryEvent } from "../types/telemetry.js";

export interface LoggerOptions {
  filePath: string;
  jsonLogs: boolean;
  verbose: boolean;
  stdout?: NodeJS.WriteStream | undefined;
  stderr?: NodeJS.WriteStream | undefined;
}

export class TelemetryLogger {
  private readonly stdout: NodeJS.WriteStream;
  private readonly stderr: NodeJS.WriteStream;

  public constructor(private readonly options: LoggerOptions) {
    mkdirSync(dirname(options.filePath), { recursive: true });
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
  }

  public log(event: NormalizedTelemetryEvent): void {
    const line = JSON.stringify(event);
    appendFileSync(this.options.filePath, `${line}\n`, "utf8");
    if (this.options.jsonLogs) {
      this.stdout.write(`${line}\n`);
    }
    if (this.options.verbose) {
      this.stderr.write(
        `[${event.timestamp}] ${event.eventType} role=${event.role} session=${event.sessionId} request=${event.requestId ?? "-"}\n`
      );
    }
  }
}
