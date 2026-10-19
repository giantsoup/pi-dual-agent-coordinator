import { Key, matchesKey, type KeyId } from "@earendil-works/pi-tui";
export const bindings = {
  help: { key: Key.f1, hint: "F1 help", description: "Open contextual help; F1 or Esc restores the previous view" },
  models: { key: Key.f3, hint: "F3 models", description: "Choose Agent A or B's model; choose A's Low/Medium/High reasoning" },
  history: { key: Key.f4, hint: "F4 history", description: "Choose a displayed request; Esc or F4 dismisses without selecting" },
  activity: { key: Key.f2, hint: "F2 activity", description: "Show or hide diagnostic activity" },
  nextPane: { key: Key.f6, hint: "F6 panes", description: "Cycle visible editor, workspace, inspector and activity panes" },
  previousPane: { key: Key.shift("f6"), hint: "Shift+F6 back", description: "Cycle panes backward" },
  scrollUp: { key: Key.pageUp, hint: "PgUp scroll up", description: "Scroll the request pane up a page, including while editing a draft" },
  scrollDown: { key: Key.pageDown, hint: "PgDn scroll down", description: "Scroll the request pane down a page, including while editing a draft" },
  scrollLineUp: { key: Key.shift("up"), hint: "Shift+Up", description: "Scroll the request pane up one line" },
  scrollLineDown: { key: Key.shift("down"), hint: "Shift+Down", description: "Scroll the request pane down one line" },
  inspect: { key: Key.enter, hint: "Enter inspect", description: "Inspect the selected record; in history, choose the highlighted request" },
  fold: { key: Key.space, hint: "Space fold", description: "Toggle just the selected record" },
  expand: { key: Key.right, hint: "Right expand", description: "Expand the selected record" },
  collapse: { key: Key.left, hint: "Left parent", description: "Collapse the selected record, or select its parent" },
  latest: { key: Key.end, hint: "End current", description: "Return to current output; in history, highlight Current without selecting" },
  close: { key: Key.escape, hint: "Esc back", description: "Close one view; otherwise open controls" },
  cancel: { key: Key.ctrl("c"), hint: "Ctrl+C cancel", description: "Cancel work; idle clears draft, then double press exits" }
};
export function bindingMatches(data: string, name: keyof typeof bindings): boolean {
  // Pi 1.3 matches F4's legacy forms only. Normalize unmodified enhanced press/repeat forms.
  if (name === "history" && /^\x1b\[(?:(?:1(?:;1(?::[12])?)?)?S|14;1(?::[12])?~)$/.test(data)) data = "\x1bOS";
  return matchesKey(data, bindings[name].key);
}
export const inspectorTabs = [
  { key: "1", section: "summary", label: "Summary" },
  { key: "2", section: "request", label: "Safe request" },
  { key: "3", section: "output", label: "Retained output" },
  { key: "4", section: "metadata", label: "Identity" }
] satisfies Array<{ key: string; section: import("../../types/history.js").HistoryDetail["section"]; label: string }>;
export const controlActions = [
  { key: "h", action: "help", label: "Help", description: "Show commands and keyboard controls" },
  { key: "m", action: "models", label: "Models", description: "Choose models and reasoning settings" },
  { key: "a", action: "activity", label: "Activity", description: "Show or hide diagnostic activity" },
  { key: "w", action: "workspace", label: "Workspace", description: "Browse the current request's records" },
  { key: "r", action: "history", label: "Request history", description: "Choose the displayed request" },
  { key: "e", action: "editor", label: "Editor", description: "Return to your draft" },
  { key: "p", action: "prompts", label: "Previous prompts", description: "Up/Down browse; Down returns to your draft" },
  { key: "l", action: "latest", label: "Latest output", description: "Resume following the current request" },
  { key: "n", action: "newline", label: "Newline", description: "Insert a newline at the draft cursor" },
  { key: "x", action: "cancel", label: "Cancel work", description: "Stop running work and preserve your draft" },
  { key: "q", action: "quit", label: "Quit", description: "Confirm before exiting" }
] satisfies Array<{ key: KeyId; action: "help" | "models" | "activity" | "workspace" | "history" | "editor" | "prompts" | "latest" | "newline" | "cancel" | "quit"; label: string; description: string }>;
export type ControlAction = typeof controlActions[number]["action"];

// Translate printable navigation only after input has left the editor.
export function browsingInput(data: string): string {
  for (const [key, sequence] of [["u", "\x1b[5~"], ["d", "\x1b[6~"], ["g", "\x1b[H"], ["l", "\x1b[F"]] satisfies Array<[KeyId, string]>) {
    if (matchesKey(data, key)) return sequence;
  }
  return data;
}

export function footerBindings(context: string): string {
  if (context === "editor") return "Esc controls | Esc r history | F4 history | Enter submit | Tab complete";
  if (context === "history") return "Esc/F4 back | h help | Arrows highlight | Enter choose | l current";
  if (context === "activity") return "Esc controls | h help | Tab panes | Up/Down scroll | u/d page";
  if (context === "inspector") return "Esc back | h help | Tab panes | 1-4 sections | u/d page";
  return "Esc controls | h help | Tab panes | Arrows select | Enter inspect";
}
export function contextualHelp(context: string): string {
  return [`Controls / ${context}`, "From the editor, press Esc, then choose a letter. Nothing to hold; no timeout.",
    ...controlActions.map((item) => `${item.key} ${item.label}: ${item.description}`),
    "Esc closes completion or the current view first. Esc on the base screen opens controls.",
    "Controls: Up/Down choose | Enter select | Esc return without changing your draft",
    "Browsing: Tab next pane | h help | u/d page | g beginning | l latest/end",
    "Scrolling pauses following. Esc then l from the editor resumes following the current request.",
    "Request history: Esc then r or F4 opens | Arrows/u/d/g/End highlight | Enter choose",
    "History: l chooses Current | Esc/F4 dismiss | Tab/F6 and F2/F3 stay in history",
    "History: Ctrl+C cancels running work; idle dismisses and preserves your draft",
    "New prompts always continue the current conversation, including while viewing history.",
    "Records: Arrows select/expand/collapse | Enter inspect | Space fold",
    `Inspector only: ${inspectorTabs.map((tab) => `${tab.key} ${tab.label}`).join(" | ")}`,
    "Inspector: Up/Down scroll | u/d page | g/l output edges | Esc back",
    "Models: a/b agent | Up/Down model | Left/Right reasoning | h help",
    "Models: s remember after restart | r refresh | Enter apply | Esc close",
    "Model loading: Esc cancel | q quit with confirmation",
    "Editor: Enter submit | Tab completion | Esc then n newline | Esc then p previous prompts",
    "Mouse: Wheel/trackpad scroll | Shift+drag selects terminal text",
    "Optional aliases: F1 help | F2 activity | F3 models | F4 history | F6/Shift+F6 panes",
    "Optional aliases: PgUp/PgDn page | Home/End edges | Shift+Enter newline | Alt+Up prompts | Ctrl+C cancel",
    "Typed commands: /help | /history | /inspect ID [section] [line offset] | /cancel | /quit",
    "Selection and inspection are read-only. Session switching remains explicit."].join("\n");
}
