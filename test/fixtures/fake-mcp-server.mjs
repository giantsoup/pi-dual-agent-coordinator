#!/usr/bin/env node

import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "fixture-mcp",
  version: "1.0.0"
});

server.registerTool(
  "echo",
  {
    description: "Echo text back to the caller",
    inputSchema: {
      text: z.string()
    },
    annotations: {
      readOnlyHint: true
    }
  },
  async ({ text }) => ({
    content: [
      {
        type: "text",
        text: `echo:${text}`
      }
    ]
  })
);

server.registerTool("slow", { description: "Cancellable fixture request", inputSchema: {}, annotations: { readOnlyHint: true } }, async (_args, extra) => {
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 30_000);
    extra.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  return { content: [{ type: "text", text: "finished" }] };
});

server.registerTool(
  "destroy",
  {
    description: "Destructive tool for policy tests",
    annotations: {
      destructiveHint: true
    }
  },
  async () => ({
    content: [
      {
        type: "text",
        text: "destroyed"
      }
    ]
  })
);

server.registerResource(
  "guide",
  "file:///fixture/guide.txt",
  {
    title: "Fixture Guide",
    description: "A fixture resource",
    mimeType: "text/plain"
  },
  async () => ({
    contents: [
      {
        uri: "file:///fixture/guide.txt",
        text: "resource-body"
      }
    ]
  })
);

server.registerPrompt(
  "hello-prompt",
  {
    description: "Generate a hello message",
    argsSchema: {
      name: z.string()
    }
  },
  async ({ name }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Hello ${name}`
        }
      }
    ]
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
