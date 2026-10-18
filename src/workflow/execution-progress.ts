import { z } from "zod";

export const EXECUTION_CHECK_IN_INTERVAL = 10;

export const executionProgressSchema = z.object({
  workflowId: z.string().min(1),
  handoffId: z.string().min(1),
  iteration: z.number().int().positive(),
  // Successful B responses only. Failed tools, invalid reports, and format repairs do not advance it.
  completedTurns: z.number().int().nonnegative(),
  checkIn: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("scheduled"), afterTurn: z.number().int().positive() }),
    z.object({ kind: z.literal("checking"), afterTurn: z.number().int().positive() }),
    z.object({ kind: z.literal("final_review") }),
    z.object({ kind: z.literal("stopped") })
  ])
});

export type ExecutionProgress = z.infer<typeof executionProgressSchema>;
