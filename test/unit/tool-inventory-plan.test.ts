import { expect, it } from "vitest";
import { executionPlanEnvelopeSchema, handoffEnvelopeSchema, planProposalEnvelopeSchema } from "../../src/handoff/handoff-envelope-schema.js";

const inventoryPlan = {
  schemaVersion: 1,
  objective: "Have Agent B report its available tools.",
  summary: "Independently inspect the executor's own tool interfaces. No files need changing.",
  acceptanceCriteria: ["Report the callable tools from the executor's session"],
  relevantPaths: [],
  executionPlan: ["Inspect tool interfaces, verify MCP connectivity, and report without changing files"]
};

it("accepts the observed tool-inventory plan without inventing a workspace path", () => {
  expect(executionPlanEnvelopeSchema.safeParse(inventoryPlan).success).toBe(true);
  expect(planProposalEnvelopeSchema.safeParse(inventoryPlan).success).toBe(true);
  expect(handoffEnvelopeSchema.safeParse({ ...inventoryPlan, workflowId: "inventory", handoffId: "inventory-1", iteration: 1 }).success).toBe(true);
});
