import { describe, expect, it } from "vitest";
import { visibleAssistantText } from "../../src/app/interactive/service.js";
import { projectHistoryDetail } from "../../src/app/interactive/history-detail.js";
import { visibleProse } from "../../src/security/display-text.js";
import type { ArchiveEntry } from "../../src/runtime/session-history.js";
import type { HistoryRecord } from "../../src/types/history.js";

const payload = { schemaVersion: 1, workflowId: "internal-workflow", handoffId: "internal-handoff", iteration: 1, turnCount: 10,
  decision: "continue", reason: "The two fixes are underway; verification remains.", nextSteps: ["Run the regression tests.", "Finish the browser checks."] };
const block = "```pi-check-in\n" + JSON.stringify(payload) + "\n```";
const time = "2026-10-17T00:00:00.000Z";
const record: HistoryRecord = { kind: "run", id: "check", parentId: "turn", role: "A", sessionId: "session", phase: "Check-in",
  title: "Check-in", timestamp: time, outcome: { kind: "completed", endedAt: time } };
const entries: ArchiveEntry[] = [{ type: "message", id: "message", parentId: null, timestamp: time,
  message: { role: "assistant", content: [{ type: "text", text: block }] } }];

describe("check-in presentation", () => {
  it("shows a readable decision, reason, and next steps without protocol fields", () => {
    const text = visibleAssistantText(block);
    expect(text).toContain("Progress check after turn 10: Continue");
    expect(text).toContain(payload.reason);
    expect(text).toContain("- Run the regression tests.");
    for (const raw of ["pi-check-in", "schemaVersion", "workflowId", "internal-workflow", "internal-handoff"]) expect(text).not.toContain(raw);
  });

  it("hides every partial protocol block while it streams", () => {
    for (let end = 5; end <= block.length; end++) expect(visibleProse(block.slice(0, end))).toBe("");
    expect(visibleProse("Before\n" + block + "\nAfter")).toBe("Before\n\nAfter");
    expect(visibleProse("```pi-future-block\n{\"internal\":true}\n```")).toBe("");
    expect(visibleProse("```python\nprint('ok')\n```")).toContain("print('ok')");
  });

  it("renders the same summary from retained history and leaves identifiers in metadata", () => {
    const output = projectHistoryDetail(record, [record], entries, "output", 0, 100).lines.join("\n");
    expect(output).toContain("Progress check after turn 10: Continue");
    expect(output).toContain(payload.reason);
    expect(output).not.toContain("schemaVersion");
    expect(output).not.toContain("internal-workflow");
    const metadata = JSON.parse(projectHistoryDetail(record, [record], entries, "metadata", 0, 100).lines.join("\n"));
    expect(metadata.checkIn).toEqual(payload);
  });

  it("hides malformed and interrupted protocol output but preserves the error", () => {
    const partial = "```pi-check-in\n{\"schemaVersion\":1,\"workflowId\":\"internal-workflow\"";
    const archive: ArchiveEntry[] = [{ ...entries[0], type: "message", id: "partial", timestamp: time, parentId: null,
      message: { role: "assistant", content: [{ type: "text", text: partial }], errorMessage: "Request was aborted" } }];
    const text = projectHistoryDetail(record, [record], archive, "output", 0, 100).lines.join("\n");
    expect(text).not.toContain("schemaVersion");
    expect(text).toContain("Request was aborted");
    expect(visibleAssistantText("```pi-check-in\n{\"decision\":\"unknown\"}\n```")).toBe("");
  });
});
