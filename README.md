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

## The app

A phone web app in `app/`, deployed to GitHub Pages on every push to `main`. Add it to your home screen from Safari (Share → Add to Home Screen) or Chrome (menu → Add to Home screen).

- **Plan:** swipe right to add a recipe to this week, left to skip. Tap a card to read the recipe.
- **List:** everything from this week's recipes, merged and grouped by store section, plus anything you add by hand. Changes show up on both phones right away. If you lose signal in the store, changes are saved on the phone and sent when you're back online.
- **Menu → Start a new week:** clears this week's recipes and their ingredients, plus checked-off items.

### One-time setup

1. **Database:** already set up (applied 2026-11-09 through the Supabase connector). Future schema changes go in a new file in `supabase/migrations/` and get applied the same way; the file names match the versions Supabase records.
2. **Household members:** in the SQL editor, run
   `insert into public.members (email) values ('you@example.com'), ('spouse@example.com');`
   Keep these emails out of the repo.
3. **Accounts:** Supabase → Authentication → Users → Add user → Create new user, with "Auto confirm" on, for each of you. Then turn off "Allow new users to sign up" under Authentication → Sign In / Providers.
4. **Hosting:** GitHub → Settings → Pages → Source: **GitHub Actions**.

### Developing

- `npm test`: validates recipes and runs unit tests.
- `npm run serve`: builds into `dist/` and serves it at http://localhost:8000.
- `npm run build && node test/e2e.mjs`: full run in headless Chrome against a fake Supabase (`test/fake-supabase.js`); screenshots go to `test/shots/`. Needs Playwright.

## Recipe pictures

Recipes without a `photo:` get an AI-generated placeholder from [Pollinations.ai](https://pollinations.ai) (free, no account). The deploy workflow makes one per recipe, saves it to `recipes/photos/generated/<recipe>.jpg`, and commits it, so each picture is made once.

- To use a real photo, add it to `recipes/photos/` and set `photo:` in the recipe. It replaces the generated one.
- To get a different generated picture, delete that recipe's file in `recipes/photos/generated/` and push.
