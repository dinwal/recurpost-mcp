import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Must be set before the server module is imported — it reads them at load time.
process.env.RECURPOST_EMAIL = "test@example.com";
process.env.RECURPOST_API_KEY = "test-api-key";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

let client: Client;

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

// Returns the { url, body } of the nth fetch call made during a test.
function fetchCall(n = 0): { url: string; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls[n];
  return { url: url as string, body: JSON.parse((init as RequestInit).body as string) };
}

beforeAll(async () => {
  const { server } = await import("../src/index");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse({ status: 200, message: "Success" }));
});

describe("tool registration", () => {
  it("exposes all 10 tools, including workspace_list", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
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
      ].sort()
    );
  });

  it("declares workspace_id as an optional input on every workspace-scoped tool", async () => {
    const { tools } = await client.listTools();
    const scoped = [
      "social_account_list",
      "library_list",
      "history_data",
      "add_content_in_library",
      "post_content",
    ];
    for (const name of scoped) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      const schema = tool!.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      expect(schema.properties, name).toHaveProperty("workspace_id");
      expect(schema.required ?? [], name).not.toContain("workspace_id");
    }
  });

  it("does not put workspace_id on tools the API does not scope", async () => {
    const { tools } = await client.listTools();
    for (const name of ["workspace_list", "user_login", "generate_image_with_ai"]) {
      const tool = tools.find((t) => t.name === name);
      const schema = tool!.inputSchema as { properties?: Record<string, unknown> };
      expect(schema.properties ?? {}, name).not.toHaveProperty("workspace_id");
    }
  });
});

describe("credential handling", () => {
  it("sends emailid and pass_key from the environment on every call", async () => {
    await client.callTool({ name: "user_login", arguments: {} });
    const { body } = fetchCall();
    expect(body.emailid).toBe("test@example.com");
    expect(body.pass_key).toBe("test-api-key");
  });
});

describe("workspace_list", () => {
  it("POSTs to /api/workspace_list and returns the API response", async () => {
    const apiResponse = {
      status: 200,
      workspace_list: [
        { ws_id: "enc-1", ws_name: "Default", is_default: 1, ownership: "own" },
        { ws_id: "enc-2", ws_name: "Client A", is_default: 0, ownership: "shared" },
      ],
    };
    fetchMock.mockResolvedValue(jsonResponse(apiResponse));

    const result = await client.callTool({ name: "workspace_list", arguments: {} });

    expect(fetchCall().url).toBe("https://social.recurpost.com/api/workspace_list");
    const content = (result.content as Array<{ text: string }>)[0];
    expect(JSON.parse(content.text)).toEqual(apiResponse);
  });
});

describe("workspace_id forwarding", () => {
  it("forwards workspace_id on social_account_list when given", async () => {
    await client.callTool({
      name: "social_account_list",
      arguments: { workspace_id: "enc-2" },
    });
    const { url, body } = fetchCall();
    expect(url).toBe("https://social.recurpost.com/api/social_account_list");
    expect(body.workspace_id).toBe("enc-2");
  });

  it("omits workspace_id on social_account_list when not given", async () => {
    await client.callTool({ name: "social_account_list", arguments: {} });
    expect(fetchCall().body).not.toHaveProperty("workspace_id");
  });

  it("forwards workspace_id alongside the other params on post_content", async () => {
    await client.callTool({
      name: "post_content",
      arguments: {
        id: "123",
        message: "Hello world",
        workspace_id: "enc-2",
        schedule_date_time: "2026-09-01 09:00:00",
      },
    });
    const { url, body } = fetchCall();
    expect(url).toBe("https://social.recurpost.com/api/post_content");
    expect(body).toMatchObject({
      id: "123",
      message: "Hello world",
      workspace_id: "enc-2",
      schedule_date_time: "2026-09-01 09:00:00",
    });
  });

  it("forwards workspace_id on add_content_in_library", async () => {
    await client.callTool({
      name: "add_content_in_library",
      arguments: { id: "77", message: "Evergreen tip", workspace_id: "enc-1" },
    });
    const { url, body } = fetchCall();
    expect(url).toBe("https://social.recurpost.com/api/add_content_in_library");
    expect(body).toMatchObject({ id: "77", message: "Evergreen tip", workspace_id: "enc-1" });
  });

  it("forwards workspace_id on history_data", async () => {
    await client.callTool({
      name: "history_data",
      arguments: { id: "123", workspace_id: "enc-2" },
    });
    const { url, body } = fetchCall();
    expect(url).toBe("https://social.recurpost.com/api/history_data");
    expect(body).toMatchObject({ id: "123", workspace_id: "enc-2" });
  });
});

describe("error handling", () => {
  it("returns isError with the API status and body on a failed request", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
      json: async () => ({}),
    });

    const result = await client.callTool({ name: "library_list", arguments: {} });

    expect(result.isError).toBe(true);
    const content = (result.content as Array<{ text: string }>)[0];
    expect(content.text).toContain("API error 500");
    expect(content.text).toContain("Internal Server Error");
  });

  it("surfaces the underlying network cause instead of a bare 'fetch failed'", async () => {
    // This is exactly what undici throws when DNS fails inside the spawned process.
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND social.recurpost.com"), {
      code: "ENOTFOUND",
    });
    fetchMock.mockRejectedValue(new TypeError("fetch failed", { cause }));

    const result = await client.callTool({ name: "social_account_list", arguments: {} });

    expect(result.isError).toBe(true);
    const content = (result.content as Array<{ text: string }>)[0];
    expect(content.text).toContain("Could not reach https://social.recurpost.com");
    expect(content.text).toContain("fetch failed");
    expect(content.text).toContain("ENOTFOUND");
    expect(content.text).toContain("getaddrinfo ENOTFOUND social.recurpost.com");
  });
});
