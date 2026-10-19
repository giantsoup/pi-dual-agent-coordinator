import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Coordinator } from "../../src/coordinator/coordinator.js";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { fixtureResponse, fixtureChatResponse, fixtureChatToolResponse } from "../../src/security/fixture-provider.js";
import type { NormalizedTelemetryEvent } from "../../src/types/telemetry.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const block = (name: string, value: unknown) => `\`\`\`${name}\n${JSON.stringify(value)}\n\`\`\``;
function field(text: string, name: string): string {
  const value = new RegExp(`${name}: ([^\\n]+)`).exec(text)?.[1];
  if (!value) throw new Error(`Missing fixture ${name}`);
  return value;
}
function strings(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(strings).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(strings).join("\n");
  return "";
}

it.each([{ relevantPaths: [] }, { relevantPaths: ["."] }])("requires operator approval for model-generated inventory execution with paths=$relevantPaths", async ({ relevantPaths }) => {
  const root = await mkdtemp(join(tmpdir(), "pi-inventory-workflow-")); roots.push(root);
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const events: NormalizedTelemetryEvent[] = [];
  let bRequests = 0;
  const coordinator = new Coordinator({ cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode: "memory", jsonLogs: false, verbose: false,
    createRoleRuntime: options => createRoleRuntime({ ...options, providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-inventory-key", request: async (_url, init) => {
      const body: unknown = JSON.parse(String(init?.body));
      const prompt = strings(body);
      if (options.role === "B") {
        bRequests++;
        if (bRequests === 1) return fixtureChatToolResponse("list_tools", {});
        expect(prompt).toContain('"name": "list_tools"');
        expect(prompt).toContain('"parameters"');
        expect(prompt).toContain('"name": "write"');
        return fixtureChatResponse(block("pi-completion", { schemaVersion: 1, workflowId: field(prompt, "Workflow ID"), handoffId: field(prompt, "Handoff ID"), iteration: 1, summary: "Reported native tools", changedPaths: [], verification: ["Native list_tools result received"] }));
      }
      if (prompt.includes("Coordinator review prompt")) return fixtureResponse(block("pi-final", { schemaVersion: 1, workflowId: field(prompt, "Workflow ID"), iteration: 1, decision: "approved", summary: "Inventory checked", userResponse: "Both inventories verified", changedPaths: [] }));
      return fixtureResponse(block("pi-execute", { schemaVersion: 1, objective: "Report B's tools", summary: "Inspect session tools without file changes", relevantPaths, acceptanceCriteria: ["B lists its own native tools"], executionPlan: ["Call list_tools and report"] }));
    } } })
  });
  coordinator.subscribeEvents(event => events.push(event));
  try {
    await coordinator.start();
    const planned = await coordinator.submitUserInput("List your tools and then instruct Agent B to do the same.");
    expect(planned.pendingPlan?.relevantPaths).toEqual(relevantPaths);
    expect(bRequests).toBe(0);
    expect(events.filter(event => event.eventType === "workflow.repair_requested")).toEqual([]);
    const completed = await coordinator.approvePendingPlan();
    expect(completed.workflow?.status).toBe("completed");
    expect(bRequests).toBe(2);
    expect(events.some(event => event.eventType === "pi.tool_execution_end" && event.role === "B" && event.details.toolName === "list_tools" && event.details.isError === false)).toBe(true);
  } finally { await coordinator.dispose(); }
});
