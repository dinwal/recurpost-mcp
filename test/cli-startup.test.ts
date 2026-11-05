import { describe, it, expect, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Regression test for v1.1.0: `npx recurpost-mcp` launches the server through the
// node_modules/.bin symlink, so process.argv[1] is the symlink while import.meta.url
// is the realpath. A guard comparing them directly never runs main(), the process
// exits without connecting stdio, and the client reports "Server disconnected".
//
// `npm test` compiles build/index.js first (pretest). Windows cannot run a .js file as a
// program, so the entry goes through node explicitly there; creating a symlink needs
// Developer Mode or admin rights on Windows, so that case is skipped when it fails.

const entry = path.resolve(__dirname, "../build/index.js");
const binDir = mkdtempSync(path.join(tmpdir(), "recurpost-mcp-bin-"));
const binLink = path.join(binDir, ".bin", "recurpost-mcp");
let symlinkAvailable = true;
try {
  mkdirSync(path.join(binDir, ".bin"));
  symlinkSync(entry, binLink, "file");
} catch {
  symlinkAvailable = false;
}

afterAll(() => rmSync(binDir, { recursive: true, force: true }));

// Sends an initialize request to `command` over stdio and resolves the JSON-RPC reply.
function initializeOverStdio(command: string): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const viaNode = process.platform === "win32";
    const child = spawn(viaNode ? process.execPath : command, viaNode ? [command] : [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        RECURPOST_EMAIL: "test@example.com",
        RECURPOST_API_KEY: "test-api-key",
      },
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no initialize response; server exited without serving stdio. stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`));
    }, 10_000);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
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
      }) + "\n",
    );
  });
}

describe("CLI startup", () => {
  it("has a compiled entry point to test (run npm run build first)", () => {
    expect(existsSync(entry)).toBe(true);
  });

  it("serves stdio when run directly", async () => {
    const reply = await initializeOverStdio(entry);
    expect(reply.result.serverInfo.name).toBe("recurpost");
  }, 15_000);

  it.skipIf(!symlinkAvailable)("serves stdio when launched through a bin symlink (npx)", async () => {
    const reply = await initializeOverStdio(binLink);
    expect(reply.result.serverInfo.name).toBe("recurpost");
  }, 15_000);
});
