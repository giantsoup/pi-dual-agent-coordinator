import { open } from "node:fs/promises";
import { constants } from "node:fs";

async function main(): Promise<void> {
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (input.length > 4 * 1024 * 1024) throw new Error("Input limit");
  }
  const request: unknown = JSON.parse(input);
  if (!request || typeof request !== "object" || !("name" in request) || !("args" in request)) throw new Error("Invalid request");
  const role = process.argv[2];
  if (role !== "A" && role !== "B") throw new Error("Invalid role");
  // Missing project instructions and sandbox-denied reads need no SDK startup.
  // Keep Pi's fuzzy/expanded path handling for every other missing read path.
  if (request.name === "read" && typeof request.args === "object" && request.args !== null && "path" in request.args && typeof request.args.path === "string") {
    try { const file = await open(request.args.path, constants.O_RDONLY | constants.O_NONBLOCK); await file.close(); }
    catch (error) {
      if (error instanceof Error && "code" in error && (["EPERM", "EACCES"].includes(String(error.code)) || error.code === "ENOENT" && request.args.path === "AGENTS.md")) throw error;
    }
  }
  const skillTool = request.name === "skills" && "skillsDir" in request && typeof request.skillsDir === "string"
    ? (await import("./skills.js")).createSkillsTool(request.skillsDir) : undefined;
  const onUpdate = (update: unknown) => { process.stdout.write(`${JSON.stringify({ update })}\n`); };
  let result: unknown;
  if (skillTool) {
    const { Value } = await import("typebox/value");
    if (!Value.Check(skillTool.parameters, request.args)) throw new Error("Invalid skills request");
    result = await skillTool.execute("isolated", request.args, undefined, onUpdate);
  } else {
    const { createCodingTools, createReadOnlyTools } = await import("@earendil-works/pi-coding-agent");
    const tools = role === "A" ? createReadOnlyTools(process.cwd()) : createCodingTools(process.cwd());
    const tool = tools.find(candidate => candidate.name === request.name);
    if (!tool) throw new Error("Unavailable tool");
    result = await tool.execute("isolated", request.args, undefined, onUpdate);
  }
  process.stdout.write(`${JSON.stringify({ result })}\n`);
}
void main().catch(() => { process.stderr.write("Isolated tool failed.\n"); process.exitCode = 1; });
