// What Ask Manami knows about the farm: a compact, deterministic context and the three client tools.
// Pure (no DOM): everything comes through a host the app builds in main.js:
//
//   host = { fields(), report(id), profile(), place(), plansData(), savedPlan(), today() }
//
// Never sent: outlines or coordinates, source ids, the jar photo or layer colours.

import { moneyAbout } from '../ui/money.js';
import { CROP_NAME, PLANS } from '../plan/planNames.js';

const firstSeason = (d) => (d.getMonth() >= 7 ? d.getFullYear() + 1 : d.getFullYear());
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const acresOf = (v) => (Number.isFinite(v) ? Math.round(v) : null);

function lastCrop(report) {
  const known = (report?.history || []).filter((h) => h.crop != null);
  const h = known[known.length - 1];
  return h ? { year: h.year, crop: h.label || h.crop } : null;
}
const flagTexts = (report) => (report?.shown || []).map((f) => f.text).filter(Boolean).slice(0, 3);

function fieldSummary(f, host) {
  const r = safe(() => host.report(f.id));
  return { id: f.id, name: f.name, acres: acresOf(r?.acres ?? f.acres), status: r?.status || 'unknown', last_crop: lastCrop(r), flags: flagTexts(r) };
}
function safe(fn, fallback = null) { try { return fn() ?? fallback; } catch { return fallback; } }

function profileOf(host) {
  const p = safe(() => host.profile()) || {};
  return { priorities: [...(p.priorities || [])], excluded_crops: [...(p.excludedCrops || [])], irrigated_field_ids: [...(p.irrigatedFieldIds || [])] };
}
function savedOf(host) {
  const s = safe(() => host.savedPlan());
  return s ? { source: s.source === 'built' ? 'built' : 'pick', start_year: s.startYear ?? null } : null;
}

/** The farm as it is now (same app state, identical JSON). */
export function buildFarmContext(host) {
  const today = safe(() => host.today()) || new Date();
  const y0 = firstSeason(today);
  const fields = (safe(() => host.fields()) || []).map((f) => fieldSummary(f, host));
  const place = safe(() => host.place());
  return {
    v: 1,
    today: ymd(today),
    plan_years: [y0, y0 + 1, y0 + 2],
    farm: { place: place?.label ?? null, field_count: fields.length, total_acres: Math.round(fields.reduce((s, f) => s + (f.acres || 0), 0)) },
    profile: profileOf(host),
    fields,
    plans_ready: !!safe(() => host.plansData()),
    saved_plan: savedOf(host),
  };
}

/** One field's check-up for get_field (from the app's own field report). */
export function fieldDetail(report) {
  const r = report;
  return {
    id: r.id,
    name: r.name,
    acres: acresOf(r.acres),
    irrigated: !!r.irrigated,
    status: r.status,
    crop_history: (r.history || []).map((h) => ({ year: h.year, crop: h.crop == null ? null : h.label || h.crop, ...(h.byFarmer ? { set_by_farmer: true } : {}) })),
    soil: r.soil ? { texture: r.soil.texture ?? null, drainage: r.soil.drainage ?? null, organic_matter_pct: round1(r.soil.organicMatterPct), water_holding_in: round1(r.soil.waterHoldingIn) } : null,
    slope: r.slope ? { pct: round1(r.slope.pct), erosion_risk: r.slope.risk ?? null } : null,
    rain: r.rain ? { recent_avg_in: round1(r.rain.recentAvg / 25.4), normal_in: round1(r.rain.avg30 / 25.4), recent_years: r.rain.recentYears } : null,
    greenness_on_record: !!r.ndvi,
    flags: (r.shown || []).map((f) => f.text).filter(Boolean),
    jar: r.jar ? { texture_class: r.jar.textureClass ?? null, sand_pct: r.jar.sandPct ?? null, silt_pct: r.jar.siltPct ?? null, clay_pct: r.jar.clayPct ?? null, confidence: r.jar.confidence ?? null, agrees_with_soil_map: !!r.jar.sameAsMap } : null,
    plan_weather: r.planWeather ? { water: r.planWeather.water ?? null, frost: r.planWeather.frost ?? null } : null,
    sources: { crop_history: 'USDA CSB and CDL, except years marked set_by_farmer (the farmer entered those, so trust them)', soil: 'USDA SSURGO', slope: 'USGS 3DEP', rain: 'NASA POWER' },
  };
}

/** The three plans for get_plans, or ready: false. data = the plans panel's { result, ... }. */
export function plansSummary(data, today = new Date()) {
  if (!data?.result?.plans) return { ready: false, reason: 'The plans have not been made yet. The farmer can press "Plan my next seasons" to make them.' };
  const y0 = firstSeason(today);
  const years = [y0, y0 + 1, y0 + 2];
  const plans = PLANS.map(({ kind, name }) => {
    const p = data.result.plans[kind];
    if (!p) return null;
    const soil = p.endSoilHealth ?? p.soilHealth;
    return {
      kind,
      name,
      cash_margin_said: moneyAbout(p.expectedGM),
      bad_year_1_in_10_said: moneyAbout(p.p10GM),
      soil_health_end: Number.isFinite(soil) ? Math.round(soil * 100) : null,
      beats_keeping_going_pct: kind === 'current' ? null : Math.round((p.probBeatsCurrent ?? 0) * 100),
      fields: (p.paddocks || []).map((pd) => ({
        field_id: pd.paddockId,
        name: pd.name,
        seasons: (pd.sequence || []).slice(0, 3).map((c, i) => ({ year: years[i], crop: CROP_NAME[c] || c })),
      })),
    };
  }).filter(Boolean);
  return { ready: true, years, weather: data.weather ? { source: data.weather.source ?? null, years: data.weather.years ?? null } : null, plans };
}

const MAX_CHARS = 12_000;
const out = (v, isError = false) => {
  let s = JSON.stringify(v);
  if (s.length > MAX_CHARS) s = JSON.stringify({ cut: true, text: s.slice(0, MAX_CHARS - 40) });
  return { content: s, is_error: isError };
};

/** The client tools: run(name, input) never throws. */
export function createClientTools(host) {
  const impl = {
    get_farm_overview: () => {
      const c = buildFarmContext(host);
      return out({ place: c.farm.place, fields: c.fields, profile: c.profile, plans_ready: c.plans_ready, saved_plan: c.saved_plan });
    },
    get_field: (input) => {
      const id = typeof input?.field_id === 'string' ? input.field_id : '';
      const r = id ? safe(() => host.report(id)) : null;
      if (!r) {
        const ids = (safe(() => host.fields()) || []).map((f) => f.id).join(', ');
        return out({ error: `No field with that id. Ids: ${ids}` }, true);
      }
      return out(fieldDetail(r));
    },
    get_plans: () => out(plansSummary(safe(() => host.plansData()), safe(() => host.today()) || new Date())),
  };
  const names = Object.keys(impl);
  return {
    names,
    async run(name, input) {
      const key = names.find((n) => n.toLowerCase() === String(name).toLowerCase());
      if (!key) return out({ error: `Unknown tool. Use one of: ${names.join(', ')}` }, true);
      try { return impl[key](input || {}); } catch (e) { return out({ error: String(e?.message || 'The tool failed.') }, true); }
    },
  };
}

/** The little line shown while a tool runs. */
export function toolStatusLine(name, input, host) {
  if (name === 'get_farm_overview') return 'Looking over your farm…';
  if (name === 'get_plans') return 'Getting the plans…';
  if (name === 'get_field') {
    const f = (safe(() => host.fields()) || []).find((x) => x.id === input?.field_id);
    return f ? `Looking at ${f.name}…` : 'Looking at that field…';
  }
  return 'Thinking…';
}
