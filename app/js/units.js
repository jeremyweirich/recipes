// US kitchen units everywhere: cups/tbsp/tsp, lb/oz, and counts. Metric is converted quietly.
// Used by the recipe build (scripts/build-recipes.mjs), manual entry, and list merging.

export const G_PER_OZ = 28.3495;
export const ML_PER_TSP = 4.92892;
const OZ = { oz: 1, lb: 16 };
const TSP = { tsp: 1, tbsp: 3, fl_oz: 6, cup: 48 };

// Nearest kitchen-friendly fraction: whole numbers plus ¼ ⅓ ½ ⅔ ¾.
const STEPS = [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1];
export function friendly(n) {
  const whole = Math.floor(n);
  const frac = STEPS.reduce((best, s) => (Math.abs(n - whole - s) < Math.abs(n - whole - best) ? s : best), 0);
  return Math.round((whole + frac) * 1000) / 1000;
}

// Total ounces → lb if at least ¼ lb, otherwise oz.
export function fromOunces(oz) {
  if (oz >= 4) return { qty: friendly(oz / 16), unit: "lb" };
  return { qty: Math.max(0.5, Math.round(oz * 2) / 2), unit: "oz" };
}

// Total teaspoons → cups if at least ¼ cup, tbsp if at least 1 tbsp, otherwise tsp.
export function fromTeaspoons(tsp) {
  if (tsp >= 12) return { qty: friendly(tsp / 48), unit: "cup" };
  if (tsp >= 3) return { qty: friendly(tsp / 3), unit: "tbsp" };
  return { qty: Math.max(0.125, friendly(tsp)), unit: "tsp" };
}

export const isMetric = (unit) => unit === "g" || unit === "kg" || unit === "ml" || unit === "l";

// Convert one measurement to US units. Non-metric measurements pass through unchanged.
export function toUS(qty, unit) {
  if (qty == null || !isMetric(unit)) return { qty, unit };
  if (unit === "g" || unit === "kg") return fromOunces((qty * (unit === "kg" ? 1000 : 1)) / G_PER_OZ);
  return fromTeaspoons((qty * (unit === "l" ? 1000 : 1)) / ML_PER_TSP);
}

// For merging list rows: which family a unit belongs to and its size in that family's base unit.
export function measureOf(qty, unit) {
  const us = toUS(qty, unit);
  if (us.unit in OZ) return { family: "mass", base: us.qty * OZ[us.unit] };
  if (us.unit in TSP) return { family: "volume", base: us.qty * TSP[us.unit] };
  return { family: us.unit ?? "whole", base: us.qty };
}
