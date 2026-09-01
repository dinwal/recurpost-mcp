import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Regression test for v1.1.0: `npx recurpost-mcp` launches the server through the
// node_modules/.bin symlink, so process.argv[1] is the symlink while import.meta.url
// is the realpath. A guard comparing them directly never runs main(), the process
// exits without connecting stdio, and the client reports "Server disconnected".

const entry = path.resolve(__dirname, "../build/index.js");
let binDir: string;
let binLink: string;

beforeAll(() => {
  binDir = mkdtempSync(path.join(tmpdir(), "recurpost-mcp-bin-"));
  mkdirSync(path.join(binDir, ".bin"));
  binLink = path.join(binDir, ".bin", "recurpost-mcp");
  symlinkSync(entry, binLink);
});

afterAll(() => rmSync(binDir, { recursive: true, force: true }));

// Sends an initialize request to `command` over stdio and resolves the JSON-RPC reply.
function initializeOverStdio(command: string): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        RECURPOST_EMAIL: "test@example.com",
        RECURPOST_API_KEY: "test-api-key",
      },
    });

    let stdout = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no initialize response; server exited without serving stdio. stdout=${JSON.stringify(stdout)}`));
    }, 10_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      for (const line of stdout.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        clearTimeout(timer);
        child.kill();
        resolve(JSON.parse(line));
        return;
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      }) + "\n"
    );
  });
}

describe("CLI startup", () => {
  it("serves stdio when run directly with node", async () => {
    const reply = await initializeOverStdio(entry);
    expect(reply.result.serverInfo.name).toBe("recurpost");
  }, 15_000);

  it("serves stdio when launched through a bin symlink (npx)", async () => {
    const reply = await initializeOverStdio(binLink);
    expect(reply.result.serverInfo.name).toBe("recurpost");
  }, 15_000);
});
