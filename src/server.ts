// Builds the MCP server: the curated tools plus find_endpoints and
// call_endpoint, all going through one RecurPostClient.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VERSION } from "./version.js";
import { RecurPostApiError, type RecurPostClient } from "./client.js";
import {
  CATALOG,
  MODULES,
  getEndpoint,
  missingRequired,
  searchEndpoints,
  suggestIds,
  type CatalogEndpoint,
  type CatalogParam,
} from "./catalog.js";
import { CURATED_TOOLS, buildShape } from "./tools.js";

const INSTRUCTIONS = `RecurPost schedules and publishes social media posts.
- Ids are opaque encrypted strings: take them from list tools (workspace_list ws_id, social_account_list smpa_id, library_list cd_id, queue_list id / post_id) and pass them back unchanged.
- workspace_id is optional everywhere; leave it out for the user's default workspace.
- The curated tools cover everyday work. For anything else (inbox, feeds, groups, team roles, custom reports, account settings, library tools and more) call find_endpoints, then call_endpoint with the endpoint id it returns.
- post_content without schedule_date_time publishes immediately. Ask the user before publishing, deleting or any call that needs confirm: true.
- Errors show the API's error message and code; explain them to the user instead of retrying blindly. On a 429, wait for retry_after_seconds.`;

// Node's fetch reports every network failure as a bare "TypeError: fetch failed"
// and buries the real reason (ENOTFOUND, ECONNREFUSED, a rejected certificate...)
// in `cause`. Walk the chain so the tool output says what actually went wrong.
export function describeError(e: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = e;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const err = cur as { name?: string; message?: string; code?: string; cause?: unknown };
    const code = err.code ? ` [${err.code}]` : "";
    parts.push(`${err.name ?? "Error"}: ${err.message ?? ""}${code}`);
    cur = err.cause;
  }
  return parts.length ? parts.join(" <- ") : String(e);
}

const HINTS: Record<string, string> = {
  credentials_required:
    "Set RECURPOST_EMAIL and RECURPOST_API_KEY for this server. The key is under Account Settings > API key in RecurPost.",
  invalid_credentials:
    "The email and API key do not match. Check RECURPOST_EMAIL and RECURPOST_API_KEY; the key is under Account Settings > API key in RecurPost and is not the login password. A regenerated key replaces the old one.",
  confirm_required:
    "Ask the user to confirm, then repeat the call with confirm: true.",
  workspace_not_found:
    "Use a ws_id from workspace_list, or leave workspace_id out for the default workspace.",
  owner_paused:
    "The owner of this workspace has paused their subscription; only they can resume it.",
  permission_denied:
    "The user's role in this workspace does not allow this action.",
  rate_limited: "Too many calls this minute. Wait retry_after_seconds before trying again.",
  login_locked: "Too many failed logins for this email. Wait retry_after_seconds.",
  too_many_attempts: "Too many failed logins from this address. Wait retry_after_seconds.",
  endpoint_not_found: "Use find_endpoints to look up a valid endpoint id.",
};

export function errorPayload(e: unknown): Record<string, unknown> {
  if (e instanceof RecurPostApiError) {
    const payload: Record<string, unknown> = {
      error: e.message,
      code: e.code ?? null,
      http_status: e.status,
      endpoint: e.endpoint,
    };
    if (typeof e.body === "object") {
      for (const [key, value] of Object.entries(e.body)) {
        if (key === "status" || key === "error" || key === "code") continue;
        payload[key] = value;
      }
    }
    if (e.retryAfter !== undefined) payload.retry_after_seconds = e.retryAfter;
    if (e.status === 429 && e.rateLimit) payload.rate_limit = e.rateLimit;
    const hint = e.code ? HINTS[e.code] : undefined;
    if (hint) payload.hint = hint;
    return payload;
  }
  return { error: describeError(e) };
}

function toolResult(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return toolResult(await fn());
  } catch (e) {
    return toolResult(errorPayload(e), true);
  }
}

function withoutUndefined(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function paramDetail(p: CatalogParam) {
  const detail: Record<string, unknown> = {
    name: p.name,
    type: p.type,
    required: p.required,
    description: p.description,
  };
  if (p.enum) detail.enum = p.enum;
  if (p.default !== undefined) detail.default = p.default;
  if ((p.type === "array" || p.type === "object") && p.example !== undefined) {
    detail.example = p.example;
  }
  return detail;
}

function requiredNames(endpoint: CatalogEndpoint): string[] {
  return endpoint.params
    .filter((p) => p.required && !p.name.includes(".") && !p.name.includes("["))
    .map((p) => p.name);
}

const DETAILED_MATCHES = 3;

export function findEndpoints(query: string, module?: string, limit = 10) {
  const results = searchEndpoints(query, module, limit);
  return {
    catalog_size: CATALOG.endpoints.length,
    matches: results.map(({ endpoint }) => ({
      id: endpoint.id,
      module: endpoint.module,
      title: endpoint.title,
      summary: endpoint.summary,
      required_params: requiredNames(endpoint),
      destructive: endpoint.destructive,
    })),
    details: results.slice(0, DETAILED_MATCHES).map(({ endpoint }) => ({
      id: endpoint.id,
      summary: endpoint.summary,
      params: endpoint.params.map(paramDetail),
    })),
    next_step:
      results.length > 0
        ? "Call call_endpoint with endpoint set to one of these ids and params as described. Pass find_endpoints the exact id to see the params of a match not detailed here."
        : "No match. Try other words, or leave query empty with a module to list that module.",
  };
}

export function createServer(client: RecurPostClient): McpServer {
  const server = new McpServer(
    { name: "recurpost", version: VERSION },
    { instructions: INSTRUCTIONS }
  );

  for (const tool of CURATED_TOOLS) {
    const endpoint = tool.endpoint;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: buildShape(tool),
        annotations: {
          readOnlyHint: tool.readOnly === true,
          destructiveHint: tool.destructive === true,
          openWorldHint: true,
        },
      },
      async (args: Record<string, unknown>) =>
        run(() =>
          endpoint === "user_login"
            ? client.login()
            : client.call(endpoint, withoutUndefined(args ?? {}))
        )
    );
  }

  server.registerTool(
    "find_endpoints",
    {
      description: `Search the full RecurPost API catalog (${CATALOG.endpoints.length} endpoints in ${MODULES.length} modules) by words and an optional module. Use it whenever the curated tools do not cover what the user wants: inbox and comments, RSS feeds, account groups, team roles, workspace invites and settings, custom reports, PDF reports, hashtag groups, watermarks, library tools (expired content, bulk edit, sharing), variations, DM automations, workflow card changes, account settings and more. Returns matching endpoint ids with summaries and required params, and the full param list (name, type, required, description, allowed values) for the best ${DETAILED_MATCHES}. Then run the endpoint with call_endpoint. Passing an exact endpoint id as query returns that endpoint's params.`,
      inputSchema: {
        query: z
          .string()
          .describe(
            "Words describing the task, for example 'reply to a comment', 'pause a library', 'invite member', or an exact endpoint id. May be empty when module is given, to list that module."
          ),
        module: z
          .enum(MODULES as [string, ...string[]])
          .optional()
          .describe("Limit the search to one module."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("How many matches to return, 1 to 50. Default 10."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, module, limit }) => toolResult(findEndpoints(query, module, limit ?? 10))
  );

  server.registerTool(
    "call_endpoint",
    {
      description:
        "Call any RecurPost API endpoint by its id, with the same login, headers and error handling as the other tools. Use find_endpoints first to get the id and its params; use the curated tools when one fits. Ids not in the catalog are refused, and missing required params are reported before anything is sent. Endpoints that delete, publish, send email or spend credits act for real: ask the user first, and only send confirm: true after they agree.",
      inputSchema: {
        endpoint: z
          .string()
          .describe("Endpoint id from find_endpoints, for example queue_list or inbox_reply_comment."),
        params: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "The endpoint's params as a JSON object, using the names find_endpoints lists. workspace_id is optional on workspace endpoints. Leave out for endpoints without params."
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ endpoint: id, params }) => {
      const endpoint = getEndpoint(id.trim());
      if (!endpoint) {
        return toolResult(
          {
            error: `Unknown endpoint id: ${id}`,
            code: "unknown_endpoint",
            suggestions: suggestIds(id),
            hint: "Use find_endpoints to look up the right id.",
          },
          true
        );
      }
      if (endpoint.id === "user_login") {
        return run(() => client.login());
      }
      const body = withoutUndefined(params ?? {});
      const missing = missingRequired(endpoint, body);
      if (missing.length > 0) {
        return toolResult(
          {
            error: `Missing required params for ${endpoint.id}: ${missing.map((p) => p.name).join(", ")}`,
            code: "missing_param",
            missing: missing.map(paramDetail),
            hint:
              missing.some((p) => p.name === "confirm")
                ? "confirm must be true. Ask the user to confirm this action first."
                : "Add the missing params and call again. Nothing was sent.",
          },
          true
        );
      }
      return run(() => client.call(endpoint.id, body));
    }
  );

  return server;
}

export const REGISTERED_TOOL_NAMES = [
  ...CURATED_TOOLS.map((t) => t.name),
  "find_endpoints",
  "call_endpoint",
];
