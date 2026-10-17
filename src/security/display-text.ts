import { redactText } from "./redact.js";

/** No tool-owned cursor, clipboard, hyperlink, C1, or bidi controls reach a terminal. */
export function safeDisplayText(text: string): string {
  return redactText(text)
    .replace(/(\b[A-Z][A-Z0-9_]{2,}\s*=\s*)[^\s"',}]+/g, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|password|secret|token)["\']?\s*[:=]\s*["\']?)[^\s"\',}]+/gi, "$1[REDACTED]")
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\|$)/g, "")
    .replace(/\x1b[P_X^][\s\S]*?(?:\x1b\\|$)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\t/g, "    ")
    .replace(/\r/g, "");
}
export function visibleProse(text: string): string {
  return safeDisplayText(text)
    .replace(/```pi-[\s\S]*?(?:```|$)/g, "")
    .replace(/```pi?$/, "")
    .trim();
}

export function safeDisplayFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, safeValue(value)]));
}
function safeValue(value: unknown): unknown {
  if (typeof value === "string") return safeDisplayText(value);
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === "object") return safeDisplayFields(Object.fromEntries(Object.entries(value)));
  return value;
}
