import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createRoleTools } from "../../src/tools/create-role-tools.js";

it("both roles retain normal reads while protected reads fail", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-dual-isolation-"));
  const workspace = await mkdtemp(join(tmpdir(), "pi-dual-workspace-"));
  const dummy = randomUUID(), secretPath = join(root, "credential");
  await writeFile(secretPath, dummy); await writeFile(join(workspace, "normal"), "NORMAL_READ_OK");
  try {
    for (const role of ["A", "B"] as const) {
      const read = createRoleTools({ role, cwd: workspace }).find((tool) => tool.name === "read");
      if (!read) throw new Error("Missing actual read tool");
      expect(JSON.stringify(await read.execute("normal", { path: "normal" }))).toContain("NORMAL_READ_OK");
      await expect(read.execute("protected", { path: secretPath })).rejects.toThrow("Isolated tool failed");
    }
  } finally {
    await rm(root, { recursive: true, force: true }); await rm(workspace, { recursive: true, force: true });
  }
});
