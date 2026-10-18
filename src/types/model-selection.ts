import type { Role } from "./role.js";

export const pickerReasoningLevels = ["low", "medium", "high"] satisfies string[];
export type PickerReasoning = "low" | "medium" | "high";

export interface ModelChoice {
  canonical: string;
  name: string;
  description: string;
  loaded?: boolean | undefined;
  disabledReason?: string | undefined;
}

export interface ModelPickerCatalog {
  role: Role;
  currentModel?: string | undefined;
  currentThinking?: string | undefined;
  models: ModelChoice[];
}

export interface ModelSwitchProgress {
  phase: "checking" | "unloading" | "loading" | "verifying" | "applying" | "restoring";
  message: string;
}
