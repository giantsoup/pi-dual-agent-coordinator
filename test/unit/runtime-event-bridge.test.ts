import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RuntimeEventBridge } from "../../src/coordinator/bind-runtime-events.js";
import { Metrics } from "../../src/telemetry/metrics.js";
import { TelemetryLogger } from "../../src/telemetry/logger.js";
import { assistantMessage, assistantTurnEnd, createFakeBinding, FakeRuntime, FakeSession } from "../helpers/fakes.js";

describe("runtime event bridge", () => {
  it("uses the final assistant turn after tools, rather than an intermediate tool request", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-bridge-tools-"));
    const bridge = new RuntimeEventBridge(new TelemetryLogger({filePath:join(root,"events"),jsonLogs:false,verbose:false}),new Metrics());
    const session = new FakeSession("A",undefined,async () => {
      const message = assistantMessage("Checking files");
      message.content.push({type:"toolCall",id:"read",name:"read",arguments:{path:"file"}});
      await session.emit({type:"turn_end",message,toolResults:[]});
      await session.emit(assistantTurnEnd("Final authoritative answer"));
    });
    const binding = createFakeBinding("A",new FakeRuntime(root,session,"A"));
    await bridge.bind(binding);
    const result = await bridge.promptAndWaitForTurnEnd(binding,"task");
    expect(result).toMatchObject({content:[{text:"Final authoritative answer"}]});
    bridge.dispose();
  });

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
