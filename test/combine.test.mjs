import { test } from "node:test";
import assert from "node:assert/strict";
import { buildList, quantityText, parseEntry, guessSection, formatQty } from "../app/js/combine.js";

const sections = [
  { id: "produce", name: "Produce" },
  { id: "meat", name: "Meat & Seafood" },
  { id: "other", name: "Other" },
];
const row = (o) => ({ id: crypto.randomUUID(), qty: null, unit: null, note: null, pick_id: null, recipe_slug: null, is_staple: false, checked: false, section: "other", ...o });

test("merges metric mass and keeps other units separate", () => {
  assert.equal(quantityText([row({ name: "onion", qty: 1, unit: "whole" }), row({ name: "onion", qty: 200, unit: "g" }), row({ name: "onion", qty: 1, unit: "kg" })]), "1 + 1.2 kg");
  assert.equal(quantityText([row({ qty: 700, unit: "ml" }), row({ qty: 400, unit: "ml" })]), "1.1 l");
  assert.equal(quantityText([row({ qty: 5, unit: "clove" }), row({ qty: 5, unit: "clove" })]), "10 cloves");
  assert.equal(formatQty(0.25, "tsp"), "¼ tsp");
  assert.equal(formatQty(1.5, "cup"), "1½ cups");
  assert.equal(formatQty(1.4, "kg"), "1.4 kg");
  assert.equal(formatQty(0.5, "kg"), "500 g");
  assert.equal(formatQty(1.5, "l"), "1½ l");
});

test("groups by name, splits staples, orders by section and checked state", () => {
  const rows = [
    row({ name: "pork shoulder", section: "meat", qty: 1.4, unit: "kg", pick_id: "p1", recipe_slug: "a" }),
    row({ name: "Pork shoulder", section: "meat", qty: 1.4, unit: "kg", pick_id: "p2", recipe_slug: "b" }),
    row({ name: "celery", section: "produce", qty: 3, unit: "stalk", checked: true }),
    row({ name: "avocado", section: "produce" }),
    row({ name: "kosher salt", section: "spices", qty: 2, unit: "tsp", is_staple: true }),
    row({ name: "mystery", section: "nowhere" }),
  ];
  const { sections: out, staples } = buildList(rows, sections, { a: "Stew A" });
  assert.deepEqual(out.map((s) => s.id), ["produce", "meat", "other"]);
  assert.deepEqual(out[0].groups.map((g) => g.name), ["avocado", "celery"]);
  const pork = out[1].groups[0];
  assert.equal(pork.qtyText, "2.8 kg");
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
});

test("guesses sections: overrides, then sections.json, then keywords", () => {
  assert.equal(guessSection("Milk"), "dairy");
  assert.equal(guessSection("turnips", { items: { turnips: "produce" } }), "produce");
  assert.equal(guessSection("milk", { overrides: { milk: "beverages" } }), "beverages");
  assert.equal(guessSection("zzz"), "other");
});
