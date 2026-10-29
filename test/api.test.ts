import { describe, it, expect, vi } from "vitest";
import { RecurPostClient, RecurPostApiError } from "../src/api";

const LOGIN_OK = {
  status: 200,
  message: "Success",
  user_info: { id: "enc-user", name: "Test User", email: "test@example.com" },
  token: "tok-1",
  expires_at: "2026-10-29T11:00:00+00:00",
  expires_in: 3600,
};

function reply(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    status,
    ok: status < 400,
    headers: new Headers(headers),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function makeClient(fetchMock: ReturnType<typeof vi.fn>, extra: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
  return new RecurPostClient({
    baseUrl: "https://api.test/",
    email: "test@example.com",
    apiKey: "key-123",
    fetchFn: fetchMock as unknown as typeof fetch,
    now: extra.now ?? (() => Date.parse("2026-10-29T10:00:00Z")),
    sleep: extra.sleep ?? (async () => {}),
  });
}

function requestAt(fetchMock: ReturnType<typeof vi.fn>, n: number) {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
  const headers = init.headers as Record<string, string>;
  return { url, headers, body: JSON.parse(init.body as string) as Record<string, unknown> };
}

describe("login and token reuse", () => {
  it("logs in once with the credentials in the body, then sends the Bearer token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(reply({ status: 200, workspace_list: [] }))
      .mockResolvedValueOnce(reply({ status: 200, library_list: [] }));
    const client = makeClient(fetchMock);

    await client.call("workspace_list");
    await client.call("api/library_list", { workspace_id: "ws-1", skip: undefined, nothing: null });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const login = requestAt(fetchMock, 0);
    expect(login.url).toBe("https://api.test/api/user_login");
    expect(login.body).toEqual({ emailid: "test@example.com", pass_key: "key-123" });
    expect(login.headers.Authorization).toBeUndefined();

    const first = requestAt(fetchMock, 1);
    expect(first.url).toBe("https://api.test/api/workspace_list");
    expect(first.headers.Authorization).toBe("Bearer tok-1");
    expect(first.headers["Content-Type"]).toBe("application/json");
    expect(first.body).toEqual({});
    expect(first.body).not.toHaveProperty("pass_key");

    const second = requestAt(fetchMock, 2);
    expect(second.url).toBe("https://api.test/api/library_list");
    expect(second.body).toEqual({ workspace_id: "ws-1" });
  });

  it("shares one login between calls made at the same time", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/user_login")) {
        return reply(LOGIN_OK);
      }
      return reply({ status: 200 });
    });
    const client = makeClient(fetchMock);

    await Promise.all([client.call("a"), client.call("b"), client.call("c")]);

    const logins = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/user_login"));
    expect(logins).toHaveLength(1);
  });

  it("logs in again shortly before the token expires", async () => {
    let now = Date.parse("2026-10-29T10:00:00Z");
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/user_login")) {
        return reply({ ...LOGIN_OK, token: `tok-${fetchMock.mock.calls.length}` });
      }
      return reply({ status: 200 });
    });
    const client = makeClient(fetchMock, { now: () => now });

    await client.call("a");
    now = Date.parse("2026-10-29T10:58:00Z");
    await client.call("b");
    now = Date.parse("2026-10-29T10:59:30Z");
    await client.call("c");

    const logins = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/user_login"));
    expect(logins).toHaveLength(2);
    expect(requestAt(fetchMock, 4).headers.Authorization).not.toBe(requestAt(fetchMock, 1).headers.Authorization);
  });

  it("logs in again once on a 401 and retries the call", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(reply({ status: 401, error: "Token expired" }, 401))
      .mockResolvedValueOnce(reply({ ...LOGIN_OK, token: "tok-2" }))
      .mockResolvedValueOnce(reply({ status: 200, message: "Success" }));
    const client = makeClient(fetchMock);

    const result = await client.call("account_details");

    expect(result).toEqual({ status: 200, message: "Success" });
    expect(requestAt(fetchMock, 1).headers.Authorization).toBe("Bearer tok-1");
    expect(requestAt(fetchMock, 3).headers.Authorization).toBe("Bearer tok-2");
  });

  it("gives up after the second 401 with the server's message", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(reply({ status: 401, error: "We could not authenticate the user's RecurPost credentials." }, 401))
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(reply({ status: 401, error: "We could not authenticate the user's RecurPost credentials." }, 401));
    const client = makeClient(fetchMock);

    const err = await client.call("account_details").catch((e) => e);

    expect(err).toBeInstanceOf(RecurPostApiError);
    expect(err.status).toBe(401);
    expect(err.message).toContain("could not authenticate");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("reports a failed login with the server's message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ status: 401, error: "Bad key" }, 401));
    const client = makeClient(fetchMock);

    const err = await client.call("workspace_list").catch((e) => e);

    expect(err).toBeInstanceOf(RecurPostApiError);
    expect(err.message).toBe("Bad key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("login() returns the account info and expiry, never the token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(LOGIN_OK));
    const client = makeClient(fetchMock);

    const info = await client.login();

    expect(info.user).toEqual(LOGIN_OK.user_info);
    expect(info.expiresAt).toBe("2026-10-29T11:00:00.000Z");
    expect(info.expiresIn).toBe(3600);
    expect(JSON.stringify(info)).not.toContain("tok-1");
  });
});

describe("rate limiting", () => {
  it("waits for Retry-After and retries once", async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(reply({ status: 429, error: "Too many calls. Try again in 7 seconds." }, 429, { "Retry-After": "7" }))
      .mockResolvedValueOnce(reply({ status: 200, ok: true }));
    const client = makeClient(fetchMock, { sleep });

    const result = await client.call("queue_list");

    expect(result).toEqual({ status: 200, ok: true });
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it("reads the wait from the message when the header is missing", async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(reply({ status: 429, error: "Daily limit reached. Try again in 12 seconds." }, 429))
      .mockResolvedValueOnce(reply({ status: 200 }));
    const client = makeClient(fetchMock, { sleep });

    await client.call("queue_list");

    expect(sleep).toHaveBeenCalledWith(12000);
  });

  it("does not wait longer than a minute and surfaces the wait instead", async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(reply({ status: 429, error: "Daily limit reached. Try again in 3600 seconds." }, 429, { "Retry-After": "3600" }));
    const client = makeClient(fetchMock, { sleep });

    const err = await client.call("queue_list").catch((e) => e);

    expect(sleep).not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(RecurPostApiError);
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(3600);
  });
});

describe("response handling", () => {
  it("treats HTTP 200 with a non-200 body status as a failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(reply({ status: 400, error: "Invalid workspace_id." }, 200));
    const client = makeClient(fetchMock);

    const err = await client.call("library_list", { workspace_id: "bad" }).catch((e) => e);

    expect(err).toBeInstanceOf(RecurPostApiError);
    expect(err.status).toBe(400);
    expect(err.message).toBe("Invalid workspace_id.");
    expect(err.body).toEqual({ status: 400, error: "Invalid workspace_id." });
  });

  it("accepts a bare array body as success", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(reply([]));
    const client = makeClient(fetchMock);

    expect(await client.call("social_account_list")).toEqual([]);
  });

  it("wraps a non-JSON error page in a readable error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(reply("<html>Bad gateway</html>", 502));
    const client = makeClient(fetchMock);

    const err = await client.call("queue_list").catch((e) => e);

    expect(err.status).toBe(502);
    expect(err.message).toContain("Bad gateway");
  });

  it("names the host and the cause when the network fails", async () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND api.test"), { code: "ENOTFOUND" });
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause }));
    const client = makeClient(fetchMock);

    const err = await client.call("queue_list").catch((e) => e);

    expect(err.message).toBe("Could not reach https://api.test");
    expect(err.cause).toBeInstanceOf(TypeError);
    expect((err.cause as Error & { cause: Error }).cause.message).toContain("ENOTFOUND");
  });
});
