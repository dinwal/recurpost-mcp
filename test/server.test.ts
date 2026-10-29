import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import path from "node:path";

// Must be set before the server module is imported: it reads them at load time.
process.env.RECURPOST_EMAIL = "test@example.com";
process.env.RECURPOST_API_KEY = "test-api-key";
process.env.RECURPOST_API_URL = "https://social.recurpost.com";
delete process.env.RECURPOST_MODULES;

const config = JSON.parse(readFileSync(path.resolve(__dirname, "../scripts/tools.config.json"), "utf8"));
const FIRST_CLASS: string[] = config.firstClass;
const CATALOG = ["list_operations", "describe_operation", "call_operation"];
const LEGACY_TEN = [
  "add_content_in_library",
  "connect_social_account_urls",
  "generate_content_with_ai",
  "generate_image_with_ai",
  "history_data",
  "library_list",
  "post_content",
  "social_account_list",
  "user_login",
  "workspace_list",
];

const LOGIN_OK = {
  status: 200,
  message: "Success",
  user_info: { id: "enc-user", name: "Test User", email: "test@example.com" },
  token: "tok-1",
  expires_at: "2099-01-01T00:00:00+00:00",
  expires_in: 3600,
};

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

let client: Client;

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status < 400,
    status,
    headers: new Headers(headers),
    text: async () => (typeof data === "string" ? data : JSON.stringify(data)),
  };
}

// Every API call after the login is answered with this unless a test says otherwise
function answerWith(data: unknown, status = 200) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith("/api/user_login")) {
      return jsonResponse(LOGIN_OK);
    }
    return jsonResponse(data, status);
  });
}

// The API calls made during a test, login calls left out
function apiCalls(): Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> {
  return fetchMock.mock.calls
    .filter(([url]) => !String(url).endsWith("/api/user_login"))
    .map(([url, init]) => ({
      url: url as string,
      headers: (init as RequestInit).headers as Record<string, string>,
      body: JSON.parse((init as RequestInit).body as string),
    }));
}

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

function text(result: ToolResult): string {
  return (result.content as Array<{ text: string }>)[0].text;
}

function json(result: ToolResult): any {
  return JSON.parse(text(result));
}

beforeAll(async () => {
  const { server } = await import("../src/index");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

beforeEach(() => {
  fetchMock.mockReset();
  answerWith({ status: 200, message: "Success" });
});

describe("tool registration", () => {
  it("exposes the first-class tools and the three catalog tools, nothing else", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...FIRST_CLASS, ...CATALOG].sort());
  });

  it("keeps the ten tools every earlier release had", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const name of LEGACY_TEN) {
      expect(names, name).toContain(name);
    }
  });

  it("keeps the parameter names the earlier post_content and history_data tools used", async () => {
    const { tools } = await client.listTools();
    const props = (name: string) => Object.keys((tools.find((t) => t.name === name)!.inputSchema as any).properties ?? {});
    expect(props("post_content")).toEqual(
      expect.arrayContaining([
        "id",
        "message",
        "workspace_id",
        "schedule_date_time",
        "image_url",
        "video_url",
        "url",
        "fb_message",
        "fb_post_type",
        "first_comment",
        "gbp_cta",
        "yt_privacy_status",
        "tk_privacy_status",
      ]),
    );
    expect(props("history_data")).toEqual(expect.arrayContaining(["id", "workspace_id", "start_date", "end_date", "is_get_video_updates"]));
    expect(props("add_content_in_library")).toEqual(expect.arrayContaining(["id", "message", "is_top_of_queue", "content_livedate", "content_expiredate"]));
  });

  it("declares workspace_id as an optional input on every workspace-scoped tool", async () => {
    const { tools } = await client.listTools();
    for (const name of ["social_account_list", "library_list", "history_data", "add_content_in_library", "post_content", "queue_list"]) {
      const schema = tools.find((t) => t.name === name)!.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      expect(schema.properties, name).toHaveProperty("workspace_id");
      expect(schema.required ?? [], name).not.toContain("workspace_id");
    }
  });

  it("never asks the model for credentials", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const props = Object.keys((tool.inputSchema as any).properties ?? {});
      expect(props, tool.name).not.toContain("emailid");
      expect(props, tool.name).not.toContain("pass_key");
    }
    expect(Object.keys((tools.find((t) => t.name === "user_login")!.inputSchema as any).properties ?? {})).toEqual([]);
  });

  it("marks read-only and destructive tools through annotations", async () => {
    const { tools } = await client.listTools();
    const annotations = (name: string) => tools.find((t) => t.name === name)!.annotations!;
    expect(annotations("library_list").readOnlyHint).toBe(true);
    expect(annotations("library_list").destructiveHint).toBe(false);
    expect(annotations("queue_post_delete").destructiveHint).toBe(true);
    expect(annotations("post_content").readOnlyHint).toBe(false);
  });

  it("gives every tool a required list that matches the docs", async () => {
    const { tools } = await client.listTools();
    const required = (name: string) => ((tools.find((t) => t.name === name)!.inputSchema as any).required ?? []).sort();
    expect(required("post_content")).toEqual(["id", "message"]);
    expect(required("approval_reject")).toEqual(["id", "message"]);
    expect(required("approval_approve")).toEqual(["id"]);
    expect(required("workspace_list")).toEqual([]);
  });
});

describe("authentication", () => {
  it("logs in with the credentials from the environment and sends the token on the call", async () => {
    await client.callTool({ name: "workspace_list", arguments: {} });

    const [loginUrl, loginInit] = fetchMock.mock.calls[0];
    expect(loginUrl).toBe("https://social.recurpost.com/api/user_login");
    expect(JSON.parse((loginInit as RequestInit).body as string)).toEqual({ emailid: "test@example.com", pass_key: "test-api-key" });

    const [call] = apiCalls();
    expect(call.url).toBe("https://social.recurpost.com/api/workspace_list");
    expect(call.headers.Authorization).toBe("Bearer tok-1");
    expect(call.body).not.toHaveProperty("emailid");
    expect(call.body).not.toHaveProperty("pass_key");
  });

  it("user_login verifies the credentials and reports the account without the token", async () => {
    const result = await client.callTool({ name: "user_login", arguments: {} });

    expect(result.isError).toBeFalsy();
    const data = json(result);
    expect(data.user_info).toEqual(LOGIN_OK.user_info);
    expect(data.token_expires_at).toBe("2099-01-01T00:00:00.000Z");
    expect(text(result)).not.toContain("tok-1");
  });

  it("reports a bad key as an error with the server's message", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ status: 401, error: "We could not authenticate the user's RecurPost credentials." }, 401),
    );

    const result = await client.callTool({ name: "library_list", arguments: {} });

    expect(result.isError).toBe(true);
    expect(json(result)).toMatchObject({ status: 401, error: "We could not authenticate the user's RecurPost credentials." });
  });
});

describe("parameter forwarding", () => {
  it("forwards workspace_id on social_account_list when given and omits it otherwise", async () => {
    await client.callTool({ name: "social_account_list", arguments: { workspace_id: "enc-2" } });
    await client.callTool({ name: "social_account_list", arguments: {} });

    const [withWorkspace, without] = apiCalls();
    expect(withWorkspace.url).toBe("https://social.recurpost.com/api/social_account_list");
    expect(withWorkspace.body).toEqual({ workspace_id: "enc-2" });
    expect(without.body).toEqual({});
  });

  it("forwards post_content fields as given, arrays included", async () => {
    await client.callTool({
      name: "post_content",
      arguments: {
        id: "123",
        message: "Hello world",
        workspace_id: "enc-2",
        schedule_date_time: "2026-09-01 09:00:00",
        image_url: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
        host_images_on_recurpost: false,
        fb_post_type: "reel",
      },
    });

    const [call] = apiCalls();
    expect(call.url).toBe("https://social.recurpost.com/api/post_content");
    expect(call.body).toEqual({
      id: "123",
      message: "Hello world",
      workspace_id: "enc-2",
      schedule_date_time: "2026-09-01 09:00:00",
      image_url: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
      host_images_on_recurpost: false,
      fb_post_type: "reel",
    });
  });

  it("accepts several account ids as an array on post_content", async () => {
    await client.callTool({ name: "post_content", arguments: { id: ["a", "b"], message: "Two accounts" } });

    expect(apiCalls()[0].body.id).toEqual(["a", "b"]);
  });

  it("sends the fixed action on a split tool", async () => {
    await client.callTool({ name: "approval_reject", arguments: { id: "p-1", message: "Please fix the link" } });

    const [call] = apiCalls();
    expect(call.url).toBe("https://social.recurpost.com/api/approval_decide");
    expect(call.body).toEqual({ action: "reject", id: "p-1", message: "Please fix the link" });
  });

  it("rejects a value outside the documented list before calling the API", async () => {
    const result = await client
      .callTool({ name: "post_content", arguments: { id: "1", message: "x", fb_post_type: "carousel" } })
      .catch((e) => e);

    expect(apiCalls()).toHaveLength(0);
    const message = result instanceof Error ? result.message : text(result);
    expect(message).toMatch(/fb_post_type|Invalid/);
  });

  it("returns the API response body as the tool text", async () => {
    const apiResponse = {
      status: 200,
      workspace_list: [
        { ws_id: "enc-1", ws_name: "Default", is_default: 1, ownership: "own" },
        { ws_id: "enc-2", ws_name: "Client A", is_default: 0, ownership: "shared" },
      ],
    };
    answerWith(apiResponse);

    const result = await client.callTool({ name: "workspace_list", arguments: {} });

    expect(json(result)).toEqual(apiResponse);
  });
});

describe("catalog tools", () => {
  it("list_operations without arguments lists the modules with counts", async () => {
    const data = json(await client.callTool({ name: "list_operations", arguments: {} }));

    expect(data.total_operations).toBeGreaterThan(250);
    expect(data.direct_tools).toBe(FIRST_CLASS.length);
    const workspaces = data.modules.find((m: any) => m.module === "workspaces");
    expect(workspaces.title).toBe("Workspaces");
    expect(workspaces.operations).toBeGreaterThan(10);
  });

  it("list_operations with a module lists its operations and marks the direct tools", async () => {
    const data = json(await client.callTool({ name: "list_operations", arguments: { module: "workspaces" } }));

    const names = data.operations.map((o: any) => o.name);
    expect(names).toContain("workspace_list");
    expect(names).toContain("workspace_social_accounts_add");
    expect(names).toContain("workspace_delete");
    expect(data.operations.find((o: any) => o.name === "workspace_list").direct_tool).toBe(true);
    expect(data.operations.find((o: any) => o.name === "workspace_delete").direct_tool).toBe(false);
    expect(data.operations.find((o: any) => o.name === "workspace_social_accounts_add").required_params).toEqual(["account_ids"]);
  });

  it("list_operations with a search matches names and summaries", async () => {
    const data = json(await client.callTool({ name: "list_operations", arguments: { search: "hashtag" } }));

    const names = data.operations.map((o: any) => o.name);
    expect(names).toContain("ai_hashtags");
    expect(names).toContain("hashtag_groups_list");
  });

  it("describe_operation returns the full parameter list", async () => {
    const data = json(await client.callTool({ name: "describe_operation", arguments: { name: "workspace_delete" } }));

    expect(data.name).toBe("workspace_delete");
    expect(data.module).toBe("workspaces");
    expect(data.destructive).toBe(true);
    expect(data.confirm_sent_automatically).toBe(true);
    const id = data.parameters.find((p: any) => p.name === "workspace_id");
    expect(id.required).toBe(false);
    expect(id.description).toContain("Defaults to your default workspace");
    expect(data.parameters.map((p: any) => p.name)).not.toContain("confirm");
  });

  it("describe_operation names an unknown operation as an error", async () => {
    const result = await client.callTool({ name: "describe_operation", arguments: { name: "nope" } });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("list_operations");
  });

  it("call_operation runs an operation, adding confirm=true where the API wants it", async () => {
    await client.callTool({ name: "call_operation", arguments: { name: "workspace_delete", params: { workspace_id: "enc-9" } } });

    const [call] = apiCalls();
    expect(call.url).toBe("https://social.recurpost.com/api/workspace_delete");
    expect(call.body).toEqual({ workspace_id: "enc-9", confirm: true });
  });

  it("call_operation sends the action of a split operation", async () => {
    await client.callTool({
      name: "call_operation",
      arguments: { name: "workspace_social_accounts_add", params: { account_ids: ["a1", "a2"], workspace_id: "enc-1" } },
    });

    expect(apiCalls()[0].body).toEqual({ action: "add", account_ids: ["a1", "a2"], workspace_id: "enc-1" });
  });

  it("call_operation rejects missing or unknown parameters without calling the API", async () => {
    const missing = json(await client.callTool({ name: "call_operation", arguments: { name: "approval_reject", params: { id: "p-1" } } }));
    const unknown = json(await client.callTool({ name: "call_operation", arguments: { name: "workspace_list", params: { foo: 1 } } }));

    expect(apiCalls()).toHaveLength(0);
    expect(missing.error).toContain("approval_reject");
    expect(missing.issues.map((i: any) => i.param)).toContain("message");
    expect(unknown.issues[0].message).toMatch(/foo/);
  });
});

describe("error handling", () => {
  it("returns isError with the body status and message when the API refuses", async () => {
    answerWith({ status: 400, error: "Invalid workspace_id." }, 200);

    const result = await client.callTool({ name: "library_list", arguments: { workspace_id: "bad" } });

    expect(result.isError).toBe(true);
    expect(json(result)).toMatchObject({ status: 400, error: "Invalid workspace_id." });
  });

  it("returns isError with the HTTP status on a server error page", async () => {
    answerWith("Internal Server Error", 500);

    const result = await client.callTool({ name: "library_list", arguments: {} });

    expect(result.isError).toBe(true);
    expect(json(result)).toMatchObject({ status: 500, error: "Internal Server Error" });
  });

  it("surfaces the underlying network cause instead of a bare 'fetch failed'", async () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND social.recurpost.com"), { code: "ENOTFOUND" });
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed", { cause });
    });

    const result = await client.callTool({ name: "social_account_list", arguments: {} });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Could not reach https://social.recurpost.com");
    expect(text(result)).toContain("ENOTFOUND");
  });

  it("tells the caller how long to wait when the rate limit cannot be absorbed", async () => {
    answerWith({ status: 429, error: "Daily limit reached. Try again in 3600 seconds." }, 429);

    const result = await client.callTool({ name: "queue_list", arguments: {} });

    expect(result.isError).toBe(true);
    expect(json(result)).toMatchObject({ status: 429, retry_after_seconds: 3600 });
  });
});
