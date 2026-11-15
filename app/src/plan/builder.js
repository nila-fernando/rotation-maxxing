// The farmer's own plan, cell by cell (roadmap 4.2): editing, and the planner's instant rule checks.
// Pure data, no DOM: src/screens/planBuilder.js draws it.
//
// A plan is the planner's shape: { sequences: { fieldId: [{ main, cover? }, x3] } }, main may be
// null while it's being built. Warnings come from the planner's checkPlacement (rules only, well under
// a millisecond each): { lens, severity 1 note | 2 careful | 3 avoid, reason }.
import { checkPlacement } from '../vendor/rotation-maxxing/algorithm/placement.ts';
import { prepareFarm } from '../vendor/rotation-maxxing/algorithm/geometry.ts';
import { handoff } from './cropCalendar.js';
import { handoffLine } from './calendarVoice.js';

export const SEASONS = 3;
export const LENS_LABEL = { nitrogen: 'Nitrogen', pest: 'Pests', water: 'Water', erosion: 'Erosion', repeat: 'Repeat', shade: 'Shade', market: 'Market', land: 'Land', frost: 'Frost', timing: 'Timing' };
export const SEVERITY_LABEL = { 1: 'Note', 2: 'Careful', 3: 'Avoid' };

/** A plan with every season empty. */
export function emptyPlan(farm) {
  return { sequences: Object.fromEntries(farm.paddocks.map((p) => [p.id, Array.from({ length: SEASONS }, () => ({ main: null }))])) };
}

/**
 * A copy of a plan on this farm: every field and season (missing ones empty), and any crop the
 * field can no longer grow (the farmer has since ruled it out) emptied.
 */
export function copyPlan(plan, farm) {
  const out = emptyPlan(farm);
  for (const p of farm.paddocks) {
    const seq = plan?.sequences?.[p.id] || [];
    const ok = (c) => c === 'fallow' || p.availableCrops.includes(c);
    out.sequences[p.id] = out.sequences[p.id].map((cell, y) => {
      const s = seq[y];
      if (!s?.main || !ok(s.main)) return cell;
      return { main: s.main, ...(s.cover && p.availableCrops.includes(s.cover) ? { cover: s.cover } : {}) };
    });
  }
  return out;
}

/** A new plan with one season set (crop null clears it; a cleared or fallow season loses its cover). */
export function setCell(plan, fieldId, year, crop) {
  const seq = plan.sequences[fieldId].map((c) => ({ ...c }));
  const keepCover = crop && crop !== 'fallow' && seq[year].cover;
  seq[year] = { main: crop || null, ...(keepCover ? { cover: seq[year].cover } : {}) };
  return { sequences: { ...plan.sequences, [fieldId]: seq } };
}

/** A new plan with a winter cover crop after a season added or taken off. */
export function setCover(plan, fieldId, year, cover) {
  const seq = plan.sequences[fieldId].map((c) => ({ ...c }));
  const { cover: _drop, ...rest } = seq[year];
  seq[year] = cover && rest.main && rest.main !== 'fallow' ? { ...rest, cover } : rest;
  return { sequences: { ...plan.sequences, [fieldId]: seq } };
}

/** Whether every season of every field has a crop (the planner can only score a full plan). */
export function isComplete(plan, farm) {
  return farm.paddocks.every((p) => plan.sequences[p.id]?.length === SEASONS && plan.sequences[p.id].every((c) => !!c.main));
}

/** How many seasons are still empty. */
export function emptyCount(plan, farm) {
  return farm.paddocks.reduce((n, p) => n + plan.sequences[p.id].filter((c) => !c.main).length, 0);
}

/**
 * Checks a farm once and returns a checker for it:
 *   at(plan, fieldId, year, crop)  warnings for putting crop there (the rest of the plan as is)
 *   all(plan)                      Map 'fieldId:year' -> warnings, for every filled season
 */
export function createChecker(farm, market, { timing = null } = {}) {
  const prepared = prepareFarm(farm);
  const known = new Set(farm.paddocks.flatMap((p) => p.availableCrops));
  const timingAt = timing ? timingCheck(farm, timing) : null;
  const at = (plan, fieldId, year, crop) => {
    if (!crop) return [];
    let out;
    try {
      out = checkPlacement(prepared, plan, fieldId, year, crop, { market });
    } catch (e) {
      // a crop the planner doesn't know (it shouldn't be offered, but never let a check crash the grid)
      return known.has(crop) ? [{ lens: 'land', severity: 3, reason: e.message }] : [];
    }
    const t = timingAt?.(plan, fieldId, year, crop);
    return t ? [...out, t] : out;
  };
  const all = (plan) => {
    const out = new Map();
    for (const p of farm.paddocks) {
      plan.sequences[p.id].forEach((c, y) => { if (c.main) out.set(`${p.id}:${y}`, at(plan, p.id, y, c.main)); });
    }
    return out;
  };
  return { at, all };
}

/**
 * The app's own timing lens (opt-in: createChecker(farm, market, { timing: place }), place from
 * cropCalendar.placeOf): whether the crop before comes off in time to sow this one. A clash is
 * Careful (2), tight is a Note (1); the reason is Manami's handoff line. The vendored planner's
 * checks are untouched, and compareFutures doesn't pass it, so the plans' own warnings don't move.
 */
function timingCheck(farm, place) {
  const byId = new Map(farm.paddocks.map((p) => [p.id, p]));
  const YEAR = 2001; // only the months and days matter
  return (plan, fieldId, year, crop) => {
    const prev = year > 0 ? plan.sequences[fieldId]?.[year - 1]?.main : byId.get(fieldId)?.history?.at(-1);
    if (!prev || prev === crop) return null;
    const h = handoff(prev, crop, YEAR + year, place);
    if (h.fit !== 'clash' && h.fit !== 'tight') return null;
    const betterAfter = h.fit === 'clash' ? (['soybeans', 'oats', 'corn'].find((c) => c !== prev && handoff(c, crop, YEAR + year, place).fit === 'ok') ?? null) : null;
    return { lens: 'timing', severity: h.fit === 'clash' ? 2 : 1, reason: handoffLine(h, { prev, next: crop, betterAfter }), fit: h.fit };
  };
}

/** The worst severity in a list of warnings (0 for none). */
export const worst = (warnings) => warnings.reduce((m, w) => Math.max(m, w.severity), 0);

/** "1 to avoid, 2 careful, 3 notes" for a list of warnings ('' for none). */
export function summarise(warnings) {
  const say = { 3: (k) => `${k} to avoid`, 2: (k) => `${k} careful`, 1: (k) => `${k} ${k === 1 ? 'note' : 'notes'}` };
  return [3, 2, 1].map((s) => [s, warnings.filter((w) => w.severity === s).length]).filter(([, k]) => k).map(([s, k]) => say[s](k)).join(', ');
}
