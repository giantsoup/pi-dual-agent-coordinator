import type { RoleRuntimeBinding } from "./create-role-runtime.js";
import { getModelDisplayInfo } from "./model-display.js";
import type { RuntimeStatusSnapshot } from "../types/status.js";

export type RuntimeHealth = RuntimeStatusSnapshot;

export function getRuntimeHealth(binding: RoleRuntimeBinding): RuntimeHealth {
  const model = getModelDisplayInfo(binding.session.model);
  return {
    role: binding.role,
    healthy: Boolean(binding.sessionId),
    sessionId: binding.sessionId,
    sessionFile: binding.sessionFile,
    cwd: binding.cwd,
    modelName: model.name,
    modelProvider: model.provider,
    modelId: model.id,
    modelCanonical: model.canonical,
    modelDisplay: model.display,
    thinking: binding.session.thinkingLevel ?? "(default)"
  };
}
