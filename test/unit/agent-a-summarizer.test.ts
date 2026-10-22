import { expect, it } from "vitest";
import { AgentASummarizer } from "../../src/runtime/agent-a-summarizer.js";
import type { SummaryRequest } from "../../src/runtime/compaction.js";
import { createSecureModelCatalog } from "../../src/security/models.js";
import { fixtureResponse, fixtureToolResponse } from "../../src/security/fixture-provider.js";
const model = createSecureModelCatalog().find("openai", "gpt-6-luna");
if (!model) throw new Error("Missing approved fixture model");
const request = (): SummaryRequest => ({ target: { role: "B", sessionId: "session", generation: "generation", leafId: "leaf" },
  preparation: { firstKeptEntryId: "kept", messagesToSummarize: [{ role: "user", content: "Preserve the objective and verified result", timestamp: 1 }], turnPrefixMessages: [], isSplitTurn: false,
    tokensBefore: 50000, fileOps: { read: new Set(["a.ts"]), written: new Set(["b.ts"]), edited: new Set() }, settings: { enabled: true, reserveTokens: 20480, keepRecentTokens: 20000 } } });
it.each(["empty", "tool", "length"])("refuses %s summary output before returning a checkpoint", async (kind) => {
  const summarizer = new AgentASummarizer({ cwd: "/fixture", model, thinking: "low", testBackend: { cwd: "/fixture", modelIds: [], load: async () => "dummy-key",
    request: async () => {
      if (kind === "tool") return fixtureToolResponse("write", { path: "forbidden", content: "never execute" });
      const response = fixtureResponse(kind === "empty" ? "" : "partial text");
      return kind === "length" ? new Response((await response.text()).replace('"status":"completed"', '"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}'), { headers: response.headers }) : response;
    } } });
  try { await expect(summarizer.summarize(request(), new AbortController().signal)).rejects.toThrow(/Summary generation/); }
  finally { await summarizer.dispose(); }
});
it("bounds a giant previous summary and accounts for every chunk's usage", async () => {
  let calls = 0;
  const summarizer = new AgentASummarizer({ cwd: "/fixture", model, thinking: "low", testBackend: { cwd: "/fixture", modelIds: [], load: async () => "dummy-key",
    request: async () => { calls++; return fixtureResponse("Objective and verified result retained. Continue safely."); } } });
  const input = request(); input.preparation.previousSummary = "界".repeat(120000);
  try {
    const result = await summarizer.summarize(input, new AbortController().signal);
    expect(calls).toBeGreaterThan(1); expect(calls).toBeLessThanOrEqual(8);
    expect(result.usage?.input).toBe(calls * 10);
    expect(result.details).toMatchObject({ schema: 1, summarizerRole: "A", readFiles: ["a.ts"], modifiedFiles: ["b.ts"] });
  } finally { await summarizer.dispose(); }
});
