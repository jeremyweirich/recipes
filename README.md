# Recipes

Our recipe collection, and the source for a shared meal-planning and grocery app (coming soon in `app/`).

## Adding a recipe

1. Create `recipes/<name-with-dashes>.md`. Copy an existing recipe as a starting point.
2. Optional photo: put it in `recipes/photos/` (JPEG, about 1200 px wide) and set `photo: photos/<file>.jpg`.
3. Any new ingredient needs a store section in `sections.json`.
4. Run `npm run check` (a GitHub Action also runs it on every push).

## Recipe format

```yaml
---
title: Keto Braised Pork Stew          # required
summary: One line for the recipe card.
servings: 6                            # required, whole number
time_minutes: 180
tags: [keto, pork, stew, oven]
photo: photos/keto-braised-pork-stew.jpg
related: [instant-pot-keto-pork-stew]  # other recipe file names, no .md
ingredients:
  - { item: yellow onion, qty: 1, unit: whole, note: "medium, diced" }
  - { item: xanthan gum, qty: 0.25, unit: tsp, optional: true }
  - { item: fish sauce, qty: 1, unit: tbsp, section: international }  # one-off section override
---

Free-form intro, then `## Method` and `## Notes` in markdown.
```

**Ingredient rules.** These keep the grocery list combining cleanly across recipes:

- `item` is the shopping name, lowercase and singular in meaning ("yellow onion", not "1 medium onion, diced"). Use the **same name in every recipe**, because that's how the list combines items. Prep details go in `note`.
- `unit` must be one of: `g kg ml l tsp tbsp cup oz lb fl_oz whole clove stalk bunch sprig can jar package slice pinch`. Use `whole` for counted things (1 onion, 2 bay leaves).
- `qty` is a number (`0.25`, not `1/4`). Leave it out for "to taste".
- Alternatives ("or olive oil") go in `note`. The list shows only the main item.

## sections.json

- `sections`: store sections, **in the order you walk the store**. Reorder them to match your store.
- `items`: ingredient name → section id. This seeds the app. Changes you make in the app will be saved there too.
- `staples`: pantry items you usually have. The app puts these in a "check you have these" group instead of adding them to the list automatically.
