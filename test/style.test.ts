import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// House style: plain hyphens only, no en or em dashes in shipped text.
const root = path.resolve(__dirname, "..");
const files = [
  "README.md",
  "mcpb/manifest.json",
  ...readdirSync(path.join(root, "src")).map((f) => `src/${f}`),
  ...readdirSync(path.join(root, "scripts")).map((f) => `scripts/${f}`),
];

describe("style", () => {
  it("uses no en or em dashes", () => {
    for (const file of files) {
      const text = readFileSync(path.join(root, file), "utf8");
      expect(/[\u2013\u2014]/.test(text), file).toBe(false);
    }
  });
});
