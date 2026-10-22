import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RuntimeEventBridge } from "../../src/coordinator/bind-runtime-events.js";
import { Metrics } from "../../src/telemetry/metrics.js";
import { TelemetryLogger } from "../../src/telemetry/logger.js";
import { assistantMessage, assistantTurnEnd, createFakeBinding, FakeRuntime, FakeSession } from "../helpers/fakes.js";

describe("runtime event bridge", () => {
  it.each([false, true])("uses the settled final turn after text-only steering, provider failure=%s", async (failure) => {
    const root = mkdtempSync(join(tmpdir(), "pi-bridge-steered-"));
    const bridge = new RuntimeEventBridge(new TelemetryLogger({ filePath: join(root, "events"), jsonLogs: false, verbose: false }), new Metrics());
    const session = new FakeSession("B", undefined, async () => {
      await session.emit(assistantTurnEnd("<tool_call>\n[]\n[END_TOOL_REQUEST]"));
      const final = assistantMessage("Final observed result");
      if (failure) { final.stopReason = "error"; final.errorMessage = "provider failed after steering"; }
      await session.emit({ type: "turn_end", message: final, toolResults: [] });
    });
    const binding = createFakeBinding("B", new FakeRuntime(root, session, "B")); await bridge.bind(binding);
    try {
      const work = bridge.promptAndWaitForTurnEnd(binding, "task");
      if (failure) await expect(work).rejects.toThrow("provider failed after steering");
      else await expect(work).resolves.toMatchObject({ content: [{ text: "Final observed result" }] });
    } finally { bridge.dispose(); }
  });

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

it("keeps provider failures separate even when a partial tool call was streamed", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bridge-provider-"));
  const bridge = new RuntimeEventBridge(new TelemetryLogger({ filePath: join(root, "events"), jsonLogs: false, verbose: false }), new Metrics());
  const session = new FakeSession("A", undefined, async () => {
    const message = assistantMessage(""); message.stopReason = "error"; message.errorMessage = "provider authentication failed";
    message.content.push({ type: "toolCall", id: "partial", name: "pi-plan", arguments: {} });
    await session.emit({ type: "turn_end", message, toolResults: [] });
  });
  const binding = createFakeBinding("A", new FakeRuntime(root, session, "A")); await bridge.bind(binding);
  try { await expect(bridge.promptAndWaitForTurnEnd(binding, "task", { formatting: {}, responseId: "response" })).rejects.toThrow("provider authentication failed"); }
  finally { bridge.dispose(); }
});

it.each(["pi-plan", "pi-execute", "pi-handoff", "pi-completion", "pi-final", "pi-check-in"])("classifies %s as a response-format failure without unsubscribing", async (toolName) => {
  const root = mkdtempSync(join(tmpdir(), "pi-bridge-protocol-"));
  const bridge = new RuntimeEventBridge(new TelemetryLogger({ filePath: join(root, "events"), jsonLogs: false, verbose: false }), new Metrics());
  let calls = 0;
  const session = new FakeSession("A", undefined, async () => {
    if (++calls === 1) await session.emit({ type: "tool_execution_start", toolCallId: "misuse", toolName, args: {} });
    else await session.emit(assistantTurnEnd("Recovered in the same session"));
  });
  const binding = createFakeBinding("A", new FakeRuntime(root, session, "A")); await bridge.bind(binding);
  try {
    await expect(bridge.promptAndWaitForTurnEnd(binding, "original", { responseId: "current-response" })).rejects.toMatchObject({ responseId: "current-response", toolName });
    expect(session.listeners.size).toBe(1);
    await expect(bridge.promptAndWaitForTurnEnd(binding, "explicit next submission")).resolves.toMatchObject({ role: "assistant" });
  } finally { bridge.dispose(); }
});
