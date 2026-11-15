// The weather the planner can count, read from its plans and said in Manami's words: the spring
// freeze on winter wheat (its "Freeze risk: …" term, K-State C646 thresholds) and the farm's
// weather risk (whether water is what limits the crops here).
//
//   freezeOf(year.terms, year.yieldPerAcre)   a season's freeze: { years, of, stage, bu, pct, cashAc, label } | null
//   weatherRiskLine(cmp.weatherRisk, { wheat }) the Notes' "Good to know" weather line
//   fieldWeatherNote(plansPanel.data, 'f1', { startYear })   the field check-up's captions
//
// Pure, and it imports only money.js, so the field check-up can use it without pulling in the
// planner. The planner's freeze rule comes from Kansas and starts counting on 1 March everywhere,
// so outside Kansas Manami says so (frostCaveat) instead of passing the count off as local fact.
import { perAcre } from '../ui/money.js';

/** The planner's per-season freeze term: in N of M years, below the <stage> threshold. */
export const FREEZE_TERM = /^Freeze risk: in (\d+) of (\d+) years, temperatures fell below the (.+?) threshold/;
/** The planner's freeze term for one weather year (it doesn't reach the app today, but read it anyway). */
export const FREEZE_EVENT = /^Spring freeze at (\S+) \((-?\d+) F on (\d\d-\d\d), injury below (\d+) F, K-State C646: ([a-z ]+);/;
/** A freeze that takes this much of the crop or more (%) is worth a Careful, not just a Note. */
export const FROST_CAREFUL_PCT = 10;

const PRICE_TERM = /^Effective .+ price$/;

/**
 * A season's spring freeze, from its terms and yield (the yield already has the freeze taken off):
 * { years, of, stage, bu (bu/ac, negative), pct (% of the crop it takes), cashAc ($/ac, negative), label },
 * or null when the season has no freeze. One weather year's event has years and of null.
 */
export function freezeOf(terms, yieldPerAcre) {
  for (const t of terms || []) {
    const label = String(t?.label || '');
    const risk = FREEZE_TERM.exec(label);
    const event = risk ? null : FREEZE_EVENT.exec(label);
    if (!risk && !event) continue;
    const bu = Number(t.value);
    if (!Number.isFinite(bu)) return null;
    const whole = Number(yieldPerAcre) - bu; // the yield before the freeze
    const pct = whole > 0 ? (-bu / whole) * 100 : 0;
    const price = (terms || []).find((x) => PRICE_TERM.test(String(x?.label || '')))?.value;
    return {
      years: risk ? Number(risk[1]) : null,
      of: risk ? Number(risk[2]) : null,
      stage: risk ? risk[3] : event[1],
      bu,
      pct,
      cashAc: Number.isFinite(price) ? bu * price : null,
      label,
    };
  }
  return null;
}

/** A season's freeze as a rule warning, so it shows with the others (a Note, or Careful at 10% or more). */
export const frostWarning = (fz) => fz && ({ lens: 'frost', severity: fz.pct >= FROST_CAREFUL_PCT ? 2 : 1, reason: fz.label, app: true });

/** The planner's wheat stages, said as a farmer sees the crop. */
export const STAGE_WORD = {
  tillering: 'while it was still short and leafy', jointing: 'as its stems began to grow', boot: 'with the head still in the stem',
  heading: 'as the heads came out', flowering: 'in flower', milk: 'as the grain filled', dough: 'as the grain filled',
};

/** "In 13 of 24 springs here" (or, for one weather year's freeze, "In one spring I tried"). */
export const springsWords = (fz) => (fz?.years != null ? `In ${fz.years} of ${fz.of} springs here` : 'In one spring I tried');

/** How much a freeze takes off, as said: "about 5%", or "a little" under 1%. */
export const frostCut = (fz) => (Math.round(fz?.pct ?? 0) >= 1 ? `about ${Math.round(fz.pct)}%` : 'a little');

/**
 * What to add after a freeze line outside Kansas: the rule's thresholds and its 1 March start come
 * from Kansas, so in Iowa a tillering count may be cold nights while the wheat is still dormant.
 * Null in Kansas.
 */
export function frostCaveat(state, stage) {
  if (state === 'KS') return null;
  if (state && stage === 'tillering') return 'My frost rule comes from Kansas, so here it may count cold nights while the wheat is still dormant.';
  return 'My frost rule comes from Kansas, so check it with someone who grows wheat near you.';
}

/**
 * The farm's weather risk in Manami's words, from the planner's weatherRisk ({ waterLimited, … }).
 * `wheat`: the plan shown grows wheat (then she says she does count its spring freezes);
 * `irrigated`: the whole farm is watered.
 */
export function weatherRiskLine(wr, { wheat = false, irrigated = false } = {}) {
  const limited = wr?.waterLimited;
  if (limited == null) return 'I couldn’t get real weather here, so I can’t say what the big weather worry is.';
  if (limited) {
    const s2 = irrigated ? 'Your fields are watered, so the real worry is your water supply.' : 'So dry years are the ones to plan for.';
    return `Water is the big weather worry here, since the rain falls short of what crops could use. ${s2}`;
  }
  return `Water isn’t the big weather worry here. Wet springs, floods and wind matter more, and I can’t count most of those yet.${wheat ? ' I do count spring freezes on wheat.' : ''}`;
}

/**
 * The field check-up's weather captions, from the plans panel's data (the planner result the
 * comparison is made from): { water, frost }. `frost` is the first season of Manami's pick that
 * grows wheat with a freeze on this field, or null.
 */
export function fieldWeatherNote(data, fieldId, { startYear } = {}) {
  const plans = data?.result?.plans;
  const pick = plans?.priority;
  const farm = data?.farm || {};
  const water = weatherRiskLine(pick?.weatherRisk ?? null, { irrigated: farm.constraints?.irrigation === 'irrigated' });
  let frost = null;
  const years = pick?.paddocks?.find((p) => p.paddockId === fieldId)?.years || [];
  const y = years.findIndex((yr) => freezeOf(yr.terms, yr.yieldPerAcre));
  if (y >= 0) {
    const fz = freezeOf(years[y].terms, years[y].yieldPerAcre);
    const y0 = Number(startYear);
    const when = Number.isFinite(y0) ? ` for the ${y0 + y} harvest` : '';
    const caveat = frostCaveat(farm.state ?? null, fz.stage);
    frost = `In my pick this field grows winter wheat${when}. ${springsWords(fz)}, a night got cold enough to hurt it.${caveat ? ` ${caveat}` : ''}`;
  }
  return { water, frost };
}

/**
 * A freeze as the card's "More numbers" rows (data, never in Manami's own words):
 * [['Spring freezes', '13 of 24 springs'], ['Freeze cut', '−2.7 bu/ac, about −$15/ac']].
 */
export function frostNumbers(fz) {
  if (!fz) return [];
  const minus = (v) => (v < 0 ? '−' : '');
  const bu = `${minus(fz.bu)}${Math.abs(fz.bu).toFixed(1)} bu/ac`;
  const rows = [];
  if (fz.years != null) rows.push(['Spring freezes', `${fz.years} of ${fz.of} springs`]);
  rows.push(['Freeze cut', Number.isFinite(fz.cashAc) ? `${bu}, about ${perAcre(fz.cashAc)}/ac` : bu]);
  return rows;
}
