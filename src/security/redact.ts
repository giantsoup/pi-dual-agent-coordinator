const secrets = new Map<string, number>();
export function protectSecret(value: string): () => void {
  if (value) secrets.set(value, (secrets.get(value) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = secrets.get(value) ?? 0;
    if (count <= 1) secrets.delete(value); else secrets.set(value, count - 1);
  };
}
export function redactText(value: string): string {
  let safe = value;
  for (const secret of secrets.keys()) {
    for (const encoded of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret), Buffer.from(secret).toString("base64")]) {
      safe = safe.split(encoded).join("[REDACTED]");
    }
  }
  return safe.replace(/\bsk-[a-zA-Z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/(Bearer\s+)[^\s"\\]+/gi, "$1[REDACTED]");
}
export function redactValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(redactText(JSON.stringify(value))) as T;
}
