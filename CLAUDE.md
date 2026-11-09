# Project notes for Claude

Shared meal-planning + grocery web app for Jeremy (Android) and his wife (iPhone). Must work well in mobile Safari and Chrome; installable to home screen (PWA). No native apps.

## Plan
- Recipes live in `recipes/*.md` (YAML front matter + markdown body). Format is documented in README.md; `scripts/build-recipes.mjs` validates and emits `dist/recipes.json`.
- `sections.json` = store sections in walking order, ingredient → section map, pantry staples.
- App (to build, in `app/`): weekly swipe deck of recipe cards → picked recipes add ingredients to a shared grocery list grouped by store section; either person can add/remove/check items. Static site on GitHub Pages; shared state in Supabase (realtime, simple auth for two users). Should tolerate poor in-store signal (offline, sync later).
- Combine ingredients by `item` + `unit`; convert within metric mass/volume (g↔kg, ml↔l). Different units are shown together on one line, not converted ("onion: 1 whole + 200 g").
- Repo is public: never commit secrets. The Supabase anon key is fine in client code only with row-level security on.

## Conventions
- Run `npm run check` after editing recipes or sections.json.
- Keep ingredient `item` names consistent across recipes; add new ones to sections.json.
- Keep MVP small: swipe, shared list by section, manual add, check-off and remove. Later: servings scaling, "both swiped yes" mode, photo upload.
