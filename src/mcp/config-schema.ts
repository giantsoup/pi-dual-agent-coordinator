import { z } from "zod";

const roleConfigSchema = z.object({
  allowTools: z.array(z.string()).optional(),
  excludeTools: z.array(z.string()).optional()
});

const serverPiDualConfigSchema = z.object({
  directTools: z.boolean().optional(),
  lifecycle: z.enum(["lazy", "eager"]).optional(),
  idleTimeoutMinutes: z.number().int().positive().optional(),
  required: z.boolean().optional(),
  roles: z
    .object({
      A: roleConfigSchema.optional(),
      B: roleConfigSchema.optional()
    })
    .partial()
    .optional()
});

export const mcpServerConfigSchema = z
  .object({
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().min(1).optional(),
    url: z.string().url().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    transport: z.enum(["stdio", "streamable-http", "sse", "http"]).optional(),
    "x-pi-dual": serverPiDualConfigSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (!value.command && !value.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each MCP server requires either `command` or `url`."
      });
    }
    if (value.command && value.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An MCP server cannot define both `command` and `url`."
      });
    }
  });

export const mcpConfigFileSchema = z.object({
  mcpServers: z.record(z.string(), mcpServerConfigSchema)
});
