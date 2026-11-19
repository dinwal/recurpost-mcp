import { vi } from "vitest";

export const TEST_TOKEN = "t".repeat(64);

export function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function loginResponse(token = TEST_TOKEN, expiresIn = 3600): Response {
  return jsonResponse({
    status: 200,
    message: "Success",
    user_info: { id: "enc-user", name: "Test User", email: "test@example.com" },
    token,
    expires_at: "2026-01-01T01:00:00Z",
    expires_in: expiresIn,
  });
}

export interface RecordedCall {
  url: string;
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

// A fetch mock that answers /api/user_login with a token and everything else
// through `handler` (default: a plain success body).
export function createFetchMock(
  handler: (call: RecordedCall, n: number) => Response | Promise<Response> = () =>
    jsonResponse({ status: 200, message: "Success" })
) {
  const calls: RecordedCall[] = [];
  let logins = 0;
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>)
    );
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const endpoint = url.replace(/^.*\/api\//, "");
    const call = { url, endpoint, headers, body };
    calls.push(call);
    if (endpoint === "user_login") {
      logins++;
      return loginResponse(`${"t".repeat(63)}${logins}`);
    }
    return handler(call, calls.length - 1);
  });
  return {
    fn: fn as unknown as typeof fetch,
    mock: fn,
    calls,
    apiCalls: () => calls.filter((c) => c.endpoint !== "user_login"),
    loginCount: () => calls.filter((c) => c.endpoint === "user_login").length,
  };
}
