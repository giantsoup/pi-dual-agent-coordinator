import { Ajv2020 } from "ajv/dist/2020.js";
import { Ajv } from "ajv";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { Type } from "typebox";

const validators = new WeakMap<Tool["inputSchema"], (args: unknown) => boolean>();

/** Compile and validate external schemas before they enter Pi's tool registry. */
export function mcpParameters(schema: Tool["inputSchema"]) {
  if (!validators.has(schema)) {
    if (schema.$async !== undefined && schema.$async !== false) throw new Error("Async MCP schemas are not supported.");
    const Validator = schema.$schema === "http://json-schema.org/draft-07/schema#" ? Ajv : Ajv2020;
    const ajv = new Validator({ strict: false, validateSchema: true, validateFormats: false, allErrors: true });
    validators.set(schema, ajv.compile(schema));
  }
  // Only the static Record shape is declared here. The external schema and every
  // invocation are validated at runtime, including calls through the proxy.
  return Type.Unsafe<Record<string, unknown>>(schema);
}

export function assertMcpArguments(tool: Tool, args: unknown): void {
  mcpParameters(tool.inputSchema);
  if (!validators.get(tool.inputSchema)?.(args ?? {})) throw new Error(`Invalid arguments for MCP tool ${tool.name}.`);
}

export function assertMcpResult(tool: Tool, result: CallToolResult): void {
  if (result.isError || !tool.outputSchema) return;
  mcpParameters(tool.outputSchema);
  if (result.structuredContent === undefined || !validators.get(tool.outputSchema)?.(result.structuredContent)) {
    throw new Error(`Invalid structured result for MCP tool ${tool.name}.`);
  }
}
