import { z } from "zod";

const schemaVersionSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  return /^1(?:\.0+)?$/.test(value.trim()) ? 1 : value;
}, z.literal(1));

export const handoffEnvelopeSchema = z.object({
  schemaVersion: schemaVersionSchema,
  handoffId: z.string().min(1),
  objective: z.string().min(1),
  summary: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  relevantPaths: z.array(z.string().min(1)).min(1),
  constraints: z.array(z.string().min(1)).optional(),
  requestId: z.string().min(1).optional(),
  originatingTurnIndex: z.number().int().nonnegative().optional()
});

export const completionRecordSchema = z.object({
  schemaVersion: schemaVersionSchema,
  handoffId: z.string().min(1),
  summary: z.string().min(1),
  changedPaths: z.array(z.string().min(1)),
  verification: z.array(z.string().min(1)).optional(),
  requestId: z.string().min(1).optional(),
  originatingTurnIndex: z.number().int().nonnegative().optional()
});
