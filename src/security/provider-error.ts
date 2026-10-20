/** Classify a bounded upstream body without exposing provider-controlled text. */
export async function isProviderContextOverflow(response: Response): Promise<boolean> {
  if (![400, 413, 422].includes(response.status) || !response.body) { await response.body?.cancel(); return false; }
  const reader = response.body.getReader();
  try {
    let bytes = 0; let text = "";
    const decoder = new TextDecoder();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 8192) return false;
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return /context_length_exceeded|exceeds the context window|greater than the context length|exceeds the available context size/i.test(text);
  } finally { await reader.cancel(); reader.releaseLock(); }
}
