import { createServer } from "node:net";
import { randomInt } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { fixtureChatResponse, fixtureChatToolResponse } from "../../src/security/fixture-provider.js";
import { ManagedSession } from "../../src/runtime/managed-session.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function fixture(server: "node" | "python" | "descendant" = "node", hold = false) {
  const root = await mkdtemp(join(tmpdir(), "pi-managed-server-")); roots.push(root);
  const cwd = join(root, "workspace"); await mkdir(cwd);
  let port = 0;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = randomInt(20000, 45000), probe = createServer();
    try {
      await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(candidate, "127.0.0.1", resolve); });
      await new Promise<void>(resolve => probe.close(() => resolve())); port = candidate; break;
    } catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "EADDRINUSE") throw error; }
  }
  if (!port) throw new Error("No test project port available");
  const origin = `http://127.0.0.1:${port}`;
  await writeFile(join(cwd, "index.html"), "MANAGED_SERVER_OK");
  let calls = 0;
  let markWaiting = () => {};
  const waiting = new Promise<void>(resolve => { markWaiting = resolve; });
  const events: unknown[] = [];
  const serve = `require('node:http').createServer((_req,res)=>res.end('MANAGED_SERVER_OK')).listen(${port},'127.0.0.1');console.log('SERVER_LOG_OK')`;
  const source = server === "descendant"
    ? `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(serve)}],{detached:true,stdio:'inherit'});setInterval(()=>{},1000)` : serve;
  const command = server === "python" ? `python3 -m http.server ${port} --bind 127.0.0.1`
    : `${quote(process.execPath)} -e ${quote(source)}`;
  const binding = await createRoleRuntime({ role: "B", cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode: "memory",
    providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-managed-server", request: async (_url, init) => {
      if (++calls === 1) return fixtureChatToolResponse("local_server", { action: "start", command });
      if (calls === 2) return fixtureChatToolResponse("bash", { command: `${quote(process.execPath)} --input-type=module -e ${quote(`
        for(let n=0; ; n++) {
          try { if(await (await fetch(${JSON.stringify(origin)})).text() !== 'MANAGED_SERVER_OK') throw new Error('Wrong project'); break; }
          catch(error) { if(n===20) throw error; await new Promise(resolve=>setTimeout(resolve,50)); }
        }
        console.log('NATIVE_B_HTTP_OK');
      `)}` });
      if (hold) {
        markWaiting();
        await new Promise<void>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) reject(new Error("Fixture request cancelled"));
          else signal?.addEventListener("abort", () => reject(new Error("Fixture request cancelled")), { once: true });
        });
      }
      return fixtureChatResponse("Server ready for verification.");
    } }
  });
  binding.session.subscribe(event => { if (event.type === "tool_execution_end") events.push(event); });
  return { binding, origin, events, waiting };
}

it.each(["abort", "newSession", "dispose"] as const)("B starts and requests a real server, then %s drains it", async action => {
  const { binding, origin, events } = await fixture();
  try {
    await binding.session.prompt("Start this project server and verify it from bash.");
    expect(JSON.stringify(events)).toContain("NATIVE_B_HTTP_OK");
    expect(JSON.stringify(events)).not.toContain('"isError":true');
    expect(await (await fetch(origin)).text()).toBe("MANAGED_SERVER_OK");
    if (action === "abort") await binding.session.abort();
    else if (action === "newSession") { await binding.runtime.newSession(); await binding.rebind(); }
    else await binding.dispose();
    await expect(fetch(origin)).rejects.toThrow();
  } finally { await binding.dispose(); }
});

it("returns logs and refuses to stop an unregistered process", async () => {
  const { binding, events } = await fixture();
  try {
    await binding.session.prompt("Start this project server.");
    if (!(binding.session instanceof ManagedSession)) throw new Error("Expected real Pi session");
    const tool = binding.session.piSession.agent.state.tools.find(tool => tool.name === "local_server");
    if (!tool) throw new Error("Missing managed server tool");
    await expect(tool.execute("foreign-server", { action: "stop", serverId: "bfda2db7-4756-4cd0-8176-d997b9e7bbe6" })).rejects.toThrow("Unknown local server");
    const result = JSON.stringify(events);
    const serverId = /\\"serverId\\":\\"([a-f0-9-]+)\\"/.exec(result)?.[1];
    if (!serverId) throw new Error("Missing server ID");
    expect(JSON.stringify(await tool.execute("server-log", { action: "status", serverId }))).toContain("SERVER_LOG_OK");
    await tool.execute("server-stop", { action: "stop", serverId });
  } finally { await binding.dispose(); }
});

it("cancels an active Pi prompt and drains a server started in an earlier tool turn", async () => {
  const { binding, origin, waiting } = await fixture("node", true);
  try {
    const prompt = binding.session.prompt("Start the project and keep verifying.");
    await waiting;
    expect(await (await fetch(origin)).text()).toBe("MANAGED_SERVER_OK");
    await binding.session.abort();
    await prompt;
    await expect(fetch(origin)).rejects.toThrow();
  } finally { await binding.dispose(); }
});

it("runs the documented Python local server through B's managed tool", async () => {
  const { binding, origin, events } = await fixture("python");
  try {
    await binding.session.prompt("Start the Python server and request the project.");
    expect(JSON.stringify(events)).toContain("NATIVE_B_HTTP_OK");
    expect(JSON.stringify(events)).not.toContain('"isError":true');
    expect(await (await fetch(origin)).text()).toBe("MANAGED_SERVER_OK");
  } finally { await binding.dispose(); }
  await expect(fetch(origin)).rejects.toThrow();
});

it("drains a server running in a descendant's separate process group", async () => {
  const { binding, origin } = await fixture("descendant");
  try {
    await binding.session.prompt("Start this project's server process tree.");
    expect(await (await fetch(origin)).text()).toBe("MANAGED_SERVER_OK");
    await new Promise(resolve => setTimeout(resolve, 300));
    await binding.session.abort();
    await expect(fetch(origin)).rejects.toThrow();
  } finally { await binding.dispose(); }
});
