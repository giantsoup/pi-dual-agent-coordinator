import { z } from "zod";

const schemaVersionSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  return /^1(?:\.0+)?$/.test(value.trim()) ? 1 : value;
}, z.literal(1));

const workflowIdSchema = z.string().trim().min(1);
const handoffIdSchema = z.string().trim().min(1);
const iterationSchema = z.number().int().positive();

export const checkInSchema = z.object({
  schemaVersion: z.literal(1),
  workflowId: z.string(),
  handoffId: z.string(),
  iteration: iterationSchema,
  turnCount: z.number().int().positive(),
  decision: z.enum(["continue", "redirect", "blocked"]),
  reason: z.string().trim().min(1).max(800),
  nextSteps: z.array(z.string().trim().min(1).max(800)).max(5)
}).strict().refine((value) => value.decision !== "redirect" || value.nextSteps.length > 0, {
  message: "A redirect requires concrete next steps."
});

export const handoffEnvelopeSchema = z.object({
  schemaVersion: schemaVersionSchema,
  workflowId: workflowIdSchema,
  handoffId: handoffIdSchema,
  iteration: iterationSchema,
  objective: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  acceptanceCriteria: z.array(z.string().trim().min(1)).min(1),
  relevantPaths: z.array(z.string().trim().min(1)).min(1),
  executionPlan: z.array(z.string().trim().min(1)).optional(),
  reviewNotes: z.array(z.string().trim().min(1)).optional(),
  constraints: z.array(z.string().trim().min(1)).optional(),
  requestId: z.string().trim().min(1).optional(),
  originatingTurnIndex: z.number().int().nonnegative().optional()
});

export const executionPlanEnvelopeSchema = z.object({
  schemaVersion: schemaVersionSchema,
  objective: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  acceptanceCriteria: z.array(z.string().trim().min(1)).min(1),
  relevantPaths: z.array(z.string().trim().min(1)).min(1),
  executionPlan: z.array(z.string().trim().min(1)).min(1),
  constraints: z.array(z.string().trim().min(1)).optional()
});

export const planProposalEnvelopeSchema = executionPlanEnvelopeSchema;

export const completionRecordSchema = z.object({
  schemaVersion: schemaVersionSchema,
  workflowId: workflowIdSchema,
  handoffId: handoffIdSchema,
  iteration: iterationSchema,
  summary: z.string().trim().min(1),
  changedPaths: z.array(z.string().trim().min(1)),
  verification: z.array(z.string().trim().min(1)).optional(),
  openQuestions: z.array(z.string().trim().min(1)).optional(),
  requestId: z.string().trim().min(1).optional(),
  originatingTurnIndex: z.number().int().nonnegative().optional()
});

export const finalDecisionSchema = z.object({
  schemaVersion: schemaVersionSchema,
  workflowId: workflowIdSchema,
  iteration: iterationSchema,
  decision: z.enum(["approved", "blocked"]),
  summary: z.string().trim().min(1),
  userResponse: z.string().trim().min(1),
  changedPaths: z.array(z.string().trim().min(1)),
  followUps: z.array(z.string().trim().min(1)).optional(),
  requestId: z.string().trim().min(1).optional()
});

/** Schemas stay with the workflow owner, including their format-repair representation. */
export function responseShape(...schemas: z.ZodType[]): string {
  return schemas.map((schema) => JSON.stringify(z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }))).join("\nOR\n");
}
