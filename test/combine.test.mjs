import { test } from "node:test";
import assert from "node:assert/strict";
import { buildList, quantityText, parseEntry, guessSection, formatQty } from "../app/js/combine.js";

const sections = [
  { id: "produce", name: "Produce" },
  { id: "meat", name: "Meat & Seafood" },
  { id: "other", name: "Other" },
];
const row = (o) => ({ id: crypto.randomUUID(), qty: null, unit: null, note: null, pick_id: null, recipe_slug: null, is_staple: false, checked: false, section: "other", ...o });

test("merges in US units and converts metric quietly", () => {
  assert.equal(quantityText([row({ qty: 1, unit: "lb" }), row({ qty: 1, unit: "lb" })]), "2 lb");
  assert.equal(quantityText([row({ qty: 1, unit: "lb" }), row({ qty: 8, unit: "oz" })]), "1½ lb");
  assert.equal(quantityText([row({ qty: 1.4, unit: "kg" }), row({ qty: 1, unit: "lb" })]), "4 lb");
  assert.equal(quantityText([row({ qty: 1, unit: "whole" }), row({ qty: 200, unit: "g" })]), "1 + ½ lb");
  assert.equal(quantityText([row({ qty: 3, unit: "cup" }), row({ qty: 1.75, unit: "cup" })]), "4¾ cups");
  assert.equal(quantityText([row({ qty: 700, unit: "ml" }), row({ qty: 400, unit: "ml" })]), "4⅔ cups");
  assert.equal(quantityText([row({ qty: 2, unit: "tsp" }), row({ qty: 2, unit: "tsp" })]), "1⅓ tbsp");
  assert.equal(quantityText([row({ qty: 5, unit: "clove" }), row({ qty: 5, unit: "clove" })]), "10 cloves");
});

test("formats single US measurements and converts metric", () => {
  assert.equal(formatQty(0.25, "tsp"), "¼ tsp");
  assert.equal(formatQty(1.5, "cup"), "1½ cups");
  assert.equal(formatQty(1.4, "kg"), "3 lb");
  assert.equal(formatQty(120, "ml"), "½ cup");
  assert.equal(formatQty(450, "g"), "1 lb");
  assert.equal(formatQty(15, "ml"), "1 tbsp");
  assert.equal(formatQty(60, "g"), "2 oz");
  assert.equal(formatQty(3, "whole"), "3");
});

test("groups by name, splits staples, orders by section and checked state", () => {
  const rows = [
    row({ name: "pork shoulder", section: "meat", qty: 3, unit: "lb", pick_id: "p1", recipe_slug: "a" }),
    row({ name: "Pork shoulder", section: "meat", qty: 3, unit: "lb", pick_id: "p2", recipe_slug: "b" }),
    row({ name: "celery", section: "produce", qty: 3, unit: "stalk", checked: true }),
    row({ name: "avocado", section: "produce" }),
    row({ name: "kosher salt", section: "spices", qty: 2, unit: "tsp", is_staple: true }),
    row({ name: "mystery", section: "nowhere" }),
  ];
  const { sections: out, staples } = buildList(rows, sections, { a: "Stew A" });
  assert.deepEqual(out.map((s) => s.id), ["produce", "meat", "other"]);
  assert.deepEqual(out[0].groups.map((g) => g.name), ["avocado", "celery"]);
  const pork = out[1].groups[0];
  assert.equal(pork.qtyText, "6 lb");
  assert.equal(pork.ids.length, 2);
  assert.deepEqual(pork.recipes, ["Stew A", "b"]);
  assert.equal(out[2].groups[0].name, "mystery");
  assert.equal(staples.length, 1);
});

test("group is checked only when every row is", () => {
  const rows = [row({ name: "garlic", checked: true }), row({ name: "garlic", checked: false })];
  assert.equal(buildList(rows, sections).sections[0].groups[0].checked, false);
});

test("parses quick entries", () => {
  assert.deepEqual(parseEntry("2 lb chicken thighs"), { name: "chicken thighs", qty: 2, unit: "lb" });
  assert.deepEqual(parseEntry("1/2 cup cream"), { name: "cream", qty: 0.5, unit: "cup" });
  assert.deepEqual(parseEntry("3 lemons"), { name: "lemons", qty: 3, unit: "whole" });
  assert.deepEqual(parseEntry("  milk "), { name: "milk", qty: null, unit: null });
  assert.deepEqual(parseEntry("500 g ground beef"), { name: "ground beef", qty: 1, unit: "lb" });
  assert.deepEqual(parseEntry("1 l milk"), { name: "milk", qty: 4.25, unit: "cup" });
});

test("guesses sections: overrides, then sections.json, then keywords", () => {
  assert.equal(guessSection("Milk"), "dairy");
  assert.equal(guessSection("turnips", { items: { turnips: "produce" } }), "produce");
  assert.equal(guessSection("milk", { overrides: { milk: "beverages" } }), "beverages");
  assert.equal(guessSection("zzz"), "other");
});
