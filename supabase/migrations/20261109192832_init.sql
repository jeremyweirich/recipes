-- Shared meal plan + grocery list.
-- Access model: only signed-in users whose email is in public.members can read or write anything.
-- Tables are exposed to the Data API by explicit grants (auto-expose is off for this project).

-- Household allowlist. Not exposed to the Data API; fill it from the SQL editor:
--   insert into public.members (email) values ('you@example.com'), ('spouse@example.com');
create table public.members (
  email text primary key check (email = lower(email))
);
alter table public.members enable row level security;
revoke all on table public.members from anon, authenticated;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- Recipes picked for this week. One row per recipe.
create table public.picks (
  id uuid primary key default gen_random_uuid(),
  recipe_slug text not null unique,
  servings int check (servings > 0),
  picked_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Grocery list rows. Recipe rows belong to a pick and disappear with it;
-- manual rows have no pick. The app merges rows with the same name for display.
create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  section text not null default 'other',
  qty numeric check (qty is null or qty >= 0),
  unit text,
  note text,
  pick_id uuid references public.picks (id) on delete cascade,
  recipe_slug text,
  is_staple boolean not null default false,
  checked boolean not null default false,
  added_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index list_items_pick_id_idx on public.list_items (pick_id);

-- Store sections you've corrected in the app; these win over sections.json.
create table public.section_overrides (
  item text primary key check (item = lower(item)),
  section text not null,
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger list_items_touch before update on public.list_items
  for each row execute function public.touch_updated_at();
create trigger section_overrides_touch before update on public.section_overrides
  for each row execute function public.touch_updated_at();

-- Row-level security: members only.
alter table public.picks enable row level security;
alter table public.list_items enable row level security;
alter table public.section_overrides enable row level security;

create policy "members manage picks" on public.picks
  for all to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy "members manage list items" on public.list_items
  for all to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy "members manage section overrides" on public.section_overrides
  for all to authenticated using ((select public.is_member())) with check ((select public.is_member()));

-- Explicit Data API grants: signed-in users only, never anon.
revoke all on table public.picks, public.list_items, public.section_overrides from anon;
grant select, insert, update, delete on table public.picks, public.list_items, public.section_overrides to authenticated;

-- Live updates between phones.
alter publication supabase_realtime add table public.picks, public.list_items, public.section_overrides;
