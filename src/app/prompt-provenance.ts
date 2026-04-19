export type PromptProvenance =
  | "planning_user"
  | "planning_repair"
  | "user_task"
  | "coordinator_handoff"
  | "coordinator_review"
  | "coordinator_repair"
  | "coordinator_control";

export interface PromptTagOptions {
  requestId?: string | undefined;
  handoffId?: string | undefined;
  workflowId?: string | undefined;
  iteration?: number | undefined;
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
    workflowId: options.workflowId,
    handoffId: options.handoffId,
    iteration:
      typeof options.iteration === "number" ? String(options.iteration) : undefined,
    sessionRole: options.sessionRole
  })
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");

  const prefix = attributes.length > 0 ? `<pi-dual ${attributes}>` : "<pi-dual>";
  return `${prefix}\n${text}`.trim();
}
