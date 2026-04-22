import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RuntimeEventBridge } from "../../src/coordinator/bind-runtime-events.js";
import { Metrics } from "../../src/telemetry/metrics.js";
import { TelemetryLogger } from "../../src/telemetry/logger.js";
import { createFakeBinding, FakeRuntime, FakeSession } from "../helpers/fakes.js";

describe("runtime event bridge", () => {
  it("does not emit an unhandled rejection when disposed with a pending turn waiter", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-dual-runtime-bridge-unit-"));
    const logger = new TelemetryLogger({
      filePath: join(root, "telemetry.jsonl"),
      jsonLogs: false,
      verbose: false
    });
    const bridge = new RuntimeEventBridge(logger, new Metrics());
    const binding = createFakeBinding(
      "A",
      new FakeRuntime(
        process.cwd(),
        new FakeSession("A-session-1", join(root, "A.jsonl"), async () => {}),
        "A"
      )
    );
    await bridge.bind(binding);

    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", listener);

    const pending = bridge.promptAndWaitForTurnEnd(binding, "hello");
    bridge.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", listener);

    await expect(pending).rejects.toThrow("Runtime event bridge disposed");
    expect(unhandled).toEqual([]);
  });
});
