// The farm's season reports: how each season really went, field by field, and what the planner learns
// from them (src/vendor/rotation-maxxing/algorithm/update.ts: plan -> season -> report -> learn -> re-plan).
//
//   A report: { v: 1, season: 2026, savedAt, fields: { [fieldId]: { crop, yield, events, notes } } }
//     crop    the app crop key actually grown (src/island/crops.js), or null (not sure)
//     yield   harvested yield per acre in the crop's unit (bu, ton, lb; unitFor), or null (don't know)
//     events  what went wrong: drought, flood, hail, pest, disease, replant, other (SEASON_EVENTS)
//     notes   the farmer's own words (kept, shown to Ask Manami; the planner doesn't read them)
//
// What the planner learns, per field and crop: reported yield vs what it expected for that season's
// real weather (NASA POWER), damped so one odd year can't swing the plans; seasons with hail, a flood
// or a replant aren't learned from. The season's crop joins the field's history, and its weather joins
// the pool of years the plans are tried against.
//
// Pure: no DOM, no network.

import { CROP_BY_ID } from '../vendor/rotation-maxxing/algorithm/croptraits.ts';
import { CROP_STYLE } from '../island/crops.js';
import { PLANNER_CROP } from './farmInput.js';
import { applyCropEdits } from '../fields/cropEdits.js';

export const REPORT_VERSION = 1;

/** What can go wrong in a season, in plain words (keys are the planner's SeasonEvent ids). */
export const SEASON_EVENTS = [
  { key: 'drought', label: 'Too dry' },
  { key: 'flood', label: 'Too wet or flooded' },
  { key: 'hail', label: 'Hail' },
  { key: 'pest', label: 'Pests' },
  { key: 'disease', label: 'Disease' },
  { key: 'replant', label: 'Had to replant' },
  { key: 'other', label: 'Something else' },
];
const EVENT_KEYS = new Set(SEASON_EVENTS.map((e) => e.key));
// (the planner leaves these seasons out of its yield learning: the yield says more about the storm)
const ONE_OFF = new Set(['hail', 'flood', 'replant']);

/** The latest season whose harvest is in: this year's from November on, else last year's. */
export function lastFinishedSeason(today = new Date()) {
  return today.getMonth() >= 10 ? today.getFullYear() : today.getFullYear() - 1;
}

/** The newest year on record for any field, not counting years the farmer reported. */
function lastRecordedYear(fields, reported) {
  let last = null;
  for (const f of fields || []) {
    for (const [y, c] of Object.entries(f.crops || {})) {
      const year = Number(y);
      if (c != null && !reported.has(year) && (last == null || year > last)) last = year;
    }
  }
  return last;
}

/**
 * The seasons that can be reported now, oldest first: from the year after the newest crop on record
 * up to the last finished season (at most the last three), leaving out ones already reported.
 */
export function seasonsDue(today, fields, reports = []) {
  const done = new Set((reports || []).map((r) => r.season));
  const to = lastFinishedSeason(today);
  const last = lastRecordedYear(fields, done);
  const from = Math.max(last == null ? to : last + 1, to - 2);
  const out = [];
  for (let y = from; y <= to; y++) if (!done.has(y)) out.push(y);
  return out;
}

/** The seasons the farmer may fill in (due ones, and ones already reported, to change them). */
export function seasonsOpen(today, fields, reports = []) {
  return [...new Set([...seasonsDue(today, fields, reports), ...(reports || []).map((r) => r.season)])].sort((a, b) => a - b);
}

/** The unit a crop's yield is reported in: 'bu', 'ton', 'lb' (null when the planner has no unit). */
export function unitFor(cropKey) {
  return CROP_BY_ID[PLANNER_CROP[cropKey]]?.yieldUnit ?? null;
}
/** "bu an acre", "tons an acre", "lb an acre". */
export const unitWords = (unit) => (unit === 'ton' ? 'tons an acre' : unit ? `${unit} an acre` : '');
/** A yield the form accepts for a unit (anything above is a typo, not a harvest). */
const MAX_YIELD = { bu: 600, ton: 30, lb: 12000, cwt: 1000 };
export function yieldOk(value, unit) {
  return Number.isFinite(value) && value > 0 && value <= (MAX_YIELD[unit] ?? 10000);
}

/**
 * A report as stored, cleaned: known crops and events only, yields as numbers within range, notes
 * trimmed. Returns null when it isn't a report.
 */
export function normalizeReport(raw, { fieldIds = null, now = new Date() } = {}) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.season)) return null;
  const fields = {};
  for (const [id, r] of Object.entries(raw.fields || {})) {
    if (fieldIds && !fieldIds.has(id)) continue;
    if (!r || typeof r !== 'object') continue;
    const crop = CROP_STYLE[r.crop] ? r.crop : null;
    const unit = crop ? unitFor(crop) : null;
    const y = r.yield == null || r.yield === '' ? null : Number(r.yield);
    fields[id] = {
      crop,
      yield: crop && unit && yieldOk(y, unit) ? Math.round(y * 10) / 10 : null,
      events: [...new Set((r.events || []).filter((e) => EVENT_KEYS.has(e)))],
      notes: String(r.notes || '').replace(/\s+/g, ' ').trim().slice(0, 280),
    };
  }
  return { v: REPORT_VERSION, season: raw.season, savedAt: raw.savedAt || now.toISOString(), fields };
}

/** Reports, cleaned, one per season (the newest save wins), oldest first. */
export function cleanReports(list, opts) {
  const bySeason = new Map();
  for (const r of list || []) {
    const n = normalizeReport(r, opts);
    if (!n) continue;
    const had = bySeason.get(n.season);
    if (!had || had.savedAt <= n.savedAt) bySeason.set(n.season, n);
  }
  return [...bySeason.values()].sort((a, b) => a.season - b.season);
}

/**
 * The reports the planner learns from: its SeasonReport shape, crops as planner ids. Only the run of
 * consecutive seasons ending at the newest counts (the planner learns season by season, in order).
 * A field whose crop the planner doesn't know (hay, pasture...) or that's "not sure" is left out.
 */
export function plannerReports(reports) {
  const sorted = cleanReports(reports);
  const run = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (run.length && sorted[i].season !== run[0].season - 1) break;
    run.unshift(sorted[i]);
  }
  return run.map((r) => ({
    season: r.season,
    paddocks: Object.entries(r.fields)
      .filter(([, f]) => f.crop && PLANNER_CROP[f.crop])
      .map(([id, f]) => ({
        paddockId: id,
        cropId: PLANNER_CROP[f.crop],
        ...(f.yield != null ? { yieldPerAcre: f.yield } : {}),
        ...(f.events.length ? { events: f.events } : {}),
      })),
  }));
}

/** The fields as they stood before `season`: crop years from it on taken off (for replaying reports). */
export function fieldsBefore(fields, season) {
  return (fields || []).map((f) => {
    if (!f.crops) return f;
    const crops = Object.fromEntries(Object.entries(f.crops).filter(([y]) => Number(y) < season));
    return { ...f, crops };
  });
}

/** The fields with a report's crops as their crop history for that season (the farmer's own years). */
export function withReportCrops(fields, report) {
  if (!report) return fields;
  return (fields || []).map((f) => {
    const r = report.fields?.[f.id];
    if (!r?.crop || f.crops?.[report.season] === CROP_STYLE[r.crop]?.label) return f;
    return applyCropEdits(f, { [report.season]: r.crop });
  });
}

const pct = (x) => Math.round(Math.abs(x) * 100);
const cropWord = (cropId) => {
  const key = Object.entries(PLANNER_CROP).find(([, id]) => id === cropId)?.[0];
  return (CROP_STYLE[key]?.label || CROP_BY_ID[cropId]?.name || cropId).toLowerCase();
};
const num = (x) => (x >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10));

/**
 * Manami's words on what a season taught her, one line per field (from the planner's log entry:
 * { season, calibration: [{ paddockId, cropId, predicted, reported, factorAfter, used }] }).
 * names: Map id -> field name. events: { [fieldId]: [event keys] } from the report.
 */
export function assessmentLines(entry, { names = new Map(), events = {} } = {}) {
  if (!entry?.calibration?.length) return [];
  return entry.calibration.map((c) => {
    const name = names.get(c.paddockId) || 'This field';
    const crop = cropWord(c.cropId);
    const unit = CROP_BY_ID[c.cropId]?.yieldUnit;
    const u = unit === 'ton' ? 'tons' : unit || '';
    const ev = (events[c.paddockId] || []).filter((e) => ONE_OFF.has(e));
    if (c.reported == null) return `${name}: ${crop} in ${entry.season}. No yield, so I only noted the crop.`;
    if (c.predicted == null || !(c.predicted > 0)) return `${name}: ${crop} came in at ${num(c.reported)} ${u}. I can’t compare it with my numbers for this crop yet.`;
    const diff = c.reported / c.predicted - 1;
    const said = `${name}: ${crop} came in at ${num(c.reported)} ${u}, against the ${num(c.predicted)} I expected for that weather`;
    if (!c.used) {
      const why = ev.length ? ev.map((e) => SEASON_EVENTS.find((x) => x.key === e)?.label.toLowerCase()).join(' and ') : 'a one-off';
      return `${said}. With ${why} that year, I won’t read much into it.`;
    }
    if (Math.abs(diff) < 0.04) return `${said}. Right on, so I’ll keep counting on that.`;
    const f = c.factorAfter != null ? c.factorAfter - 1 : diff;
    const lean = Math.abs(f) < 0.01 ? 'only a touch' : `about ${pct(f)}%`;
    return diff > 0
      ? `${said}, ${pct(diff)}% better. I’ll count on ${lean} more from its ${crop} from now on.`
      : `${said}, ${pct(diff)}% short. I’ll count on ${lean} less from its ${crop} until it shows me otherwise.`;
  });
}

/** One line for the plans: what they were tuned with ("I tuned these plans with your 2026 season."). */
export function tunedLine(seasons) {
  const ys = (seasons || []).map((s) => s.season ?? s).filter(Number.isInteger).sort((a, b) => a - b);
  if (!ys.length) return null;
  const which = ys.length === 1 ? `your ${ys[0]} season` : `your ${ys[0]} to ${ys[ys.length - 1]} seasons`;
  return `I tuned these plans with ${which}: what each field really yielded, against that year’s weather.`;
}
