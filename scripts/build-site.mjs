// Builds the deployable site into dist/: recipes.json + app/ + photos + vendored supabase-js.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const require = createRequire(import.meta.url);

const recipes = spawnSync(process.execPath, [join(root, "scripts/build-recipes.mjs")], { stdio: "inherit" });
if (recipes.status !== 0) process.exit(recipes.status ?? 1);

cpSync(join(root, "app"), dist, { recursive: true });

const photos = join(root, "recipes/photos");
if (existsSync(photos)) cpSync(photos, join(dist, "recipes/photos"), { recursive: true });

mkdirSync(join(dist, "vendor"), { recursive: true });
const supabaseUmd = join(dirname(require.resolve("@supabase/supabase-js/package.json")), "dist/umd/supabase.js");
cpSync(supabaseUmd, join(dist, "vendor/supabase.js"));

const build = (process.env.GITHUB_SHA ?? String(Date.now())).slice(0, 12);
const swPath = join(dist, "sw.js");
writeFileSync(swPath, readFileSync(swPath, "utf8").replace("__BUILD__", build));

console.log(`Site built in dist/ (build ${build})`);
