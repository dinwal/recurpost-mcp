import { describe, it, expect } from "vitest";
import {
  CATALOG,
  MODULES,
  getEndpoint,
  missingRequired,
  searchEndpoints,
  suggestIds,
} from "../src/catalog";

describe("bundled catalog", () => {
  it("holds every endpoint once, each in a listed module", () => {
    const ids = CATALOG.endpoints.map((e) => e.id);
    expect(ids.length).toBeGreaterThanOrEqual(300);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of CATALOG.endpoints) {
      expect(MODULES, e.id).toContain(e.module);
      expect(e.summary, e.id).not.toBe("");
    }
  });

  it("keeps descriptions as plain text", () => {
    for (const e of CATALOG.endpoints) {
      for (const p of e.params) {
        expect(p.description, `${e.id}.${p.name}`).not.toMatch(/<\/?(p|code|strong|ul|li)>/);
        expect(p.description, `${e.id}.${p.name}`).not.toMatch(/&(lt|gt|amp);/);
      }
    }
  });

  it("includes the v1 endpoints and the auth endpoint", () => {
    for (const id of [
      "user_login",
      "workspace_list",
      "social_account_list",
      "library_list",
      "connect_social_account_urls",
      "history_data",
      "post_content",
      "add_content_in_library",
      "generate_content_with_ai",
      "generate_image_with_ai",
    ]) {
      expect(getEndpoint(id), id).toBeDefined();
    }
    expect(getEndpoint("no_such_endpoint")).toBeUndefined();
  });

  it("flags endpoints that take confirm as destructive", () => {
    expect(getEndpoint("library_delete")?.destructive).toBe(true);
    expect(getEndpoint("library_list")?.destructive).toBe(false);
  });
});

describe("missingRequired", () => {
  const postContent = getEndpoint("post_content")!;

  it("lists required params that are absent or blank", () => {
    expect(missingRequired(postContent, {}).map((p) => p.name).sort()).toEqual(["id", "message"]);
    expect(missingRequired(postContent, { id: [], message: "  " }).map((p) => p.name).sort()).toEqual([
      "id",
      "message",
    ]);
    expect(missingRequired(postContent, { id: ["a"], message: "Hi" })).toEqual([]);
  });

  it("accepts false and 0 as present values", () => {
    const del = getEndpoint("library_delete")!;
    expect(missingRequired(del, { id: "x", confirm: false })).toEqual([]);
  });

  it("ignores nested param names", () => {
    const nested = CATALOG.endpoints.find((e) =>
      e.params.some((p) => p.required && (p.name.includes(".") || p.name.includes("[")))
    );
    if (!nested) return;
    const topLevel = nested.params.filter(
      (p) => p.required && !p.name.includes(".") && !p.name.includes("[")
    );
    const params = Object.fromEntries(topLevel.map((p) => [p.name, "x"]));
    expect(missingRequired(nested, params)).toEqual([]);
  });
});

describe("searchEndpoints", () => {
  const top = (q: string, module?: string, n = 3) =>
    searchEndpoints(q, module, n).map((r) => r.endpoint.id);

  it("finds endpoints by everyday words", () => {
    expect(top("reply to a comment")).toContain("inbox_reply_comment");
    expect(top("pause library", undefined, 1)).toEqual(["library_pause"]);
    expect(top("invite member")).toContain("workspace_invite");
    expect(top("rss feed items")).toContain("feed_items");
    expect(top("queue list", undefined, 1)).toEqual(["queue_list"]);
  });

  it("puts an exact id first", () => {
    expect(top("report_posts", undefined, 1)).toEqual(["report_posts"]);
  });

  it("limits results to a module", () => {
    const ids = searchEndpoints("delete", "post_labels", 10).map((r) => r.endpoint);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((e) => e.module === "post_labels")).toBe(true);
  });

  it("lists a whole module for an empty query", () => {
    const all = searchEndpoints("", "drafts", 50).map((r) => r.endpoint.id);
    expect(all).toEqual(["draft_list", "draft_save", "draft_schedule", "draft_delete"]);
  });

  it("returns nothing for gibberish", () => {
    expect(searchEndpoints("zzqxv", undefined, 5)).toEqual([]);
  });

  it("suggests close ids for a typo", () => {
    expect(suggestIds("queue_lists")).toContain("queue_list");
  });
});
