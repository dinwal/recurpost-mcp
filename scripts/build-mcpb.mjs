// Builds the Claude Desktop extension (.mcpb).
//
// The server is bundled into ONE file with esbuild rather than shipping
// node_modules: Claude Desktop runs the extension with its own Node runtime,
// and a single file avoids the path-resolution failures seen on Windows MSIX
// installs, where the extension directory is virtualised under
// %LOCALAPPDATA%\Packages\...\LocalCache\Roaming\Claude\Claude Extensions.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(root, "dist-mcpb");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

execFileSync("node", [join(root, "scripts/gen-version.mjs")], { stdio: "inherit" });

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "server"), { recursive: true });

await build({
  entryPoints: [join(root, "src/index.ts")],
  outfile: join(stage, "server/index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
});

// .js inside the extension is read as CommonJS unless the nearest package.json
// says otherwise, and the bundle is ESM (it relies on import.meta.url).
writeFileSync(
  join(stage, "server/package.json"),
  JSON.stringify({ type: "module" }, null, 2) + "\n"
);

const manifest = JSON.parse(readFileSync(join(root, "mcpb/manifest.json"), "utf8"));
manifest.version = pkg.version;
// The advertised tool list is the generated first-class set, never typed by hand
manifest.tools = JSON.parse(readFileSync(join(root, "mcpb/tools.json"), "utf8"));
writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

copyFileSync(join(root, "mcpb/icon.png"), join(stage, "icon.png"));
copyFileSync(join(root, "README.md"), join(stage, "README.md"));

const out = join(root, `recurpost-${pkg.version}.mcpb`);
rmSync(out, { force: true });
// Windows only has npx.cmd, which Node refuses to spawn without a shell
const windows = process.platform === "win32";
execFileSync(windows ? "npx.cmd" : "npx", ["-y", "@anthropic-ai/mcpb@2", "pack", stage, out], {
  stdio: "inherit",
  shell: windows,
});
console.log(`\nBuilt ${out}`);
