// RecurPost API v2 client.
//
// Every endpoint is POST <base>/api/<id> with a JSON body. The client logs in
// with the email and API key (POST /api/user_login), caches the one-hour
// Bearer token, logs in again shortly before it runs out, and retries a call
// once when the API answers 401 token_expired or token_invalid. Every request,
// the login included, carries X-RecurPost-Client: mcp.

import { VERSION } from "./version.js";

export const DEFAULT_API_URL = "https://social.recurpost.com";
export const CLIENT_HEADER = "X-RecurPost-Client";
export const CLIENT_NAME = "mcp";

// Log in again when the cached token has less than this left.
const REFRESH_MARGIN_MS = 60_000;
const DEFAULT_TOKEN_LIFETIME_S = 3600;
const RETRY_CODES = new Set(["token_expired", "token_invalid"]);

export interface RateLimit {
  limit?: number;
  remaining?: number;
  reset?: number;
}

export interface LoginInfo {
  status?: number;
  message?: string;
  user_info?: { id?: string; name?: string; email?: string };
  expires_at?: string;
  expires_in?: number;
}

export interface ClientOptions {
  email: string;
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

// An answer from the API with an error status. `body` keeps every field the
// API sent (error, code and extras such as permission or details).
export class RecurPostApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body: Record<string, unknown> | string;
  readonly endpoint: string;
  readonly retryAfter?: number;
  readonly rateLimit?: RateLimit;

  constructor(args: {
    endpoint: string;
    status: number;
    body: Record<string, unknown> | string;
    retryAfter?: number;
    rateLimit?: RateLimit;
  }) {
    const body = args.body;
    const message =
      typeof body === "object" && typeof body.error === "string"
        ? body.error
        : `API error ${args.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`;
    super(message);
    this.name = "RecurPostApiError";
    this.endpoint = args.endpoint;
    this.status = args.status;
    this.body = body;
    this.code = typeof body === "object" && typeof body.code === "string" ? body.code : undefined;
    this.retryAfter = args.retryAfter;
    this.rateLimit = args.rateLimit;
  }
}

// The API could not be reached at all (DNS, refused connection, TLS...).
export class RecurPostNetworkError extends Error {
  constructor(baseUrl: string, cause: unknown) {
    super(`Could not reach ${baseUrl}`, { cause });
    this.name = "RecurPostNetworkError";
  }
}

function toNumber(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function readRateLimit(headers: Headers | undefined): RateLimit | undefined {
  if (!headers || typeof headers.get !== "function") return undefined;
  const rl: RateLimit = {
    limit: toNumber(headers.get("X-RateLimit-Limit")),
    remaining: toNumber(headers.get("X-RateLimit-Remaining")),
    reset: toNumber(headers.get("X-RateLimit-Reset")),
  };
  return rl.limit === undefined && rl.remaining === undefined && rl.reset === undefined
    ? undefined
    : rl;
}

function normaliseBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/api$/, "");
}

export class RecurPostClient {
  readonly baseUrl: string;
  private readonly email: string;
  private readonly apiKey: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly now: () => number;
  private token?: string;
  private tokenExpiresAt = 0;
  private loginInFlight?: Promise<LoginInfo>;
  lastRateLimit?: RateLimit;

  constructor(options: ClientOptions) {
    this.email = options.email;
    this.apiKey = options.apiKey;
    this.baseUrl = normaliseBaseUrl(options.baseUrl || DEFAULT_API_URL);
    this.fetchImpl = options.fetch;
    this.now = options.now ?? Date.now;
  }

  // Logs in now, replacing any cached token. Returns the login answer without
  // the token, which never leaves this class.
  login(): Promise<LoginInfo> {
    if (!this.loginInFlight) {
      this.loginInFlight = this.doLogin().finally(() => {
        this.loginInFlight = undefined;
      });
    }
    return this.loginInFlight;
  }

  // Calls POST /api/<endpoint> with a Bearer token and returns the parsed body.
  async call(endpoint: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (endpoint === "user_login") {
      return this.login();
    }
    let token = await this.validToken();
    let result = await this.send(endpoint, params, token);
    if (result.status === 401 && RETRY_CODES.has(this.codeOf(result.body))) {
      this.dropToken(token);
      token = await this.validToken();
      result = await this.send(endpoint, params, token);
    }
    return this.unwrap(endpoint, result);
  }

  private codeOf(body: unknown): string {
    return body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string"
      ? ((body as { code: string }).code)
      : "";
  }

  private dropToken(token: string) {
    if (this.token === token) {
      this.token = undefined;
      this.tokenExpiresAt = 0;
    }
  }

  private async validToken(): Promise<string> {
    if (!this.token || this.now() >= this.tokenExpiresAt - REFRESH_MARGIN_MS) {
      await this.login();
    }
    return this.token as string;
  }

  private async doLogin(): Promise<LoginInfo> {
    const result = await this.send("user_login", { emailid: this.email, api_key: this.apiKey });
    const body = this.unwrap("user_login", result) as Record<string, unknown>;
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) {
      throw new RecurPostApiError({
        endpoint: "user_login",
        status: result.status,
        body: { error: "Login answered without an access token.", code: "token_missing" },
      });
    }
    let lifetimeMs = DEFAULT_TOKEN_LIFETIME_S * 1000;
    if (typeof body.expires_in === "number" && body.expires_in > 0) {
      lifetimeMs = body.expires_in * 1000;
    } else if (typeof body.expires_at === "string" && !Number.isNaN(Date.parse(body.expires_at))) {
      lifetimeMs = Math.max(0, Date.parse(body.expires_at) - this.now());
    }
    this.token = token;
    this.tokenExpiresAt = this.now() + lifetimeMs;
    const safe: Record<string, unknown> = { ...body };
    delete safe.token;
    return safe as LoginInfo;
  }

  private async send(
    endpoint: string,
    params: Record<string, unknown>,
    token?: string
  ): Promise<{ status: number; body: Record<string, unknown> | string; headers?: Headers }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      [CLIENT_HEADER]: CLIENT_NAME,
      "User-Agent": `recurpost-mcp/${VERSION}`,
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const doFetch = this.fetchImpl ?? globalThis.fetch;
    let response: Response;
    try {
      response = await doFetch(`${this.baseUrl}/api/${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      });
    } catch (e) {
      throw new RecurPostNetworkError(this.baseUrl, e);
    }

    const rateLimit = readRateLimit(response.headers);
    if (rateLimit) this.lastRateLimit = rateLimit;

    const text = await response.text();
    let body: Record<string, unknown> | string = text;
    if (text.trim() !== "") {
      try {
        const parsed = JSON.parse(text);
        body = parsed && typeof parsed === "object" ? parsed : text;
      } catch {
        body = text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
      }
    }
    return { status: response.status, body, headers: response.headers };
  }

  private unwrap(
    endpoint: string,
    result: { status: number; body: Record<string, unknown> | string; headers?: Headers }
  ): unknown {
    const { status, body, headers } = result;
    // An error can also arrive as HTTP 200 with the real status in the body
    // (the legacy convention); treat it the same as a real error status.
    const bodyStatus =
      typeof body === "object" && typeof body.status === "number" ? body.status : undefined;
    const isError =
      status >= 400 ||
      (bodyStatus !== undefined && bodyStatus >= 400 && typeof body === "object" && "error" in body);
    if (!isError) {
      return body;
    }
    const retryAfter = toNumber(headers?.get?.("Retry-After"));
    throw new RecurPostApiError({
      endpoint,
      status: status >= 400 ? status : (bodyStatus as number),
      body,
      retryAfter,
      rateLimit: readRateLimit(headers),
    });
  }
}
