// Turns the generated endpoint specs into MCP tools. The first-class set is registered as
// ordinary tools with full input schemas; every other operation is reachable through three
// catalog tools (list_operations, describe_operation, call_operation) so the whole API is
// available without loading hundreds of tool definitions into the model's context.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { RecurPostApiError, RecurPostClient, describeError } from "./api.js";
import type { ParamSpec, ToolSpec } from "./types.js";
import { generatedTools, modules, firstClassToolNames } from "./generated/index.js";

// Parameter descriptions on first-class tools are cut to this many characters; the full text
// stays available through describe_operation.
export const SHORT_DESCRIPTION_CHARS = 220;

export function shorten(text: string, max = SHORT_DESCRIPTION_CHARS): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  if (end > max * 0.3) {
    return cut.slice(0, end + 1);
  }
  return cut.replace(/\s+\S*$/, "") + "...";
}

export function paramDescription(p: ParamSpec, full: boolean): string {
  let text = full ? p.description : shorten(p.description);
  if (p.default !== undefined && !/default/i.test(text)) {
    text += ` Default: ${p.default}.`;
  }
  if (p.type === "datetime" && !/YYYY|ISO/i.test(text)) {
    text += " Format: YYYY-MM-DD HH:MM:SS.";
  }
  if (p.type === "date" && !/YYYY/.test(text)) {
    text += " Format: YYYY-MM-DD.";
  }
  return text;
}

export function zodFor(p: ParamSpec, full: boolean): z.ZodTypeAny {
  let schema: z.ZodTypeAny;
  if (p.values && p.values.length) {
    schema = z.enum(p.values as [string, ...string[]]);
    if (p.type === "integer") {
      schema = z.union([schema, z.number().int()]);
    }
  } else {
    switch (p.type) {
      case "integer":
        schema = z.number().int();
        break;
      case "boolean":
        schema = z.boolean();
        break;
      case "array":
        schema = p.items === "object" ? z.array(z.union([z.record(z.unknown()), z.string()])) : z.array(z.union([z.string(), z.number()]));
        if (p.acceptsList) {
          schema = z.union([schema, z.string()]);
        }
        break;
      case "object":
        schema = z.record(z.unknown());
        break;
      default:
        schema = p.acceptsList ? z.union([z.string(), z.array(z.string())]) : z.string();
    }
  }
  schema = schema.describe(paramDescription(p, full));
  return p.required ? schema : schema.optional();
}

export function shapeFor(tool: ToolSpec, full: boolean): z.ZodRawShape {
  const shape: z.ZodRawShape = {};
  for (const p of tool.params) {
    shape[p.key] = zodFor(p, full);
  }
  return shape;
}

// The body sent to the API: the caller's arguments plus the fixed action / confirm values
export function requestBody(tool: ToolSpec, args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const p of tool.params) {
    if (args[p.key] !== undefined) {
      body[p.key] = args[p.key];
    }
  }
  if (tool.action) {
    body.action = tool.action;
  }
  if (tool.confirm) {
    body.confirm = true;
  }
  return body;
}

export function toolDescription(tool: ToolSpec): string {
  let text = tool.summary;
  if (tool.description) {
    text += " " + shorten(tool.description, 260);
  }
  if (tool.confirm) {
    text += " This change cannot be undone and runs without a further confirmation step.";
  }
  return text;
}

export function toolResult(data: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }],
    isError,
  };
}

export function errorResult(e: unknown): CallToolResult {
  if (e instanceof RecurPostApiError) {
    const out: Record<string, unknown> = { error: e.message, status: e.status };
    if (e.retryAfter) {
      out.retry_after_seconds = e.retryAfter;
    }
    if (e.body && typeof e.body === "object") {
      out.details = e.body;
    }
    return toolResult(out, true);
  }
  return toolResult({ error: describeError(e) }, true);
}

export async function runTool(client: RecurPostClient, tool: ToolSpec, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    if (tool.endpoint === "user_login") {
      const info = await client.login();
      return toolResult({
        status: 200,
        message: "Credentials verified",
        user_info: info.user,
        token_expires_at: info.expiresAt,
      });
    }
    return toolResult(await client.call(tool.endpoint, requestBody(tool, args)));
  } catch (e) {
    return errorResult(e);
  }
}

// The first-class set: the configured list plus whole modules named in RECURPOST_MODULES
// ("all" promotes everything). Unknown module names are reported on stderr and skipped.
export function resolveFirstClass(modulesEnv: string | undefined, log: (line: string) => void = (l) => console.error(l)): Set<string> {
  const names = new Set(firstClassToolNames);
  const wanted = (modulesEnv ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (wanted.includes("all")) {
    for (const tool of generatedTools) {
      names.add(tool.name);
    }
    return names;
  }
  const known = new Set(modules.map((m) => m.key));
  for (const key of wanted) {
    if (!known.has(key)) {
      log(`RECURPOST_MODULES: unknown module "${key}". Known modules: ${[...known].join(", ")}`);
      continue;
    }
    for (const tool of generatedTools) {
      if (tool.module === key) {
        names.add(tool.name);
      }
    }
  }
  return names;
}

function describeParam(p: ParamSpec) {
  return {
    name: p.key,
    type: p.type,
    required: p.required,
    description: paramDescription(p, true),
    values: p.values,
    default: p.default,
    example: p.example,
  };
}

function describeTool(tool: ToolSpec, direct: boolean) {
  return {
    name: tool.name,
    title: tool.title,
    module: tool.module,
    description: [tool.summary, tool.description].filter(Boolean).join(" "),
    direct_tool: direct,
    read_only: tool.readOnly,
    destructive: tool.destructive,
    confirm_sent_automatically: Boolean(tool.confirm),
    parameters: tool.params.map(describeParam),
  };
}

export function registerTools(server: McpServer, client: RecurPostClient, firstClass: Set<string>): void {
  const byName = new Map(generatedTools.map((t) => [t.name, t]));

  for (const tool of generatedTools) {
    if (!firstClass.has(tool.name)) {
      continue;
    }
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: toolDescription(tool),
        inputSchema: shapeFor(tool, false),
        annotations: {
          title: tool.title,
          readOnlyHint: tool.readOnly,
          destructiveHint: tool.destructive,
          idempotentHint: tool.readOnly,
          openWorldHint: true,
        },
      },
      async (args) => runTool(client, tool, (args ?? {}) as Record<string, unknown>),
    );
  }

  const moduleKeys = modules.map((m) => m.key) as [string, ...string[]];
  const catalogIntro = `RecurPost has ${generatedTools.length} API operations in ${modules.length} modules; ${firstClass.size} are available as direct tools.`;

  server.registerTool(
    "list_operations",
    {
      title: "List RecurPost operations",
      description: `${catalogIntro} Lists the modules, or the operations of one module or matching a search. Use describe_operation to see an operation's parameters and call_operation to run any operation that is not a direct tool.`,
      inputSchema: {
        module: z.enum(moduleKeys).optional().describe("Module whose operations to list"),
        search: z.string().optional().describe("Text to look for in operation names and summaries"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ module, search }) => {
      if (!module && !search) {
        return toolResult({
          modules: modules.map((m) => ({
            module: m.key,
            title: m.title,
            description: m.description,
            operations: generatedTools.filter((t) => t.module === m.key).length,
          })),
          total_operations: generatedTools.length,
          direct_tools: firstClass.size,
        });
      }
      const needle = (search ?? "").toLowerCase();
      const matches = generatedTools.filter(
        (t) => (!module || t.module === module) && (!needle || t.name.includes(needle) || t.summary.toLowerCase().includes(needle)),
      );
      return toolResult({
        operations: matches.map((t) => ({
          name: t.name,
          module: t.module,
          summary: t.summary,
          required_params: t.params.filter((p) => p.required).map((p) => p.key),
          direct_tool: firstClass.has(t.name),
        })),
      });
    },
  );

  server.registerTool(
    "describe_operation",
    {
      title: "Describe a RecurPost operation",
      description: "Full description and parameter list of one operation, by the name list_operations returned.",
      inputSchema: {
        name: z.string().describe("Operation name from list_operations"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ name }) => {
      const tool = byName.get(name);
      if (!tool) {
        return toolResult({ error: `Unknown operation "${name}". Use list_operations to find the name.` }, true);
      }
      return toolResult(describeTool(tool, firstClass.has(tool.name)));
    },
  );

  server.registerTool(
    "call_operation",
    {
      title: "Run a RecurPost operation",
      description:
        "Runs any operation by name with its parameters as an object. Parameters are checked against the operation's definition first; describe_operation shows what each one takes. Operations that delete or disconnect things run without a further confirmation step.",
      inputSchema: {
        name: z.string().describe("Operation name from list_operations"),
        params: z.record(z.unknown()).optional().describe("The operation's parameters, by API parameter name"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ name, params }) => {
      const tool = byName.get(name);
      if (!tool) {
        return toolResult({ error: `Unknown operation "${name}". Use list_operations to find the name.` }, true);
      }
      const parsed = z.object(shapeFor(tool, true)).strict().safeParse(params ?? {});
      if (!parsed.success) {
        return toolResult(
          {
            error: `Invalid parameters for ${name}`,
            issues: parsed.error.issues.map((i) => ({ param: i.path.join(".") || undefined, message: i.message })),
            hint: `Call describe_operation with name "${name}" to see the parameters.`,
          },
          true,
        );
      }
      return runTool(client, tool, parsed.data as Record<string, unknown>);
    },
  );
}
