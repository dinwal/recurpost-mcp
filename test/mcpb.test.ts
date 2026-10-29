import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { VERSION } from "../src/version";

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(readFileSync(path.join(root, "mcpb/manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const source = readFileSync(path.join(root, "src/index.ts"), "utf8");
const builder = readFileSync(path.join(root, "scripts/build-mcpb.mjs"), "utf8");

describe("reported version", () => {
  // The handshake version was hardcoded and drifted to 1.1.0 while the package
  // was on 1.1.3; src/version.ts is generated from package.json (pretest, build) to stop that.
  it("matches package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });
});

describe("mcpb manifest", () => {
  it("points at the bundled server entry point", () => {
    expect(manifest.server.type).toBe("node");
    expect(manifest.server.entry_point).toBe("server/index.js");
    expect(manifest.server.mcp_config.args).toEqual(["${__dirname}/server/index.js"]);
  });

  it("supplies every variable the server reads from the environment", () => {
    const read = [...source.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]);
    expect(read.length).toBeGreaterThan(0);
    const supplied = manifest.server.mcp_config.env;
    for (const name of read) {
      expect(supplied[name], `${name} missing from manifest env`).toBeDefined();
    }
  });

  it("fills those variables from user_config fields that exist", () => {
    for (const value of Object.values<string>(manifest.server.mcp_config.env)) {
      const key = /^\$\{user_config\.([a-z_]+)\}$/.exec(value)?.[1];
      expect(key, `${value} is not a user_config reference`).toBeDefined();
      expect(manifest.user_config[key!], key).toBeDefined();
    }
  });

  it("requires the credentials and gives the optional settings a default", () => {
    expect(manifest.user_config.email.required).toBe(true);
    expect(manifest.user_config.api_key.required).toBe(true);
    for (const [key, field] of Object.entries<any>(manifest.user_config)) {
      if (key === "email" || key === "api_key") {
        continue;
      }
      expect(field.required, key).toBe(false);
      expect(field.default, key).toBeDefined();
    }
  });

  it("marks the API key as sensitive so it is stored in the OS keychain", () => {
    expect(manifest.user_config.api_key.sensitive).toBe(true);
    expect(manifest.user_config.email.sensitive).toBeUndefined();
  });

  it("takes its tool list from the generated mcpb/tools.json at build time", () => {
    expect(manifest.tools).toBeUndefined();
    expect(builder).toContain("mcpb/tools.json");
  });
});
