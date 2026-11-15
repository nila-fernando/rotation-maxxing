// Manami's rotation lines for "Plan my next seasons": the headline, the pattern note, a reason per
// change of crop, the field lead, the why-not line, the money lines (always last) and the
// screen-reader words of a ribbon cell. Every line passes futuresVoice.lintLine; plain text, so the
// caller escapes it where it goes into HTML.
//
// Rotation first, profit second: the headline, the pattern and the reasons never say money; the
// money has its own lines (moneyLine, fieldMoneyLine), which come last wherever they are shown.
import { moneyAbout, perAcre } from '../ui/money.js';
import { CROP_NAME, CROP_WORD, share } from './planNames.js';
import { fieldOf, isGoodFit, sameCrops, sameEverywhere, tiles } from './compareFutures.js';
import { word, short, names, joinAnd, warnLine, fieldLine } from './futuresVoice.js';
import { FAMILY, SMALL_GRAINS, histRun, rotationOf } from './rotationStory.js';

// ---- words ----

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const about = (v) => moneyAbout(Math.abs(v));
const plural = (id) => !!CROP_WORD[id]?.plural;
const verb = (id, stem) => (plural(id) ? stem : `${stem}s`);
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const num = (n) => NUM[n] ?? String(n);
const seasonsWord = (n) => `${n} season${n === 1 ? '' : 's'}`;
const sentencesOf = (s) => String(s).trim().split(/(?<=[.!?…])\s+/).filter(Boolean);

// the crops in the order they are said ("corn and beans", never "beans and corn")
const RANK = Object.keys(CROP_NAME);
const byRank = (a, b) => {
  const i = RANK.indexOf(a), j = RANK.indexOf(b);
  return (i < 0 ? RANK.length : i) - (j < 0 ? RANK.length : j);
};

/** Names in the farm's own order (the rotation's fields come in ribbon order). */
const namesInOrder = (fields, max) => names([...fields].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((f) => f.name), max);

/** Three crops in words, the first time as the word and after that as the short word: "soybeans, then corn, then beans". */
function seqList(crops) {
  const seen = new Set();
  // a run of one crop is said once: "corn for two seasons, then soybeans", never "corn, then corn"
  const runs = [];
  for (const c of crops) {
    if (runs.length && runs[runs.length - 1].c === c) runs[runs.length - 1].n++;
    else runs.push({ c, n: 1 });
  }
  if (runs.length === 1) return `${word(runs[0].c)} every season`;
  return runs.map(({ c, n }) => {
    const w = seen.has(c) ? short(c) : word(c);
    seen.add(c);
    return n > 1 ? `${w} for ${num(n)} seasons` : w;
  }).join(', then ');
}

/** The two crops a field swaps between ([a, b] in said order), or null: a, b, a over the three seasons. */
export function swapPair(seasons) {
  const crops = seasons.map((s) => s.crop);
  const set = [...new Set(crops)];
  if (set.length !== 2 || crops[1] === crops[0] || crops[2] === crops[1]) return null;
  return set.sort(byRank);
}

/** The pair most fields swap between, with the fields that do: { pair, fields } | null. */
function mainSwap(fields) {
  const groups = new Map();
  for (const f of fields) {
    const p = swapPair(f.seasons);
    if (!p) continue;
    const key = p.join('|');
    if (!groups.has(key)) groups.set(key, { pair: p, fields: [] });
    groups.get(key).fields.push(f);
  }
  return [...groups.values()].reduce((a, b) => (!a || b.fields.length > a.fields.length ? b : a), null);
}

/** The view's subject for "I’d grow …": "I’d", "Keeping going would", … */
const WHO = { priority: 'I’d', current: 'Keeping going would', maxProfit: 'The most-profit plan would', mix: 'Your plan would' };
/** The plan as a subject: "My pick grows …". */
const SUBJECT = { priority: 'My pick', current: 'Keeping going', maxProfit: 'The most-profit plan', mix: 'Your plan' };
/** The base plan in the rotation check: "keeping going: 9". */
const BASE_NAME = { current: 'keeping going', priority: 'my pick', maxProfit: 'most profit', mix: 'your plan' };

// ---- 6.1 the headline ----

/** The headline: what the fields have grown, what the pick does with them and why. Rotation only, no money. */
export function headline(cmp) {
  if (isGoodFit(cmp)) return 'Your rotation is already a good swap. My pick changes little.';
  const pri = rotationOf(cmp, 'priority');
  const cur = rotationOf(cmp, 'current');
  const out = [];

  // S1: the fields that have grown one crop two years or more
  const groups = new Map();
  for (const f of pri.fields) {
    const run = histRun(f.history);
    if (run < 2) continue;
    const c = f.history[f.history.length - 1];
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push({ f, run });
  }
  const g = [...groups].reduce((a, b) => (!a || b[1].length > a[1].length ? b : a), null);
  if (g) {
    const [crop, rows] = g;
    const runs = rows.map((r) => r.run);
    const n = Math.min(...runs);
    const howLong = runs.every((r) => r === n) ? `${num(n)} years running` : `at least ${num(n)} years running`;
    out.push(`${namesInOrder(rows.map((r) => r.f))} ${rows.length === 1 ? 'has' : 'have'} grown ${short(crop)} ${howLong}.`);
  }

  // S2: the pattern of the pick
  // the fields whose main crops change (a cover alone isn't a change of rotation), and the ones whose cover does
  const curOf = (f) => fieldOf(cmp, f.id).byKind.current.seasons;
  const changed = pri.fields.filter((f) => f.seasons.some((s, y) => s.crop !== curOf(f)[y].crop));
  const coverOnly = pri.fields.filter((f) => !changed.includes(f) && !f.seasons.every((s, y) => sameCrops(s, curOf(f)[y])));
  const grainFields = changed.filter((f) => f.seasons.some((s) => SMALL_GRAINS.includes(s.crop)));
  const sw = mainSwap(pri.fields);
  if (grainFields.length) {
    const grain = grainFields[0].seasons.find((s) => SMALL_GRAINS.includes(s.crop)).crop;
    const others = new Set(grainFields.flatMap((f) => f.seasons.map((s) => s.crop)).filter((c) => !SMALL_GRAINS.includes(c)));
    const cornBeans = [...others].every((c) => c === 'corn' || c === 'soybeans') && others.size === 2;
    out.push(cornBeans
      ? `My pick brings ${word(grain)} into the corn and beans run on ${namesInOrder(grainFields)}.`
      : `My pick brings ${word(grain)} in on ${namesInOrder(grainFields)}.`);
  } else if (sw && sw.fields.length === pri.fields.length) {
    const [a, b] = sw.pair;
    const once = pri.fields.filter((f) => f.verdict.key === 'onceMore');
    const onceCrop = once[0]?.seasons[0].crop;
    const onceSame = once.filter((f) => f.seasons[0].crop === onceCrop);
    const where = pri.fields.length === 1 ? `on ${pri.fields[0].name}` : 'on every field';
    out.push(`My pick swaps ${short(a)} and ${short(b)} ${where}${onceSame.length ? `, with one more ${short(onceCrop)} first on ${namesInOrder(onceSame)}` : ''}.`);
  } else if (sw && sw.fields.some((f) => changed.includes(f))) {
    const [a, b] = sw.pair;
    out.push(`My pick swaps ${short(a)} and ${short(b)} on ${namesInOrder(sw.fields.filter((f) => changed.includes(f)))}.`);
  } else if (changed.length) {
    out.push(`My pick changes the crops on ${namesInOrder(changed)}.`);
  } else if (coverOnly.length) {
    const where = coverOnly.length === pri.fields.length && coverOnly.length > 1 ? 'every field' : namesInOrder(coverOnly);
    const cover = coverOnly[0].seasons.find((s) => s.cover)?.cover;
    out.push(cover ? `My pick keeps your crops and adds a ${short(cover)} cover on ${where}.` : `My pick keeps your crops and changes the winter cover on ${where}.`);
  }

  // S3: why, from the counts against keeping going
  const moreN = pri.counts.nHandoffs > cur.counts.nHandoffs;
  const lessRw = pri.counts.rootworm < cur.counts.rootworm;
  if (moreN) {
    const pair = mainHandoff(pri);
    const nSent = !pair || (pair.prev === 'soybeans' && pair.crop === 'corn')
      ? 'The beans leave nitrogen for the next corn'
      : `The ${short(pair.prev)} ${verb(pair.prev, 'leave')} nitrogen for the next ${short(pair.crop)}`;
    out.push(lessRw ? `${nSent}, and the swap breaks the rootworm cycle.` : `${nSent}.`);
  } else if (pri.counts.coverSeasons > cur.counts.coverSeasons) {
    const cover = pri.fields.flatMap((f) => f.seasons).find((s) => s.cover).cover;
    out.push(`${cap(word(cover))} ${verb(cover, 'keep')} the ground covered over winter.`);
  }
  return out.join(' ');
}

/** The most common nitrogen handoff of a rotation: { prev, crop } | null. */
function mainHandoff(rot) {
  const n = new Map();
  for (const f of rot.fields) for (const s of f.seasons) {
    if (s.link.kind !== 'nitrogen') continue;
    const key = `${s.link.prev}|${s.crop}`;
    n.set(key, (n.get(key) || 0) + 1);
  }
  if (!n.size) return null;
  const [key] = [...n].reduce((a, b) => (b[1] > a[1] ? b : a));
  const [prev, crop] = key.split('|');
  return { prev, crop };
}

// ---- 6.2 the pattern note ----

/** The quiet line under the plan switch: what stays, what swaps, and how the acres split. */
export function patternNote(rot) {
  const fields = rot?.fields ?? [];
  const N = fields.length;
  if (!N) return '';
  const out = [];
  // the same crop every season
  const same = new Map();
  for (const f of fields) {
    const c = f.seasons[0].crop;
    if (!f.seasons.every((s) => s.crop === c)) continue;
    if (!same.has(c)) same.set(c, []);
    same.get(c).push(f);
  }
  const big = [...same].reduce((a, b) => (!a || b[1].length > a[1].length ? b : a), null);
  if (big) {
    const [c, fs] = big;
    out.push(`${cap(word(c))} ${verb(c, 'stay')} every season on ${fs.length === N && N > 1 ? 'every field' : namesInOrder(fs)}.`);
  }
  // the swap
  const sw = mainSwap(fields);
  if (sw) {
    const [a, b] = sw.pair;
    const n = sw.fields.length;
    out.push(`${cap(short(a))} and ${short(b)} swap on ${n === N ? (N === 1 ? fields[0].name : 'every field') : `${n} of ${N} fields`}.`);
  }
  // the acre split
  const tops = (rot.split ?? []).filter((x) => x.total > 0).map((x) => {
    const [crop, acres] = Object.entries(x.byCrop).reduce((p, q) => (q[1] > p[1] ? q : p));
    return { year: x.year, crop, pct: (100 * acres) / x.total, crops: Object.keys(x.byCrop).length };
  });
  if (tops.length) {
    const odd = tops.find((t) => t.pct < 40 || t.pct > 60);
    if (!odd && tops.every((t) => t.crops === 2)) out.push('About half your acres are in each crop every season.');
    else if (odd) {
      const how = odd.pct >= 99.5 ? 'all' : share(odd.pct);
      out.push(`In ${odd.year}, ${how} of your acres are in ${short(odd.crop)}.`);
    }
  }
  return out.slice(0, 3).join(' ');
}

// ---- 6.3 the reason for each change ----

const FAMILY_WORD = { grass: 'another grain', legume: 'another legume' };

/**
 * Why a season's crop follows the one before, in at most 3 sentences.
 * @param {object} season a rotation season (rotationOf().fields[].seasons[])
 * @param {{field?: object|string, history?: string[], prevSeason?: object|null}} ctx
 */
export function changeReason(season, ctx = {}) {
  if (!season) return '';
  const { link = {}, crop } = season;
  const prev = link.prev;
  const history = ctx.history ?? (typeof ctx.field === 'object' && ctx.field ? historyOf(ctx.field) : []);
  const fieldName = typeof ctx.field === 'string' ? ctx.field : ctx.field?.name;
  const out = [];
  if (prev && link.kind === 'repeat') {
    const rw = season.warnings.find((w) => w.lens === 'repeat');
    const pest = season.warnings.find((w) => w.lens === 'pest' && /rootworm/i.test(w.reason || ''));
    const wctx = { field: fieldName, crop, prev, drag: season.drag, unit: season.unit };
    out.push(rw ? warnLine(rw, wctx) : `${cap(word(crop))} again after ${word(prev)}.`);
    if (pest) out.push(warnLine(pest, wctx));
  } else if (prev && link.kind === 'nitrogen') {
    out.push(`${cap(word(crop))} after ${short(prev)} gets ${plural(prev) ? 'their' : 'its'} nitrogen, about ${perAcre(link.nUsd)} an acre less to buy.`);
  } else if (prev && SMALL_GRAINS.includes(crop) && (prev === 'corn' || prev === 'soybeans')) {
    out.push(`${cap(word(crop))} ${verb(crop, 'break')} up the corn and beans run.`);
  } else if (prev && link.kind === 'break' && prev === 'corn') {
    // the two crops before this one: corn on corn means rootworm control this season skips
    const before = ctx.prevSeason ? [ctx.prevSeason.link?.prev, ctx.prevSeason.crop] : history.slice(-2);
    const skip = !!ctx.prevSeason?.link?.rootworm || (before.length === 2 && before.every((c) => c === 'corn'));
    out.push(`${cap(short(crop))} after corn ${verb(crop, 'break')} the rootworm cycle${skip ? ', so you skip rootworm control' : ''}.`);
  } else if (prev && link.kind === 'break') {
    out.push(`Changing to ${word(crop)} breaks the pest cycles of the ${short(prev)}.`);
  } else if (prev && link.kind === 'same-family') {
    out.push(`${cap(word(crop))} ${verb(crop, 'follow')} ${word(prev)}, ${FAMILY_WORD[FAMILY[crop]] ?? 'the same kind of crop'}.`);
  }
  if (season.cover && out.reduce((n, s) => n + sentencesOf(s).length, 0) < 3) {
    out.push(`${cap(word(season.cover))} after harvest ${verb(season.cover, 'keep')} the ground covered over winter.`);
  }
  return out.join(' ');
}

/**
 * A rotation field's history (oldest first): its own, else the comparison's, else the two past
 * seasons the ribbon shows.
 */
function historyOf(f, cf = null) {
  return f.history ?? cf?.history ?? (f.past ?? []).map((p) => p.crop).filter(Boolean);
}

/** changeReason for the i-th season of a rotation field. */
export function reasonFor(field, i) {
  return changeReason(field.seasons[i], { field, history: historyOf(field), prevSeason: i > 0 ? field.seasons[i - 1] : null });
}

// ---- 6.4 the field lead ----

/** What a field has grown, as the start of its story. */
function historyWords(f, h) {
  const run = histRun(h);
  const last = h[h.length - 1];
  if (run >= 2) return `${f.name} has grown ${short(last)} ${num(run)} years running.`;
  if (h.length >= 2) return `${f.name} already turns ${joinAnd([h[h.length - 2], last].sort(byRank).map(short))}.`;
  if (h.length === 1) return `${f.name} grew ${word(last)} last season.`;
  return '';
}

/** The first line of a field story: what it has grown, and what this plan grows next. */
export function fieldLead(rot, cmp, id) {
  const f = rot?.fields?.find((x) => x.id === id);
  const cf = fieldOf(cmp, id);
  if (!f || !cf) return '';
  if (sameEverywhere(cf)) return fieldLine(cmp, id, 'priority');
  const view = rot.view;
  const crops = f.seasons.map((s) => s.crop);
  if (f.verdict.key === 'keepsSame') {
    const cover = f.seasons[0].cover;
    const everyWinter = cover && f.seasons.every((s) => s.cover === cover) ? `, with a ${short(cover)} cover each winter` : '';
    if (view === 'current') return `Keeping going means ${word(crops[0])} every season here${everyWinter}.`;
    const said = `${SUBJECT[view] ?? 'This plan'} grows ${word(crops[0])} every season here${everyWinter}.`;
    const before = historyWords(f, historyOf(f, cf));
    return before ? `${before} ${said}` : said;
  }
  const who = WHO[view] ?? 'This plan would';
  const hist = historyWords(f, historyOf(f, cf));
  let next;
  if (f.verdict.key === 'nowTurns') next = `${who} turn it to ${seqList(crops)}.`;
  else if (f.verdict.key === 'onceMore') {
    const rest = seqList(crops).split(', then ').slice(1).join(', then ');
    next = `${who} grow ${short(crops[0])} once more, then ${rest}.`;
  } else next = `${who} grow ${seqList(crops)}.`;
  if (hist) return `${hist} ${next}`;
  return `On ${f.name}, ${next.startsWith('I’d') ? next : `${next.charAt(0).toLowerCase()}${next.slice(1)}`}`;
}

// ---- 6.5 why not the most-profit plan ----

/** The top crop's share of the acres each season of a rotation: [pct]. */
const topShares = (rot) => rot.split.map((x) => (x.total ? (100 * Math.max(...Object.values(x.byCrop))) / x.total : 0));

/**
 * Why my pick isn't the most-profit plan on this field, from the first fact that holds: the soil
 * it ends on, the balance of the farm's crops, or a better bad year. null when the two plans grow
 * the same here, when the most-profit plan doesn't earn more here, or when no fact applies.
 */
export function whyNotLine(cmp, id) {
  const f = fieldOf(cmp, id);
  if (!f) return null;
  const p = f.byKind.priority.seasons, m = f.byKind.maxProfit.seasons;
  if (p.every((s, y) => sameCrops(s, m[y]))) return null;
  const d = f.byKind.maxProfit.total - f.byKind.priority.total;
  if (d <= 0) return null;
  const lead = p[0].crop !== m[0].crop ? `${cap(short(m[0].crop))} first` : 'The most-profit plan';
  const earns = d >= 500 ? `${lead} earns about ${about(d)} more here.` : `${lead} would earn a little more here.`;
  if (p[2].soil100 - m[2].soil100 >= 5) {
    // the same last crop on both plans: say what differs, the cover it ends with or the crop before
    let ends = word(p[2].crop);
    if (p[2].crop === m[2].crop) {
      if (p[2].cover && p[2].cover !== m[2].cover) ends += ` with a ${short(p[2].cover)} cover`;
      else if (p[1].crop !== m[1].crop) ends += ` after ${short(p[1].crop)}`;
    }
    return `${earns} My pick ends on ${ends} instead, and the soil scores ${p[2].soil100} that season, not ${m[2].soil100}.`;
  }
  // the farm's balance is a reason only where this field's own crops differ (not just its cover)
  const cropsDiffer = p.some((s, y) => s.crop !== m[y].crop);
  const pri = rotationOf(cmp, 'priority'), max = rotationOf(cmp, 'maxProfit');
  const pTop = topShares(pri), mTop = topShares(max);
  if (cropsDiffer && mTop.some((x) => x > 65) && pTop.every((x) => x <= 60)) {
    const [a, b] = Object.keys(pri.split[0].byCrop).slice(0, 2).sort(byRank);
    if (a && b) return `${lead} would earn a little more here. My pick keeps your ${short(a)} and ${short(b)} close to half and half each season.`;
  }
  const dp10 = (cmp.totals.priority?.p10GM ?? 0) - (cmp.totals.maxProfit?.p10GM ?? 0);
  if (dp10 >= 500) return `${lead} would earn a little more here. My pick holds up better in a bad year, about ${about(dp10)} more across the farm.`;
  return null;
}

// ---- 6.6 a field's money, always last ----

/** A field's money over 3 seasons on the rotation's plan, against keeping going. */
export function fieldMoneyLine(rot, id) {
  const f = rot?.fields?.find((x) => x.id === id);
  if (!f) return '';
  const earns = f.total < 0 ? `loses about ${about(f.total)}` : `earns about ${about(f.total)}`;
  if (rot.view === 'current') return `Over 3 seasons it ${earns} here.`;
  const d = f.diffVsCurrent;
  const vs = Math.abs(d) < 500 ? 'about the same as keeping going' : `about ${about(d)} ${d > 0 ? 'more' : 'less'} than keeping going`;
  return `Over 3 seasons it ${earns} here, ${vs}.`;
}

// ---- 6.7 the rotation check ----

/**
 * The 5-row rotation check of a plan against a base plan (keeping going, or my pick when keeping
 * going is on show): [{ key, label, value, base, better, n, baseN }]. better is true when this
 * plan does better on the row, false when worse, null when the same (or nothing to compare).
 */
export function checkRows(rot, baseRot) {
  const c = rot?.counts;
  if (!c) return [];
  const b = baseRot && baseRot !== rot && baseRot.view !== rot.view ? baseRot.counts : null;
  const name = b ? BASE_NAME[baseRot.view] ?? 'keeping going' : null;
  const vs = (x) => (b ? `${name}: ${x}` : '');
  const cmpN = (n, bn, lowerIsBetter) => {
    if (!b || n == null || bn == null || n === bn) return null;
    return lowerIsBetter ? n < bn : n > bn;
  };
  const count = (n) => (n ? String(n) : 'none');

  const handoffs = (rot.fields ?? []).flatMap((f) => f.seasons).filter((s) => s.link.kind === 'nitrogen');
  const cornBeans = handoffs.every((s) => s.crop === 'corn' && s.link.prev === 'soybeans');
  const covers = [...new Set((rot.fields ?? []).flatMap((f) => f.seasons).map((s) => s.cover).filter(Boolean))];
  const coverWord = covers.length === 1 ? short(covers[0]) : 'cover';
  const bare = c.bareMonthsAvg != null ? Math.round(c.bareMonthsAvg) : null;
  const lastYear = rot.years?.[2];

  return [
    { key: 'repeats', label: 'Same crop again', value: c.repeats ? seasonsWord(c.repeats) : 'none', base: vs(count(b?.repeats)), better: cmpN(c.repeats, b?.repeats, true), n: c.repeats, baseN: b?.repeats ?? null },
    {
      key: 'handoffs', label: cornBeans ? 'Corn after beans' : 'After a legume',
      value: c.nHandoffs ? `${seasonsWord(c.nHandoffs)}${c.nLb ? `, about ${c.nLb} lb of free nitrogen an acre each time` : ''}` : 'none',
      base: vs(count(b?.nHandoffs)), better: cmpN(c.nHandoffs, b?.nHandoffs, false), n: c.nHandoffs, baseN: b?.nHandoffs ?? null,
    },
    { key: 'rootworm', label: 'Rootworm control needed', value: c.rootworm ? seasonsWord(c.rootworm) : 'none', base: vs(count(b?.rootworm)), better: cmpN(c.rootworm, b?.rootworm, true), n: c.rootworm, baseN: b?.rootworm ?? null },
    {
      key: 'cover', label: 'Winter cover',
      value: c.coverSeasons ? `${seasonsWord(c.coverSeasons)} of ${coverWord}` : `none${bare != null ? `. The ground sits bare about ${bare} months each winter.` : ''}`,
      base: vs(count(b?.coverSeasons)), better: cmpN(c.coverSeasons, b?.coverSeasons, false), n: c.coverSeasons, baseN: b?.coverSeasons ?? null,
    },
    {
      key: 'soil', label: lastYear ? `Soil score in ${lastYear}` : 'Soil score at the end',
      value: c.endSoil100 != null ? `${c.endSoil100}/100` : 'not worked out yet',
      base: vs(b?.endSoil100 != null ? String(b.endSoil100) : '–'), better: cmpN(c.endSoil100, b?.endSoil100, false), n: c.endSoil100, baseN: b?.endSoil100 ?? null,
    },
  ];
}

// ---- 6.8 the money line ----

/** The one money line: the plan's cash over 3 seasons, against keeping going, and a bad year. */
export function moneyLine(cmp, view, mixScore, choice) {
  const t = tiles(cmp, view, mixScore, choice);
  const cash = t[0].value, gain = t[0].diff, p10 = t[1].value;
  if (cash == null) return 'I’m still working out what your plan earns.';
  const head = cash < 0 ? `A loss of about ${about(cash)} over 3 seasons` : `About ${about(cash)} over 3 seasons`;
  let s1;
  if (view === 'current') s1 = `${head} if you keep going.`;
  else if (Math.abs(gain) < 500) s1 = `${head}, about the same as keeping going.`;
  else s1 = `${head}, about ${about(gain)} ${gain > 0 ? 'more' : 'less'} than keeping going.`;
  if (p10 == null) return s1;
  const bad = p10 < 0 ? `a loss of about ${about(p10)}` : `about ${about(p10)}`;
  return `${s1} In a bad year, 1 in 10, ${bad}.`;
}

// ---- the chip and the screen reader ----

/** The chip's words after the crop: 'after beans' | 'corn again' | ''. */
export function chipAfterWords(link) {
  if (!link?.prev || !link.kind) return '';
  if (link.kind === 'repeat') return `${short(link.prev)} again`;
  return `after ${short(link.prev)}`;
}

/**
 * A ribbon cell's screen-reader words: "Home place, 2028: Corn, after soybeans. Corn after beans
 * gets their nitrogen, about $20 an acre less to buy." (the reason cut to 2 sentences).
 */
export function cellSr(field, season) {
  if (!field || !season) return '';
  const i = field.seasons.indexOf(season);
  const crop = `${CROP_NAME[season.crop] || cap(word(season.crop))}${season.cover ? ` with a ${short(season.cover)} cover` : ''}`;
  const { kind, prev } = season.link || {};
  const after = !prev || !kind ? '' : kind === 'repeat' ? `, again after ${word(prev)}` : `, after ${word(prev)}`;
  const reason = changeReason(season, { field, history: historyOf(field), prevSeason: i > 0 ? field.seasons[i - 1] : null });
  const said = sentencesOf(reason).slice(0, 2).join(' ');
  return `${field.name}, ${season.year}: ${crop}${after}.${said ? ` ${said}` : ''}`;
}

// ---- for the lint test ----

/** Every line this module can say for the plans, for the lint test. */
export function allRotationLines(cmp, { choice, mixScore } = {}) {
  const out = [headline(cmp)];
  for (const view of ['current', 'maxProfit', 'priority', 'mix']) {
    const rot = rotationOf(cmp, view, choice || {}, mixScore ?? null);
    out.push(patternNote(rot), moneyLine(cmp, view, mixScore, choice));
    for (const f of rot.fields) {
      out.push(fieldLead(rot, cmp, f.id), fieldMoneyLine(rot, f.id));
      f.seasons.forEach((s, i) => out.push(reasonFor(f, i), cellSr(f, s)));
    }
  }
  for (const f of cmp.fields) out.push(whyNotLine(cmp, f.id));
  return out.filter((s) => s != null && s !== '');
}
