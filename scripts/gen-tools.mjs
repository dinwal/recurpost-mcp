// Generates src/generated/*.ts from the RecurPost API docs (recurpost-apis/data/endpoints/*.json):
// one MCP tool per endpoint, or one per `action` value on endpoints that bundle several, with the
// parameters each one takes. Also writes mcpb/tools.json, the first-class tool list the Claude
// Desktop extension manifest advertises.
//
//   node scripts/gen-tools.mjs [path/to/recurpost-apis/data/endpoints] [--check]
//
// --check regenerates to memory and fails when the committed output differs.
// scripts/tools.config.json holds everything the docs cannot say: which tools are first-class,
// nicer names for split actions, and the read-only / destructive hints.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "scripts/tools.config.json"), "utf8"));
const args = process.argv.slice(2);
const check = args.includes("--check");
const docsDir = resolve(root, args.find((a) => !a.startsWith("--")) ?? config.docsDir);
const outDir = join(root, "src/generated");
const toolsJson = join(root, "mcpb/tools.json");

const ACRONYMS = { id: "ID", ids: "IDs", url: "URL", urls: "URLs", ai: "AI", pdf: "PDF", rss: "RSS", dm: "DM", gbp: "GBP", utc: "UTC", api: "API", x: "X" };

// ---------- string helpers ----------

const stripHtml = (s) => String(s ?? "").replace(/<\/(?:p|li|div|h[1-6]|tr)>|<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const words = (s) => s.split(/[_\s]+/).filter(Boolean);
const titleWord = (w) => ACRONYMS[w.toLowerCase()] ?? w.charAt(0).toUpperCase() + w.slice(1);
const title = (s) => words(s).map(titleWord).join(" ");
const camel = (s) => s.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase());

// ---------- per-action applicability from the param description (same rules as the n8n node) ----------

function actionList(text, actions) {
  const found = text
    .replace(/action\s*=\s*/g, "")
    .split(/,|\band\b|\bor\b|\//)
    .map((a) => a.trim().toLowerCase())
    .filter((a) => actions.includes(a));
  return found.length ? [...new Set(found)] : null;
}

function applicability(desc, actions) {
  const text = stripHtml(desc);
  const result = { onlyFor: null, requiredFor: null };
  let m;
  if ((m = text.match(/(?:Required|Must be true(?: \(or 1\))?) (?:for|when action is|when action=|when action|on|with)\s*([^.;:]+)/i))) {
    result.requiredFor = actionList(m[1], actions);
  }
  if ((m = text.match(/Required for every action (?:but|except) ([^.;:]+)/i))) {
    const exclude = actionList(m[1], actions) ?? [];
    result.requiredFor = actions.filter((a) => !exclude.includes(a));
  }
  if ((m = text.match(/^(?:With|For|On) ([^.:]+?):/i))) {
    result.onlyFor = actionList(m[1], actions);
  } else if ((m = text.match(/\b([a-z_]+(?:, [a-z_]+)*(?:,? (?:and|or) [a-z_]+)?) only\b/i))) {
    result.onlyFor = actionList(m[1], actions);
  } else if ((m = text.match(/(?:Read|Used|Sent) (?:only )?(?:when|with) action(?: is)? ([a-z_]+)/i))) {
    result.onlyFor = actionList(m[1], actions);
  }
  if (result.requiredFor && !result.onlyFor) {
    result.onlyFor = null;
  }
  return result;
}

// ---------- params ----------

const LIST_HINT = /comma-separated|json array|one id, |several .* take a json array|an array/i;

function paramSpec(param, required) {
  const description = stripHtml(param.description);
  const spec = { key: param.name, type: param.type, required: Boolean(required), description };
  if (param.type === "boolean") {
    // Booleans need no value list
  } else if (Array.isArray(param.values) && param.values.length) {
    const values = param.values.map((v) => String(v)).filter((v) => v !== "");
    if (values.length) {
      spec.values = values;
    }
  }
  if (param.default !== undefined && param.default !== null && param.default !== "") {
    spec.default = String(param.default);
  }
  if (param.example !== undefined && param.example !== null && param.example !== "") {
    spec.example = param.example;
  }
  if (param.type === "array") {
    const ex = param.example;
    spec.items = Array.isArray(ex) && ex.some((v) => v && typeof v === "object") ? "object" : "string";
    spec.acceptsList = spec.items === "string";
  } else if (param.type === "string" && (Array.isArray(param.example) || LIST_HINT.test(description))) {
    spec.acceptsList = true;
  }
  return spec;
}

// ---------- tools ----------

function toolName(endpoint, action) {
  if (!action) {
    return endpoint.id;
  }
  const override = config.toolNames[`${endpoint.id}:${action}`];
  if (override) {
    return override;
  }
  if (endpoint.id.endsWith(`_${action}`)) {
    return endpoint.id;
  }
  return `${endpoint.id}_${action}`;
}

function isReadOnly(name, endpointId, action) {
  if (action) {
    return config.readOnlyActions.includes(action);
  }
  if (config.notReadOnlyTools.includes(endpointId)) {
    return false;
  }
  return config.readOnlyTools.includes(endpointId) || config.readOnlyPatterns.some((p) => new RegExp(p).test(endpointId));
}

function isDestructive(name, endpointId, action, confirm) {
  if (confirm) {
    return true;
  }
  if (action) {
    return config.destructiveActions.includes(action);
  }
  return config.destructivePatterns.some((p) => new RegExp(p).test(endpointId));
}

function buildTool(mod, endpoint, action, actions) {
  const name = toolName(endpoint, action);
  const summary = stripHtml(endpoint.summary);
  const notes = (endpoint.notes ?? []).map((n) => stripHtml(`${n.title ? n.title + ": " : ""}${n.text}`)).filter(Boolean);
  const description = [stripHtml(endpoint.description), ...notes].filter(Boolean).join(" ");

  const confirmParam = endpoint.params.find((p) => p.name === "confirm");
  let confirm = false;
  if (confirmParam) {
    const hint = applicability(confirmParam.description, actions);
    confirm = !action || !hint.requiredFor || hint.requiredFor.includes(action);
  }

  const params = [];
  for (const param of endpoint.params) {
    if (["action", "confirm"].includes(param.name) || config.hiddenParams.includes(param.name)) {
      continue;
    }
    const hint = action ? applicability(param.description, actions) : { onlyFor: null, requiredFor: null };
    if (action && hint.onlyFor && !hint.onlyFor.includes(action)) {
      continue;
    }
    let required = param.required;
    if (action && hint.requiredFor) {
      required = hint.requiredFor.includes(action);
    }
    params.push(paramSpec(param, required));
  }
  // Required params first, workspace_id last: that is the order a reader expects
  params.sort((a, b) => Number(b.required) - Number(a.required) || Number(a.key === "workspace_id") - Number(b.key === "workspace_id"));

  const spec = {
    name,
    title: action ? `${stripHtml(endpoint.title)} (${title(action)})` : stripHtml(endpoint.title),
    module: mod.module,
    endpoint: endpoint.id,
    action,
    confirm: confirm || undefined,
    summary: action ? `${summary} This tool runs the ${action} action.` : summary,
    description,
    readOnly: isReadOnly(name, endpoint.id, action),
    destructive: isDestructive(name, endpoint.id, action, confirm),
    params,
  };
  return spec;
}

// ---------- main ----------

const moduleFiles = readdirSync(docsDir).filter((f) => f.endsWith(".json")).sort();
const modules = [];
const toolsByModule = new Map();

for (const file of moduleFiles) {
  const mod = JSON.parse(readFileSync(join(docsDir, file), "utf8"));
  modules.push({ key: mod.module, title: stripHtml(mod.title), description: stripHtml(mod.description) });
  const tools = [];
  for (const endpoint of mod.endpoints) {
    const actionParam = endpoint.params.find((p) => p.name === "action" && p.values?.length);
    const actions = actionParam ? actionParam.values.map((v) => String(v)) : [];
    if (actions.length) {
      tools.push(...actions.map((a) => buildTool(mod, endpoint, a, actions)));
    } else {
      tools.push(buildTool(mod, endpoint, undefined, []));
    }
  }
  toolsByModule.set(mod.module, tools);
}

const allTools = [...toolsByModule.values()].flat();
const names = allTools.map((t) => t.name);
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
if (dupes.length) {
  throw new Error(`Duplicate tool names: ${[...new Set(dupes)].join(", ")}`);
}
for (const name of names) {
  if (!/^[a-z0-9_]{1,64}$/.test(name)) {
    throw new Error(`Tool name not allowed: ${name}`);
  }
}
for (const name of config.firstClass) {
  if (!names.includes(name)) {
    throw new Error(`firstClass names a tool that does not exist: ${name}`);
  }
}

function literal(value, indent = "") {
  const inner = indent + "  ";
  if (Array.isArray(value)) {
    if (!value.length) {
      return "[]";
    }
    return "[\n" + value.map((v) => inner + literal(v, inner)).join(",\n") + "\n" + indent + "]";
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined);
    if (!keys.length) {
      return "{}";
    }
    return "{\n" + keys.map((k) => `${inner}${/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) ? k : literal(k)}: ${literal(value[k], inner)}`).join(",\n") + "\n" + indent + "}";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
}

const header = "// Generated by scripts/gen-tools.mjs from the RecurPost API docs. Do not edit by hand.\n";
const files = new Map();
for (const [key, tools] of toolsByModule) {
  files.set(
    `${key}.ts`,
    header + `import type { ToolSpec } from "../types.js";\n\nexport const ${camel(key)}Tools: ToolSpec[] = ${literal(tools)};\n`,
  );
}
const moduleKeys = [...toolsByModule.keys()];
files.set(
  "index.ts",
  header +
    moduleKeys.map((k) => `import { ${camel(k)}Tools } from "./${k}.js";`).join("\n") +
    `\nimport type { ModuleSpec, ToolSpec } from "../types.js";\n\n` +
    `export const modules: ModuleSpec[] = ${literal(modules)};\n\n` +
    `export const generatedTools: ToolSpec[] = [\n${moduleKeys.map((k) => `  ...${camel(k)}Tools,`).join("\n")}\n];\n\n` +
    `export const firstClassToolNames: string[] = ${literal(config.firstClass)};\n`,
);

const firstClassJson =
  JSON.stringify(
    config.firstClass.map((name) => {
      const tool = allTools.find((t) => t.name === name);
      return { name, description: tool.summary };
    }),
    null,
    2,
  ) + "\n";

if (check) {
  let dirty = false;
  for (const [name, content] of files) {
    const path = join(outDir, name);
    if (!existsSync(path) || readFileSync(path, "utf8") !== content) {
      console.error(`out of date: src/generated/${name}`);
      dirty = true;
    }
  }
  if (!existsSync(toolsJson) || readFileSync(toolsJson, "utf8") !== firstClassJson) {
    console.error("out of date: mcpb/tools.json");
    dirty = true;
  }
  process.exit(dirty ? 1 : 0);
}

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true });
}
mkdirSync(outDir, { recursive: true });
for (const [name, content] of files) {
  writeFileSync(join(outDir, name), content);
}
writeFileSync(toolsJson, firstClassJson);

console.log(`generated ${allTools.length} tools across ${moduleKeys.length} modules (${config.firstClass.length} first-class)`);
for (const tool of allTools) {
  const flags = `${tool.readOnly ? "R" : " "}${tool.destructive ? "D" : " "}${tool.confirm ? "C" : " "}${config.firstClass.includes(tool.name) ? "*" : " "}`;
  console.log(`${tool.module.padEnd(18)} ${tool.name.padEnd(36)} ${flags} ${tool.endpoint}${tool.action ? ":" + tool.action : ""}  req=${tool.params.filter((p) => p.required).map((p) => p.key).join(",")}`);
}
