#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { RecurPostClient, DEFAULT_API_URL } from "./client.js";
import { createServer } from "./server.js";

// --- Credentials from environment (never exposed to tool callers) ---

const EMAIL = process.env.RECURPOST_EMAIL;
const API_KEY = process.env.RECURPOST_API_KEY;
// Optional: another RecurPost host, for example a staging server.
const API_URL = process.env.RECURPOST_API_URL || DEFAULT_API_URL;

if (!EMAIL || !API_KEY) {
  console.error(
    "Error: RECURPOST_EMAIL and RECURPOST_API_KEY environment variables are required."
  );
  process.exit(1);
}

export const client = new RecurPostClient({ email: EMAIL, apiKey: API_KEY, baseUrl: API_URL });
export const server = createServer(client);

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`RecurPost MCP Server running on stdio (${client.baseUrl})`);
}

// Only take over stdio when executed as a CLI, not when imported (e.g. by tests).
// process.argv[1] is the path as invoked, which for `npx recurpost-mcp` is the
// node_modules/.bin symlink, while import.meta.url is always the realpath of this
// module. Resolve argv[1] through realpath so the two are comparable.
function isRunningAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isRunningAsCli()) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
