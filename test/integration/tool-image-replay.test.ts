import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ProjectBrowser } from "../../src/browser/controller.js";
import { createRoleRuntime } from "../../src/runtime/create-role-runtime.js";
import { localTokenCounter } from "../../src/security/local-token-counter.js";
import { createLocalModel } from "../../src/security/models.js";
import { fixtureResponse, fixtureToolResponse, fixtureChatResponse, fixtureChatToolResponse } from "../../src/security/fixture-provider.js";

vi.mock("@lmstudio/sdk", () => ({ LMStudioClient: class {
  public llm = { createDynamicHandle: () => ({ applyPromptTemplate: async () => "FORMATTED_SCREENSHOT_NOTICE", countTokens: async () => 123, getContextLength: async () => 65536 }) };
  public async [Symbol.asyncDispose]() {}
} }));

it.each(["A", "B"] as const)("continues Agent %s after an image-only browser result and preserves archived evidence", async role => {
  const root = await mkdtemp(join(tmpdir(), "pi-tool-image-replay-"));
  const cwd = join(root, "workspace"); await mkdir(cwd);
  const image = { type: "image", data: Buffer.from("PRIVATE_SCREENSHOT_BYTES").toString("base64"), mimeType: "image/jpeg" } as const;
  const screenshot = vi.spyOn(ProjectBrowser.prototype, "call").mockResolvedValue({ content: [image], details: { action: "screenshot" } });
  const count = localTokenCounter(async () => "verified-fixture-instance");
  let requests = 0;
  const binding = await createRoleRuntime({ role, cwd, agentDir: join(root, "agent"), sessionRoot: join(root, "state"), sessionMode: "persistent",
    ...(role === "B" ? { localModel: createLocalModel({ id: "qwen/qwen3.8-27b", name: "Fixture vision", vision: true }) } : {}),
    browser: { workspace: cwd, allowedOrigins: ["http://localhost:5173"] },
    providerTestBackend: { cwd, modelIds: [], load: async () => "dummy-tool-image", request: async (_url, init) => {
      const body = String(init?.body);
      // Fixture inference must obey the production local payload validator too.
      if (role === "B") await count(JSON.parse(body));
      if (++requests === 1) return role === "A" ? fixtureToolResponse("browser", { action: "screenshot" }) : fixtureChatToolResponse("browser", { action: "screenshot" });
      expect(body).not.toContain(image.data);
      expect(body).not.toContain('"image_url"');
      expect(body).not.toContain('"input_image"');
      expect(body).toContain("Image evidence retained in the session archive");
      expect(body).toContain("Do not claim visual verification");
      return role === "A" ? fixtureResponse("Continue using browser snapshots.") : fixtureChatResponse("Continue using browser snapshots.");
    } }
  });
  try {
    await binding.session.prompt("Capture the current page.");
    const path = binding.session.sessionFile;
    if (!path) throw new Error("Expected a persisted screenshot session");
    await binding.runtime.newSession();
    await binding.runtime.switchSession(path);
    await binding.rebind();
    await binding.session.prompt("Continue without repeating the screenshot.");
    expect(requests).toBe(3);
    expect(screenshot).toHaveBeenCalledOnce();
    const archived = binding.session.messages?.find(message => message.role === "toolResult" && message.toolName === "browser");
    expect(archived?.role === "toolResult" ? archived.content : undefined).toEqual([image]);
  } finally { screenshot.mockRestore(); await binding.dispose(); await rm(root, { recursive: true, force: true }); }
});
