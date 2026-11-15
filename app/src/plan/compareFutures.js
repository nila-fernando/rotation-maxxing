// The three plans side by side, field by field and season by season, for "See them on the farm"
// (src/screens/planFutures.js): what each field grows, earns and risks on each plan, what changes
// against keeping going, how many coins each field gets, and the stops of Manami's short walk.
//
//   const cmp = compareFutures(plansPanel.data, { startYear: 2027 })
//   viewField(cmp, 'f2', 'priority')            the field's 3 seasons on that plan
//   seasonChanges(cmp, 'priority')              [Map id -> 'crop'|'margin'] x 3
//   coinPlan(cmp).countsFor('mix', choice)      Map id -> coins
//   reelStops(cmp)                              the walk, in order
//   frostIds(cmp, 'priority', 1)                Set of ids whose wheat has a spring freeze that season
//
// Pure data, no DOM, so node:test runs it on a real planner result. The numbers per field and
// season are the planner's own deterministic ones (mean weather, mean prices); the farm totals
// (expectedGM, the bad year, beats keeping going) are its Monte Carlo ones, which only exist for
// the whole farm. Only the lazy plan views import this (it pulls in the planner's rule checks).
import { createChecker, worst } from './builder.js';
import { APP_CROP } from './farmInput.js';
import { freezeOf, frostWarning } from './weatherWords.js';

/** The three whole plans, in the order they are shown. A fourth view, 'mix', is the farmer's pick per field. */
export const KINDS = ['current', 'maxProfit', 'priority'];
const SEASONS = [0, 1, 2];

/** Which plan a field is on in the mix (Manami's pick until the farmer picks). */
export const kindFor = (choice, id) => (KINDS.includes(choice?.[id]) ? choice[id] : 'priority');

/** The plan the farmer has picked field by field, in the planner's Plan shape. Never changes its inputs. */
export function mixedPlan(plans, choice) {
  const sequences = {};
  for (const p of plans.priority.paddocks) {
    const kind = kindFor(choice, p.paddockId);
    sequences[p.paddockId] = plans[kind].plan.sequences[p.paddockId].map((c) => ({ ...c }));
  }
  return { sequences };
}

/**
 * The parts of a season's numbers that only live in the planner's term labels:
 * N credit ($/ac), yield drag (bu/ac, negative), cover crop cost ($/ac, negative) and name,
 * ground cover (0-1) with bare and covered months, and water used, short and wanted (inches).
 */
export function termsOf(year) {
  const out = { nCredit: 0, drag: 0, coverCost: 0, coverName: null, groundCover: null, bareMonths: null, coverMonths: 0, water: null, waterShort: 0, waterDemand: null };
  for (const t of year?.terms || []) {
    const label = String(t.label || '');
    let m;
    if (/^N credit from/.test(label)) out.nCredit += t.value;
    else if (/yield drag$/.test(label)) out.drag += t.value;
    else if ((m = /^Winter cover crop: (.+?) \(/.exec(label))) { out.coverCost += t.value; out.coverName = m[1]; }
    else if (/^Ground cover:/.test(label)) {
      out.groundCover = t.value;
      const bare = /(\d+) bare month/.exec(label);
      const covered = /winter cover crop for (\d+) months/.exec(label);
      if (bare) out.bareMonths = Number(bare[1]);
      if (covered) out.coverMonths = Number(covered[1]);
    } else if ((m = /^Water used: ([\d.]+) in crop ET(?: \(([\d.]+) in short of ([\d.]+) in demand\))?/.exec(label))) {
      out.water = Number(m[1]);
      if (m[2]) { out.waterShort = Number(m[2]); out.waterDemand = Number(m[3]); }
    }
  }
  return out;
}

/** A plan result's farm numbers in the shape the tiles use (also for the mix's evaluateMix score). */
export function totalsOf(p) {
  if (!p) return null;
  return {
    expectedGM: p.expectedGM,
    p10GM: p.p10GM,
    probBeatsCurrent: p.probBeatsCurrent ?? null,
    endSoil100: Math.round((p.endSoilHealth ?? p.soilHealth ?? 0) * 100),
    avgSoil100: Math.round((p.soilHealth ?? 0) * 100),
    nCarried: p.nitrogenCarriedForward ?? 0,
    waterUse: p.waterUse ?? null,
  };
}

// the rule checker for each comparison, and the last mix's warnings (kept off the plain data)
const checkers = new WeakMap();
const mixCache = new WeakMap();

/**
 * @param {object} data   the plans panel's data: { result, weather, gaps, farm, market }
 * @param {{startYear: number}} o   the first planned season (2027)
 */
export function compareFutures(data, { startYear } = {}) {
  const y0 = Number(startYear);
  if (!Number.isFinite(y0)) throw new Error('compareFutures needs the first season (startYear)');
  const plans = data.result.plans;
  const checker = createChecker(data.farm, data.market);
  const warnings = Object.fromEntries(KINDS.map((k) => [k, checker.all(plans[k].plan)]));
  const farmById = new Map(data.farm.paddocks.map((p) => [p.id, p]));

  const fields = plans.priority.paddocks.map((pd) => {
    const id = pd.paddockId;
    const farmP = farmById.get(id) || {};
    const history = farmP.history || [];
    const byKind = {};
    for (const kind of KINDS) {
      const slots = plans[kind].plan.sequences[id];
      const years = plans[kind].paddocks.find((p) => p.paddockId === id).years;
      const seq = slots.map((s) => ({ main: s.main, cover: s.cover || null, key: APP_CROP[s.main] || 'other' }));
      const seasons = SEASONS.map((y) => {
        const yr = years[y];
        // the planner's spring freeze on wheat lives in the season's terms, not its rule checks
        const freeze = freezeOf(yr.terms, yr.yieldPerAcre);
        const fw = frostWarning(freeze);
        const w = [...(warnings[kind].get(`${id}:${y}`) || []), ...(fw ? [fw] : [])];
        return {
          crop: seq[y].main, cover: seq[y].cover, key: seq[y].key,
          gmAc: yr.grossMarginPerAcre, cash: yr.grossMarginPerAcre * pd.acres,
          yield: yr.yieldPerAcre, unit: yr.yieldUnit,
          soil: yr.soilHealthIndex, soil100: Math.round(yr.soilHealthIndex * 100),
          ...termsOf(yr),
          freeze,
          warnings: w, worst: worst(w),
        };
      });
      byKind[kind] = { kind, seq, seasons, total: seasons.reduce((a, s) => a + s.cash, 0) };
    }
    return {
      id, name: pd.name, acres: pd.acres,
      slopePct: farmP.land?.slopePct ?? null,
      history,
      isRepeat0: !!history.length && byKind.current.seq[0].main === history[history.length - 1],
      byKind,
      diff: { maxProfit: byKind.maxProfit.total - byKind.current.total, priority: byKind.priority.total - byKind.current.total },
    };
  });

  const totals = Object.fromEntries(KINDS.map((k) => [k, totalsOf(plans[k])]));
  const seasonCash = Object.fromEntries(KINDS.map((k) => [k, SEASONS.map((y) => fields.reduce((a, f) => a + f.byKind[k].seasons[y].cash, 0))]));

  const cmp = {
    years: SEASONS.map((y) => y0 + y),
    fields,
    totals,
    seasonCash,
    price: priceOf(data.result.priceOfPriorities),
    weights: weightsOf(plans.priority.objectiveTerms, data.priorities),
    notes: notesOf(data, plans, fields),
    raw: Object.fromEntries(KINDS.map((k) => [k, rawOf(plans[k])])),
    gaps: [...(data.gaps || [])],
    weather: weatherOf(data.weather),
    // whether water is what limits the crops here (the same on every plan), and the farm facts the
    // weather lines need: the state (the freeze rule is a Kansas one) and whether it is all watered
    weatherRisk: plans.priority.weatherRisk ?? null,
    facts: { state: data.farm.state ?? null, irrigated: data.farm.constraints?.irrigation === 'irrigated' },
  };
  // whether the two plans are the same crops (then the pick costs nothing, whatever the rounding),
  // and whether the water numbers are inches (only with real daily weather; else a crop-water index)
  cmp.price.samePlan = samePlans(cmp, 'maxProfit', 'priority');
  cmp.price.waterInches = cmp.weather.years >= 2;
  checkers.set(cmp, { checker, plans });
  return cmp;
}

/** The price of the farmer's priorities: what the pick gives up next to the most-profit plan. */
function priceOf(pop = {}) {
  const term = (re) => (pop.terms || []).find((t) => re.test(t.label))?.value;
  return {
    cash: term(/^Cash margin given up/) ?? 0, // negative: cash given up
    nCarried: term(/^Change in nitrogen carried forward/) ?? 0, // negative: less nitrogen left
    p10: term(/^Bad-year \(P10\)/) ?? pop.p10Change ?? 0, // positive: a bad year is better
    soilAvgPts: (pop.soilHealthGain ?? 0) * 100,
    waterIn: -(pop.waterUseReduction ?? 0), // positive: the pick uses more water
    profitCost: pop.profitCost ?? 0,
    summary: pop.summary || '',
  };
}

const WEIGHT_KEY = { Profit: 'profit', 'Soil health': 'soilHealth', Water: 'water' };

// the planner's priorities ({ profit, soilHealth, water, risk }, 0-100, 50 neutral) -> the farmer's first pick
function firstAsk(prio) {
  const top = ['profit', 'soilHealth', 'water', 'risk'].map((k) => [k, prio?.[k] ?? 0]).sort((a, b) => b[1] - a[1])[0];
  return top[1] > 50 ? top[0] : null;
}

/**
 * The say each priority got, from the planner's objective terms ("…, weight 68%"), and `asked`:
 * what the farmer put first (from the planner's priorities; null when unknown).
 */
function weightsOf(terms = [], priorities = null) {
  const pcts = {};
  let waterPlentiful = false;
  for (const t of terms) {
    const m = /^(Profit|Soil health|Water)\b.*weight (\d+)%/.exec(t.label || '');
    if (m) pcts[WEIGHT_KEY[m[1]]] = Number(m[2]);
    if (/^Water is plentiful/.test(t.label || '')) waterPlentiful = true;
  }
  const order = Object.entries(pcts).sort((a, b) => b[1] - a[1]);
  const second = order[1]?.[1] > 0 ? order[1] : null;
  return { top: order[0]?.[0] ?? null, topPct: order[0]?.[1] ?? 0, second: second?.[0] ?? null, secondPct: second?.[1] ?? 0, pcts, waterPlentiful, asked: firstAsk(priorities) };
}

function rawOf(p) {
  return { reasons: [...(p?.reasons || [])], risks: [...(p?.risks || [])], informationGaps: [...(p?.informationGaps || [])], localReview: [...(p?.localReview || [])] };
}

/** Field names that belong to one field only (a name two fields share can't be tied to either). */
export function idsByName(fields) {
  const count = new Map();
  for (const f of fields) count.set(f.name, (count.get(f.name) || 0) + 1);
  return new Map(fields.filter((f) => count.get(f.name) === 1).map((f) => [f.name, f.id]));
}

/** The gaps and local-review notes, split into the ones about one field and the farm-wide rest. */
function notesOf(data, plans, fields) {
  const byName = idsByName(fields);
  const names = [...byName.keys()].sort((a, b) => b.length - a.length); // "West 140" before "West"
  const byField = Object.fromEntries(fields.map((f) => [f.id, { gaps: [], review: [] }]));
  const union = (key) => [...new Set(KINDS.flatMap((k) => plans[k][key] || []))];
  const farm = { gaps: [], informationGaps: union('informationGaps'), localReview: [] };
  for (const g of data.gaps || []) {
    const name = names.find((n) => g.startsWith(`${n}: `));
    if (name) byField[byName.get(name)].gaps.push(g);
    else farm.gaps.push(g);
  }
  for (const r of union('localReview')) {
    const name = names.find((n) => r.startsWith(`${n} `) || r.startsWith(`${n}: `));
    if (name) byField[byName.get(name)].review.push(r);
    else farm.localReview.push(r);
  }
  return { byField, farm };
}

function weatherOf(w = {}) {
  const m = /weather for (.+?) \(/.exec(w.source || '');
  return { source: w.source || '', years: w.years ?? 0, place: m ? m[1] : null, fallback: !!w.fallback };
}

export const fieldOf = (cmp, id) => cmp.fields.find((f) => f.id === id) || null;

/** The field's entry for a view, without re-running the rule checks (crops and numbers only). */
function entryFor(f, view, choice) {
  return f.byKind[view === 'mix' ? kindFor(choice, f.id) : view];
}

/** Whether the farmer's picks all name one plan (which one, or null for a real mix). */
export function uniformKind(cmp, choice) {
  const kinds = new Set(cmp.fields.map((f) => kindFor(choice, f.id)));
  return kinds.size === 1 ? [...kinds][0] : null;
}

/**
 * The one whole plan the mix amounts to, or null when only its evaluateMix score can say. With a
 * choice, the choice decides (every field on one plan: that plan); with none, a score is the mix's
 * and no score means nothing has been picked yet (Manami's pick).
 */
export function mixKind(cmp, mixScore, choice) {
  if (choice) return uniformKind(cmp, choice);
  return mixScore ? null : 'priority';
}

/**
 * The rule warnings for every season of the mixed plan (a neighbour's crop can change them), or
 * null for a copied comparison (structuredClone in the tests), which has no checker of its own.
 */
function mixWarnings(cmp, choice) {
  const key = JSON.stringify(cmp.fields.map((f) => kindFor(choice, f.id)));
  const hit = mixCache.get(cmp);
  if (hit?.key === key) return hit.map;
  if (!checkers.has(cmp)) return null;
  const { checker, plans } = checkers.get(cmp);
  const map = checker.all(mixedPlan(plans, choice));
  mixCache.set(cmp, { key, map });
  return map;
}

/**
 * What to show for a field in a view: { kind, seq, seasons, total }. For the mix it is the picked
 * plan's entry, with the warnings checked again on the mixed plan (and the freeze added back: it
 * comes from the season's own weather, not from the neighbours).
 */
export function viewField(cmp, id, view, choice) {
  const f = fieldOf(cmp, id);
  if (!f) return null;
  if (view !== 'mix') return f.byKind[view];
  const base = entryFor(f, view, choice);
  const ws = mixWarnings(cmp, choice);
  if (!ws) return base;
  return {
    ...base,
    seasons: base.seasons.map((s, y) => {
      const fw = frostWarning(s.freeze);
      const w = [...(ws.get(`${id}:${y}`) || []), ...(fw ? [fw] : [])];
      return { ...s, warnings: w, worst: worst(w) };
    }),
  };
}

/** Whether two seasons grow the same main crop and the same cover. */
export const sameCrops = (a, b) => a.crop === b.crop && (a.cover || null) === (b.cover || null);

/**
 * Per season, the fields that differ from `base`: 'crop' when the main crop or the cover differs,
 * 'margin' when the crops are the same but the cash an acre moves by $5 or more.
 */
export function seasonChanges(cmp, view, choice, base = 'current') {
  return SEASONS.map((y) => {
    const out = new Map();
    for (const f of cmp.fields) {
      const a = entryFor(f, view, choice).seasons[y];
      const b = entryFor(f, base, choice).seasons[y];
      if (!sameCrops(a, b)) out.set(f.id, 'crop');
      else if (Math.abs(a.gmAc - b.gmAc) >= 5) out.set(f.id, 'margin');
    }
    return out;
  });
}

/** The whole farm's cash margin in each season for a view: [3]. */
export function seasonCashFor(cmp, view, choice) {
  if (view !== 'mix') return cmp.seasonCash[view];
  return SEASONS.map((y) => cmp.fields.reduce((a, f) => a + entryFor(f, view, choice).seasons[y].cash, 0));
}

/** Whether two whole plans grow the same crops everywhere. */
export function samePlans(cmp, a, b) {
  return cmp.fields.every((f) => f.byKind[a].seasons.every((s, y) => sameCrops(s, f.byKind[b].seasons[y])));
}

/** Whether a field grows the same crops on all three plans. */
export const sameEverywhere = (f) => KINDS.every((k) => f.byKind[k].seasons.every((s, y) => sameCrops(s, f.byKind.current.seasons[y])));

const COIN_STEPS = [1e3, 2e3, 2.5e3, 5e3, 1e4, 2e4, 2.5e4, 5e4, 1e5, 2e5, 2.5e5, 5e5, 1e6];

/**
 * The coin stacks: each coin is worth `value` (a round step, so the biggest field fits in `max`
 * coins on any plan), and each field gets round(3-season cash / value) coins, 0 to max.
 */
export function coinPlan(cmp, { max = 12 } = {}) {
  const top = Math.max(0, ...cmp.fields.flatMap((f) => KINDS.map((k) => f.byKind[k].total)));
  const value = COIN_STEPS.find((s) => s >= top / max) ?? COIN_STEPS[COIN_STEPS.length - 1];
  const count = (total) => (total > 0 ? Math.max(0, Math.min(max, Math.round(total / value))) : 0);
  const counts = Object.fromEntries(KINDS.map((k) => [k, new Map(cmp.fields.map((f) => [f.id, count(f.byKind[k].total)]))]));
  const countsFor = (view, choice) => (view === 'mix'
    ? new Map(cmp.fields.map((f) => [f.id, counts[kindFor(choice, f.id)].get(f.id)]))
    : counts[view]);
  return { value, max, counts, countsFor };
}

/**
 * The 4 tiles' numbers for a view: cash margin, a bad year, soil at the end, beats keeping going,
 * each with its difference from keeping going. The mix uses its evaluateMix score (or, when every
 * field is on one plan, that plan's); with neither yet, the values are null (still working).
 */
export function tiles(cmp, view, mixScore, choice) {
  const cur = cmp.totals.current;
  let t;
  if (view === 'mix') {
    const k = mixKind(cmp, mixScore, choice);
    t = k ? cmp.totals[k] : totalsOf(mixScore);
  } else t = cmp.totals[view];
  const diff = (a, b) => (t ? a - b : null);
  return [
    { key: 'cash', value: t?.expectedGM ?? null, diff: diff(t?.expectedGM, cur.expectedGM) },
    { key: 'badYear', value: t?.p10GM ?? null, diff: diff(t?.p10GM, cur.p10GM) },
    { key: 'soil', value: t?.endSoil100 ?? null, diff: diff(t?.endSoil100, cur.endSoil100) },
    { key: 'beats', value: t && t.probBeatsCurrent != null ? Math.round(t.probBeatsCurrent * 100) : null, diff: null },
  ];
}

// when a season has several warnings of its worst severity, the one to lead with
const LENS_ORDER = ['pest', 'erosion', 'land', 'water', 'frost', 'market', 'repeat', 'shade', 'nitrogen'];

/** The warning to lead with: the worst, and among those the most telling lens. */
export function headline(warnings) {
  const w = worst(warnings);
  if (!w) return null;
  const top = warnings.filter((x) => x.severity === w);
  const rank = (x) => { const i = LENS_ORDER.indexOf(x.lens); return i < 0 ? LENS_ORDER.length : i; };
  return top.reduce((a, b) => (rank(b) < rank(a) ? b : a));
}

/** The fields with something to watch in a season: { id, worst, lens, count, warnings }. */
export function flagsFor(cmp, view, choice, season) {
  return cmp.fields.map((f) => {
    const s = viewField(cmp, f.id, view, choice).seasons[season];
    if (!s.worst) return null;
    return { id: f.id, worst: s.worst, lens: headline(s.warnings).lens, count: s.warnings.length, warnings: s.warnings };
  }).filter(Boolean);
}

/**
 * The planner's own words for a view: a whole plan's, or for the mix (as the tiles do) the plan
 * every field is on when the farmer's picks all name one (no picks yet: Manami's pick), else the
 * mix's evaluateMix score. A real mix that isn't scored yet has none.
 */
export function rawFor(cmp, kind, mixScore, choice) {
  if (kind !== 'mix') return cmp.raw[kind];
  const k = mixKind(cmp, mixScore, choice);
  return k ? cmp.raw[k] : rawOf(mixScore);
}

/** Every raw planner string for a plan, word for word, grouped for the Fine print. */
export function fineprint(cmp, kind, mixScore, choice) {
  const r = rawFor(cmp, kind, mixScore, choice);
  return {
    Reasons: [...r.reasons],
    Risks: [...r.risks],
    Gaps: [...cmp.gaps],
    'Information gaps': [...r.informationGaps],
    'Local review': [...r.localReview],
    'Price of priorities': cmp.price.summary ? [cmp.price.summary] : [],
    'Weather source': cmp.weather.source ? [cmp.weather.source] : [],
    'Weather risk': cmp.weatherRisk?.message ? [cmp.weatherRisk.message] : [],
  };
}

// ---- the weather on the farm ----

/** The fields whose shown season grows wheat with a spring freeze: Set of ids. */
export function frostIds(cmp, view, season, choice) {
  return new Set(cmp.fields.filter((f) => entryFor(f, view, choice).seasons[season]?.freeze).map((f) => f.id));
}

/** The first season of Manami's pick with a spring freeze, and the fields it hits: { season, ids } | null. */
export function frostStop(cmp) {
  for (const y of SEASONS) {
    const ids = [...frostIds(cmp, 'priority', y)];
    if (ids.length) return { season: y, ids };
  }
  return null;
}

/**
 * Whether water is the weather worry here: the planner's weatherRisk, except just under its dry
 * line, where its own weights call water plentiful (then Manami says that, and never both).
 * true | false, or null with no real weather.
 */
export function waterWorry(cmp) {
  const limited = cmp?.weatherRisk?.waterLimited;
  if (limited == null) return null;
  return limited === true && !cmp.weights?.waterPlentiful;
}

/**
 * The fields left short of water (1 in or more) in the shown season, only where water is what
 * limits the crops (waterWorry): Set of ids, empty on a humid farm.
 */
export function dryIds(cmp, view, season, choice) {
  if (waterWorry(cmp) !== true) return new Set();
  return new Set(cmp.fields.filter((f) => (entryFor(f, view, choice).seasons[season]?.waterShort ?? 0) >= 1).map((f) => f.id));
}

/** The first season of Manami's pick with a field short of water: { season, ids } | null. */
function dryStop(cmp) {
  for (const y of SEASONS) {
    const ids = [...dryIds(cmp, 'priority', y)];
    if (ids.length) return { season: y, ids };
  }
  return null;
}

// ---- the walk's picks (shared with the lines in futuresVoice.js) ----

/** The pick's 3-season gain over keeping going, whole farm. */
export const pickGain = (cmp) => cmp.totals.priority.expectedGM - cmp.totals.current.expectedGM;

/** The field the pick gains most on (more than $1k), or null. */
export function gainField(cmp) {
  const f = cmp.fields.reduce((a, b) => (!a || b.diff.priority > a.diff.priority ? b : a), null);
  return f && f.diff.priority > 1000 ? f : null;
}

/** The first season a field's crops differ on the pick (else its biggest cash change, else 0). */
export function firstCropChange(cmp, id) {
  const f = fieldOf(cmp, id);
  const p = f.byKind.priority.seasons, c = f.byKind.current.seasons;
  const y = SEASONS.find((i) => !sameCrops(p[i], c[i]));
  if (y != null) return y;
  return SEASONS.reduce((a, i) => (Math.abs(p[i].gmAc - c[i].gmAc) > Math.abs(p[a].gmAc - c[a].gmAc) ? i : a), 0);
}

/**
 * How much more season `a` earns an acre than `b`, in whole dollars, worked out from the rounded
 * amounts the card shows ("$271/ac" against "$198/ac" is $73), so the line and the card agree.
 */
export const acreGain = (a, b) => Math.round(a.gmAc) - Math.round(b.gmAc);

/**
 * The season where the pick grows the same crops as keeping going but earns most more an acre
 * ($5 or more), leaving out the fields in `skip`: { id, season, delta } or null.
 */
export function sameCropPick(cmp, skip = []) {
  let best = null;
  for (const f of cmp.fields) {
    if (skip.includes(f.id)) continue;
    SEASONS.forEach((y) => {
      const a = f.byKind.priority.seasons[y], b = f.byKind.current.seasons[y];
      const delta = acreGain(a, b);
      if (sameCrops(a, b) && delta >= 5 && (!best || delta > best.delta)) best = { id: f.id, season: y, delta };
    });
  }
  return best;
}

/** The fields where the pick sows a different winter cover (or none) from keeping going, with the same main crops. */
export function coverOnlyFields(cmp) {
  return cmp.fields.filter((f) => {
    const p = f.byKind.priority.seasons, c = f.byKind.current.seasons;
    return SEASONS.some((y) => !sameCrops(p[y], c[y])) && SEASONS.every((y) => p[y].crop === c[y].crop);
  });
}

/** The fields where the pick sows a winter cover in a season keeping going has none. */
export const coverAddFields = (cmp) => cmp.fields.filter((f) => f.byKind.priority.seasons.some((s, y) => s.cover && !f.byKind.current.seasons[y].cover));

/** The fields the pick earns less on (by more than $500), worst first. */
export function giveUpFields(cmp) {
  return cmp.fields.filter((f) => f.diff.priority < -500).sort((a, b) => a.diff.priority - b.diff.priority);
}

/** The season with the most fields to be careful about on the pick (0 when there are none). */
export function watchSeason(cmp, view = 'priority', choice) {
  const n = SEASONS.map((y) => flagsFor(cmp, view, choice, y).filter((x) => x.worst >= 2).length);
  return n.reduce((a, k, i) => (k > n[a] ? i : a), 0);
}

/**
 * Whether the pick hardly differs from keeping going (the walk is then one line): the same crops
 * everywhere, or the same main crops with only the winter covers changed for under $1k either way.
 * A pick that changes crops is never a good fit, even when it earns less: the full walk says why.
 */
export function isGoodFit(cmp) {
  if (samePlans(cmp, 'priority', 'current')) return true;
  const sameMains = cmp.fields.every((f) => f.byKind.priority.seasons.every((s, y) => s.crop === f.byKind.current.seasons[y].crop));
  return sameMains && Math.abs(pickGain(cmp)) < 1000;
}

/**
 * Manami's walk through the plans, in order: { id, view, season, fieldId?, camera, marksBase,
 * growStagger }. camera is 'overview', 'field' or 'none' (stay put); marksBase is the plan the
 * change outlines are measured against (null: no outlines); growStagger the grow-in delay per field.
 * The weather stops add frostLens (outline the frost fields) or dryLens, and noFocus (no gold field).
 */
export function reelStops(cmp) {
  const stop = (id, o = {}) => ({ id, view: 'priority', season: 0, camera: 'overview', marksBase: 'current', growStagger: 0.06, ...o });
  const weather = [];
  const fz = frostStop(cmp);
  if (fz) {
    const one = fz.ids.length === 1;
    weather.push(stop('frost', { season: fz.season, marksBase: null, frostLens: true, growStagger: 0, camera: one ? 'field' : 'overview', ...(one ? { fieldId: fz.ids[0] } : {}), noFocus: true }));
  }
  const dry = dryStop(cmp);
  if (dry) weather.push(stop('dry', { season: dry.season, marksBase: null, dryLens: true, growStagger: 0, camera: 'overview', noFocus: true }));
  const out = [stop('intro', { view: 'current', marksBase: null, growStagger: 0 })];
  if (isGoodFit(cmp)) return [...out, stop('goodFit'), ...weather, stop('yourTurn', { view: 'mix' })];
  out.push(stop('flip', { growStagger: 0.12 }));
  const g = gainField(cmp);
  if (g) out.push(stop('gain', { fieldId: g.id, season: firstCropChange(cmp, g.id), camera: 'field' }));
  const same = sameCropPick(cmp, g ? [g.id] : []);
  if (same) out.push(stop('sameCrop', { fieldId: same.id, season: same.season, camera: 'field' }));
  const lose = giveUpFields(cmp)[0];
  if (lose) out.push(stop('giveUp', { fieldId: lose.id, season: 2, camera: 'field' }));
  if (!samePlans(cmp, 'maxProfit', 'priority')) out.push(stop('vsProfit', { view: 'maxProfit', marksBase: 'priority' }));
  out.push(stop('why', { camera: 'none', growStagger: 0 }));
  out.push(...weather);
  out.push(stop('watch', { season: watchSeason(cmp) }));
  out.push(stop('yourTurn', { view: 'mix' }));
  return out;
}
