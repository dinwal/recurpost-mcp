import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { generatedTools, modules, firstClassToolNames } from "../src/generated";
import { shapeFor, requestBody, resolveFirstClass, shorten } from "../src/tools";

const root = path.resolve(__dirname, "..");
const config = JSON.parse(readFileSync(path.join(root, "scripts/tools.config.json"), "utf8"));
const docsDir = path.resolve(root, config.docsDir);

describe("generated tool specs", () => {
  it.skipIf(!existsSync(docsDir))("are in sync with the API docs (npm run gen:check)", () => {
    const run = spawnSync(process.execPath, [path.join(root, "scripts/gen-tools.mjs"), "--check"], { encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  it("cover every module with unique, well-formed names", () => {
    const names = generatedTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9_]{1,64}$/);
    }
    expect(modules.length).toBe(27);
    for (const mod of modules) {
      expect(generatedTools.some((t) => t.module === mod.key), mod.key).toBe(true);
    }
    expect(generatedTools.length).toBeGreaterThan(250);
  });

  it("keep the ten legacy tools as whole endpoints under their old names", () => {
    for (const name of [
      "user_login",
      "connect_social_account_urls",
      "social_account_list",
      "library_list",
      "workspace_list",
      "history_data",
      "add_content_in_library",
      "post_content",
      "generate_content_with_ai",
      "generate_image_with_ai",
    ]) {
      const tool = generatedTools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.endpoint).toBe(name);
      expect(tool!.action).toBeUndefined();
    }
  });

  it("never expose credential or legacy alias parameters", () => {
    for (const tool of generatedTools) {
      for (const p of tool.params) {
        expect(config.hiddenParams, `${tool.name}.${p.key}`).not.toContain(p.key);
        expect(p.key, tool.name).not.toBe("action");
        expect(p.key, tool.name).not.toBe("confirm");
      }
    }
  });

  it("send confirm only where the docs require it", () => {
    const byName = new Map(generatedTools.map((t) => [t.name, t]));
    expect(byName.get("workspace_delete")!.confirm).toBe(true);
    expect(byName.get("custom_fields_delete")!.confirm).toBe(true);
    expect(byName.get("custom_fields_list")!.confirm).toBeUndefined();
    expect(byName.get("workspace_list")!.confirm).toBeUndefined();
    expect(requestBody(byName.get("workspace_delete")!, { workspace_id: "w" })).toEqual({ workspace_id: "w", confirm: true });
    expect(requestBody(byName.get("custom_fields_list")!, {})).toEqual({ action: "list" });
  });

  it("flag destructive and read-only tools", () => {
    const byName = new Map(generatedTools.map((t) => [t.name, t]));
    expect(byName.get("workspace_delete")!.destructive).toBe(true);
    expect(byName.get("social_account_remove")!.destructive).toBe(true);
    expect(byName.get("library_list")!.readOnly).toBe(true);
    expect(byName.get("library_list")!.destructive).toBe(false);
    expect(byName.get("queue_post_add_accounts")!.readOnly).toBe(false);
    expect(byName.get("social_account_status")!.readOnly).toBe(false);
    expect(byName.get("custom_fields_list")!.readOnly).toBe(true);
  });

  it("build a valid zod schema for every tool that accepts its documented examples", () => {
    for (const tool of generatedTools) {
      const schema = z.object(shapeFor(tool, true));
      const sample: Record<string, unknown> = {};
      for (const p of tool.params) {
        if (p.example === undefined) {
          continue;
        }
        if (p.values) {
          sample[p.key] = p.values[0];
        } else if (p.type === "integer") {
          sample[p.key] = Number(p.example);
        } else if (p.type === "boolean") {
          sample[p.key] = String(p.example) === "true";
        } else if (p.type === "array" || p.type === "object") {
          sample[p.key] = p.example;
        } else {
          sample[p.key] = Array.isArray(p.example) ? p.example.map(String) : String(p.example);
        }
      }
      const result = schema.safeParse(sample);
      expect(result.success, `${tool.name}: ${result.success ? "" : JSON.stringify(result.error.issues)}`).toBe(true);
    }
  });

  it("list every first-class tool in mcpb/tools.json with its summary", () => {
    const listed = JSON.parse(readFileSync(path.join(root, "mcpb/tools.json"), "utf8")) as Array<{ name: string; description: string }>;
    expect(listed.map((t) => t.name)).toEqual(firstClassToolNames);
    expect(firstClassToolNames).toEqual(config.firstClass);
    for (const entry of listed) {
      expect(entry.description.length, entry.name).toBeGreaterThan(10);
    }
  });
});

describe("first-class set", () => {
  it("is the configured list by default", () => {
    expect([...resolveFirstClass(undefined)].sort()).toEqual([...config.firstClass].sort());
    expect([...resolveFirstClass("")].sort()).toEqual([...config.firstClass].sort());
  });

  it("adds whole modules named in RECURPOST_MODULES and reports unknown ones", () => {
    const warnings: string[] = [];
    const names = resolveFirstClass("inbox, Workspaces,bogus", (line) => warnings.push(line));
    for (const tool of generatedTools.filter((t) => t.module === "inbox" || t.module === "workspaces")) {
      expect(names.has(tool.name), tool.name).toBe(true);
    }
    expect(names.has("feed_create")).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"bogus"');
  });

  it("promotes everything with RECURPOST_MODULES=all", () => {
    expect(resolveFirstClass("all").size).toBe(generatedTools.length);
  });
});

describe("shorten", () => {
  it("cuts at a sentence boundary when one is near enough, otherwise at a word", () => {
    const two = "First sentence is here. Second sentence goes on for a while and keeps going past the limit set.";
    expect(shorten(two, 60)).toBe("First sentence is here.");
    expect(shorten("short", 60)).toBe("short");
    const words = "word ".repeat(30).trim();
    const cut = shorten(words, 40);
    expect(cut.endsWith("...")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(43);
  });
});
