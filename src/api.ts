// One client for the RecurPost public API: logs in once with the account email and API key,
// sends the one-hour Bearer token on every call, and logs in again when it expires or is
// rejected. Nothing here knows about MCP.

export interface ClientOptions {
  baseUrl: string;
  email: string;
  apiKey: string;
  // Seams for tests
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface LoginInfo {
  user: unknown;
  expiresAt: string;
  expiresIn: number;
}

// Longest rate-limit wait the client absorbs on its own; longer waits surface as an error
export const MAX_RETRY_AFTER_SECONDS = 60;
// Log in again this long before the token expires so a call never races the expiry
const REFRESH_MARGIN_MS = 60_000;

export class RecurPostApiError extends Error {
  status: number;
  body: unknown;
  retryAfter?: number;

  constructor(message: string, status: number, body: unknown, retryAfter?: number) {
    super(message);
    this.name = "RecurPostApiError";
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

// Node's fetch reports every network failure as a bare "TypeError: fetch failed" and buries the
// real reason (ENOTFOUND, ECONNREFUSED, a rejected certificate...) in `cause`. Walk the chain so
// the tool output says what actually went wrong.
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

interface Reply {
  httpStatus: number;
  status: number;
  body: unknown;
  retryAfter?: number;
}

function parseBody(text: string): unknown {
  if (text === "") {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function bodyStatus(body: unknown, httpStatus: number): number {
  if (body && typeof body === "object" && !Array.isArray(body) && "status" in body) {
    const n = Number((body as { status: unknown }).status);
    if (!Number.isNaN(n)) {
      return n;
    }
  }
  return httpStatus;
}

function bodyMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const b = body as { error?: unknown; message?: unknown };
    if (typeof b.error === "string" && b.error) {
      return b.error;
    }
    if (typeof b.message === "string" && b.message) {
      return b.message;
    }
  }
  return `RecurPost API error ${status}`;
}

function retryAfterSeconds(response: Response, body: unknown): number | undefined {
  const header = Number(response.headers.get("Retry-After"));
  if (header > 0) {
    return header;
  }
  const m = /try again in (\d+) seconds/i.exec(bodyMessage(body, 429));
  return m ? Number(m[1]) : undefined;
}

export class RecurPostClient {
  private readonly baseUrl: string;
  private readonly email: string;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  private token = "";
  private expiresAtMs = 0;
  private pendingLogin: Promise<LoginInfo> | null = null;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.email = options.email;
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? (() => Date.now());
  }

  get apiUrl(): string {
    return this.baseUrl;
  }

  // Logs in now, sharing one request between callers that ask at the same time
  login(): Promise<LoginInfo> {
    if (!this.pendingLogin) {
      this.pendingLogin = this.doLogin().finally(() => {
        this.pendingLogin = null;
      });
    }
    return this.pendingLogin;
  }

  private async doLogin(): Promise<LoginInfo> {
    const reply = await this.post("/api/user_login", { emailid: this.email, pass_key: this.apiKey });
    const body = reply.body as { token?: unknown; expires_at?: unknown; expires_in?: unknown; user_info?: unknown };
    if (reply.httpStatus >= 400 || reply.status !== 200 || typeof body.token !== "string") {
      this.token = "";
      throw new RecurPostApiError(bodyMessage(reply.body, reply.status), reply.status, reply.body, reply.retryAfter);
    }
    const expiresIn = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
    const parsed = typeof body.expires_at === "string" ? Date.parse(body.expires_at) : NaN;
    this.token = body.token;
    this.expiresAtMs = Number.isNaN(parsed) ? this.now() + expiresIn * 1000 : parsed;
    return {
      user: body.user_info ?? null,
      expiresAt: new Date(this.expiresAtMs).toISOString(),
      expiresIn,
    };
  }

  private async ensureToken(): Promise<string> {
    if (this.token && this.now() < this.expiresAtMs - REFRESH_MARGIN_MS) {
      return this.token;
    }
    await this.login();
    return this.token;
  }

  // Posts to one endpoint and returns the decoded body; throws RecurPostApiError on any failure
  async call(endpoint: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const path = `/api/${endpoint.replace(/^\/?(api\/)?/, "")}`;
    let relogged = false;
    let waited = false;
    for (;;) {
      const token = await this.ensureToken();
      const reply = await this.post(path, params, token);

      if (reply.status === 401 && !relogged) {
        relogged = true;
        this.token = "";
        continue;
      }
      if (reply.status === 429 && !waited && reply.retryAfter !== undefined && reply.retryAfter <= MAX_RETRY_AFTER_SECONDS) {
        waited = true;
        await this.sleep(reply.retryAfter * 1000);
        continue;
      }
      if (reply.httpStatus >= 400 || (reply.status !== 200 && !Array.isArray(reply.body))) {
        throw new RecurPostApiError(bodyMessage(reply.body, reply.status), reply.status, reply.body, reply.retryAfter);
      }
      return reply.body;
    }
  }

  private async post(path: string, params: Record<string, unknown>, token?: string): Promise<Reply> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        body[key] = value;
      }
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error(`Could not reach ${this.baseUrl}`, { cause: e });
    }
    const parsed = parseBody(await response.text());
    const status = bodyStatus(parsed, response.status);
    return {
      httpStatus: response.status,
      status,
      body: parsed,
      retryAfter: status === 429 ? retryAfterSeconds(response, parsed) : undefined,
    };
  }
}
