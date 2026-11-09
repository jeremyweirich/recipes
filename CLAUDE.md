# Project notes for Claude

Shared meal-planning + grocery web app for Jeremy (Android) and his wife (iPhone). Must work well in mobile Safari and Chrome; installable to home screen (PWA). No native apps.

## Plan
- Recipes live in `recipes/*.md` (YAML front matter + markdown body). Format is documented in README.md; `scripts/build-recipes.mjs` validates and emits `dist/recipes.json`.
- `sections.json` = store sections in walking order, ingredient → section map, pantry staples.
- App (`app/`): weekly swipe deck of recipe cards → picked recipes add ingredients to a shared grocery list grouped by store section; either person can add/remove/check items. Static site on GitHub Pages; shared state in Supabase (realtime, simple auth for two users). Should tolerate poor in-store signal (offline, sync later).
- Combine ingredients by `item` + `unit`; convert within metric mass/volume (g↔kg, ml↔l). Different units are shown together on one line, not converted ("onion: 1 whole + 200 g").
- Repo is public: never commit secrets. The Supabase anon key is fine in client code only with row-level security on.

## Conventions
- Run `npm run check` after editing recipes or sections.json.
- Keep ingredient `item` names consistent across recipes; add new ones to sections.json.
- Keep MVP small: swipe, shared list by section, manual add, check-off and remove. Later: servings scaling, "both swiped yes" mode, photo upload.

## App layout
- `app/index.html`, `app/app.css`: one page, two tabs (Plan, List), `<dialog>` sheets.
- `app/js/store.js`: Supabase data + localStorage outbox (optimistic; ops replayed on fresh server state; 4xx ops dropped). Realtime triggers a full refetch.
- `app/js/combine.js`: pure merging/formatting/section-guessing (unit tested in `test/combine.test.mjs`).
- `app/sw.js`: shell cached per build (`__BUILD__` stamped by `scripts/build-site.mjs`); Supabase never cached.
- `supabase/migrations/`: schema. Access = signed in AND email in `public.members` (`is_member()`). New tables need explicit grants + RLS.
- After UI changes: `npm run build && PLAYWRIGHT=<path> node test/e2e.mjs` and look at `test/shots/`.
