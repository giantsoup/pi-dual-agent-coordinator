import { createCodingTools, createReadOnlyTools } from "@mariozechner/pi-coding-agent";

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
  const tools = role === "A" ? createReadOnlyTools(process.cwd()) : createCodingTools(process.cwd());
  const tool = tools.find((candidate) => candidate.name === request.name);
  if (!tool) throw new Error("Unavailable tool");
  const result = await tool.execute("isolated", request.args, undefined, (update) => {
    process.stdout.write(`${JSON.stringify({ update })}\n`);
  });
  process.stdout.write(`${JSON.stringify({ result })}\n`);
}
void main().catch(() => { process.stderr.write("Isolated tool failed.\n"); process.exitCode = 1; });
