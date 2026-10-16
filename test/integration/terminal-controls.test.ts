import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Coordinator } from "../../src/coordinator/coordinator.js";
import { createRoleRuntime, type RoleRuntimeBinding } from "../../src/runtime/create-role-runtime.js";
import { fixtureResponse } from "../../src/security/fixture-provider.js";
import { applyCoordinatorDefaultsToCliOptions, loadCoordinatorConfig } from "../../src/app/coordinator-config.js";
import { parseCliArgs, parseReplCommand, REPL_COMPLETION_COMMANDS } from "../../src/app/cli.js";

const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map((root) => rm(root, {recursive:true,force:true}))); });

describe("terminal configuration through real Pi runtimes", () => {
  it("restores conversation context, preserves role isolation, and saves defaults only explicitly", async () => {
    const root = await mkdtemp(join(tmpdir(),"pi-terminal-controls-")); roots.push(root);
    const workspace = join(root,"workspace"); await mkdir(workspace);
    vi.stubEnv("PI_DUAL_COORDINATOR_HOME", join(root,"config"));
    let rejectAuth = false;
    const bindings = new Map<string, RoleRuntimeBinding>();
    const options = {cwd:workspace,sessionRoot:join(root,"state"),sessionMode:"persistent" as const,jsonLogs:false,verbose:false,
      createRoleRuntime: async (input: Parameters<typeof createRoleRuntime>[0]) => {
        const binding = await createRoleRuntime({...input, providerTestBackend: { cwd: workspace, modelIds: [],
          load: async () => { if (rejectAuth) throw new Error("storage unavailable"); return `dummy-${randomUUID()}`; },
          request: async () => fixtureResponse("Context answer")
        }});
        bindings.set(input.role, binding); return binding;
      }};
    const coordinator = new Coordinator(options);
    await coordinator.start();
    try {
      await coordinator.submitUserInput("Remember conversation marker");
      const original = bindings.get("A");
      const path = original?.sessionFile;
      if (!path) throw new Error("Missing persisted Pi session");
      const sessions = await coordinator.getSavedSessions("A");
      expect(sessions.some((session) => session.path === path)).toBe(true);
      await coordinator.getSessionHistory("A",path);
      expect(bindings.get("A")).toBe(original);
      await coordinator.configureRole("A",{model:"openai/gpt-5.4",thinking:"medium",save:false});
      expect(bindings.get("A")?.session.messages?.some((message) => JSON.stringify(message).includes("Remember conversation marker"))).toBe(true);
      expect((await loadCoordinatorConfig()).exists).toBe(false);
      expect(coordinator.getStatus().runtimes.find((runtime) => runtime.role === "A")?.modelCanonical).toBe("openai/gpt-5.4");
      const active = bindings.get("A");
      rejectAuth = true;
      await expect(coordinator.configureRole("A",{model:"openai/gpt-6-luna",save:false})).rejects.toThrow("storage unavailable");
      expect(bindings.get("A")).toBe(active);
      expect((await coordinator.submitUserInput("Still usable")).userResponse).toBe("Context answer");
      rejectAuth = false;
      await coordinator.configureRole("A",{model:"openai/gpt-6-luna",thinking:"high",save:true});
      await coordinator.configureDefaults("review-rounds",2,true);
      await coordinator.configureDefaults("timeout-ms",12000,true);
      await coordinator.configureDefaults("review-rounds",4,false);
      const config = (await loadCoordinatorConfig()).config;
      expect(config?.defaults).toMatchObject({modelA:"openai/gpt-6-luna",thinkingA:"high",maxReviewRounds:2,timeoutMs:12000});
      const parsed = parseCliArgs(["repl",workspace]);
      if (parsed.command !== "repl") throw new Error("CLI");
      expect(applyCoordinatorDefaultsToCliOptions(parsed,config)).toMatchObject({maxReviewRounds:2,timeoutMs:12000});
      expect(coordinator.getStatus().maxReviewRounds).toBe(4);
      await coordinator.replaceRuntime("A",{type:"new",role:"A"});
      expect(bindings.get("A")?.session.messages).toHaveLength(0);
      await coordinator.replaceRuntime("A",{type:"switch",role:"A",sessionPath:path});
      expect(bindings.get("A")?.session.messages?.some((message) => JSON.stringify(message).includes("Remember conversation marker"))).toBe(true);
      expect(coordinator.getStatus().operation?.kind).not.toBe("running");
      await expect(coordinator.replaceRuntime("B",{type:"switch",role:"B",sessionPath:path})).rejects.toThrow("private session directory");
      await expect(coordinator.configureRole("A",{model:"untrusted/model",save:false})).rejects.toThrow("approved");
    } finally { await coordinator.dispose(); }
  }, 30_000);

  it("keeps completion commands and the shared parser in agreement", () => {
    const args: Record<string,string> = {inspect:" record-id",new:" A",switch:" A /tmp/session.jsonl",model:" A",thinking:" B",config:" review-rounds 2"};
    for (const command of REPL_COMPLETION_COMMANDS) expect(() => parseReplCommand(`/${command.name}${args[command.name] ?? ""}`)).not.toThrow();
    expect(() => parseReplCommand("/config timeout-ms 2junk")).toThrow();
    expect(() => parseReplCommand("/thinking A bogus")).toThrow();
    expect(parseReplCommand("/thinking B xhigh save")).toMatchObject({thinking:"xhigh",save:true});
  });
});
