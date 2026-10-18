import { z } from "zod";

const request = z.object({
  input: z.array(z.object({ role: z.string().optional(), content: z.unknown().optional(),
    type: z.string().optional(), reasoning: z.object({ effort: z.string() }).optional() })),
  reasoning: z.object({ effort: z.string() }).optional()
});
/** Responses can append configuration updates after the current user input. */
export function responsesInput(body: unknown) {
  const parsed = request.parse(body);
  return {
    prompt: parsed.input.filter((item) => item.role === "user").at(-1)?.content,
    thinking: parsed.input.filter((item) => item.type === "configuration_update" && item.reasoning).at(-1)?.reasoning?.effort
      ?? parsed.reasoning?.effort
  };
}
