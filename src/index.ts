#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { RecurPostClient } from "./api.js";
import { registerTools, resolveFirstClass } from "./tools.js";
import { VERSION } from "./version.js";

// --- Configuration from environment (credentials are never exposed to tool callers) ---

const EMAIL = process.env.RECURPOST_EMAIL;
const API_KEY = process.env.RECURPOST_API_KEY;
const API_URL = process.env.RECURPOST_API_URL || "https://social.recurpost.com";
const MODULES = process.env.RECURPOST_MODULES;

if (!EMAIL || !API_KEY) {
  console.error("Error: RECURPOST_EMAIL and RECURPOST_API_KEY environment variables are required.");
  process.exit(1);
}

export const client = new RecurPostClient({ baseUrl: API_URL, email: EMAIL, apiKey: API_KEY });

export const server = new McpServer({
  name: "recurpost",
  version: VERSION,
});

registerTools(server, client, resolveFirstClass(MODULES));

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("RecurPost MCP Server running on stdio");
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
