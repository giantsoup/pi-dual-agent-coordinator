import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HistoryIndex } from "../../src/app/interactive/history.js";
import { readSessionArchive, archiveRunEntries } from "../../src/runtime/session-history.js";
import { safeDisplayText } from "../../src/security/display-text.js";
import { protectSecret } from "../../src/security/redact.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";

const time = "2026-10-16T12:00:00.000Z";
const event = (eventType: string, details: Record<string, unknown> = {}, extra: Partial<NormalizedTelemetryEvent> = {}): NormalizedTelemetryEvent => ({ eventType, details, operatorTurnId: "turn", runId: "run", role: "B", sessionId: "session", requestId: "request", timestamp: time, ...extra });
describe("retained history identities and recovery", () => {
  it("keeps more than eight calls, preserves failures, ignores duplicates and scopes reused IDs by session and run", () => {
    const index = new HistoryIndex();
    const events = [event("ui.turn_started", { objective: "Task" }), event("runtime.run_started", { provenance: "coordinator_handoff" })];
    for (let i = 0; i < 14; i++) {
      const start = event("pi.tool_execution_start", { toolName: "read", toolCallId: `call-${i}`, toolArgs: { path: `file-${i}` } });
      const end = event("pi.tool_execution_end", { toolName: "read", toolCallId: `call-${i}`, isError: i === 2, resultPreview: "Only a preview" });
      events.push(start, start, end, end, start);
    }
    events.push(event("runtime.run_started", { provenance: "coordinator_review" }, { role: "A", sessionId: "another-session", runId: "review" }),
      event("pi.tool_execution_start", { toolName: "read", toolCallId: "call-0" }, { role: "A", sessionId: "another-session", runId: "review" }));
    for (const item of events) index.observe(item);
    expect(index.snapshot().records.filter((record) => record.kind === "tool")).toHaveLength(15);
    expect(index.snapshot().records.filter((record) => record.kind === "tool" && record.outcome.kind === "failed")).toHaveLength(1);
    const restored = new HistoryIndex(); restored.restore({ events, warnings: [] });
    expect(restored.snapshot().records.find((record) => record.id === "review")?.outcome.kind).toBe("interrupted");
    expect(restored.snapshot().records.filter((record) => record.kind === "tool" && record.outcome.kind === "interrupted")).toHaveLength(1);
  });
  it.each(["cancelled", "timed_out", "failed"])("preserves completed calls while closing unfinished records as %s", (status) => {
    const index = new HistoryIndex();
    for (const item of [event("ui.turn_started", { objective: "Task" }), event("runtime.run_started"), event("pi.tool_execution_end", { toolName: "read", toolCallId: "done" }), event("pi.tool_execution_start", { toolName: "bash", toolCallId: "pending" }), event("ui.turn_finished", { outcome: status })]) index.observe(item);
    expect(index.snapshot().records.find((record) => record.kind === "tool" && record.callId === "done")?.outcome.kind).toBe("completed");
    expect(index.snapshot().records.find((record) => record.kind === "tool" && record.callId === "pending")?.outcome.kind).toBe(status);
  });
  it("links approval and workflow to the original turn with a different request ID", () => {
    const index = new HistoryIndex();
    for (const item of [event("ui.turn_started"), event("runtime.run_started"), event("planning.plan_ready"), event("ui.turn_finished", { outcome: "waiting_approval" }), event("ui.turn_started", {}, { requestId: "approved-request" }), event("runtime.run_started", {}, { requestId: "approved-request", runId: "execution" }), event("workflow.started", { workflowId: "workflow" }, { operatorTurnId: undefined, requestId: "approved-request" })]) index.observe(item);
    expect(index.snapshot().records.filter((record) => record.kind === "turn")).toHaveLength(1);
    expect(index.get("turn")).toMatchObject({ planId: "request", requestIds: ["request", "approved-request"], workflowId: "workflow" });
  });
  it("reads pre-compaction messages and separate branches without modifying the archive", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-archive-")); const path = join(root, "session.jsonl");
    const rows = [
      { type: "session", version: 3, id: "session", cwd: root, timestamp: time },
      { type: "custom", id: "root", parentId: null, timestamp: time, customType: "pi-dual-run", data: { runId: "old-run" } },
      { type: "message", id: "old-message", parentId: "root", timestamp: time, message: { role: "assistant", content: [{ type: "text", text: "Before compaction" }] } },
      { type: "compaction", id: "compact", parentId: "old-message", timestamp: time },
      { type: "custom", id: "branch-marker", parentId: "root", timestamp: time, customType: "pi-dual-run", data: { runId: "branch-run" } },
      { type: "message", id: "branch-message", parentId: "branch-marker", timestamp: time, message: { role: "assistant", content: [{ type: "text", text: "Separate branch" }] } }
    ];
    try {
      const bytes = rows.map((row) => JSON.stringify(row)).join("\n") + "\n"; writeFileSync(path, bytes);
      const archive = readSessionArchive(path);
      expect(archiveRunEntries(archive, "old-run").map((entry) => entry.id)).toContain("old-message");
      expect(archiveRunEntries(archive, "old-run").map((entry) => entry.id)).not.toContain("branch-message");
      expect(archiveRunEntries(archive, "branch-run").map((entry) => entry.id)).toEqual(["branch-marker", "branch-message"]);
      expect(readFileSync(path, "utf8")).toBe(bytes);
      writeFileSync(path, bytes + JSON.stringify({ type: "message", id: "cyclic", parentId: "cyclic", timestamp: time, message: { role: "user", content: "cycle" } }));
      expect(() => readSessionArchive(path)).toThrow("Cyclic");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("strips terminal controls and redacts protected and credential/environment text", () => {
    const release = protectSecret("unique-dummy-private-value");
    try {
      expect(safeDisplayText("界 é 😀\u001b[2J\u001b[H\u001b]52;c;clipboard\u0007\u001b]8;;url\u001b\\link\u001b]8;;\u001b\\\u001b[31mred\u001b[0m\u009b unsafe\u202ereverse unique-dummy-private-value OPENAI_API_KEY=foo password=bar")).toBe("界 é 😀linkred unsafereverse [REDACTED] OPENAI_API_KEY=[REDACTED] password=[REDACTED]");
      const json = '{"command":"OPENAI_API_KEY=dummy"}';
      const safe = safeDisplayText(json);
      expect(JSON.parse(safe)).toEqual({ command: "OPENAI_API_KEY=[REDACTED]" });
      expect(safeDisplayText(safe)).toBe(safe);
    } finally { release(); }
  });
});
