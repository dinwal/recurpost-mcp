import { describe, it, expect, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RecurPostClient } from "../src/client";
import { createServer, REGISTERED_TOOL_NAMES } from "../src/server";
import { CURATED_TOOLS, toolParamNames } from "../src/tools";
import { getEndpoint, getParam } from "../src/catalog";
import { createFetchMock, jsonResponse } from "./helpers/fetch-mock";

const LEGACY_TOOLS = [
  "user_login",
  "workspace_list",
  "social_account_list",
  "library_list",
  "connect_social_account_urls",
  "history_data",
  "post_content",
  "add_content_in_library",
  "generate_content_with_ai",
  "generate_image_with_ai",
];

type FetchMock = ReturnType<typeof createFetchMock>;

let mock: FetchMock;
let client: Client;

async function connect(handler?: Parameters<typeof createFetchMock>[0]) {
  mock = createFetchMock(handler);
  const api = new RecurPostClient({
    email: "test@example.com",
    apiKey: "test-api-key",
    fetch: mock.fn,
  });
  const server = createServer(api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ text: string }>)[0].text;
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { isError: result.isError === true, text, data };
}

beforeEach(async () => {
  await connect();
});

describe("tool registration", () => {
  it("keeps every v1 tool name and adds find_endpoints and call_endpoint", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const name of [...LEGACY_TOOLS, "find_endpoints", "call_endpoint"]) {
      expect(names, name).toContain(name);
    }
    expect([...names].sort()).toEqual([...REGISTERED_TOOL_NAMES].sort());
    expect(new Set(names).size).toBe(names.length);
  });

  it("offers 40 to 50 curated tools", () => {
    expect(CURATED_TOOLS.length).toBeGreaterThanOrEqual(40);
    expect(CURATED_TOOLS.length).toBeLessThanOrEqual(50);
  });

  it("maps every curated tool to a catalog endpoint and real params", () => {
    for (const tool of CURATED_TOOLS) {
      const endpoint = getEndpoint(tool.endpoint);
      expect(endpoint, `${tool.name} -> ${tool.endpoint}`).toBeDefined();
      for (const name of toolParamNames(tool)) {
        expect(getParam(endpoint!, name), `${tool.name}.${name}`).toBeDefined();
      }
    }
  });

  it("marks exactly the endpoint's required params as required", async () => {
    const { tools } = await client.listTools();
    for (const tool of CURATED_TOOLS) {
      const listed = tools.find((t) => t.name === tool.name)!;
      const schema = listed.inputSchema as { required?: string[] };
      const endpoint = getEndpoint(tool.endpoint)!;
      const expected = toolParamNames(tool).filter(
        (name) => tool.overrides?.[name]?.required ?? getParam(endpoint, name)!.required
      );
      expect([...(schema.required ?? [])].sort(), tool.name).toEqual(expected.sort());
    }
  });

  it("gives every tool a description and exposes no credential params", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(40);
      const props = Object.keys((tool.inputSchema as { properties?: object }).properties ?? {});
      for (const secret of ["emailid", "api_key", "pass_key", "token"]) {
        expect(props, `${tool.name} exposes ${secret}`).not.toContain(secret);
      }
    }
  });

  it("declares workspace_id as optional on workspace-scoped tools only", async () => {
    const { tools } = await client.listTools();
    for (const name of [
      "social_account_list",
      "library_list",
      "history_data",
      "add_content_in_library",
      "post_content",
      "queue_list",
    ]) {
      const schema = tools.find((t) => t.name === name)!.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema.properties, name).toHaveProperty("workspace_id");
      expect(schema.required ?? [], name).not.toContain("workspace_id");
    }
    for (const name of ["workspace_list", "user_login"]) {
      const schema = tools.find((t) => t.name === name)!.inputSchema as {
        properties?: Record<string, unknown>;
      };
      expect(schema.properties ?? {}, name).not.toHaveProperty("workspace_id");
    }
  });

  it("annotates read-only and destructive tools", async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.queue_list.annotations?.readOnlyHint).toBe(true);
    expect(byName.post_content.annotations?.readOnlyHint).toBe(false);
    expect(byName.library_content_delete.annotations?.destructiveHint).toBe(true);
    expect(byName.find_endpoints.annotations?.readOnlyHint).toBe(true);
  });
});

describe("user_login", () => {
  it("logs in with api_key and shows the account without the token", async () => {
    const result = await call("user_login");
    expect(result.isError).toBe(false);
    expect(result.data.user_info.email).toBe("test@example.com");
    expect(result.data).not.toHaveProperty("token");
    expect(result.text).not.toMatch(/t{40}/);
    const [login] = mock.calls;
    expect(login.endpoint).toBe("user_login");
    expect(login.body).toEqual({ emailid: "test@example.com", api_key: "test-api-key" });
    expect(login.headers["X-RecurPost-Client"]).toBe("mcp");
  });
});

describe("curated tools", () => {
  it("workspace_list POSTs to /api/workspace_list with a Bearer token and returns the answer", async () => {
    const apiResponse = {
      status: 200,
      workspace_list: [
        { ws_id: "enc-1", ws_name: "Default", is_default: 1, ownership: "own" },
        { ws_id: "enc-2", ws_name: "Client A", is_default: 0, ownership: "shared" },
      ],
    };
    await connect(() => jsonResponse(apiResponse));
    const result = await call("workspace_list");

    const [api] = mock.apiCalls();
    expect(api.url).toBe("https://social.recurpost.com/api/workspace_list");
    expect(api.headers.Authorization).toMatch(/^Bearer /);
    expect(api.headers["X-RecurPost-Client"]).toBe("mcp");
    expect(api.body).toEqual({});
    expect(result.data).toEqual(apiResponse);
  });

  it("logs in once for several tool calls", async () => {
    await call("workspace_list");
    await call("library_list");
    await call("queue_list", { per_page: 5 });
    expect(mock.loginCount()).toBe(1);
  });

  it("forwards workspace_id when given and omits it otherwise", async () => {
    await call("social_account_list", { workspace_id: "enc-2" });
    await call("social_account_list", {});
    const [withWs, withoutWs] = mock.apiCalls();
    expect(withWs.body).toEqual({ workspace_id: "enc-2" });
    expect(withoutWs.body).toEqual({});
  });

  it("post_content takes one account id as a string (v1 style) or a list", async () => {
    await call("post_content", {
      id: "acc-1",
      message: "Hello world",
      workspace_id: "enc-2",
      schedule_date_time: "2026-09-01 09:00:00",
    });
    await call("post_content", { id: ["acc-1", "acc-2"], message: "Hello again" });
    const [one, many] = mock.apiCalls();
    expect(one.endpoint).toBe("post_content");
    expect(one.body).toEqual({
      id: "acc-1",
      message: "Hello world",
      workspace_id: "enc-2",
      schedule_date_time: "2026-09-01 09:00:00",
    });
    expect(many.body.id).toEqual(["acc-1", "acc-2"]);
  });

  it("post_content takes Facebook and Instagram post types as one value or a list", async () => {
    await call("post_content", { id: "acc-1", message: "Hi", fb_post_type: "story", in_post_type: "reel" });
    const listed = await call("post_content", {
      id: "acc-1",
      message: "Hi",
      fb_post_type: ["feed", "story", "reel"],
      in_post_type: ["story", "reel"],
    });
    expect(listed.isError).toBe(false);
    const [single, multi] = mock.apiCalls();
    expect(single.body.fb_post_type).toBe("story");
    expect(single.body.in_post_type).toBe("reel");
    expect(multi.body.fb_post_type).toEqual(["feed", "story", "reel"]);
    expect(multi.body.in_post_type).toEqual(["story", "reel"]);
  });

  it("rejects an unknown post type before reaching the API", async () => {
    const bad = await call("post_content", { id: "acc-1", message: "Hi", fb_post_type: ["feed", "carousel"] });
    expect(bad.isError).toBe(true);
    expect(mock.apiCalls()).toHaveLength(0);
  });

  it("add_content_in_library keeps the v1 params", async () => {
    await call("add_content_in_library", {
      id: "lib-1",
      message: "Evergreen tip",
      image_url: ["https://example.com/a.jpg"],
      is_top_of_queue: 1,
      gbp_cta: "Learn more",
      workspace_id: "enc-1",
    });
    const [api] = mock.apiCalls();
    expect(api.endpoint).toBe("add_content_in_library");
    expect(api.body).toEqual({
      id: "lib-1",
      message: "Evergreen tip",
      image_url: ["https://example.com/a.jpg"],
      is_top_of_queue: 1,
      gbp_cta: "Learn more",
      workspace_id: "enc-1",
    });
  });

  it("history_data forwards its params", async () => {
    await call("history_data", {
      id: "acc-1",
      start_date: "2026-10-01 00:00:00",
      end_date: "2026-10-02 00:00:00",
      workspace_id: "enc-2",
    });
    expect(mock.apiCalls()[0].body).toEqual({
      id: "acc-1",
      start_date: "2026-10-01 00:00:00",
      end_date: "2026-10-02 00:00:00",
      workspace_id: "enc-2",
    });
  });

  it("rejects a call missing a required param before reaching the API", async () => {
    const result = await call("post_content", { message: "no account" });
    expect(result.isError).toBe(true);
    expect(mock.calls).toHaveLength(0);
  });
});

describe("error handling", () => {
  it("shows the API error, code and extra fields", async () => {
    await connect(() =>
      jsonResponse(
        {
          status: 403,
          error: "Your role does not allow this.",
          code: "permission_denied",
          permission: "delete-others",
        },
        403
      )
    );
    const result = await call("queue_post_delete", { id: "q-1" });
    expect(result.isError).toBe(true);
    expect(result.data).toMatchObject({
      error: "Your role does not allow this.",
      code: "permission_denied",
      http_status: 403,
      permission: "delete-others",
      endpoint: "queue_post_delete",
    });
  });

  it("shows Retry-After on a 429", async () => {
    await connect(() =>
      jsonResponse({ status: 429, error: "Rate limit reached.", code: "rate_limited" }, 429, {
        "Retry-After": "42",
      })
    );
    const result = await call("library_list");
    expect(result.isError).toBe(true);
    expect(result.data.code).toBe("rate_limited");
    expect(result.data.retry_after_seconds).toBe(42);
  });

  it("explains an invalid API key", async () => {
    mock.mock.mockImplementation(async () =>
      jsonResponse(
        { status: 401, error: "Invalid email or API key.", code: "invalid_credentials" },
        401
      )
    );
    const result = await call("library_list");
    expect(result.isError).toBe(true);
    expect(result.data.code).toBe("invalid_credentials");
    expect(result.data.hint).toContain("Account Settings > API key");
  });

  it("returns isError with the status and body on a non-JSON failure", async () => {
    await connect(() => new Response("Internal Server Error", { status: 500 }));
    const result = await call("library_list");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("API error 500");
    expect(result.text).toContain("Internal Server Error");
  });

  it("surfaces the underlying network cause instead of a bare 'fetch failed'", async () => {
    // This is exactly what undici throws when DNS fails inside the spawned process.
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND social.recurpost.com"), {
      code: "ENOTFOUND",
    });
    mock.mock.mockRejectedValue(new TypeError("fetch failed", { cause }));

    const result = await call("social_account_list");

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Could not reach https://social.recurpost.com");
    expect(result.text).toContain("fetch failed");
    expect(result.text).toContain("ENOTFOUND");
    expect(result.text).toContain("getaddrinfo ENOTFOUND social.recurpost.com");
  });
});

describe("find_endpoints", () => {
  it("returns matches with summaries and full params for the best ones", async () => {
    const result = await call("find_endpoints", { query: "pause a library" });
    expect(result.isError).toBe(false);
    expect(result.data.catalog_size).toBeGreaterThanOrEqual(300);
    expect(result.data.matches[0].id).toBe("library_pause");
    expect(result.data.matches[0].required_params).toEqual(["id"]);
    const detail = result.data.details.find((d: { id: string }) => d.id === "library_pause");
    const idParam = detail.params.find((p: { name: string }) => p.name === "id");
    expect(idParam.required).toBe(true);
    expect(idParam.description).not.toBe("");
    expect(result.data.details.length).toBeLessThanOrEqual(3);
    expect(mock.calls).toHaveLength(0);
  });

  it("lists a module for an empty query", async () => {
    const result = await call("find_endpoints", { query: "", module: "inbox", limit: 50 });
    expect(result.data.matches.length).toBeGreaterThan(10);
    expect(result.data.matches.every((m: { module: string }) => m.module === "inbox")).toBe(true);
  });
});

describe("call_endpoint", () => {
  it("refuses ids that are not in the catalog without calling the API", async () => {
    const result = await call("call_endpoint", { endpoint: "queue_lists", params: {} });
    expect(result.isError).toBe(true);
    expect(result.data.code).toBe("unknown_endpoint");
    expect(result.data.suggestions).toContain("queue_list");
    expect(mock.calls).toHaveLength(0);
  });

  it("reports missing required params before calling", async () => {
    const result = await call("call_endpoint", {
      endpoint: "library_content_move",
      params: { content_ids: ["c-1"] },
    });
    expect(result.isError).toBe(true);
    expect(result.data.code).toBe("missing_param");
    expect(result.data.missing.map((p: { name: string }) => p.name).sort()).toEqual([
      "from_library_id",
      "to_library_ids",
    ]);
    expect(mock.calls).toHaveLength(0);
  });

  it("asks for confirmation when confirm is missing on a destructive endpoint", async () => {
    const result = await call("call_endpoint", {
      endpoint: "library_delete",
      params: { id: "lib-1" },
    });
    expect(result.isError).toBe(true);
    expect(result.data.missing.map((p: { name: string }) => p.name)).toEqual(["confirm"]);
    expect(result.data.hint).toContain("confirm");
    expect(mock.calls).toHaveLength(0);
  });

  it("calls the endpoint with the same auth and header as the curated tools", async () => {
    await connect(() => jsonResponse({ status: 200, items: [], total: 0 }));
    const result = await call("call_endpoint", {
      endpoint: "queue_list",
      params: { per_page: 5, workspace_id: "enc-1" },
    });
    expect(result.isError).toBe(false);
    expect(result.data).toEqual({ status: 200, items: [], total: 0 });
    const [api] = mock.apiCalls();
    expect(api.url).toBe("https://social.recurpost.com/api/queue_list");
    expect(api.body).toEqual({ per_page: 5, workspace_id: "enc-1" });
    expect(api.headers.Authorization).toMatch(/^Bearer /);
    expect(api.headers["X-RecurPost-Client"]).toBe("mcp");
  });

  it("works without params for endpoints that take none", async () => {
    const result = await call("call_endpoint", { endpoint: "workspace_list" });
    expect(result.isError).toBe(false);
    expect(mock.apiCalls()[0].body).toEqual({});
  });

  it("maps API errors the same way", async () => {
    await connect(() =>
      jsonResponse({ status: 404, error: "Library not found.", code: "not_found" }, 404)
    );
    const result = await call("call_endpoint", {
      endpoint: "library_pause",
      params: { id: "x" },
    });
    expect(result.isError).toBe(true);
    expect(result.data).toMatchObject({
      error: "Library not found.",
      code: "not_found",
      http_status: 404,
    });
  });

  it("handles user_login itself, ignoring passed credentials and hiding the token", async () => {
    const result = await call("call_endpoint", {
      endpoint: "user_login",
      params: { emailid: "other@example.com", api_key: "other" },
    });
    expect(result.isError).toBe(false);
    expect(result.data).not.toHaveProperty("token");
    expect(mock.calls[0].body).toEqual({ emailid: "test@example.com", api_key: "test-api-key" });
  });
});
