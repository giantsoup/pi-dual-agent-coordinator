import { z } from "zod";
import { safeDisplayText } from "../security/display-text.js";
import type { ModelTurnEnd } from "../runtime/create-role-runtime.js";

const observationSchema = z.object({
  toolCallId: z.string().max(256), toolName: z.string().max(256), status: z.enum(["success", "error"]),
  command: z.string().max(2000).optional(), commandTruncated: z.boolean().optional(),
  exitCode: z.number().int().nullable(), output: z.string().max(4100),
  outputTruncated: z.boolean().nullable(), source: z.enum(["bash-native-metadata", "native-text"])
});
export const nativeEvidenceSchema = z.object({ schemaVersion: z.literal(1), observations: z.array(observationSchema).max(50), omitted: z.number().int().nonnegative() });
export type NativeEvidence = z.infer<typeof nativeEvidenceSchema>;
const shellResultSchema = z.object({ piDualShell: z.object({ outputTruncated: z.boolean(), exitCode: z.number().int() }) });

/** Native facts only. Exit status describes the shell command, never every process in a pipeline. */
export function observeNativeTurn(event: ModelTurnEnd): NativeEvidence["observations"] {
  if (event.message.role !== "assistant") return [];
  return event.message.content.flatMap((call) => {
    if (call.type !== "toolCall") return [];
    const result = event.toolResults.find((item) => item.toolCallId === call.id && item.toolName === call.name);
    if (!result) return [];
    const shell = call.name === "bash" ? shellResultSchema.safeParse(result.details) : undefined;
    const text = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    const safe = safeDisplayText(text);
    const command = call.name === "bash" && typeof call.arguments.command === "string" ? safeDisplayText(call.arguments.command) : undefined;
    return [{ toolCallId: call.id, toolName: call.name, status: result.isError ? "error" as const : "success" as const,
      ...(command === undefined ? {} : { command: command.slice(0, 2000), commandTruncated: command.length > 2000 }),
      exitCode: shell?.success ? shell.data.piDualShell.exitCode : null,
      output: safe.length > 4000 ? `${safe.slice(0, 2000)}\n[output omitted]\n${safe.slice(-2000)}` : safe,
      outputTruncated: safe.length > 4000 ? true : shell?.success ? shell.data.piDualShell.outputTruncated : null,
      source: shell?.success ? "bash-native-metadata" as const : "native-text" as const }];
  });
}

/** Historical records without this metadata remain unknown. No archive mutation or execution. */
export function readNativeEvidence(details: Record<string, unknown> | undefined): NativeEvidence | undefined {
  const parsed = nativeEvidenceSchema.safeParse(details?.nativeEvidence);
  return parsed.success ? parsed.data : undefined;
}
