// Validates every recipe in recipes/ and writes dist/recipes.json for the app.
// Usage: node scripts/build-recipes.mjs [--check]   (--check validates only)
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const recipesDir = join(root, "recipes");
const checkOnly = process.argv.includes("--check");

export const UNITS = [
  "g", "kg", "ml", "l", "tsp", "tbsp", "cup", "oz", "lb", "fl_oz",
  "whole", "clove", "stalk", "bunch", "sprig", "can", "jar", "package", "slice", "pinch",
];

const sections = JSON.parse(readFileSync(join(root, "sections.json"), "utf8"));
const sectionIds = new Set(sections.sections.map((s) => s.id));
const errors = [];

for (const [item, sec] of Object.entries(sections.items)) {
  if (!sectionIds.has(sec)) errors.push(`sections.json: "${item}" maps to unknown section "${sec}"`);
  if (item !== item.toLowerCase()) errors.push(`sections.json: "${item}" should be lowercase`);
}

// Placeholder pictures made by scripts/generate-photos.mjs; a real `photo:` always wins.
const generated = (slug) => (existsSync(join(recipesDir, "photos/generated", `${slug}.jpg`)) ? `recipes/photos/generated/${slug}.jpg` : null);

const files = readdirSync(recipesDir).filter((f) => f.endsWith(".md")).sort();
const slugs = new Set(files.map((f) => basename(f, ".md")));
const recipes = [];

for (const file of files) {
  const slug = basename(file, ".md");
  const where = `recipes/${file}`;
  const raw = readFileSync(join(recipesDir, file), "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) { errors.push(`${where}: missing front matter`); continue; }

  let meta;
  try { meta = yaml.load(m[1]); } catch (e) { errors.push(`${where}: bad YAML: ${e.message}`); continue; }

  if (!/^[a-z0-9-]+$/.test(slug)) errors.push(`${where}: file name should be lowercase-with-dashes`);
  if (!meta.title) errors.push(`${where}: title is required`);
  if (!Number.isInteger(meta.servings) || meta.servings < 1) errors.push(`${where}: servings must be a positive whole number`);
  if (meta.time_minutes != null && !Number.isInteger(meta.time_minutes)) errors.push(`${where}: time_minutes must be a whole number`);
  if (meta.tags && !Array.isArray(meta.tags)) errors.push(`${where}: tags must be a list`);
  if (meta.photo && !existsSync(join(recipesDir, meta.photo))) errors.push(`${where}: photo "${meta.photo}" not found`);
  for (const r of meta.related ?? []) if (!slugs.has(r)) errors.push(`${where}: related recipe "${r}" not found`);
  if (!Array.isArray(meta.ingredients) || meta.ingredients.length === 0) {
    errors.push(`${where}: ingredients list is required`);
    continue;
  }

  const ingredients = meta.ingredients.map((ing, i) => {
    const at = `${where}: ingredient ${i + 1}`;
    if (!ing || typeof ing.item !== "string") { errors.push(`${at}: item is required`); return null; }
    const item = ing.item.trim().toLowerCase();
    if (ing.qty != null && typeof ing.qty !== "number") errors.push(`${at} (${item}): qty must be a number`);
    if (ing.unit != null && !UNITS.includes(ing.unit)) errors.push(`${at} (${item}): unknown unit "${ing.unit}" (allowed: ${UNITS.join(", ")})`);
    const section = ing.section ?? sections.items[item];
    if (!section) errors.push(`${at}: "${item}" has no store section; add it to sections.json`);
    else if (!sectionIds.has(section)) errors.push(`${at} (${item}): unknown section "${section}"`);
    return {
      item,
      qty: ing.qty ?? null,
      unit: ing.unit ?? null,
      note: ing.note ?? null,
      optional: ing.optional === true,
      section: section ?? "other",
      staple: sections.staples.includes(item),
    };
  }).filter(Boolean);

  recipes.push({
    slug,
    title: meta.title,
    summary: meta.summary ?? "",
    servings: meta.servings,
    time_minutes: meta.time_minutes ?? null,
    tags: meta.tags ?? [],
    photo: meta.photo ? `recipes/${meta.photo}` : generated(slug),
    photo_generated: !meta.photo && generated(slug) !== null,
    related: meta.related ?? [],
    ingredients,
    body: m[2].trim(),
  });
}

if (errors.length) {
  console.error(`${errors.length} problem(s):\n- ` + errors.join("\n- "));
  process.exit(1);
}

if (!checkOnly) {
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", "recipes.json"), JSON.stringify({ sections, recipes }, null, 2));
}
console.log(`OK: ${recipes.length} recipe(s)${checkOnly ? " validated" : " written to dist/recipes.json"}`);
