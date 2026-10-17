export const INTERACTIVE_COMMAND_HINT =
  "/help /status /approve /discard /sessions /handoff /cancel /new [A|B] /switch A|B /quit | /history | /inspect ID [section] [line-offset] | /model A|B [MODEL] [save] | /thinking A|B [LEVEL] [save] | /config review-rounds|timeout-ms N [save]";

export const INTERACTIVE_RUNTIME_HINT =
  "/new starts a fresh conversation for both agents; /new A or /new B resets only that role. Previous work stays in History. /switch restores a role's session file.";

export const INTERACTIVE_PLAIN_KEY_HINT = "Enter submit | Ctrl+C cancel work, repeat while idle to exit";

export const INTERACTIVE_TUI_KEY_HINT =
  "F1 help | F6 panes | F2 activity | Enter submit | Esc close modal | Ctrl+C cancel work; idle clears draft, repeat exits";
