import { responsesInput } from "../helpers/provider.js";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Coordinator } from "../../src/coordinator/coordinator.js";
import { createRoleRuntime, type RoleRuntimeBinding } from "../../src/runtime/create-role-runtime.js";
import { HeadlessInteractiveCoordinatorService } from "../../src/app/interactive/service.js";
import { fixtureResponse, fixtureChatResponse } from "../../src/security/fixture-provider.js";
import { loadCoordinatorConfig } from "../../src/app/coordinator-config.js";
import { lmStudioFixture } from "../helpers/lm-studio.js";

const roots: string[] = [];
const originalCwd = process.cwd();
afterEach(async () => { process.chdir(originalCwd); vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
function deferred() { let resolve = () => {}; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
async function setup(start = true) {
  const root = await mkdtemp(join(tmpdir(), "pi-model-switch-")); roots.push(root);
  const cwd = join(root, "workspace"); await mkdir(cwd);
  vi.stubEnv("PI_DUAL_COORDINATOR_HOME", join(root, "config"));
  const local = lmStudioFixture();
  const bindings = new Map<string, RoleRuntimeBinding>();
  const bodies: unknown[] = [];
  let rejectModel: string | undefined;
  let rejectBind = false;
  const coordinator = new Coordinator({ cwd, sessionRoot: join(root, "state"), sessionMode: "persistent", jsonLogs: false, verbose: false,
    localModels: local.host, createRoleRuntime: async (input) => {
      if (rejectModel && input.modelOverride === rejectModel) throw new Error("Replacement runtime failed");
      const binding = await createRoleRuntime({ ...input, providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-fixture-key",
        request: async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return input.role === "A" ? fixtureResponse("Context retained") : fixtureChatResponse("Local answer"); } } });
      if (rejectBind && input.modelOverride === "lm-studio/qwen3-coder-next") binding.rebind = async () => { throw new Error("Replacement binding failed"); };
      bindings.set(input.role, binding); return binding;
    } });
  const service = new HeadlessInteractiveCoordinatorService(coordinator);
  if (start) await service.start();
  return { local, bindings, bodies, coordinator, service, reject(model: string) { rejectModel = model; }, rejectBinding() { rejectBind = true; } };
}
describe("model picker coordinator transactions", () => {
  it("lists all downloaded LLMs and switches an unused B conversation to a discovered model", async () => {
    const { local, bindings, coordinator, service } = await setup();
    try {
      const original = bindings.get("B");
      const catalog = await coordinator.getModelPickerCatalog("B");
      expect(catalog.models.map((model) => model.canonical)).toContain("lm-studio/google/gemma-4-e4b");
      await service.dispatch({ type: "configure_role", role: "B", model: "lm-studio/google/gemma-4-e4b", save: true });
      expect(coordinator.getStatus().runtimes.find((runtime) => runtime.role === "B")).toMatchObject({ modelCanonical: "lm-studio/google/gemma-4-e4b", healthy: true });
      expect(bindings.get("B")?.sessionId).toBe(original?.sessionId);
      expect(bindings.get("B")?.sessionFile).toBe(original?.sessionFile);
      await bindings.get("B")?.session.prompt("First response after changing the unused model");
      expect(JSON.stringify(bindings.get("B")?.session.messages)).toContain("Local answer");
      expect(local.models.find((model) => model.key === "qwen/qwen3.8-27b")?.loaded_instances).toHaveLength(0);
      expect((await loadCoordinatorConfig()).config?.defaults?.modelB).toBe("lm-studio/google/gemma-4-e4b");
      expect(service.getState().notification?.message).toContain("ready");
    } finally { await service.dispose(); }
  });

  it("sends the selected GPT reasoning level and preserves the conversation", async () => {
    const { coordinator, service, bindings, bodies } = await setup();
    try {
      await coordinator.submitUserInput("Remember this model selection conversation");
      const id = bindings.get("A")?.sessionId;
      for (const thinking of ["low", "medium", "high"] satisfies ("low" | "medium" | "high")[]) {
        await coordinator.configureRole("A", { model: "openai/gpt-6.1-sol", thinking, save: false });
        await coordinator.submitUserInput(`Continue with ${thinking} reasoning`);
        expect(bindings.get("A")?.sessionId).toBe(id);
        expect(JSON.stringify(bindings.get("A")?.session.messages)).toContain("Remember this model selection conversation");
        expect(bodies.at(-1)).toMatchObject({ model: "gpt-6.1-sol" });
        expect(responsesInput(bodies.at(-1)).thinking).toBe(thinking);
      }
      expect((await loadCoordinatorConfig()).exists).toBe(false);
    } finally { await service.dispose(); }
  }, 30_000);

  it("restores the previous local model when replacement runtime creation fails", async () => {
    const { local, coordinator, service, reject } = await setup();
    try {
      reject("lm-studio/qwen3-coder-next");
      await expect(coordinator.configureRole("B", { model: "lm-studio/qwen3-coder-next", save: true })).rejects.toThrow("Replacement runtime failed");
      expect(coordinator.getStatus().runtimes.find((runtime) => runtime.role === "B")).toMatchObject({ modelCanonical: "lm-studio/qwen/qwen3.8-27b", healthy: true });
      expect(local.models.find((model) => model.key === "qwen/qwen3.8-27b")?.loaded_instances).toHaveLength(1);
      expect(local.models.find((model) => model.key === "qwen3-coder-next")?.loaded_instances).toHaveLength(0);
      expect((await loadCoordinatorConfig()).exists).toBe(false);
      await coordinator.submitUserInput("The restored conversation remains usable");
    } finally { await service.dispose(); }
  });

  it.each(["cancel", "quit"] satisfies ("cancel" | "quit")[])("settles an in-flight LM Studio load and restores before %s finishes", async (action) => {
    const { local, coordinator, service } = await setup();
    const entered = deferred(); const release = deferred();
    local.onLoad(async (key) => { if (key === "qwen3-coder-next") { entered.resolve(); await release.promise; } });
    try {
      const switching = service.dispatch({ type: "configure_role", role: "B", model: "lm-studio/qwen3-coder-next", save: true });
      await entered.promise;
      const cancelling = service.dispatch({ type: action });
      expect(service.getState().modal).toMatchObject({ kind: "model_loading", cancelling: true });
      release.resolve(); await Promise.all([switching, cancelling]);
      expect(service.getState().shouldExit).toBe(action === "quit");
      expect(coordinator.getStatus().runtimes.find((runtime) => runtime.role === "B")?.modelCanonical).toBe("lm-studio/qwen/qwen3.8-27b");
      expect(local.models.find((model) => model.key === "qwen/qwen3.8-27b")?.loaded_instances).toHaveLength(1);
      expect(local.models.find((model) => model.key === "qwen3-coder-next")?.loaded_instances).toHaveLength(0);
      expect((await loadCoordinatorConfig()).exists).toBe(false);
    } finally { release.resolve(); await service.dispose(); }
  });

  it.each(["save", "bind"])("restores the runtime and local model after a %s failure", async (failure) => {
    const { local, coordinator, service, rejectBinding } = await setup();
    const configPath = (await loadCoordinatorConfig()).path;
    try {
      if (failure === "save") { await mkdir(dirname(configPath), { recursive: true }); await writeFile(configPath, "invalid original config"); }
      else rejectBinding();
      await expect(coordinator.configureRole("B", { model: "lm-studio/qwen3-coder-next", save: true })).rejects.toThrow(failure === "save" ? "config warnings" : "Replacement binding failed");
      expect(coordinator.getStatus().runtimes.find((runtime) => runtime.role === "B")).toMatchObject({ modelCanonical: "lm-studio/qwen/qwen3.8-27b", healthy: true });
      expect(local.models.find((model) => model.key === "qwen/qwen3.8-27b")?.loaded_instances).toHaveLength(1);
      expect(local.models.find((model) => model.key === "qwen3-coder-next")?.loaded_instances).toHaveLength(0);
      if (failure === "save") expect(await readFile(configPath, "utf8")).toBe("invalid original config");
      await coordinator.submitUserInput("Previous runtime still receives events");
    } finally { await service.dispose(); }
  });

  it.each(["cancel", "quit"] satisfies ("cancel" | "quit")[])("cleans up an unloaded startup model before %s", async (action) => {
    const { local, coordinator, service } = await setup(false);
    for (const model of local.models) model.loaded_instances = [];
    const entered = deferred(); const release = deferred();
    local.onLoad(async () => { entered.resolve(); await release.promise; });
    try {
      const starting = service.start(); await entered.promise;
      const stopping = service.dispatch({ type: action }); release.resolve();
      await Promise.all([starting, stopping]);
      expect(service.getState().shouldExit).toBe(true);
      expect(local.models.every((model) => model.loaded_instances.length === 0)).toBe(true);
      expect(coordinator.getStatus().runtimes).toHaveLength(0);
    } finally { release.resolve(); await service.dispose(); }
  });

  it("loads an unloaded saved B model during startup and reports readiness progress", async () => {
    const { local, coordinator, service } = await setup(false);
    for (const model of local.models) model.loaded_instances = [];
    const phases: string[] = [];
    const unsubscribe = service.subscribeState((state) => { if (state.modal.kind === "model_loading") phases.push(state.modal.progress.phase); });
    try {
      await service.start();
      expect(phases).toContain("loading"); expect(phases).toContain("verifying");
      expect(coordinator.getStatus().runtimes).toHaveLength(2);
      expect(local.models.find((model) => model.key === "qwen/qwen3.8-27b")?.loaded_instances).toHaveLength(1);
    } finally { unsubscribe(); await service.dispose(); }
  });

  it("blocks execution after failed restoration and lets a successful selection recover B", async () => {
    const { local, coordinator, service } = await setup();
    try {
      local.failures.add("qwen3-coder-next"); local.failures.add("qwen/qwen3.8-27b");
      await expect(coordinator.configureRole("B", { model: "lm-studio/qwen3-coder-next", save: false })).rejects.toThrow("could not be restored");
      expect(coordinator.getStatus().runtimes.find((runtime) => runtime.role === "B")?.healthy).toBe(false);
      await expect(coordinator.submitUserInput("Must wait for recovery")).rejects.toThrow(/model.*unavailable/i);
      local.failures.clear();
      await coordinator.configureRole("B", { model: "lm-studio/qwen/qwen3.8-27b", save: false });
      expect(coordinator.getStatus().runtimes.find((runtime) => runtime.role === "B")?.healthy).toBe(true);
      await coordinator.submitUserInput("Recovered");
    } finally { await service.dispose(); }
  });

  it("reports failed compensation after the new model was ready but runtime creation failed", async () => {
    const { local, coordinator, service, reject } = await setup();
    try {
      reject("lm-studio/qwen3-coder-next"); local.failures.add("qwen/qwen3.8-27b");
      await expect(coordinator.configureRole("B", { model: "lm-studio/qwen3-coder-next", save: false })).rejects.toMatchObject({ recovery: "unavailable", cancelled: false });
      expect(coordinator.getStatus().runtimes.find((runtime) => runtime.role === "B")?.healthy).toBe(false);
      await expect(coordinator.submitUserInput("Wait for a ready model")).rejects.toThrow(/model.*unavailable/i);
    } finally { await service.dispose(); }
  });
});
