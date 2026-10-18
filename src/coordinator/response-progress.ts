import { z } from "zod";

export const RESPONSE_ATTEMPT_LIMIT = 10;

export const responseProgressSchema = z.object({
  responseId: z.string().min(1),
  state: z.enum(["attempting", "rejected", "succeeded", "exhausted", "stopping"]),
  responseKind: z.enum(["planning", "handoff", "review", "final", "completion", "check-in"]),
  requestId: z.string().min(1), workflowId: z.string().optional(), handoffId: z.string().optional(),
  iteration: z.number().int().nonnegative().optional(), turnCount: z.number().int().positive().optional(),
  attempt: z.number().int().min(1).max(RESPONSE_ATTEMPT_LIMIT), maxAttempts: z.literal(RESPONSE_ATTEMPT_LIMIT),
  repairCount: z.number().int().min(0).max(RESPONSE_ATTEMPT_LIMIT - 1), reason: z.string().optional(), label: z.string()
});
export type ResponseProgress = z.infer<typeof responseProgressSchema>;
