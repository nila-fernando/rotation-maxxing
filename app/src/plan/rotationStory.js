// The rotation story of a plan: for each field, the crop each season, how it follows the one before
// (the same crop again, beans feeding the corn, a pest-cycle break, another grain), a verdict, and
// the farm-wide counts the rotation check shows. Pure (no DOM), worked out from compareFutures().
//
//   const rot = rotationOf(cmp, 'priority')     fields (in orderFields order), counts, acre split
//   rotationTiles(cmp, 'priority')              the farm's 4 tiles while the money is off
//
// Rotation first: the link between two seasons comes from the crops and the planner's own terms
// (its N credit and its "Rotation diversity" term), never from the money.
import { CROP_NAME, CROP_WORD } from './planNames.js';
import { fieldOf, kindFor, mixKind, rotationOrder, tiles, totalsOf, viewField } from './compareFutures.js';

export const LINK_KINDS = ['repeat', 'nitrogen', 'break', 'same-family'];

export const FAMILY = {
  corn: 'grass', sorghum: 'grass', 'winter-wheat': 'grass', 'spring-wheat': 'grass', oats: 'grass', barley: 'grass', 'cereal-rye': 'grass',
  soybeans: 'legume', alfalfa: 'legume', 'dry-beans': 'legume', cotton: 'other', sunflower: 'other', canola: 'other', fallow: 'none',
};

/** The small grains that can break up a corn and beans run. */
export const SMALL_GRAINS = ['winter-wheat', 'spring-wheat', 'oats', 'barley'];

const YEARS_OF = (cmp) => {
  if (Array.isArray(cmp?.years) && cmp.years.length) return cmp.years.slice(0, 3);
  const y0 = Number(cmp?.startYear) || 2027;
  return [y0, y0 + 1, y0 + 2];
};

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const shortOf = (id) => CROP_WORD[id]?.short ?? String(CROP_NAME[id] || id || '').toLowerCase();

/** How many seasons in a row the last crop of a history has grown (0 for no history). */
export function histRun(history = []) {
  const last = history[history.length - 1];
  if (last == null) return 0;
  let n = 0;
  for (let i = history.length - 1; i >= 0 && history[i] === last; i--) n++;
  return n;
}

const ROOTWORM = /rootworm/i;
const SCN_MOLD = /cyst|SCN|white mold/i;
const hasRootworm = (ws = []) => ws.some((w) => w.lens === 'pest' && ROOTWORM.test(w.reason || ''));
const hasScnMold = (ws = []) => ws.some((w) => SCN_MOLD.test(w.reason || ''));

/**
 * How a season follows the crop before it, by precedence: the same crop ('repeat'), a nitrogen
 * credit ('nitrogen'), a family or pest-cycle break ('break'), else 'same-family'. kind is null
 * when there is nothing before it (no history).
 */
export function linkOf(s, prev) {
  const base = {
    prev: prev ?? null,
    nLb: s.nLb || 0,
    nUsd: s.nCredit > 0 ? s.nCredit : 0,
    dragBu: s.drag < 0 ? -s.drag : 0,
    rootworm: hasRootworm(s.warnings),
    scnMold: hasScnMold(s.warnings),
  };
  if (!prev) return { kind: null, ...base };
  let kind;
  if (prev === s.crop) kind = 'repeat';
  else if (s.nCredit > 0) kind = 'nitrogen';
  else if (s.diversity > 0 || FAMILY[prev] !== FAMILY[s.crop]) kind = 'break';
  else kind = 'same-family';
  return { kind, ...base };
}

/** The verdict chip of a field's three seasons: { key, words }. */
export function verdictOf(history, seasons, years) {
  const last = history[history.length - 1] ?? null;
  const reps = seasons.map((s) => s.link.kind === 'repeat');
  const run = histRun(history);
  if (last && seasons.every((s) => s.crop === last)) return { key: 'keepsSame', words: `${CROP_NAME[last] || cap(shortOf(last))} every season` };
  if (reps[0] && !reps[1] && !reps[2]) return { key: 'onceMore', words: `${cap(shortOf(seasons[0].crop))} once more, then turns` };
  if (!reps.some(Boolean)) {
    if (run >= 2) return { key: 'nowTurns', words: `Was ${shortOf(last)} on ${shortOf(last)}, now turns` };
    return { key: 'alreadyTurns', words: 'Already turns' };
  }
  const y = reps.findIndex(Boolean);
  if (y >= 0) return { key: 'repeatsLater', words: `Same crop again in ${years[y]}` };
  return { key: 'turns', words: 'Turns' };
}

/** Field ids in ribbon order: changed fields by how many repeats the pick saves, unchanged ones last. */
export function orderFields(cmp) {
  return rotationOrder(cmp);
}

/** The plan a view's farm numbers come from (null for a real mix that only its score knows). */
function totalsFor(cmp, view, mixScore, choice) {
  if (view !== 'mix') return cmp.totals?.[view] ?? null;
  const k = mixKind(cmp, mixScore, choice);
  return k ? cmp.totals[k] : totalsOf(mixScore);
}

/**
 * The rotation of one view of the plans.
 * @param {object} cmp compareFutures() output
 * @param {'current'|'maxProfit'|'priority'|'mix'} view
 * @param {object} [choice] field id -> kind, for 'mix'
 * @param {object|null} [mixScore] the mix's evaluateMix score (for its soil at the end)
 */
export function rotationOf(cmp, view, choice = {}, mixScore = null) {
  const years = YEARS_OF(cmp);
  const pastYears = [years[0] - 2, years[0] - 1];
  const cmpIndex = new Map((cmp?.fields ?? []).map((f, i) => [f.id, i]));
  const fields = orderFields(cmp).map((id) => {
    const f = fieldOf(cmp, id);
    const history = [...(f.history || [])];
    const entry = viewField(cmp, id, view, choice);
    const n = history.length;
    const past = pastYears.map((year) => ({ year, crop: history[n - (years[0] - year)] ?? null })).filter((p) => p.crop);
    const seasons = entry.seasons.map((s, y) => {
      const prev = y > 0 ? entry.seasons[y - 1].crop : history[n - 1] ?? null;
      return {
        year: years[y], crop: s.crop, cover: s.cover || null, key: s.key,
        soil100: s.soil100, cash: s.cash, gmAc: s.gmAc, warnings: s.warnings || [], worst: s.worst ?? null,
        drag: s.drag ?? 0, unit: s.unit, nCredit: s.nCredit ?? 0, bareMonths: s.bareMonths ?? null, coverName: s.coverName ?? null,
        link: linkOf(s, prev),
      };
    });
    return {
      id, name: f.name, acres: f.acres, slopePct: f.slopePct ?? null, index: cmpIndex.get(id),
      kind: view === 'mix' ? kindFor(choice, id) : view,
      history, past,
      verdict: verdictOf(history, seasons, years),
      seasons,
      total: entry.total,
      diffVsCurrent: entry.total - f.byKind.current.total,
    };
  });

  const all = fields.flatMap((f) => f.seasons.map((s) => ({ s, acres: f.acres })));
  const nLbs = new Map();
  for (const { s } of all) if (s.link.kind === 'nitrogen' && s.link.nLb > 0) nLbs.set(s.link.nLb, (nLbs.get(s.link.nLb) || 0) + 1);
  const bare = all.filter(({ s }) => s.bareMonths != null);
  const bareAcres = bare.reduce((a, x) => a + x.acres, 0);
  const t = totalsFor(cmp, view, mixScore, choice);
  const counts = {
    repeats: all.filter(({ s }) => s.link.kind === 'repeat').length,
    nHandoffs: all.filter(({ s }) => s.link.kind === 'nitrogen').length,
    nLb: nLbs.size ? [...nLbs].reduce((a, b) => (b[1] > a[1] ? b : a))[0] : null,
    rootworm: all.filter(({ s }) => s.link.rootworm).length,
    scnMold: all.filter(({ s }) => s.link.scnMold).length,
    coverSeasons: all.filter(({ s }) => s.cover).length,
    bareMonthsAvg: bareAcres > 0 ? bare.reduce((a, x) => a + x.s.bareMonths * x.acres, 0) / bareAcres : null,
    endSoil100: t?.endSoil100 ?? null,
  };

  const split = years.map((year, y) => {
    const raw = {};
    for (const f of fields) raw[f.seasons[y].crop] = (raw[f.seasons[y].crop] || 0) + f.acres;
    const byCrop = Object.fromEntries(Object.entries(raw).sort((a, b) => b[1] - a[1]).map(([c, a]) => [c, Math.round(a)]));
    return { year, byCrop, total: Math.round(Object.values(raw).reduce((a, b) => a + b, 0)) };
  });

  return { view, years, pastYears, fields, counts, split };
}

/**
 * The 4 farm tiles while the money is off: same crop again and corn after beans (with keeping
 * going's count as `base`), then the soil at the end and the cash (with their difference from
 * keeping going, as tiles() has them).
 */
export function rotationTiles(cmp, view, mixScore, choice) {
  const rot = rotationOf(cmp, view, choice || {}, mixScore);
  const base = view === 'current' ? rot : rotationOf(cmp, 'current');
  const t = tiles(cmp, view, mixScore, choice);
  return [
    { key: 'repeats', value: rot.counts.repeats, base: base.counts.repeats },
    { key: 'handoffs', value: rot.counts.nHandoffs, base: base.counts.nHandoffs },
    { key: 'soil', value: t[2].value, diff: t[2].diff },
    { key: 'cash', value: t[0].value, diff: t[0].diff },
  ];
}

const LINK_LABEL = {
  repeat: 'Same crop again',
  nitrogen: 'Beans feed the corn',
  break: 'Breaks a pest cycle',
  'same-family': 'Another grain',
  cover: 'Winter cover',
};

/** The legend words for a link kind (or 'cover'); { generic: true } for a nitrogen link that isn't corn after beans. */
export function linkLabel(kind, { generic = false } = {}) {
  if (kind === 'nitrogen' && generic) return 'Nitrogen from the crop before';
  return LINK_LABEL[kind] ?? '';
}
