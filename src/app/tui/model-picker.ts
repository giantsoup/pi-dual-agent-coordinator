import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ModelPickerCatalog, PickerReasoning } from "../../types/model-selection.js";
import { pickerReasoningLevels } from "../../types/model-selection.js";
import type { UiAction } from "../../types/ui.js";
import { frame, paintRole } from "./workspace.js";

export class ModelPicker {
  private index: number;
  private reasoning: PickerReasoning;
  private remember = true;
  public constructor(private readonly catalog: ModelPickerCatalog) {
    this.index = Math.max(0, catalog.models.findIndex((model) => model.canonical === catalog.currentModel));
    this.reasoning = this.selectedDefault();
  }
  public handleInput(data: string, busy: boolean): UiAction | undefined {
    if (data.toLowerCase() === "a" || data.toLowerCase() === "b") return { type: "open_models", role: data.toLowerCase() === "a" ? "A" : "B" };
    if (data.toLowerCase() === "r") return { type: "open_models", role: this.catalog.role };
    if (data.toLowerCase() === "s") this.remember = !this.remember;
    const previousIndex = this.index;
    if (matchesKey(data, Key.up)) this.index--;
    if (matchesKey(data, Key.down)) this.index++;
    if (matchesKey(data, Key.home)) this.index = 0;
    if (matchesKey(data, Key.end)) this.index = this.catalog.models.length - 1;
    if (matchesKey(data, Key.pageUp)) this.index -= 5;
    if (matchesKey(data, Key.pageDown)) this.index += 5;
    this.index = Math.max(0, Math.min(Math.max(0, this.catalog.models.length - 1), this.index));
    if (previousIndex !== this.index) this.reasoning = this.selectedDefault();
    const levels = this.levels();
    const index = levels.indexOf(this.reasoning);
    const next = matchesKey(data, Key.left) ? index - 1 : matchesKey(data, Key.right) ? index + 1 : index;
    this.reasoning = levels[Math.max(0, Math.min(levels.length - 1, next))] ?? "off";
    const model = this.catalog.models[this.index];
    if (matchesKey(data, Key.enter) && model && !model.disabledReason && !busy) return {
      type: "configure_role", role: this.catalog.role, model: model.canonical, save: this.remember,
      thinking: this.reasoning
    };
    return undefined;
  }
  private levels(): PickerReasoning[] {
    return this.catalog.models[this.index]?.thinkingLevels ?? (this.catalog.role === "A" ? pickerReasoningLevels : ["off"]);
  }
  private selectedDefault(): PickerReasoning {
    const model = this.catalog.models[this.index];
    const levels = this.levels();
    return (model?.canonical === this.catalog.currentModel ? levels.find(level => level === this.catalog.currentThinking) : undefined)
      ?? model?.defaultThinking ?? (this.catalog.role === "A" ? "high" : "off");
  }
  public render(width: number, height: number, busy: boolean, pendingPlan: boolean): string[] {
    const { role, models } = this.catalog;
    const current = models.find((model) => model.canonical === this.catalog.currentModel)?.name ?? this.catalog.currentModel ?? "None";
    const body = [role === "A" ? "[A Agent A / Planner]    B Agent B / Executor" : " A Agent A / Planner    [B Agent B / Executor]",
      `Current: ${current} / ${this.catalog.currentThinking ?? "off"}`, ""];
    const rows = Math.max(1, Math.floor((height - 11) / 2));
    const start = Math.max(0, Math.min(Math.max(0, models.length - rows), this.index - Math.floor(rows / 2)));
    for (const [offset, model] of models.slice(start, start + rows).entries()) {
      const selected = start + offset === this.index;
      const marker = model.canonical === this.catalog.currentModel ? " / Current" : "";
      const state = role === "B" ? model.disabledReason ? " / Unavailable" : model.loaded ? " / Ready" : " / Not loaded" : "";
      body.push(paintRole(`${selected ? ">" : " "} ${model.name}${marker}${state}`, selected ? role : undefined),
        `  ${truncateToWidth(model.disabledReason ?? model.description, Math.max(1, width - 6), "…")}`);
    }
    if (!models.length) body.push("No downloaded models. Download a tool-capable LLM in LM Studio.", "R refreshes the list.");
    while (body.length < 3 + rows * 2) body.push("");
    body.push(`Reasoning: ${this.levels().map((level) => this.reasoning === level ? `[${capitalize(level)}]` : capitalize(level)).join("   ")}`);
    body.push(`[${this.remember ? "x" : " "}] Remember after restart${models.length > rows ? `    ${this.index + 1}/${models.length}` : ""}`,
      busy ? "Finish work, or close and use Controls > Cancel work." : pendingPlan ? "Changing settings clears the pending plan." : "Conversation and draft are preserved.",
      role === "A" ? "↑/↓ model | ←/→ reasoning | Enter apply" : "↑/↓ model | ←/→ reasoning | Enter load and apply",
      "a/b agent | s remember | r refresh | h help | Esc back");
    return frame("Models", body, width, Math.min(height, body.length + 2), role);
  }
}
function capitalize(value: string): string { return value[0]?.toUpperCase() + value.slice(1); }
