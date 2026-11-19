import { describe, it, expect } from "vitest";
import {
  RecurPostClient,
  RecurPostApiError,
  RecurPostNetworkError,
  DEFAULT_API_URL,
} from "../src/client";
import { createFetchMock, jsonResponse } from "./helpers/fetch-mock";

function makeClient(
  mock: ReturnType<typeof createFetchMock>,
  options: { baseUrl?: string; now?: () => number } = {}
) {
  return new RecurPostClient({
    email: "test@example.com",
    apiKey: "test-api-key",
    fetch: mock.fn,
    ...options,
  });
}

describe("login", () => {
  it("posts emailid and api_key to /api/user_login with the client header and no token", async () => {
    const mock = createFetchMock();
    await makeClient(mock).login();

    const [login] = mock.calls;
    expect(login.url).toBe(`${DEFAULT_API_URL}/api/user_login`);
    expect(login.body).toEqual({ emailid: "test@example.com", api_key: "test-api-key" });
    expect(login.body).not.toHaveProperty("pass_key");
    expect(login.headers["X-RecurPost-Client"]).toBe("mcp");
    expect(login.headers["Content-Type"]).toBe("application/json");
    expect(login.headers).not.toHaveProperty("Authorization");
  });

  it("never returns the token", async () => {
    const mock = createFetchMock();
    const info = await makeClient(mock).login();
    expect(info).not.toHaveProperty("token");
    expect(info.user_info?.name).toBe("Test User");
    expect(info.expires_in).toBe(3600);
  });

  it("shares one login between concurrent calls", async () => {
    const mock = createFetchMock();
    const client = makeClient(mock);
    await Promise.all([client.call("library_list"), client.call("workspace_list")]);
    expect(mock.loginCount()).toBe(1);
  });

  it("turns a failed login into an API error with code", async () => {
    const mock = createFetchMock();
    mock.mock.mockImplementation(async () =>
      jsonResponse(
        { status: 401, error: "Invalid email or API key.", code: "invalid_credentials" },
        401
      )
    );
    const err = await makeClient(mock).call("library_list").catch((e) => e);
    expect(err).toBeInstanceOf(RecurPostApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe("invalid_credentials");
    expect(err.endpoint).toBe("user_login");
    // A bad key is not retried.
    expect(mock.mock).toHaveBeenCalledTimes(1);
  });
});

describe("requests", () => {
  it("POSTs JSON to /api/<id> with the Bearer token and the client header", async () => {
    const mock = createFetchMock();
    await makeClient(mock).call("queue_list", { page: 2, workspace_id: "enc-ws" });

    const [call] = mock.apiCalls();
    expect(call.url).toBe(`${DEFAULT_API_URL}/api/queue_list`);
    expect(call.headers.Authorization).toMatch(/^Bearer t{63}1$/);
    expect(call.headers["X-RecurPost-Client"]).toBe("mcp");
    expect(call.body).toEqual({ page: 2, workspace_id: "enc-ws" });
    expect(call.body).not.toHaveProperty("emailid");
    expect(call.body).not.toHaveProperty("api_key");
    expect(mock.mock.mock.calls[1][1]?.method).toBe("POST");
  });

  it("uses a configurable base URL, with or without a trailing slash or /api", async () => {
    for (const baseUrl of ["https://staging.example.com", "https://staging.example.com/", "https://staging.example.com/api/"]) {
      const mock = createFetchMock();
      await makeClient(mock, { baseUrl }).call("library_list");
      expect(mock.calls.map((c) => c.url)).toEqual([
        "https://staging.example.com/api/user_login",
        "https://staging.example.com/api/library_list",
      ]);
    }
  });

  it("reuses the cached token while it is valid", async () => {
    const mock = createFetchMock();
    const client = makeClient(mock);
    await client.call("library_list");
    await client.call("workspace_list");
    await client.call("social_account_list");
    expect(mock.loginCount()).toBe(1);
  });

  it("logs in again shortly before the token expires", async () => {
    let now = 1_000_000;
    const mock = createFetchMock();
    const client = makeClient(mock, { now: () => now });
    await client.call("library_list");
    now += 3000 * 1000; // 50 minutes later: still valid
    await client.call("library_list");
    expect(mock.loginCount()).toBe(1);
    now += 570 * 1000; // 59.5 minutes after login: inside the refresh margin
    await client.call("library_list");
    expect(mock.loginCount()).toBe(2);
    expect(mock.apiCalls()[2].headers.Authorization).toMatch(/2$/);
  });

  for (const code of ["token_expired", "token_invalid"]) {
    it(`logs in again and retries once on 401 ${code}`, async () => {
      let first = true;
      const mock = createFetchMock(() => {
        if (first) {
          first = false;
          return jsonResponse({ status: 401, error: "Token problem.", code }, 401);
        }
        return jsonResponse({ status: 200, library_list: [] });
      });
      const result = await makeClient(mock).call("library_list");

      expect(result).toEqual({ status: 200, library_list: [] });
      expect(mock.calls.map((c) => c.endpoint)).toEqual([
        "user_login",
        "library_list",
        "user_login",
        "library_list",
      ]);
      expect(mock.apiCalls()[1].headers.Authorization).toMatch(/2$/);
    });
  }

  it("retries only once when the fresh token is refused too", async () => {
    const mock = createFetchMock(() =>
      jsonResponse({ status: 401, error: "Token expired.", code: "token_expired" }, 401)
    );
    const err = await makeClient(mock).call("library_list").catch((e) => e);
    expect(err).toBeInstanceOf(RecurPostApiError);
    expect(err.code).toBe("token_expired");
    expect(mock.calls).toHaveLength(4);
  });

  it("does not retry other 401 codes", async () => {
    const mock = createFetchMock(() =>
      jsonResponse({ status: 401, error: "Token required.", code: "token_required" }, 401)
    );
    await makeClient(mock).call("library_list").catch(() => undefined);
    expect(mock.calls).toHaveLength(2);
  });
});

describe("error mapping", () => {
  it("keeps the HTTP status, code and every extra field", async () => {
    const mock = createFetchMock(() =>
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
    const err = await makeClient(mock).call("queue_post_delete", { id: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(RecurPostApiError);
    expect(err.message).toBe("Your role does not allow this.");
    expect(err.status).toBe(403);
    expect(err.code).toBe("permission_denied");
    expect(err.endpoint).toBe("queue_post_delete");
    expect(err.body.permission).toBe("delete-others");
  });

  it("reads Retry-After and the rate limit headers on a 429", async () => {
    const mock = createFetchMock(() =>
      jsonResponse({ status: 429, error: "Rate limit reached.", code: "rate_limited" }, 429, {
        "Retry-After": "17",
        "X-RateLimit-Limit": "60",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": "1767225660",
      })
    );
    const err = await makeClient(mock).call("library_list").catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.code).toBe("rate_limited");
    expect(err.retryAfter).toBe(17);
    expect(err.rateLimit).toEqual({ limit: 60, remaining: 0, reset: 1767225660 });
  });

  it("reports a non-JSON error body with its status", async () => {
    const mock = createFetchMock(() => new Response("Internal Server Error", { status: 500 }));
    const err = await makeClient(mock).call("library_list").catch((e) => e);
    expect(err).toBeInstanceOf(RecurPostApiError);
    expect(err.status).toBe(500);
    expect(err.message).toContain("API error 500");
    expect(err.message).toContain("Internal Server Error");
  });

  it("treats an error status inside a 200 body as an error", async () => {
    const mock = createFetchMock(() =>
      jsonResponse({ status: 404, error: "Not found.", code: "not_found" }, 200)
    );
    const err = await makeClient(mock).call("library_details", { id: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(RecurPostApiError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("not_found");
  });

  it("returns an empty list answer as data, not an error", async () => {
    const mock = createFetchMock(() => jsonResponse({ status: 200, message: "Success", items: [] }));
    await expect(makeClient(mock).call("queue_list")).resolves.toEqual({
      status: 200,
      message: "Success",
      items: [],
    });
  });

  it("wraps network failures with the base URL and keeps the cause", async () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND social.recurpost.com"), {
      code: "ENOTFOUND",
    });
    const mock = createFetchMock();
    mock.mock.mockRejectedValue(new TypeError("fetch failed", { cause }));
    const err = await makeClient(mock).call("library_list").catch((e) => e);
    expect(err).toBeInstanceOf(RecurPostNetworkError);
    expect(err.message).toBe(`Could not reach ${DEFAULT_API_URL}`);
    expect(err.cause.cause).toBe(cause);
  });
});
