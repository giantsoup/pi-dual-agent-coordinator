import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Role } from "./role.js";

export const pickerReasoningLevels = ["low", "medium", "high"] satisfies ThinkingLevel[];
export type PickerReasoning = ThinkingLevel;

export interface ModelChoice {
  canonical: string;
  name: string;
  description: string;
  thinkingLevels?: ThinkingLevel[];
  defaultThinking?: ThinkingLevel;
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
