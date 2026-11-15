-- Season reports (app v0.13): how each season really went on a farm, field by field, so the planner
-- can learn from it (src/plan/seasons.js): what was grown, the yield per acre, what went wrong (hail,
-- drought, pests...) and the farmer's notes. One row per farm and season; saving again replaces it.
--
--   report = { "v": 1, "season": 2026, "savedAt": "...",
--              "fields": { "<app field id>": { "crop": "corn", "yield": 196, "events": ["drought"], "notes": "" } } }
--
-- Safe to run more than once. The app keeps working before it's run (reports then stay on the device).
create table if not exists public.season_reports (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id) on delete cascade,
  season int not null check (season between 1990 and 2100),
  report jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, season)
);
create index if not exists season_reports_farm_idx on public.season_reports (farm_id, season);

drop trigger if exists season_reports_touch on public.season_reports;
create trigger season_reports_touch before update on public.season_reports for each row execute function public.touch_updated_at();

alter table public.season_reports enable row level security;
drop policy if exists "season reports of own farms" on public.season_reports;
create policy "season reports of own farms" on public.season_reports for all to authenticated
  using (public.owns_farm(farm_id)) with check (public.owns_farm(farm_id));
