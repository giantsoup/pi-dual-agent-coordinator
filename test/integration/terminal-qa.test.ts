import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSession } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Coordinator } from "../../src/coordinator/coordinator.js";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { fixtureResponse } from "../../src/security/fixture-provider.js";
import { RuntimeRegistry } from "../../src/runtime/runtime-registry.js";
import { assistantTurnEnd, createFakeBinding, FakeRuntime, FakeSession } from "../helpers/fakes.js";

const originalCwd = process.cwd();
const roots: string[] = [];
afterEach(async () => { process.chdir(originalCwd); vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => rm(root, {recursive:true,force:true}))); });
async function setup(sessionMode: "memory" | "persistent" = "persistent", requestBackend?: NonNullable<Parameters<typeof createRoleRuntime>[0]["providerTestBackend"]>["request"]) {
  const root = await mkdtemp(join(tmpdir(), "pi-terminal-qa-")); roots.push(root);
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const request = vi.fn(requestBackend ?? (async () => fixtureResponse("QA answer")));
  const coordinator = new Coordinator({cwd, sessionRoot:join(root,"state"),sessionMode,jsonLogs:false,verbose:false,
    createRoleRuntime: (input) => createRoleRuntime({...input,providerTestBackend:{cwd,modelIds:[],load:async()=>`dummy-${randomUUID()}`,request}})});
  await coordinator.start();
  return {coordinator, root, cwd, request};
}

describe("terminal QA regressions", () => {
  it("drains cancelled preflight and prevents a late provider request", async () => {
    const {coordinator, request} = await setup();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {release = resolve;});
    let entered = () => {};
    const ready = new Promise<void>((resolve) => {entered = resolve;});
    try {
      await coordinator.submitUserInput("seed conversation");
      const prompt = AgentSession.prototype.prompt;
      vi.spyOn(AgentSession.prototype,"prompt").mockImplementationOnce(async function (this: AgentSession, text, options) {
        entered(); await gate;
        return prompt.call(this,text,options);
      });
      const work = coordinator.submitUserInput("cancel during preflight");
      await ready;
      let settled = false;
      const cancel = coordinator.cancelActive().then(() => {settled = true;});
      await new Promise((resolve) => setTimeout(resolve,20));
      expect(settled).toBe(false);
      expect(coordinator.getStatus().operation?.kind).toBe("cancelling");
      release(); await cancel;
      expect((await work).userResponse).toContain("cancelled");
      expect(request).toHaveBeenCalledTimes(1);
      expect((await coordinator.submitUserInput("explicit retry")).userResponse).toBe("QA answer");
      expect(request).toHaveBeenCalledTimes(2);
    } finally {release(); await coordinator.dispose();}
  });

  it("keeps Agent A's explicitly requested reasoning in the no-tools verification path", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-qa-no-tools-")); roots.push(root);
    const cwd = join(root,"workspace"); await mkdir(cwd);
    const request = vi.fn<typeof fetch>(async (_url,init) => {
      const body: unknown = JSON.parse(String(init?.body));
      expect(body).toMatchObject({reasoning:{effort:"high"}});
      return fixtureResponse("LOCAL_API_OK");
    });
    const binding = await createRoleRuntime({role:"A",cwd,sessionRoot:join(root,"state"),sessionMode:"memory",thinkingOverride:"high",noTools:true,
      providerTestBackend:{cwd,modelIds:[],load:async()=>`dummy-${randomUUID()}`,request}});
    try {
      expect(binding.session.thinkingLevel).toBe("high");
      await binding.session.prompt("Reply exactly LOCAL_API_OK");
      expect(request).toHaveBeenCalledOnce();
    } finally {await binding.dispose();}
  });

  it("surfaces a real HTTP provider failure without automatic retries and accepts explicit retry", async () => {
    let count = 0;
    const {coordinator} = await setup("persistent",async () => {
      count += 1;
      return count === 1 ? new Response("fixture failure",{status:503}) : fixtureResponse("QA answer");
    });
    try {
      await expect(coordinator.submitUserInput("provider failure")).rejects.toThrow("503");
      expect(count).toBe(1);
      expect(coordinator.getStatus().operation?.kind).toBe("failed");
      expect((await coordinator.getWorkflowStatus()).ledgerTail?.status).toBe("failed");
      expect((await coordinator.submitUserInput("explicit retry")).userResponse).toBe("QA answer");
      expect(count).toBe(2);
    } finally {await coordinator.dispose();}
  });

  it("owns and aborts real post-turn Pi compaction before releasing the submission", async () => {
    let entered = () => {};
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    let compactionAborted = false;
    let count = 0;
    const {coordinator} = await setup("persistent", async (_url, init) => {
      count += 1;
      if (count === 1) {
        const response = fixtureResponse("QA answer");
        return new Response((await response.text()).replace('"input_tokens":10','"input_tokens":10000000'),{headers:response.headers});
      }
      entered();
      return new Promise<Response>((_resolve,reject) => {
        const abort = () => {compactionAborted = true; reject(new Error("compaction cancelled"));};
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort",abort,{once:true});
      });
    });
    try {
      let settled = false;
      const work = coordinator.submitUserInput("trigger compaction").then((result) => {settled = true; return result;});
      await ready;
      expect(settled).toBe(false);
      expect(coordinator.getStatus().operation?.kind).toBe("running");
      await coordinator.cancelActive();
      expect((await work).userResponse).toContain("cancelled");
      await vi.waitFor(() => expect(compactionAborted).toBe(true));
      expect(count).toBe(2);
      expect(coordinator.getStatus().operation?.kind).toBe("cancelled");
    } finally {await coordinator.dispose();}
  },10000);

  it("keeps repeated /new and model replacement in memory without workspace session files", async () => {
    const {coordinator,cwd} = await setup("memory");
    try {
      for (let index=0; index<2; index++) {
        await coordinator.replaceRuntime("A",{type:"new",role:"A"});
        await coordinator.submitUserInput(`memory ${index}`);
        expect(coordinator.getSessions().find((session) => session.role === "A")?.sessionFile).toBeUndefined();
      }
      await coordinator.configureRole("A",{model:"openai/gpt-5.4",save:false});
      expect((await coordinator.submitUserInput("after model change")).userResponse).toBe("QA answer");
      expect(await readdir(cwd)).toEqual([]);
    } finally {await coordinator.dispose();}
  });

  it("preserves corrupt history bytes and the current runtime on failed switches", async () => {
    const {coordinator,root,cwd} = await setup();
    try {
      await coordinator.submitUserInput("current conversation");
      const original = coordinator.getSessions().find((session) => session.role === "A")?.sessionId;
      const corrupt = join(root,"state","A","corrupt.jsonl");
      const bytes = '{"type":"session","id":"broken"'; await writeFile(corrupt,bytes);
      await expect(coordinator.getSessionHistory("A",corrupt)).rejects.toThrow();
      await expect(coordinator.replaceRuntime("A",{type:"switch",role:"A",sessionPath:corrupt})).rejects.toThrow();
      expect(await readFile(corrupt,"utf8")).toBe(bytes);
      const wrongCwd = join(root,"state","A","other.jsonl");
      await writeFile(wrongCwd,JSON.stringify({type:"session",version:3,id:"other",timestamp:new Date().toISOString(),cwd:root})+"\n");
      await expect(coordinator.replaceRuntime("A",{type:"switch",role:"A",sessionPath:wrongCwd})).rejects.toThrow("cwd changes");
      expect(coordinator.getSessions().find((session) => session.role === "A")?.sessionId).toBe(original);
      expect((await coordinator.submitUserInput("still works")).userResponse).toBe("QA answer");
      expect(await readdir(cwd)).toEqual([]);
    } finally {await coordinator.dispose();}
  });

  it("rejects cyclic history without hanging or changing source bytes", async () => {
    const {coordinator,root,cwd} = await setup();
    try {
      await coordinator.submitUserInput("create session directory");
      const path = join(root,"state","A","cyclic.jsonl");
      const bytes = [
        {type:"session",version:3,id:"cycle",timestamp:"now",cwd},
        {type:"message",id:"loop",parentId:"loop",timestamp:"now",message:{role:"user",content:"cycle",timestamp:1}}
      ].map((entry) => JSON.stringify(entry)).join("\n")+"\n";
      await writeFile(path,bytes);
      await expect(coordinator.getSessionHistory("A",path)).rejects.toThrow("Cyclic session history");
      expect(await readFile(path,"utf8")).toBe(bytes);
      await expect(coordinator.replaceRuntime("A",{type:"switch",role:"A",sessionPath:path})).rejects.toThrow("Cyclic session history");
      expect((await coordinator.submitUserInput("still works")).userResponse).toBe("QA answer");
    } finally {await coordinator.dispose();}
  });

  it("clears the old plan once a model is installed even when old-runtime cleanup fails", async () => {
    const root = await mkdtemp(join(tmpdir(),"pi-qa-installed-role-")); roots.push(root);
    let count = 0;
    const coordinator = new Coordinator({cwd:root,sessionRoot:join(root,"state"),sessionMode:"memory",jsonLogs:false,verbose:false,
      createRoleRuntime:async (input) => {
        const session = new FakeSession(`${input.role}-${++count}`,undefined,async () => {
          await session.emit(assistantTurnEnd('```pi-plan\n{"schemaVersion":1,"objective":"Task","summary":"Plan","acceptanceCriteria":["done"],"relevantPaths":["file.txt"],"executionPlan":["work"]}\n```'));
        });
        const binding = createFakeBinding(input.role,new FakeRuntime(root,session,input.role));
        if (count === 1) vi.spyOn(binding,"dispose").mockRejectedValueOnce(new Error("old cleanup failed"));
        return binding;
      }});
    await coordinator.start();
    try {
      await coordinator.submitUserInput("propose plan");
      expect(coordinator.getStatus().pendingPlanReady).toBe(true);
      await expect(coordinator.configureRole("A",{model:"openai/gpt-5.4",save:false})).rejects.toThrow("old cleanup failed");
      expect(coordinator.getStatus().pendingPlanReady).toBe(false);
      expect(coordinator.getSessions().find((session) => session.role === "A")?.sessionId).toBe("A-3");
      await expect(coordinator.approvePendingPlan()).rejects.toThrow("No pending plan");
    } finally {await coordinator.dispose();}
  });

  it("releases configuration ownership even when rejected replacement cleanup fails", async () => {
    const root = await mkdtemp(join(tmpdir(),"pi-qa-cleanup-")); roots.push(root);
    let count = 0;
    const coordinator = new Coordinator({cwd:root,sessionRoot:join(root,"state"),sessionMode:"memory",jsonLogs:false,verbose:false,
      createRoleRuntime:async (input) => {
        const binding = createFakeBinding(input.role,new FakeRuntime(root,new FakeSession(input.role,undefined),input.role));
        if (++count > 2) {
          vi.spyOn(binding,"rebind").mockRejectedValue(new Error("bind failed"));
          vi.spyOn(binding,"dispose").mockRejectedValue(new Error("cleanup failed"));
        }
        return binding;
      }});
    await coordinator.start();
    try {
      await expect(coordinator.configureRole("A",{model:"openai/gpt-5.4",save:false})).rejects.toThrow("cleanup failed");
      await coordinator.configureDefaults("timeout-ms",1000,false);
      expect(coordinator.getStatus().timeoutMs).toBe(1000);
    } finally {await coordinator.dispose();}
  });

  it("releases both roles when the first runtime fails disposal", async () => {
    const registry = new RuntimeRegistry();
    const a = createFakeBinding("A",new FakeRuntime("/tmp",new FakeSession("A",undefined),"A"));
    const b = createFakeBinding("B",new FakeRuntime("/tmp",new FakeSession("B",undefined),"B"));
    vi.spyOn(a,"dispose").mockRejectedValue(new Error("A cleanup failed"));
    const disposeB = vi.spyOn(b,"dispose"); registry.set(a); registry.set(b);
    await expect(registry.disposeAll()).rejects.toThrow("Resource cleanup failed");
    expect(disposeB).toHaveBeenCalledOnce();
    expect(registry.list()).toEqual([]);
  });
});
