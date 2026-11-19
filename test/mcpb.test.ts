import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { VERSION } from "../src/version";
import { REGISTERED_TOOL_NAMES } from "../src/server";
import { DEFAULT_API_URL } from "../src/client";

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(
  readFileSync(path.join(root, "mcpb/manifest.json"), "utf8")
);
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const source = readFileSync(path.join(root, "src/index.ts"), "utf8");

describe("reported version", () => {
  // The handshake version was hardcoded and drifted to 1.1.0 while the package
  // was on 1.1.3; src/version.ts is generated from package.json to stop that.
  it("matches package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });
});

describe("mcpb manifest", () => {
  it("points at the bundled server entry point", () => {
    expect(manifest.server.type).toBe("node");
    expect(manifest.server.entry_point).toBe("server/index.js");
    expect(manifest.server.mcp_config.args).toEqual([
      "${__dirname}/server/index.js",
    ]);
  });

  it("supplies every credential the server reads from the environment", () => {
    const read = [...source.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]);
    const supplied = manifest.server.mcp_config.env;
    for (const name of read) {
      expect(supplied[name], `${name} missing from manifest env`).toBeDefined();
    }
  });

  it("fills them from user_config fields that exist", () => {
    for (const value of Object.values<string>(manifest.server.mcp_config.env)) {
      const key = /^\$\{user_config\.([a-z_]+)\}$/.exec(value)?.[1];
      expect(key, `${value} is not a user_config reference`).toBeDefined();
      expect(manifest.user_config[key!]).toBeDefined();
    }
  });

  it("requires the email and API key", () => {
    expect(manifest.server.mcp_config.env.RECURPOST_EMAIL).toBe("${user_config.email}");
    expect(manifest.server.mcp_config.env.RECURPOST_API_KEY).toBe("${user_config.api_key}");
    expect(manifest.user_config.email.required).toBe(true);
    expect(manifest.user_config.api_key.required).toBe(true);
  });

  it("offers the API URL as an optional field defaulting to the live host", () => {
    expect(manifest.server.mcp_config.env.RECURPOST_API_URL).toBe("${user_config.api_url}");
    expect(manifest.user_config.api_url.required).toBe(false);
    expect(manifest.user_config.api_url.default).toBe(DEFAULT_API_URL);
  });

  it("lists exactly the tools the server registers", () => {
    const listed = manifest.tools.map((t: { name: string }) => t.name);
    expect([...listed].sort()).toEqual([...REGISTERED_TOOL_NAMES].sort());
  });

  it("marks the API key as sensitive so it is stored in the OS keychain", () => {
    expect(manifest.user_config.api_key.sensitive).toBe(true);
    expect(manifest.user_config.email.sensitive).toBeUndefined();
  });
});
