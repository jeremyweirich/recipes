// Pure helpers for turning list rows into the grouped, merged grocery list.
import { toUS, measureOf, fromOunces, fromTeaspoons } from "./units.js";

const PLURALS = {
  clove: "cloves", stalk: "stalks", bunch: "bunches", sprig: "sprigs", can: "cans",
  jar: "jars", package: "packages", slice: "slices", pinch: "pinches", cup: "cups",
};
const UNIT_LABEL = { fl_oz: "fl oz" };
const FRACTIONS = [[0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"]];

export function formatNumber(n) {
  if (n == null) return "";
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  if (frac < 0.01) return String(whole);
  for (const [v, glyph] of FRACTIONS) {
    if (Math.abs(frac - v) < 0.02) return whole ? `${whole}${glyph}` : glyph;
  }
  return String(Math.round(n * 100) / 100);
}

// Display one measurement in US units ("3 lb", "1¾ cups", "5 cloves", "2").
export function formatQty(qty, unit) {
  if (qty == null) return "";
  ({ qty, unit } = toUS(qty, unit));
  if (!unit || unit === "whole") return formatNumber(qty);
  const label = qty > 1 && PLURALS[unit] ? PLURALS[unit] : UNIT_LABEL[unit] ?? unit;
  return `${formatNumber(qty)} ${label}`;
}

// Sum quantities: weights merge (oz/lb), volumes merge (tsp/tbsp/cup), counts merge by unit.
// Metric rows are converted to US first.
export function sumQuantities(rows) {
  const buckets = new Map(); // family -> total in base unit
  for (const r of rows) {
    if (r.qty == null) continue;
    const { family, base } = measureOf(Number(r.qty), r.unit);
    buckets.set(family, (buckets.get(family) ?? 0) + base);
  }
  return [...buckets.entries()].map(([family, total]) =>
    family === "mass" ? fromOunces(total) : family === "volume" ? fromTeaspoons(total) : { qty: total, unit: family });
}

export function quantityText(rows) {
  return sumQuantities(rows).map((b) => formatQty(b.qty, b.unit)).join(" + ");
}

export const itemKey = (name) => name.trim().toLowerCase();

// Groups rows by item name. Staples (and optional ingredients) go to their own group.
// Returns { sections: [{ id, name, groups }], staples: [groups] }.
export function buildList(rows, sectionDefs, recipeTitles = {}) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.is_staple ? "s" : "n"}|${itemKey(r.name)}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, name: r.name.trim(), section: r.section, isStaple: r.is_staple, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(r);
  }

  const out = [];
  for (const g of groups.values()) {
    const recipes = [...new Set(g.rows.map((r) => r.recipe_slug).filter(Boolean))];
    out.push({
      key: g.key,
      name: g.name,
      section: g.section,
      isStaple: g.isStaple,
      ids: g.rows.map((r) => r.id),
      checked: g.rows.every((r) => r.checked),
      qtyText: quantityText(g.rows),
      recipes: recipes.map((s) => recipeTitles[s] ?? s),
      manual: g.rows.some((r) => !r.pick_id),
      notes: [...new Set(g.rows.map((r) => r.note).filter(Boolean))],
    });
  }

  const byName = (a, b) => (a.checked - b.checked) || a.name.localeCompare(b.name);
  const known = new Set(sectionDefs.map((s) => s.id));
  const sections = sectionDefs.map((s) => ({
    id: s.id,
    name: s.name,
    groups: out.filter((g) => !g.isStaple && (g.section === s.id || (s.id === "other" && !known.has(g.section)))).sort(byName),
  })).filter((s) => s.groups.length);
  const staples = out.filter((g) => g.isStaple).sort(byName);
  return { sections, staples };
}

// Parse quick manual entries like "2 lb chicken thighs", "1/2 cup cream", "milk".
const UNIT_WORDS = {
  g: "g", gram: "g", grams: "g", kg: "kg", ml: "ml", l: "l", liter: "l", litre: "l",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  cup: "cup", cups: "cup", oz: "oz", ounce: "oz", ounces: "oz", lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  can: "can", cans: "can", jar: "jar", jars: "jar", bunch: "bunch", bunches: "bunch",
  package: "package", packages: "package", pkg: "package", clove: "clove", cloves: "clove",
};

export function parseEntry(text) {
  const t = text.trim().replace(/\s+/g, " ");
  const m = t.match(/^(\d+(?:\.\d+)?|\d+\/\d+|\d+ \d+\/\d+)\s+(\S+)(?:\s+(.*))?$/);
  if (!m) return { name: t, qty: null, unit: null };
  const qty = parseAmount(m[1]);
  const unit = UNIT_WORDS[m[2].toLowerCase()];
  if (unit && m[3]) return { name: m[3], ...toUS(qty, unit) };
  return { name: [m[2], m[3]].filter(Boolean).join(" "), qty, unit: "whole" };
}

function parseAmount(s) {
  if (s.includes(" ")) { const [w, f] = s.split(" "); return Number(w) + parseAmount(f); }
  if (s.includes("/")) { const [a, b] = s.split("/").map(Number); return b ? a / b : a; }
  return Number(s);
}

// Best guess at a store section for a manually added item.
const KEYWORDS = [
  ["produce", /\b(apple|banana|berr|lemon|lime|orange|onion|garlic|potato|tomato|lettuce|spinach|kale|carrot|celery|pepper|cucumber|avocado|herb|cilantro|parsley|basil|mint|ginger|mushroom|zucchini|squash|broccoli|cauliflower|cabbage|scallion|shallot|leek|fruit|grape|melon)/],
  ["meat", /\b(chicken|beef|pork|steak|bacon|sausage|turkey|lamb|ground|fish|salmon|shrimp|tuna steak|thigh|breast|ribs)/],
  ["dairy", /\b(milk|cheese|butter|cream|yogurt|yoghurt|egg|sour cream|half and half)/],
  ["bakery", /\b(bread|bagel|bun|tortilla|baguette|roll|pita|croissant)/],
  ["frozen", /\b(frozen|ice cream)/],
  ["canned", /\b(canned|broth|stock|beans|tomato paste|soup|coconut milk)/],
  ["grains", /\b(rice|pasta|noodle|quinoa|oats|couscous|spaghetti)/],
  ["baking", /\b(flour|sugar|baking|yeast|vanilla|chocolate chips|cocoa)/],
  ["spices", /\b(salt|pepper|paprika|cumin|oregano|thyme|cinnamon|spice|seasoning|chili powder)/],
  ["condiments", /\b(ketchup|mustard|mayo|sauce|salsa|dressing|honey|jam|peanut butter)/],
  ["oils", /\b(oil|vinegar)/],
  ["beverages", /\b(coffee|tea|juice|soda|sparkling|water)/],
  ["alcohol", /\b(wine|beer)/],
  ["household", /\b(paper towel|toilet paper|soap|detergent|foil|plastic wrap|trash bag|sponge)/],
];

export function guessSection(name, { overrides = {}, items = {} } = {}) {
  const k = itemKey(name);
  if (overrides[k]) return overrides[k];
  if (items[k]) return items[k];
  for (const [section, re] of KEYWORDS) if (re.test(k)) return section;
  return "other";
}
