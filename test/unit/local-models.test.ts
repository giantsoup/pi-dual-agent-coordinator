import { describe, expect, it } from "vitest";
import { lmStudioFixture } from "../helpers/lm-studio.js";
import { LmStudioModels, LocalModelSwitchError } from "../../src/security/lm-studio.js";

const prior = "qwen/qwen3.8-27b";
const target = "qwen3-coder-next";
describe("trusted local model switching", () => {
  it("lists downloaded LLMs and validates tool and context support", async () => {
    const fixture = lmStudioFixture();
    for (const model of fixture.models) {
      if (model.key === target) model.capabilities.trained_for_tool_use = false;
      if (model.key === "google/gemma-4-e4b") model.max_context_length = 4096;
    }
    const models = await fixture.host.listModels();
    expect(models.map((item) => item.model.id)).toEqual([prior, target, "google/gemma-4-e4b"]);
    expect(models[0]?.loaded).toBe(true);
    expect(models[1]?.disabledReason).toContain("Tool calling");
    expect(models[2]?.disabledReason).toContain("65,536");
    await expect(fixture.host.prepare(target, prior, new AbortController().signal, () => {})).rejects.toThrow("Tool calling");
    expect(fixture.calls.every((call) => !call.body)).toBe(true);
  });
  it("unloads the old instance before loading and verifying the new model", async () => {
    const fixture = lmStudioFixture();
    const phases: string[] = [];
    const prepared = await fixture.host.prepare(target, prior, new AbortController().signal, (progress) => phases.push(progress.phase));
    expect(phases).toEqual(["checking", "unloading", "loading", "verifying"]);
    expect(fixture.calls.filter((call) => call.body)).toEqual([
      { path: "/api/v1/models/unload", body: { instance_id: `${prior}-instance` } },
      { path: "/api/v1/models/load", body: { model: target, context_length: 65536 } }
    ]);
    expect(prepared.model.id).toBe(target);
    prepared.commit(); await prepared.rollback();
    expect((await fixture.host.listModels()).find((item) => item.model.id === target)?.loaded).toBe(true);
    expect(fixture.calls.filter((call) => call.body)).toHaveLength(2);
  });
  it("restores the former model if loading fails", async () => {
    const fixture = lmStudioFixture(); fixture.failures.add(target);
    await expect(fixture.host.prepare(target, prior, new AbortController().signal, () => {})).rejects.toMatchObject({ recovery: "restored", cancelled: false });
    expect((await fixture.host.listModels()).find((item) => item.model.id === prior)?.loaded).toBe(true);
  });
  it("waits for an in-flight load to settle before cancelling and restoring", async () => {
    const fixture = lmStudioFixture();
    const controller = new AbortController();
    let release = () => {};
    let entered = () => {};
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fixture.onLoad(async (key) => { if (key === target) { entered(); await gate; } });
    const running = fixture.host.prepare(target, prior, controller.signal, () => {});
    const rejection = expect(running).rejects.toMatchObject({ cancelled: true, recovery: "restored" });
    await started; controller.abort();
    expect(fixture.calls.filter((call) => call.path.endsWith("/load"))).toHaveLength(1);
    release(); await rejection;
    const models = await fixture.host.listModels();
    expect(models.find((item) => item.model.id === prior)?.loaded).toBe(true);
    expect(models.find((item) => item.model.id === target)?.loaded).toBe(false);
  });
  it("bounds readiness waiting and restores after insufficient context", async () => {
    const fixture = lmStudioFixture(); fixture.useShortContext();
    await expect(fixture.host.prepare(target, prior, new AbortController().signal, () => {})).rejects.toMatchObject({ recovery: "restored" });
    expect((await fixture.host.listModels()).find((item) => item.model.id === prior)?.loaded).toBe(true);
  });
  it("reports failed recovery instead of claiming the old model is usable", async () => {
    const fixture = lmStudioFixture(); fixture.failures.add(target); fixture.failures.add(prior);
    await expect(fixture.host.prepare(target, prior, new AbortController().signal, () => {})).rejects.toBeInstanceOf(LocalModelSwitchError);
    await expect(fixture.host.prepare(target, prior, new AbortController().signal, () => {})).rejects.toMatchObject({ recovery: "unavailable" });
  });
  it("does not reload the same model or accept a forged selection", async () => {
    const fixture = lmStudioFixture();
    const prepared = await fixture.host.prepare(prior, prior, new AbortController().signal, () => {});
    prepared.commit(); await prepared.rollback();
    await expect(fixture.host.prepare("not-downloaded", prior, new AbortController().signal, () => {})).rejects.toThrow("no longer downloaded");
    expect(fixture.calls.every((call) => !call.body)).toBe(true);
  });
  it("rejects redirected management responses", async () => {
    const host = new LmStudioModels({ request: async () => new Response(null, { status: 302 }) });
    await expect(host.listModels()).rejects.toThrow("302");
  });
  it("reconciles a load that succeeded after its HTTP response was lost", async () => {
    const fixture = lmStudioFixture();
    const host = new LmStudioModels({ timeoutMs: 300, pollMs: 2, request: async (url, init) => {
      const response = await fixture.request(url, init);
      if (String(url).endsWith("/load") && String(init?.body).includes(target)) throw new Error("Connection lost after load");
      return response;
    } });
    await expect(host.prepare(target, prior, new AbortController().signal, () => {})).rejects.toMatchObject({ recovery: "restored" });
    expect((await host.listModels()).find((model) => model.model.id === prior)?.loaded).toBe(true);
    expect((await host.listModels()).find((model) => model.model.id === target)?.loaded).toBe(false);
  });
  it("makes repeated rollback calls converge on one restoration", async () => {
    const fixture = lmStudioFixture();
    const prepared = await fixture.host.prepare(target, prior, new AbortController().signal, () => {});
    await Promise.all([prepared.rollback(), prepared.rollback()]);
    await prepared.rollback();
    expect(fixture.calls.filter((call) => call.path.endsWith("/load") && call.body?.model === prior)).toHaveLength(1);
  });
});
