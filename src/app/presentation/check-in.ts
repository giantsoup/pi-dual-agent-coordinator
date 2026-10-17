import { extractMachineBlock } from "../../handoff/handoff-envelope.js";
import { checkInSchema } from "../../workflow/workflow-schema.js";
import { safeDisplayText } from "../../security/display-text.js";

export function readCheckInForDisplay(text: string) {
  if ([...text.matchAll(/```pi-[a-z0-9-]+\b/g)].length !== 1) return undefined;
  const block = extractMachineBlock(text, "pi-check-in");
  if (!block) return undefined;
  try {
    const parsed = checkInSchema.safeParse(JSON.parse(block));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function renderCheckInSummary(text: string): string {
  const checkIn = readCheckInForDisplay(text);
  if (!checkIn) return "";
  const labels = { continue: "Continue", redirect: "Adjusting course", blocked: "Needs attention" };
  return safeDisplayText([
    `Progress check after turn ${checkIn.turnCount}: ${labels[checkIn.decision]}`,
    checkIn.reason,
    ...(checkIn.nextSteps.length ? ["", "Next steps:", ...checkIn.nextSteps.map((step) => `- ${step}`)] : [])
  ].join("\n"));
}
