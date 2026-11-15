// When to sow and harvest each crop where the farm is: USDA Handbook 628 windows (from the vendored
// planner's SEASONS), recent NASS planting pace, Iowa State best windows, RMA insurance dates, NOAA
// frost normals and the NRCS cereal rye seeding dates, all but the first from
// data/crop-calendar.json (built by scripts/build-crop-calendar.mjs; nothing is fetched at runtime).
//
// Honesty rules: lookups go county first, then the state, then null. A state row is never "here";
// only a county row is. RMA dates are insurance deadlines ("Last day for full insurance"), never best.
//
// Pure (no DOM). Dates are "MM-DD" strings; Date objects only come out of spanFor and handoff.
import CAL from '../../data/crop-calendar.json' with { type: 'json' };
import { SEASONS } from '../vendor/rotation-maxxing/algorithm/croptraits.ts';
import { CROP_WORD } from './planNames.js';

export const LABEL = {
  best: 'Best sown',
  usual: 'Most farms plant',
  recent: 'Lately half are in by',
  insurance: 'Last day for full insurance',
  harvest: 'Harvest mostly',
};

export const STATE_NAME = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/** The bundled data, for the view's source list and the tests. */
export const CALENDAR = CAL;

/** Crops sown in the fall for a harvest the next summer. */
const FALL_SOWN = new Set(['winter-wheat']);
/** Cover crops (they get coverFor, not windowsFor). */
const COVERS = new Set(['cereal-rye']);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parts = (mmdd) => {
  const m = /^(\d\d)-(\d\d)$/.exec(String(mmdd ?? ''));
  return m ? { month: Number(m[1]), day: Number(m[2]) } : null;
};
/** "MM-DD" → day of a non-leap year (1–365), or null. */
export const dayOf = (mmdd) => {
  const p = parts(mmdd);
  return p ? Math.round((Date.UTC(2025, p.month - 1, p.day) - Date.UTC(2025, 0, 1)) / 86400000) + 1 : null;
};
const monthOf = (mmdd) => parts(mmdd)?.month ?? null;
/** A local-time Date for "MM-DD" in a year (noon, so no time zone pushes it a day). */
const dateIn = (year, mmdd) => { const p = parts(mmdd); return p ? new Date(year, p.month - 1, p.day, 12) : null; };
const uniq = (list) => [...new Set(list.filter(Boolean))];

/** Where the farm is, for the lookups. */
export function placeOf(farm) {
  return { state: farm?.state ?? null, fips: farm?.fips ?? null };
}

/** The county entry for a place (only when its state matches the place's). */
function countyOf(place) {
  const c = place?.fips ? CAL.counties?.[String(place.fips)] : null;
  if (!c) return null;
  return !place.state || !c.state || c.state === place.state ? c : null;
}

/** Whether the place has a county row (frost, insurance "here"). */
export const hasCounty = (place) => !!countyOf(place);

/**
 * A crop's sowing and harvest windows where the farm is, or null when nothing is known.
 * @returns {null | { crop, state, sow:{best, usual, recent, lossAfter, soilCue, insurance, plantsFallBefore},
 *   harvest:{usual, recent}, srcs:string[], gaps:string[] }}
 */
export function windowsFor(cropId, place) {
  const state = place?.state ?? null;
  if (!cropId || !state || COVERS.has(cropId)) return null;
  const h = SEASONS[cropId]?.[state] ?? null;
  const j = CAL.states?.[state]?.[cropId] ?? null;
  const county = countyOf(place)?.crops?.[cropId] ?? null;
  if (!h && !j && !county) return null;

  const win = (w) => (w ? { begin: w.begin, active: [w.activeStart, w.activeEnd], end: w.end, src: 'h628' } : null);
  const usual = win(h?.plant);
  const harvestUsual = win(h?.harvest);
  const recent = j?.recent?.plant ? { ...j.recent.plant, years: j.recent.years, src: j.recent.src } : null;
  const harvestRecent = j?.recent?.harvest ? { ...j.recent.harvest, years: j.recent.years, src: j.recent.src } : null;
  const best = j?.best ? { from: j.best.from ?? null, to: j.best.to, note: j.best.note, src: j.best.src, ...(j.best.secondary ? { secondary: true } : {}) } : null;
  const lossAfter = j?.lossAfter ? { date: j.lossAfter.date, src: j.lossAfter.src } : null;

  let insurance = null;
  if (county?.final) {
    insurance = { earliest: county.earliest ?? null, final: county.final, latePlantEnd: county.latePlantEnd ?? null, scope: 'county', scopeWords: 'here', src: county.src };
  } else if (j?.rmaState) {
    const r = j.rmaState;
    const final = r.final ?? r.springFinal ?? null;
    if (final) {
      insurance = {
        earliest: r.earliest ?? null, final, latePlantEnd: r.latePlantEnd ?? null, scope: 'state',
        scopeWords: `in most of ${STATE_NAME[state] ?? state}`, src: r.src,
        ...(r.springFinal ? { what: 'spring', lateSummerFinal: r.lateSummerFinal ?? null } : {}),
      };
    }
  }

  const plantsFallBefore = FALL_SOWN.has(cropId)
    || (!!usual && !!harvestUsual && dayOf(usual.begin) > dayOf(harvestUsual.begin));
  const srcs = uniq([usual?.src, harvestUsual?.src, recent?.src, harvestRecent?.src, best?.src, lossAfter?.src, j?.soilCue, insurance?.src]);
  const gaps = [];
  const said = CROP_WORD[cropId]?.word ?? cropId;
  const stName = STATE_NAME[state] ?? state;
  if (!recent && usual) gaps.push(`No recent planting pace for ${said} in ${stName}.`);
  // a state row is never "here": only say where the dates are missing
  if (!insurance) gaps.push(`No insurance dates for ${said} in ${countyOf(place)?.name ?? stName}.`);
  return {
    crop: cropId, state,
    sow: { best, usual, recent, lossAfter, soilCue: srcs.includes('isuLicht2020') && !!j?.soilCue, insurance, plantsFallBefore },
    harvest: { usual: harvestUsual, recent: harvestRecent },
    srcs, gaps,
  };
}

/** A cover crop's seeding window where the farm is, or null. */
export function coverFor(cropId, place) {
  const c = CAL.cover?.[cropId]?.[place?.state ?? ''];
  if (!c) return null;
  return { seed: [...c.seed], terminate: c.terminate, zoneConfirmed: !!c.zoneConfirmed, src: c.src, ...(c.termSrc ? { termSrc: c.termSrc } : {}) };
}

/** The frost normals of the nearest station (county rows only), or null. */
export function frostFor(place) {
  const f = countyOf(place)?.frost;
  if (!f) return null;
  return {
    station: f.station, stationName: f.stationName,
    lastSpring: { ...f.lastSpring }, firstFall: { ...f.firstFall }, hardFreeze: { ...f.hardFreeze }, src: f.src,
  };
}

/** The county's region words ("central Iowa"), or null. */
export const regionOf = (place) => countyOf(place)?.region ?? null;

/** The day a crop goes in: best from, else the recent halfway day, else the usual busy start. */
const plantDay = (w) => w?.sow.best?.from ?? w?.sow.recent?.p50 ?? w?.sow.usual?.active[0] ?? null;
/** The day a crop is mostly off: the recent halfway day, else the end of the usual busy run. */
const offDay = (w) => w?.harvest.recent?.p50 ?? w?.harvest.usual?.active[1] ?? null;

/**
 * A crop's planting and harvest dates in a season (winter wheat plants in seasonYear − 1).
 * Unknown crops get a plain May 1 / Oct 15 (Oct 1 the fall before / Jul 15 for fall-sown) and known:false.
 */
export function spanFor(cropId, seasonYear, place) {
  const w = windowsFor(cropId, place);
  const fall = w ? w.sow.plantsFallBefore : FALL_SOWN.has(cropId);
  const py = fall ? seasonYear - 1 : seasonYear;
  const plant = plantDay(w) ?? (fall ? '10-01' : '05-01');
  const harvest = offDay(w) ?? (fall ? '07-15' : '10-15');
  return {
    plant: dateIn(py, plant),
    harvest: dateIn(seasonYear, harvest),
    bestFrom: w?.sow.best?.from ? dateIn(py, w.sow.best.from) : null,
    bestTo: w?.sow.best?.to ? dateIn(py, w.sow.best.to) : null,
    known: !!w,
  };
}

/**
 * How one crop hands the field to the next. prevId grew in seasonYear − 1, nextId in seasonYear.
 * off is the prev's mostly-off day; fit is 'ok' | 'tight' | 'clash' (null when unknown):
 *   a spring crop after a fall harvest is always ok; a fall-sown crop clashes when off ≥ its last day
 *   for full insurance − 3 days, and is tight when off is past its best window or the prev's slow-year
 *   (p90) harvest is past that last day. coverFits: a rye cover can still go in (off ≤ the seed end).
 *   A cover crop as next gets fit from the cover: ok, tight (15 days or less to seed) or clash.
 * @returns {{ off, onDate, gapDays, coverFits, coverDays, coverBy, fit, final, scopeWords, prevP90 }}
 */
export function handoff(prevId, nextId, seasonYear, place) {
  const P = windowsFor(prevId, place);
  const rye = coverFor('cereal-rye', place);
  const off = offDay(P);
  const out = { off, onDate: null, gapDays: null, coverFits: false, coverDays: null, coverBy: rye?.seed[1] ?? null, fit: null, final: null, scopeWords: null, prevP90: P?.harvest.recent?.p90 ?? null };
  if (!off) return out;
  // the prev comes off in the season before (a fall-sown prev comes off that summer)
  const offDate = dateIn(seasonYear - 1, off);
  if (rye) {
    out.coverDays = dayOf(rye.seed[1]) - dayOf(off);
    out.coverFits = dayOf(off) <= dayOf(rye.seed[1]);
  }
  if (COVERS.has(nextId)) {
    const c = coverFor(nextId, place);
    if (!c) return out;
    const days = dayOf(c.seed[1]) - dayOf(off);
    out.onDate = dateIn(seasonYear - 1, dayOf(off) > dayOf(c.seed[0]) ? off : c.seed[0]);
    out.gapDays = Math.max(0, Math.round((out.onDate - offDate) / 86400000));
    out.fit = days < 0 ? 'clash' : days <= 15 ? 'tight' : 'ok';
    return out;
  }
  const N = windowsFor(nextId, place);
  if (!N) return out;
  const on = plantDay(N);
  if (!on) return out;
  const fall = N.sow.plantsFallBefore;
  out.onDate = dateIn(fall ? seasonYear - 1 : seasonYear, on);
  out.gapDays = Math.round((out.onDate - offDate) / 86400000);
  out.final = N.sow.insurance?.final ?? null;
  out.scopeWords = N.sow.insurance?.scopeWords ?? null;
  if (!fall) { out.fit = 'ok'; return out; }
  const last = out.final ?? N.sow.usual?.end ?? null;
  const o = dayOf(off);
  if (last && o >= dayOf(last) - 3) out.fit = 'clash';
  else if ((N.sow.best?.to && o > dayOf(N.sow.best.to)) || (last && out.prevP90 && dayOf(out.prevP90) > dayOf(last))) out.fit = 'tight';
  else out.fit = 'ok';
  return out;
}

/**
 * The farm's jobs grouped by month.
 * rows [{fieldId, name, acres, crop, cover, year, prevCover?}] (one season's plan; prevCover is last
 * season's cover on that field, ended at or before this crop's planting).
 * → [{month, year, jobs:[{kind:'plant'|'harvest'|'coverSeed'|'coverEnd', crop, fieldIds, names, acres, from, to, by, src}]}]
 * Fields with the same crop and kind are merged; months and jobs run in date order.
 */
export function jobsByMonth(rows, place) {
  const jobs = new Map();
  const add = (key, base, row) => {
    const j = jobs.get(key) ?? { ...base, fieldIds: [], names: [], acres: 0 };
    j.fieldIds.push(row.fieldId);
    j.names.push(row.name);
    j.acres += Number(row.acres) || 0;
    jobs.set(key, j);
  };
  for (const row of rows ?? []) {
    const year = Number(row.year);
    const w = windowsFor(row.crop, place);
    if (w) {
      const fallYear = w.sow.plantsFallBefore ? year - 1 : year;
      const from = w.sow.best?.from ?? w.sow.usual?.active[0] ?? null;
      const to = w.sow.best?.to ?? w.sow.usual?.active[1] ?? null;
      if (from && to) {
        const by = !w.sow.best?.from && !!w.sow.best?.to;
        const src = w.sow.best?.to ? w.sow.best.src : 'h628';
        add(`plant|${row.crop}`, { kind: 'plant', crop: row.crop, month: monthOf(from), year: fallYear, from, to, by, src }, row);
      }
      const hv = w.harvest.usual;
      if (hv?.active[0] && hv.active[1]) {
        const mid = w.harvest.recent?.p50 ?? mmddOfDay(Math.round((dayOf(hv.active[0]) + dayOf(hv.active[1])) / 2));
        add(`harvest|${row.crop}`, { kind: 'harvest', crop: row.crop, month: monthOf(mid), year, from: hv.active[0], to: hv.active[1], by: false, src: 'h628' }, row);
      }
      if (row.prevCover) {
        const c = coverFor(row.prevCover, place);
        if (c && from) add(`coverEnd|${row.prevCover}|${row.crop}`, { kind: 'coverEnd', crop: row.prevCover, before: row.crop, month: monthOf(from), year: fallYear, from, to: from, by: true, src: c.termSrc ?? c.src }, row);
      }
    }
    if (row.cover) {
      const c = coverFor(row.cover, place);
      if (c) {
        const off = offDay(w);
        const from = off && dayOf(off) > dayOf(c.seed[0]) ? off : c.seed[0];
        if (dayOf(from) <= dayOf(c.seed[1])) {
          add(`coverSeed|${row.cover}`, { kind: 'coverSeed', crop: row.cover, month: monthOf(from), year, from, to: c.seed[1], by: false, src: c.src }, row);
        }
      }
    }
  }
  const months = new Map();
  for (const j of jobs.values()) {
    const key = j.year * 100 + j.month;
    const m = months.get(key) ?? { month: j.month, year: j.year, jobs: [] };
    const { month, year, ...job } = j;
    void month; void year;
    m.jobs.push(job);
    months.set(key, m);
  }
  return [...months.entries()].sort((a, b) => a[0] - b[0]).map(([, m]) => ({
    ...m,
    jobs: m.jobs.sort((a, b) => (dayOf(a.from) - dayOf(b.from)) || JOB_ORDER[a.kind] - JOB_ORDER[b.kind]),
  }));
}
const JOB_ORDER = { coverEnd: 0, plant: 1, harvest: 2, coverSeed: 3 };
const mmddOfDay = (n) => { const d = new Date(Date.UTC(2025, 0, n)); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };

/** The tooltip's second line for a crop: 'Best sown Apr 15 – May 9' | 'Most farms plant Apr 25 – May 18' | ''. */
export function tipSubFor(cropId, place) {
  const w = windowsFor(cropId, place);
  if (!w) return '';
  const b = w.sow.best;
  if (b?.from && b.to) return `${LABEL.best} ${fmt(b.from)} – ${fmt(b.to)}`;
  if (b?.to) return `${LABEL.best} by ${fmt(b.to)}`;
  const u = w.sow.usual;
  if (u?.active[0] && u.active[1]) return `${LABEL.usual} ${fmt(u.active[0])} – ${fmt(u.active[1])}`;
  return '';
}

/**
 * The calendar's gaps for this farm (for Good to know): the bundled gaps that apply where the farm is
 * (an Iowa gap only for an Iowa farm, a Story County one only for Story County), then what is missing
 * for the place itself (no county rows, no insurance or cover dates for the state, or no dates at all).
 */
export function gapsFor(place) {
  const st = place?.state ?? null;
  const name = STATE_NAME[st] ?? st;
  const county = countyOf(place);
  const has628 = !!st && Object.values(SEASONS).some((r) => r?.[st]);
  const rows = CAL.states?.[st] ?? null;
  if (!st) return ['No state for the farm yet, so no sowing dates.'];
  if (!has628 && !rows && !county) return [`No sowing dates for ${name} yet.`];
  const applies = (g) => {
    if (/Handbook 628/.test(g)) return has628;
    const named = Object.values(CAL.counties ?? {}).find((c) => c.name && g.includes(c.name.replace(/, [A-Z]{2}$/, '')));
    if (named) return named === county;
    return Object.entries(STATE_NAME).every(([code, n]) => !g.includes(n) || code === st);
  };
  const out = (CAL.gaps ?? []).filter(applies);
  if (!county) {
    out.push(Object.values(rows ?? {}).some((r) => r?.rmaState)
      ? 'No county insurance or frost dates for this farm yet.'
      : `No insurance or frost dates for ${name} yet.`);
  }
  if (!Object.values(CAL.cover ?? {}).some((c) => c?.[st])) out.push(`No cover crop seeding dates for ${name} yet.`);
  return out;
}

/** "05-31" -> "May 31". */
export function fmt(mmdd) {
  const p = parts(mmdd);
  return p ? `${MONTHS[p.month - 1]} ${p.day}` : '';
}

/** "04-15", "05-09" -> "Apr 15 to May 9". */
export function rangeWords(a, b) {
  return `${fmt(a)} to ${fmt(b)}`;
}

/** "10-05" -> "early October" (1–10 early, 11–20 mid, 21+ late). */
export function partWords(mmdd) {
  const p = parts(mmdd);
  if (!p) return '';
  const part = p.day <= 10 ? 'early' : p.day <= 20 ? 'mid' : 'late';
  return `${part} ${MONTH_NAMES[p.month - 1]}`;
}

/** A month number as its name: 4 -> "April". */
export const monthName = (m) => MONTH_NAMES[m - 1] ?? '';
