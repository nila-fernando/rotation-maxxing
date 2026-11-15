-- Rotation-Maxxing: first database schema (Supabase / Postgres 15+).
-- Run once in the Supabase SQL editor (or `supabase db push`). Safe to read top to bottom:
-- every table has Row Level Security ON, and every policy lets a signed-in farmer see and change
-- only their own rows. The browser uses the publishable (anon) key; the secret (service role) key
-- is only for server code (the AI Edge Function's usage log) and must never reach the app.

-- ---------------------------------------------------------------- profiles
-- One row per signed-in person, made automatically when they sign up (trigger below).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  -- check-in answers: what matters most (profit, soil-health, saving-water, low-risk), crops off the table
  priorities text[] not null default '{profit}',
  excluded_crops text[] not null default '{}',
  -- the farmer said yes to sending questions and farm details to Claude (Ask Manami)
  ai_consent boolean not null default false,
  ai_enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb, -- sound on/off, units, etc.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- farms
create table if not exists public.farms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'My farm',
  -- where it is: { lat, lon, label, county, state, fips } (the search result the farmer picked)
  place jsonb not null default '{}'::jsonb,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists farms_owner_idx on public.farms (owner_id);

-- ---------------------------------------------------------------- fields
create table if not exists public.fields (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id) on delete cascade,
  app_key text not null,                 -- the app's own id for the field (e.g. 'f1'), stable per farm
  name text not null,
  acres numeric(10, 2),
  geometry jsonb not null,               -- GeoJSON Polygon / MultiPolygon (WGS84)
  source text,                           -- 'usda' | 'ai' | 'drawn'
  source_ids text[] not null default '{}',
  crops jsonb not null default '{}'::jsonb, -- crop history by year: { "2018": "Corn", ... }
  irrigated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, app_key)
);
create index if not exists fields_farm_idx on public.fields (farm_id);

-- ---------------------------------------------------------------- field data cache
-- Real data per field fetched from public sources (USDA soil, slope, NASA rain, greenness, CropScape),
-- kept so a farm opens fast and the sources aren't asked again and again.
create table if not exists public.field_data (
  field_id uuid not null references public.fields (id) on delete cascade,
  kind text not null check (kind in ('soil', 'slope', 'rain', 'greenness', 'cdl', 'weather')),
  data jsonb not null,
  source text,                           -- e.g. 'USDA NRCS SSURGO', 'NASA POWER'
  fetched_at timestamptz not null default now(),
  primary key (field_id, kind)
);

-- ---------------------------------------------------------------- soil jar tests
-- The result only (texture, sand/silt/clay, confidence, the layers' colours). The photo itself is
-- NOT stored by default: it stays on the farmer's device (the app promises that).
create table if not exists public.jar_tests (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.fields (id) on delete cascade,
  record jsonb not null,                 -- the app's JarRecord (v: 1, textureClass, sandPct, siltPct, clayPct, confidence, layers, ...)
  in_use boolean not null default true,  -- the planner uses this field's jar texture
  created_at timestamptz not null default now()
);
create index if not exists jar_tests_field_idx on public.jar_tests (field_id, created_at desc);

-- ---------------------------------------------------------------- plans
-- A saved plan for the next 3 seasons ("Use this plan").
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id) on delete cascade,
  start_year int not null,
  source text not null default 'saved' check (source in ('saved', 'built', 'ai')),
  choice jsonb not null default '{}'::jsonb,     -- which plan each field takes (keep going / most profit / Manami's pick)
  sequences jsonb not null,                      -- { fieldKey: [{ main, cover? }, x3] }
  scores jsonb not null default '{}'::jsonb,     -- the planner's numbers when saved (cash, bad year, soil, beats)
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists plans_farm_idx on public.plans (farm_id, created_at desc);
-- only one current plan per farm
create unique index if not exists plans_one_current on public.plans (farm_id) where is_current;

-- ---------------------------------------------------------------- Ask Manami (AI) history
create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  farm_id uuid references public.farms (id) on delete set null,
  title text,
  created_at timestamptz not null default now()
);
create index if not exists ai_conversations_owner_idx on public.ai_conversations (owner_id, created_at desc);

create table if not exists public.ai_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,                -- text and tool blocks as the app keeps them
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_conv_idx on public.ai_messages (conversation_id, id);

-- Token use per request, written ONLY by the AI Edge Function (service role), read by the farmer.
-- Used for per-person daily limits so one account can't run up the Claude bill.
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  route text not null,                   -- 'chat' | 'plan' | 'jar'
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_owner_day_idx on public.ai_usage (owner_id, created_at desc);

-- ---------------------------------------------------------------- updated_at
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists farms_touch on public.farms;
create trigger farms_touch before update on public.farms for each row execute function public.touch_updated_at();
drop trigger if exists fields_touch on public.fields;
create trigger fields_touch before update on public.fields for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- a profile for every new sign-up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- Row Level Security
alter table public.profiles         enable row level security;
alter table public.farms            enable row level security;
alter table public.fields           enable row level security;
alter table public.field_data       enable row level security;
alter table public.jar_tests        enable row level security;
alter table public.plans            enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages      enable row level security;
alter table public.ai_usage         enable row level security;

-- helper: does the signed-in person own this farm?
create or replace function public.owns_farm(f uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.farms where id = f and owner_id = (select auth.uid()))
$$;
create or replace function public.owns_field(fl uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.fields x join public.farms fa on fa.id = x.farm_id
    where x.id = fl and fa.owner_id = (select auth.uid()))
$$;

-- profiles: your own row only (created by the trigger, so no insert policy)
drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- farms
drop policy if exists "own farms" on public.farms;
create policy "own farms" on public.farms for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- fields, plans: through the farm
drop policy if exists "fields of own farms" on public.fields;
create policy "fields of own farms" on public.fields for all to authenticated
  using (public.owns_farm(farm_id)) with check (public.owns_farm(farm_id));
drop policy if exists "plans of own farms" on public.plans;
create policy "plans of own farms" on public.plans for all to authenticated
  using (public.owns_farm(farm_id)) with check (public.owns_farm(farm_id));

-- field data, jar tests: through the field
drop policy if exists "data of own fields" on public.field_data;
create policy "data of own fields" on public.field_data for all to authenticated
  using (public.owns_field(field_id)) with check (public.owns_field(field_id));
drop policy if exists "jar tests of own fields" on public.jar_tests;
create policy "jar tests of own fields" on public.jar_tests for all to authenticated
  using (public.owns_field(field_id)) with check (public.owns_field(field_id));

-- AI conversations and messages
drop policy if exists "own conversations" on public.ai_conversations;
create policy "own conversations" on public.ai_conversations for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "messages of own conversations" on public.ai_messages;
create policy "messages of own conversations" on public.ai_messages for all to authenticated
  using (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.owner_id = (select auth.uid())));

-- AI usage: read your own; only the Edge Function (service role, which bypasses RLS) writes
drop policy if exists "own usage read" on public.ai_usage;
create policy "own usage read" on public.ai_usage for select to authenticated using (owner_id = (select auth.uid()));

-- Nothing is granted to the anon role: signed-out visitors use the app without saving (as today).
