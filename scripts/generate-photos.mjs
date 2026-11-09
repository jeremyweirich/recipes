// Creates a placeholder photo for every recipe that has no `photo:` and no generated image yet.
// Images come from Pollinations.ai (free, no key) and are saved to recipes/photos/generated/<slug>.jpg,
// so each one is generated once. A recipe's optional `photo_prompt:` describes the finished dish;
// changing it makes a new picture (prompts are tracked in photos/generated/prompts.json).
// Delete a file to get a new picture; set `photo:` to use a real one.
// Never fails the build: if the service is down, recipes simply keep showing without a picture.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const recipesDir = join(root, "recipes");
const outDir = join(recipesDir, "photos/generated");
const BASE = process.env.IMAGE_BASE ?? "https://image.pollinations.ai/prompt/";
const DELAY_MS = Number(process.env.DELAY_MS ?? 30000); // anonymous tier turns away bursts (HTTP 402/429)
const sections = JSON.parse(readFileSync(join(root, "sections.json"), "utf8"));
const staples = new Set(sections.staples);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seedFor = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 1_000_000;

const STYLE = "served on a wooden kitchen table, overhead three-quarter angle, soft natural window light, realistic food photography, shallow depth of field, no text, no people";

function promptFor(meta) {
  if (meta.photo_prompt) return `${String(meta.photo_prompt).trim().replace(/[.\s]+$/, "")}. ${STYLE}`;
  const keyIngredients = (meta.ingredients ?? [])
    .filter((i) => !i.optional && !staples.has(String(i.item).toLowerCase()))
    .slice(0, 6)
    .map((i) => i.item)
    .join(", ");
  return [
    `Appetizing home-cooked ${meta.title}`,
    meta.summary?.replace(/[.\s]+$/, ""),
    keyIngredients && `made with ${keyIngredients}`,
    `in a simple ceramic dish ${STYLE}`,
  ].filter(Boolean).join(". ");
}

const manifestPath = join(outDir, "prompts.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};

const todo = [];
for (const file of readdirSync(recipesDir).filter((f) => f.endsWith(".md")).sort()) {
  const slug = basename(file, ".md");
  const m = readFileSync(join(recipesDir, file), "utf8").match(/^---\n([\s\S]*?)\n---/);
  if (!m) continue;
  const meta = yaml.load(m[1]);
  if (meta.photo) continue;
  const prompt = promptFor(meta);
  const exists = existsSync(join(outDir, `${slug}.jpg`));
  // Make a picture if there's none, or if the recipe's photo_prompt is new or changed.
  const promptChanged = meta.photo_prompt && manifest[slug] !== prompt;
  if (exists && !promptChanged) continue;
  todo.push({ slug, prompt });
}

if (!todo.length) {
  console.log("Every recipe has a photo.");
  process.exit(0);
}
mkdirSync(outDir, { recursive: true });

let made = 0;
for (const [n, { slug, prompt }] of todo.entries()) {
  if (n > 0) await sleep(DELAY_MS);
  const url = `${BASE}${encodeURIComponent(prompt)}?width=1200&height=800&seed=${seedFor(slug)}&model=flux&nologo=true`;
  let saved = false;
  for (let attempt = 1; attempt <= 4 && !saved; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      const type = res.headers.get("content-type") ?? "";
      if (res.status === 429 || res.status === 402) { console.warn(`${slug}: busy (HTTP ${res.status}), waiting`); await sleep(DELAY_MS); continue; }
      if (!res.ok || !type.startsWith("image/")) throw new Error(`HTTP ${res.status} ${type}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 10_000) throw new Error(`image too small (${buf.length} bytes)`);
      writeFileSync(join(outDir, `${slug}.jpg`), buf);
      manifest[slug] = prompt;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      console.log(`${slug}: saved (${Math.round(buf.length / 1024)} KB)`);
      saved = true;
      made++;
    } catch (e) {
      console.warn(`${slug}: attempt ${attempt} failed: ${e.message}`);
      if (attempt < 4) await sleep(DELAY_MS);
    }
  }
}
console.log(`Generated ${made} of ${todo.length} photo(s).`);
