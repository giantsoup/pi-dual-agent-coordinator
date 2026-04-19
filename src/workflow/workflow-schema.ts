import { z } from "zod";

const schemaVersionSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  return /^1(?:\.0+)?$/.test(value.trim()) ? 1 : value;
}, z.literal(1));

const workflowIdSchema = z.string().min(1);
const handoffIdSchema = z.string().min(1);
const iterationSchema = z.number().int().positive();

export const handoffEnvelopeSchema = z.object({
  schemaVersion: schemaVersionSchema,
  workflowId: workflowIdSchema,
  handoffId: handoffIdSchema,
  iteration: iterationSchema,
  objective: z.string().min(1),
  summary: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  relevantPaths: z.array(z.string().min(1)).min(1),
  reviewNotes: z.array(z.string().min(1)).optional(),
  constraints: z.array(z.string().min(1)).optional(),
  requestId: z.string().min(1).optional(),
  originatingTurnIndex: z.number().int().nonnegative().optional()
});

export const completionRecordSchema = z.object({
  schemaVersion: schemaVersionSchema,
  workflowId: workflowIdSchema,
  handoffId: handoffIdSchema,
  iteration: iterationSchema,
  summary: z.string().min(1),
  changedPaths: z.array(z.string().min(1)),
  verification: z.array(z.string().min(1)).optional(),
  openQuestions: z.array(z.string().min(1)).optional(),
  requestId: z.string().min(1).optional(),
  originatingTurnIndex: z.number().int().nonnegative().optional()
});

export const finalDecisionSchema = z.object({
  schemaVersion: schemaVersionSchema,
  workflowId: workflowIdSchema,
  iteration: iterationSchema,
  decision: z.enum(["approved", "blocked"]),
  summary: z.string().min(1),
  userResponse: z.string().min(1),
  changedPaths: z.array(z.string().min(1)),
  followUps: z.array(z.string().min(1)).optional(),
  requestId: z.string().min(1).optional()
});
