export type PromptProvenance =
  | "user_task"
  | "coordinator_handoff"
  | "coordinator_control";

export interface PromptTagOptions {
  requestId?: string | undefined;
  handoffId?: string | undefined;
  sessionRole?: string | undefined;
}

export function withPromptProvenance(
  provenance: PromptProvenance,
  text: string,
  options: PromptTagOptions = {}
): string {
  const attributes = Object.entries({
    provenance,
    requestId: options.requestId,
    handoffId: options.handoffId,
    sessionRole: options.sessionRole
  })
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");

  const prefix = attributes.length > 0 ? `<pi-dual ${attributes}>` : "<pi-dual>";
  return `${prefix}\n${text}`.trim();
}
