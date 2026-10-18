import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repairResponse, ResponseFormatError, ResponseRepairExhaustedError } from "../../src/coordinator/response-repair.js";
import { RuntimeEventBridge } from "../../src/coordinator/bind-runtime-events.js";
import { TelemetryLogger } from "../../src/telemetry/logger.js";
import { Metrics } from "../../src/telemetry/metrics.js";
import { assistantTurnEnd, createFakeBinding, FakeRuntime, FakeSession } from "../helpers/fakes.js";

function setup(successAt: number) {
  const root = mkdtempSync(join(tmpdir(), "pi-repair-"));
  const events: Array<{ eventType: string; details: Record<string, unknown> }> = [];
  const logger = new TelemetryLogger({ filePath: join(root, "events"), jsonLogs: false, verbose: false });
  logger.subscribe((event) => events.push(event));
  const bridge = new RuntimeEventBridge(logger, new Metrics());
  let count = 0;
  const session = new FakeSession("A", undefined, async (_text, options) => {
    count++;
    if (count > 1) expect(options?.formatOnly).toBe(true);
    await session.emit(assistantTurnEnd(count === successAt ? "valid" : "invalid"));
  });
  const binding = createFakeBinding("A", new FakeRuntime(root, session, "A"));
  const run = async (submit?: (id: string) => Promise<never>) => {
    await bridge.bind(binding);
    return repairResponse({ bridge, binding, kind: "check-in", identifiers: { requestId: "request", workflowId: "workflow", handoffId: "handoff", iteration: 2, turnCount: 10 },
      shape: "exactly one pi-check-in JSON block", submit: submit ?? ((responseId) => bridge.promptAndWaitForTurnEnd(binding, "original task", { responseId })),
      validate: (message) => message.role === "assistant" && message.content.some((part) => part.type === "text" && part.text === "valid")
        ? { value: { kind: "accepted" } } : { reason: "Expected pi-check-in for iteration 2" } });
  };
  return { run, bridge, session, events, binding };
}

describe("one budget for each required response", () => {
  it.each([1, 2, 10])("accepts success on total attempt %i", async (successAt) => {
    const fixture = setup(successAt);
    try {
      await expect(fixture.run()).resolves.toEqual({ kind: "accepted" });
      expect(fixture.session.prompts).toHaveLength(successAt);
      expect(fixture.session.prompts.filter((text) => text === "original task")).toHaveLength(1);
      const progress = fixture.events.filter((event) => event.eventType === "response.attempt_started");
      expect(progress.map((event) => event.details.attempt)).toEqual(Array.from({ length: successAt }, (_, index) => index + 1));
      expect(new Set(progress.map((event) => event.details.responseId)).size).toBe(1);
      expect(fixture.events.filter((event) => event.eventType === "workflow.repair_requested")).toHaveLength(successAt - 1);
      for (const prompt of fixture.session.prompts.slice(1)) {
        expect(prompt).toContain("Expected pi-check-in for iteration 2");
        expect(prompt).toContain('"turnCount":10');
        expect(prompt).toContain("pi-check-in");
      }
    } finally { fixture.bridge.dispose(); }
  });
  it("exhausts at ten responses, nine repairs, and never submits eleven", async () => {
    const fixture = setup(Infinity);
    try {
      await expect(fixture.run()).rejects.toBeInstanceOf(ResponseRepairExhaustedError);
      expect(fixture.session.prompts).toHaveLength(10);
      expect(fixture.events.filter((event) => event.eventType === "workflow.repair_requested")).toHaveLength(9);
      expect(fixture.events.filter((event) => event.eventType === "response.exhausted")).toHaveLength(1);
      expect(fixture.events.at(-1)?.details.reason).toContain("Expected pi-check-in");
    } finally { fixture.bridge.dispose(); }
  });
  it.each([new Error("authentication failed"), new ResponseFormatError("nested", "other response")])("does not retry unrelated failures", async (error) => {
    const fixture = setup(1);
    try {
      await expect(fixture.run(async () => { throw error; })).rejects.toBe(error);
      expect(fixture.session.prompts).toHaveLength(0);
      expect(fixture.events.some((event) => event.eventType === "workflow.repair_requested")).toBe(false);
    } finally { fixture.bridge.dispose(); }
  });
});

describe("repair lifetime", () => {
  it("propagates nested exhaustion once, without spending an outer repair budget", async () => {
    const fixture = setup(Infinity);
    try {
      let nested: unknown;
      try { await fixture.run(); } catch (error) { nested = error; }
      if (!(nested instanceof ResponseRepairExhaustedError)) throw new Error("Expected nested exhaustion");
      const before = fixture.events.length;
      await expect(fixture.run(async () => { throw nested; })).rejects.toBe(nested);
      expect(fixture.events.slice(before).map((event) => event.eventType).filter((type) => type.startsWith("response."))).toEqual(["response.attempt_started"]);
    } finally { fixture.bridge.dispose(); }
  });
  it("bounds one protocol misuse per submission and keeps subscriptions usable for explicit new work", async () => {
    const fixture = setup(Infinity);
    let calls = 0;
    const original = fixture.session.prompt.bind(fixture.session);
    fixture.session.prompt = async (text, options) => {
      calls++;
      if (calls <= 10) {
        await fixture.session.emit({ type: "tool_execution_start", toolCallId: String(calls), toolName: calls % 2 ? "pi-plan" : "pi-final", args: {} });
        await fixture.session.emit(assistantTurnEnd("invalid"));
      } else await original(text, options);
    };
    try {
      await expect(fixture.run()).rejects.toBeInstanceOf(ResponseRepairExhaustedError);
      expect(calls).toBe(10); expect(fixture.session.listeners.size).toBe(1);
      const message = await fixture.bridge.promptAndWaitForTurnEnd(createFakeBinding("A", new FakeRuntime("/tmp", fixture.session, "A")), "explicit new work");
      expect(message.role).toBe("assistant"); expect(calls).toBe(11);
    } finally { fixture.bridge.dispose(); }
  });
});

it("keeps one response identity and budget across runtime rebinds and fresh model run IDs", async () => {
  const fixture = setup(10);
  const original = fixture.session.prompt.bind(fixture.session);
  fixture.session.prompt = async (text, options) => { await fixture.bridge.bind(fixture.binding); await original(text, options); };
  try {
    await fixture.run();
    expect(fixture.session.prompts).toHaveLength(10);
    const runs = fixture.events.filter((event) => event.eventType === "runtime.run_started");
    expect(runs).toHaveLength(10);
    expect(new Set(runs.map((event) => event.details.runId)).size).toBe(10);
    expect(new Set(runs.map((event) => event.details.responseId)).size).toBe(1);
  } finally { fixture.bridge.dispose(); }
});

it("does not turn a submission cleanup failure into a response repair", async () => {
  const fixture = setup(Infinity);
  fixture.session.prompt = async (_text, options) => { throw new ResponseFormatError(options?.responseId ?? "", "Bad format"); };
  fixture.session.abort = async () => { throw new Error("Cleanup failed"); };
  try {
    await expect(fixture.run()).rejects.toThrow("Cleanup failed");
    expect(fixture.events.filter((event) => event.eventType === "workflow.repair_requested")).toHaveLength(0);
  } finally { fixture.bridge.dispose(); }
});
