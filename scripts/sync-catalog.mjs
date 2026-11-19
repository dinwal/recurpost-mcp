// Builds src/catalog.json, the compact endpoint catalog bundled with the server.
//
// The source of truth is the API docs repo (one JSON file per module under
// data/endpoints/). Run this after a docs change so new or changed endpoints
// reach find_endpoints and call_endpoint:
//
//   node scripts/sync-catalog.mjs [path-to-recurpost-apis]
//
// The docs path defaults to ../recurpost-apis next to this repo.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = resolve(process.argv[2] ?? join(root, "..", "recurpost-apis"));
const endpointsDir = join(docsRoot, "data", "endpoints");
const out = join(root, "src", "catalog.json");

const ENTITIES = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&amp;": "&",
};

// Turns the simple HTML used in the docs (<p>, <code>, <strong>, lists) into
// plain text. Long dashes become plain hyphens to match the house style.
function toPlainText(html) {
  if (html === undefined || html === null) return "";
  let s = String(html);
  s = s.replace(/<li[^>]*>/gi, "\n- ");
  s = s.replace(/<\/(p|ul|ol|li|div|h\d)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/&(lt|gt|quot|#39|apos|nbsp|amp);/g, (m) => ENTITIES[m]);
  s = s.replace(/[\u2013\u2014]/g, "-");
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
  return s;
}

function compactParam(p) {
  const param = {
    name: p.name,
    type: p.type,
    required: p.required === true,
    description: toPlainText(p.description),
  };
  if (Array.isArray(p.values) && p.values.length) param.enum = p.values;
  if (p.default !== undefined && p.default !== null && p.default !== "") param.default = p.default;
  if (p.example !== undefined && p.example !== null && p.example !== "") param.example = p.example;
  return param;
}

const files = readdirSync(endpointsDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

const modules = [];
const endpoints = [];
const seen = new Set();

for (const file of files) {
  const doc = JSON.parse(readFileSync(join(endpointsDir, file), "utf8"));
  modules.push({ module: doc.module, title: toPlainText(doc.title) });
  for (const e of doc.endpoints ?? []) {
    if (seen.has(e.id)) {
      throw new Error(`Duplicate endpoint id ${e.id} in ${file}`);
    }
    seen.add(e.id);
    endpoints.push({
      id: e.id,
      module: doc.module,
      title: toPlainText(e.title),
      summary: toPlainText(e.summary),
      auth: e.auth,
      legacy: e.legacy === true,
      destructive: (e.params ?? []).some((p) => p.name === "confirm"),
      params: (e.params ?? []).map(compactParam),
    });
  }
}

const catalog = { modules, endpoints };
writeFileSync(out, JSON.stringify(catalog) + "\n");
console.log(
  `Wrote ${endpoints.length} endpoints in ${modules.length} modules to ${out} (${Math.round(
    JSON.stringify(catalog).length / 1024
  )} KB)`
);
