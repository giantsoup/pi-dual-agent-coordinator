import { Key, matchesKey } from "@earendil-works/pi-tui";
export const bindings = {
  help: { key: Key.f1, hint: "F1 help", description: "Open contextual help; F1 or Esc restores the previous view" },
  models: { key: Key.f3, hint: "F3 models", description: "Choose Agent A or B's model; choose A's Low/Medium/High reasoning" },
  activity: { key: Key.f2, hint: "F2 activity", description: "Show or hide diagnostic activity" },
  nextPane: { key: Key.f6, hint: "F6 panes", description: "Cycle visible editor, workspace, history, inspector and activity panes" },
  previousPane: { key: Key.shift("f6"), hint: "Shift+F6 back", description: "Cycle panes backward" },
  scrollUp: { key: Key.pageUp, hint: "PgUp scroll up", description: "Scroll the request pane up a page, including while editing a draft" },
  scrollDown: { key: Key.pageDown, hint: "PgDn scroll down", description: "Scroll the request pane down a page, including while editing a draft" },
  scrollLineUp: { key: Key.shift("up"), hint: "Shift+Up", description: "Scroll the request pane up one line" },
  scrollLineDown: { key: Key.shift("down"), hint: "Shift+Down", description: "Scroll the request pane down one line" },
  inspect: { key: Key.enter, hint: "Enter inspect", description: "Inspect the selected record, or open the compact history control" },
  fold: { key: Key.space, hint: "Space fold", description: "Toggle just the selected record" },
  expand: { key: Key.right, hint: "Right expand", description: "Expand the selected record" },
  collapse: { key: Key.left, hint: "Left parent", description: "Collapse the selected record, or select its parent" },
  latest: { key: Key.end, hint: "End current", description: "Return to the current turn and resume following" },
  close: { key: Key.escape, hint: "Esc back", description: "Close one view, then return to the editor" },
  cancel: { key: Key.ctrl("c"), hint: "Ctrl+C cancel", description: "Cancel work; idle clears draft, then double press exits" }
};
export const bindingMatches = (data: string, name: keyof typeof bindings): boolean => matchesKey(data, bindings[name].key);
export const inspectorTabs = [
  { key: "1", section: "summary", label: "Summary" },
  { key: "2", section: "request", label: "Safe request" },
  { key: "3", section: "output", label: "Retained output" },
  { key: "4", section: "metadata", label: "Identity" }
] satisfies Array<{ key: string; section: import("../../types/history.js").HistoryDetail["section"]; label: string }>;
export function footerBindings(context: string): string {
  const common = [bindings.help.hint, bindings.models.hint, bindings.nextPane.hint];
  const local = context === "editor" ? ["PgUp/PgDn scroll", "Enter submit", "Tab complete"]
    : context === "inspector" ? ["1-4 tabs", "PgUp/PgDn scroll", bindings.close.hint]
    : context === "activity" ? ["Up/Down scroll", bindings.close.hint] : ["Up/Down select", bindings.inspect.hint, bindings.fold.hint];
  return [...common, ...local, bindings.activity.hint].join(" | ");
}
export function contextualHelp(context: string): string {
  return [`Controls / ${context}`, ...Object.values(bindings).map((binding) => `${binding.hint}: ${binding.description}`),
    "Request: Wheel/trackpad or PgUp/PgDn scroll | Shift+Up/Down scroll a line",
    "Scrolling pauses following. End returns to the current request and follows.",
    "Models: F3 opens | A/B agent | Up/Down model | Left/Right reasoning",
    "Models: S remember after restart | Enter apply | Esc close",
    "Model loading: Esc/Ctrl+C cancel | Q quit after cleanup",
    "Mouse: wheel over request or inspector | Shift+drag selects terminal text",
    "Records: F6 to focus | Up/Down select | Home first | End current/follow",
    "History: Up/Down select | PgUp/PgDn page | Home first | End current/follow",
    `Inspector only: ${inspectorTabs.map((tab) => `${tab.key} ${tab.label}`).join(" | ")}`,
    "Inspector: Up/Down scroll | PgUp/PgDn range | Home/End output edges",
    "Editor: Enter submit | Shift+Enter newline | Tab completion | Alt+Up prompt history",
    "Editor: /help typed fallback | /history | /inspect ID [section] [line offset]",
    "Selection and inspection are read-only. Session switching remains explicit."].join("\n");
}
