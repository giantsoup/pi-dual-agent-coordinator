import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SkillCatalog } from "./skill-catalog.js";
import type { McpExtensionRuntime } from "../mcp/extension.js";

/** Discovery only: registry, sandboxed skill metadata, and role-filtered MCP metadata. */
export function createToolInventoryExtension(options: {
  readSkills(signal?: AbortSignal): Promise<SkillCatalog>;
  mcp: McpExtensionRuntime | undefined;
}): ExtensionFactory {
  return pi => {
    pi.registerTool(defineTool({
      name: "list_tools",
      label: "List tools",
      description: "List this session's callable native tools and schemas, MCP tools and connection status, and installed skills including pstack and Matt Pocock when installed. Skills are instruction workflows, not MCP tools. Use this for capability inventories.",
      parameters: Type.Object({}),
      async execute(_id, _args, signal) {
        const active = new Set(pi.getActiveTools());
        const tools = pi.getAllTools().filter(tool => active.has(tool.name))
          .map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))
          .sort((left, right) => left.name.localeCompare(right.name));
        const [skills, mcp] = await Promise.all([
          options.readSkills(signal),
          options.mcp?.getInventory(signal) ?? Promise.resolve({ status: { enabled: false, servers: [] }, tools: [] })
        ]);
        signal?.throwIfAborted();
        const mcpNames = new Set(options.mcp?.getToolNames().filter(name => name !== "mcp"));
        return {
          content: [{ type: "text", text: JSON.stringify({ tools: tools.map(tool => ({ ...tool, kind: mcpNames.has(tool.name) ? "mcp" : "native" })), mcp, skills,
          guidance: "Report native tools, MCP tools, and installed skills separately. The skills section is the session-start catalog; skills({}) refreshes discovery, and a new session reloads startup metadata. Skills such as Matt Pocock and pstack are invoked through skills, not as MCP tools. Read instructions with skills({name:'NAME'}). MCP entries with allowed:false are blocked; check server lastError before claiming connectivity. Call declared native tools with their schemas or proxy MCP tools with mcp({action:'call_tool',server:'SERVER',tool:'TOOL',arguments:{...}}). There is no multi_tool_use.parallel tool." }, null, 2) }],
          details: {}
        };
      }
    }));
  };
}
