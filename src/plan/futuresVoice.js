// Manami's words for "See them on the farm" (src/screens/planFutures.js): the lines of her short
// walk through the plans, the field card, the tooltip, the Notes sheet and the screen-reader status,
// all worked out from compareFutures() (src/plan/compareFutures.js).
//
// Her voice: first person and warm, short plain sentences (at most 3 a line, 24 words each), farm
// words not planner words, money rounded ("about $25k"), curly apostrophes, a real minus. The
// planner's own strings are never said as they are: warnings and gaps go through WARN_PHRASE and
// GAP_PHRASE, and anything those don't know is shown word for word in the Fine print instead.
// lintLine() checks every line against these rules (the tests run it on all of them).
//
// Pure (no DOM): lines are plain text, so the caller escapes them where they go into HTML.
import { money, moneyAbout, perAcre } from '../ui/money.js';
import { PLANS, CROP_NAME, CROP_WORD, SPEECH, share, coverWord } from './planNames.js';
import { LENS_LABEL, SEVERITY_LABEL } from './builder.js';
import {
  KINDS, kindFor, fieldOf, viewField, seasonChanges, seasonCashFor, tiles, totalsOf, headline, flagsFor,
  gainField, firstCropChange, sameCropPick, giveUpFields, watchSeason, samePlans, sameCrops, sameEverywhere,
  acreGain, mixKind, idsByName, rawFor, coinPlan, coverOnlyFields, coverAddFields, frostIds, frostStop, dryIds,
} from './compareFutures.js';
import { FREEZE_TERM, FREEZE_EVENT, STAGE_WORD, frostCaveat, frostCut, springsWords, weatherRiskLine } from './weatherWords.js';

// the weather lines the field check-up shares (src/plan/weatherWords.js imports no planner code)
export { weatherRiskLine, frostCaveat, STAGE_WORD } from './weatherWords.js';

// ---- the rules ----

const BANNED = /year \d|P10|lambda|index|paddock|fertiliser|lb N\/ac|\bx \$|0\.\d{2}/;

/** The sentences of a line (a decimal point like "0.4 in" doesn't end one). */
const sentencesOf = (s) => String(s).trim().split(/(?<=[.!?…])\s+/).filter(Boolean);

/**
 * What's wrong with a line in Manami's voice: [] when it's fine, else one note per problem.
 * At most 3 sentences of at most 24 words; no planner words (P10, lambda, index, paddock,
 * fertiliser, lb N/ac, "x $", 0.35); no emoji; no straight apostrophe; no exact dollars like
 * $12,349 (spoken money is rounded); a negative amount uses a real minus (−).
 */
export function lintLine(s) {
  const text = String(s ?? '');
  const out = [];
  if (!text.trim()) return ['empty line'];
  const sentences = sentencesOf(text);
  if (sentences.length > 3) out.push(`${sentences.length} sentences (at most 3)`);
  for (const x of sentences) {
    const n = x.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length; // "·" isn't a word
    if (n > 24) out.push(`${n} words in "${x}" (at most 24)`);
  }
  const banned = BANNED.exec(text);
  if (banned) out.push(`says "${banned[0]}"`);
  if (/\p{Extended_Pictographic}/u.test(text)) out.push('has an emoji');
  if (text.includes("'")) out.push('has a straight apostrophe (use ’)');
  if (/\$\d{1,3},\d{3}/.test(text)) out.push('has exact dollars (say them rounded)');
  if (/(^|[\s(])-[$\d]/.test(text)) out.push('has a hyphen for a minus (use −)');
  return out;
}

// ---- words ----

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const about = (v) => moneyAbout(Math.abs(v));
const moreLess = (v) => (v >= 0 ? 'more' : 'less');

/** A planner crop name as said: "Corn (grain)" -> "corn", "Cereal rye (cover crop)" -> "cereal rye". */
const plainCrop = (name) => String(name || '').replace(/\s*\(.*?\)/g, '').trim().toLowerCase();
/** A planner crop name -> its id when known ("Soybeans" -> 'soybeans'). */
const idOfName = (name) => Object.keys(CROP_NAME).find((id) => CROP_NAME[id].toLowerCase() === plainCrop(name)) ?? null;
const wordsOf = (id) => CROP_WORD[id] || { word: plainCrop(CROP_NAME[id] || id), short: plainCrop(CROP_NAME[id] || id), plural: false };
/** "soybeans": the crop the first time in a line. */
export const word = (id) => wordsOf(id).word;
/** "beans": the crop once it has been named. */
export const short = (id) => wordsOf(id).short;
/** "earn" for soybeans, "earns" for corn. */
const verb = (id, stem) => (wordsOf(id).plural ? stem : `${stem}s`);
/** A planner crop name ("Soybeans") as Manami says it. */
const saidName = (name) => { const id = idOfName(name); return id ? word(id) : plainCrop(name); };

/** "a", "a and b", "a, b and c". */
export function joinAnd(list) {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** Field names in a sentence: "Home place, West 140 and East place", or "8 of your fields" past `max`. */
export function names(list, max = 3) {
  return list.length > max ? `${list.length} of your fields` : joinAnd(list);
}

/** How a plan ends, for "it ends on …": "corn after beans", or "corn with a rye cover". */
const endWords = (seasons) => (seasons[2].cover
  ? `${word(seasons[2].crop)} with a ${short(seasons[2].cover)} cover`
  : `${word(seasons[2].crop)} after ${short(seasons[1].crop)}`);

const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const points = (n) => `${n} point${n === 1 ? '' : 's'}`;

/** One season's crops in words: "corn", "corn with a rye cover". */
const cellWords = (s) => `${word(s.crop ?? s.main)}${s.cover ? ` with a ${short(s.cover)} cover` : ''}`;

/** Three seasons in words: "soybeans, corn, then soybeans", or "corn all three seasons". */
export function seqWords(seasons) {
  const w = seasons.map(cellWords);
  return w.every((x) => x === w[0]) ? `${w[0]} all three seasons` : `${w[0]}, ${w[1]}, then ${w[2]}`;
}

/** How a plan is the subject of a sentence: "My pick grows…". */
const SUBJECT = { current: 'Keeping going', maxProfit: 'The most-profit plan', priority: 'My pick', mix: 'Your plan' };
/** "…in my pick", "…if you keep going". */
const IN_PLAN = { current: 'if you keep going', maxProfit: 'in the most-profit plan', priority: 'in my pick', mix: 'in your plan' };

const planName = (view) => (view === 'mix' ? 'Your plan' : PLANS.find((p) => p.kind === view)?.name ?? view);
const entryOf = (f, view, choice) => f.byKind[view === 'mix' ? kindFor(choice, f.id) : view];
const lastCrop = (f) => f.history[f.history.length - 1] ?? null;
const prevCrop = (f, seasons, y) => (y > 0 ? seasons[y - 1].crop : lastCrop(f));

// ---- warnings ----

/** A percentage from a planner reason, as said: "2.0" -> "2", "5.5" -> "5.5". */
const pct = (x) => String(Math.round(Number(x) * 10) / 10);
/** Kit as said: "hay equipment (mower-conditioner, rake, baler)" -> "hay equipment". */
const plainKit = (s) => String(s).replace(/\s*\(.*?\)/g, '');

/**
 * The planner's rule warnings in Manami's words, by lens and reason. ctx is
 * { field, crop, prev, year, slopePct, drag, unit, freeze } (crop ids; drag in bu/ac, negative;
 * freeze from weatherWords.freezeOf, or null).
 */
export const WARN_PHRASE = [
  { lens: 'repeat', re: /^(Next year: )?(.+?) can't follow .+?: back-to-back hosts build up (.+?)\.$/,
    say: (m) => (m[1]
      ? `Next season’s ${saidName(m[2])} can’t follow this crop, since back-to-back crops build up ${m[3]}.`
      : `${cap(saidName(m[2]))} can’t follow ${saidName(m[2])}, since back-to-back crops build up ${m[3]}.`) },
  { lens: 'repeat', re: /Alfalfa would reach (\d+) years/,
    say: (m) => `Alfalfa would stand ${m[1]} years here, longer than a stand lasts, so it needs a new spot.` },
  { lens: 'repeat', re: /again after .*about ([\d.]+)% yield drag/,
    say: (m, c) => `${cap(word(c.crop))} again after ${word(c.prev || c.crop)}, so I expect about ${c.drag < -0.5 ? `${Math.round(-c.drag)} ${c.unit || 'bu'} an acre less` : `${pct(m[1])}% less yield`}.` },
  { lens: 'repeat', re: /again after/,
    say: (m, c) => `${cap(word(c.crop))} again after ${word(c.prev || c.crop)}, so I expect a little less yield.` },
  { lens: 'pest', re: /rootworm/i, say: () => 'Corn on corn usually needs rootworm control.' },
  { lens: 'pest', re: /cyst nematode|SCN/,
    say: (m, c, w) => { const p = /about ([\d.]+)%/.exec(w.reason); return `A little cyst nematode risk${p ? `, about ${pct(p[1])}% less yield` : ''}.`; } },
  { lens: 'pest', re: /white mold/i,
    say: (m, c, w) => { const p = /about ([\d.]+)%/.exec(w.reason); return `A touch of white mold risk${p ? `, about ${pct(p[1])}% less yield` : ''}.`; } },
  { lens: 'pest', re: /establishment year.*about ([\d.]+)% yield loss/,
    say: (m) => `Alfalfa yields less in the year it’s sown, about ${pct(m[1])}% less.` },
  { lens: 'pest', re: /^(.+?)(?: carried over from .+? last year)?: .*about ([\d.]+)% yield loss/,
    say: (m) => `Some ${plainCrop(m[1])} risk, about ${pct(m[2])}% less yield.` },
  { lens: 'nitrogen', re: /No legume before/, say: () => 'No beans before this corn, so budget the full nitrogen rate.' },
  { lens: 'nitrogen', re: /wasted|unless corn follows|only counts if corn follows/i,
    say: (m, c) => `The ${short(c.crop)} ${verb(c.crop, 'leave')} nitrogen that next year’s crop won’t use.` },
  { lens: 'erosion', re: /has a ([\d.]+)% slope and (.+?) leaves about ([\d.]+)% ground cover/,
    say: (m, c) => { const crop = c.crop ?? idOfName(m[2]); return `${c.field} has a ${m[1]}% slope, and ${crop ? word(crop) : plainCrop(m[2])} ${crop ? verb(crop, 'leave') : 'leaves'} only about ${coverWord(Number(m[3]))} of the ground covered.`; } },
  { lens: 'erosion', re: /has a ([\d.]+)% slope and .+?'s residue cover isn't sourced/,
    say: (m, c) => `${c.field} has a ${m[1]}% slope, and I don’t know how well ${word(c.crop)} ${verb(c.crop, 'cover')} the ground, so I assume little.` },
  { lens: 'water', re: /(?:)/, say: (m, c) => `This ground may run short of water for ${word(c.crop)}.` },
  // the planner's spring freeze on wheat (weatherWords.js reads it off the season's terms)
  { lens: 'frost', re: FREEZE_TERM,
    say: (m, c) => `Spring freezes can hurt the wheat. One got cold enough in ${m[1]} of ${m[2]} springs here${c.freeze ? `, so I take ${frostCut(c.freeze)} off` : ''}.` },
  { lens: 'frost', re: FREEZE_EVENT, say: (m, c) => `A spring freeze can hurt the wheat here, so I take ${c.freeze ? frostCut(c.freeze) : 'a little'} off.` },
  { lens: 'frost', re: /(?:)/, say: () => 'Spring freezes can hurt the wheat here.' },
  { lens: 'shade', re: /would put ([\d.]+)% of (.+?) \(to the north\) in noon shade/,
    say: (m, c) => `The ${word(c.crop)} here would shade about ${Math.round(Number(m[1]))}% of ${m[2]} at noon.` },
  { lens: 'shade', re: /([\d.]+)% of .+? is in noon shade/,
    say: (m) => `About ${Math.round(Number(m[1]))}% of the field is shaded at noon, which trims yield a little.` },
  { lens: 'market', re: /^Needs a confirmed buyer/,
    say: (m, c) => `${cap(word(c.crop))} needs a buyer lined up first, since few local buyers take it.` },
  { lens: 'market', re: /(?:)/, say: (m, c) => `Local buyers may not take this much ${word(c.crop)}.` },
  { lens: 'land', re: /seed isn't available locally/, say: (m, c) => `${cap(word(c.crop))} seed isn’t sold near here.` },
  { lens: 'land', re: /needs (.+?), which you've said you don't have/,
    say: (m, c) => `${cap(word(c.crop))} needs ${plainKit(m[1])}, which you don’t have yet.` },
  { lens: 'land', re: /isn't a usual crop in (.+?) \(/,
    say: (m, c) => `${cap(word(c.crop))} isn’t a usual crop in ${m[1]}, so check with local advisers first.` },
  { lens: 'land', re: /^Salinity .*? to about ([\d.]+)% of normal/,
    say: (m, c) => `Salty ground here cuts ${word(c.crop)} yield to about ${pct(m[1])}% of normal.` },
  { lens: 'land', re: /(?:)/, say: (m, c) => `This ground doesn’t suit ${word(c.crop)} well.` },
];

const LENS_WORD = { nitrogen: 'nitrogen', pest: 'pest', water: 'water', frost: 'frost', erosion: 'erosion', repeat: 'rotation', shade: 'shade', market: 'market', land: 'land' };

/** The WARN_PHRASE entry for a warning, or null (it then gets the plain fallback). */
export function warnEntry(w) {
  return WARN_PHRASE.find((e) => e.lens === w.lens && e.re.test(w.reason || '')) || null;
}

/** A warning in Manami's words (without its severity word). */
export function warnLine(w, ctx = {}) {
  const e = warnEntry(w);
  if (e) return e.say(e.re.exec(w.reason || ''), ctx, w);
  const lens = LENS_WORD[w.lens] || String(LENS_LABEL[w.lens] || 'planner').toLowerCase();
  return `${/^[aeiou]/.test(lens) ? 'An' : 'A'} ${lens} note here. The details are in the fine print.`;
}

/** A warning with its severity word, as in lists and the tooltip: "Careful: corn on corn usually needs…". */
export function sevPhrase(w, ctx = {}) {
  const text = warnLine(w, ctx);
  const named = ctx.field && ctx.field !== THIS_FIELD && text.startsWith(ctx.field); // a field's name keeps its capital
  return `${SEVERITY_LABEL[w.severity]}: ${named ? text : lowerFirst(text)}`;
}

// where the field is already named (its card, its tooltip, its row), a phrase says "This field" instead
const THIS_FIELD = 'This field';
const here = (ctx) => ({ ...ctx, field: THIS_FIELD });

/** What warnLine needs to know about a field and season. */
export function warnCtx(cmp, id, view, season, choice) {
  const f = fieldOf(cmp, id);
  const seasons = entryOf(f, view, choice).seasons;
  const s = seasons[season];
  return { field: f.name, crop: s.crop, prev: prevCrop(f, seasons, season), year: cmp.years[season], slopePct: f.slopePct, drag: s.drag, unit: s.unit, freeze: s.freeze ?? null };
}

/** Every warning for a field on a view, for the card's "What to watch": [{ season, year, severity, label, lens, text }]. */
export function watchItems(cmp, id, view, choice) {
  const e = viewField(cmp, id, view, choice);
  return e.seasons.flatMap((s, y) => s.warnings.map((w) => ({
    season: y, year: cmp.years[y], severity: w.severity, label: SEVERITY_LABEL[w.severity], lens: w.lens,
    text: warnLine(w, here(warnCtx(cmp, id, view, y, choice))),
  })));
}

/**
 * The Notes sheet's watch rows: one per field and season with anything to watch, in field order:
 * [{ id, season, severity, lens, text: "North draw · 2027 · Careful: corn on corn usually needs rootworm control." }].
 */
export function watchRows(cmp, view, choice) {
  const rows = [];
  for (const f of cmp.fields) {
    viewField(cmp, f.id, view, choice).seasons.forEach((s, y) => {
      const h = headline(s.warnings);
      if (!h) return;
      rows.push({ id: f.id, season: y, severity: s.worst, lens: h.lens, text: `${f.name} · ${cmp.years[y]} · ${sevPhrase(h, here(warnCtx(cmp, f.id, view, y, choice)))}` });
    });
  }
  return rows;
}

// the farm-wide risks the planner writes (the per-field ones come from the rule checks instead)
const FARM_RISK = [
  { re: /^In a bad run of years \(P10\) this plan loses \$([\d,]+)/,
    say: (m) => `In a bad run of years this plan could lose about ${moneyAbout(Number(m[1].replace(/,/g, '')))} over 3 seasons.` },
  { re: /^Year (\d): the farm grows more (.+?) than local buyers take/,
    say: (m, cmp) => `In ${cmp.years[Number(m[1]) - 1] ?? 'one season'}, the farm grows more ${saidName(m[2])} than local buyers take.` },
  // the wheat's spring freeze, with the caveat that the rule is a Kansas one
  { re: FREEZE_TERM,
    say: (m, cmp) => {
      const how = STAGE_WORD[m[3]];
      const caveat = frostCaveat(cmp.facts?.state ?? null, m[3]);
      return `In ${m[1]} of ${m[2]} springs here, a freeze got cold enough to hurt the wheat${how ? ` ${how}` : ''}.${caveat ? ` ${caveat}` : ''}`;
    } },
];

/** The farm-wide risks for a plan: { lines (in her words), unmatched (word for word) }. */
export function farmRiskLines(cmp, kind, mixScore, choice) {
  const risks = rawFor(cmp, kind, mixScore, choice).risks;
  const fieldNames = cmp.fields.map((f) => f.name);
  const lines = [], unmatched = [];
  for (const r of risks) {
    if (fieldNames.some((n) => r.startsWith(`${n}, year `) || r.startsWith(`${n}: `))) continue;
    const hit = FARM_RISK.map((e) => [e, e.re.exec(r)]).find(([, m]) => m);
    if (hit) lines.push(hit[0].say(hit[1], cmp));
    else unmatched.push(r);
  }
  return { lines: [...new Set(lines)], unmatched };
}

// ---- gaps ----

const shadeVerb = (crops) => (crops.length > 1 || CROP_WORD[idOfName(crops[0])]?.plural || /s$/.test(crops[0]) ? 'handle' : 'handles');

/**
 * The planner's gaps and local-review notes in Manami's words. `field: true` entries name a field
 * first (m[1]); they get a card line for that field, and the farm line groups them.
 */
export const GAP_PHRASE = [
  // a field's jar test (farmInput.js): ahead of 'survey', which the no-survey jar line would match too
  { key: 'jarNoSurvey', field: true, re: /^(.+?): no soil survey yet, but soil texture from your jar test \((.+?)\)/,
    farm: (ms) => `I’ve used your jar test for ${names(ms.map((m) => m[1]))} instead of the soil map.`,
    card: (m) => `I don’t have a soil survey here, so I used your jar test: ${m[2].split(',')[0]}.` },
  { key: 'jar', field: true, re: /^(.+?): soil texture from your jar test \((.+?)\) instead of the soil survey \((.+)\)\.$/,
    farm: (ms) => `I’ve used your jar test for ${names(ms.map((m) => m[1]))} instead of the soil map.`,
    card: (m) => `Your jar test says ${m[2].split(',')[0]} here, so I planned with that instead of the soil map’s ${m[3]}.` },
  { key: 'record', field: true, re: /^(.+?): (?:(\d{4})'s crop isn't|the (\d{4})-(\d{4}) crops aren't) on record yet, .*\((.+)\)\.$/,
    farm: ([m]) => `I don’t have ${m[2] ? `${m[2]}’s crops` : `the ${m[3]} to ${m[4]} crops`} on record yet, so I’ve taken each field to follow its usual turn.`,
    card: (m) => (m[2]
      ? `I’ve taken ${m[2]} to be ${joinAnd(m[5].split(/,\s*/).map((c) => word(c)))} here, since it isn’t on record yet.`
      : `I’ve taken ${m[3]} to ${m[4]} to follow your usual turn here, since they aren’t on record yet.`) },
  { key: 'tile', field: true, re: /^(.+?): poorly drained soil .* tile drained\.$/,
    farm: (ms) => `I’ve taken ${names(ms.map((m) => m[1]))} to be tile drained.`,
    card: () => 'The soil drains poorly, so I’ve taken it to be tile drained.' },
  { key: 'survey', field: true, re: /^(.+?): no soil survey yet/,
    farm: (ms) => `I don’t have a soil survey for ${names(ms.map((m) => m[1]))} yet, so I’ve taken a typical loam on a gentle slope.`,
    card: () => 'I don’t have a soil survey here yet, so I’ve taken it to be a typical loam on a gentle slope.' },
  { key: 'history', field: true, re: /^(.+?): only (\d) of the last 3 years' crops are on record/,
    farm: (ms) => `Only part of the crop history is on record for ${names(ms.map((m) => m[1]))}, so my picks there are rougher.`,
    card: (m) => `Only ${m[2]} of the last 3 years’ crops here are on record, so my picks for it are rougher.` },
  { key: 'ph', re: /soil pH is unknown/, farm: () => 'I don’t know your soil pH yet, so I haven’t checked it.' },
  { key: 'erodibility', re: /erodibility K/, farm: () => 'I can’t put erosion in tons yet, so I flag risky slopes instead.' },
  { key: 'prices', re: /sampled independently per crop/, farm: () => 'I treat corn and bean prices as moving on their own, which they don’t quite.' },
  { key: 'shade', re: /Shade tolerance for (.+?) is not/,
    farm: (ms) => { const crops = [...new Set(ms.map((m) => saidName(m[1])))]; return `I’m guessing how well ${joinAnd(crops)} ${shadeVerb(crops)} shade.`; } },
  { key: 'nrcs', field: true, re: /^(.+?) is sloped: ask NRCS/,
    card: () => 'It’s worth asking NRCS about contour strips, terraces or more residue for the low-cover years.' },
  { key: 'yields', re: /Yields start from US averages/, farm: () => 'My yields start from US averages, so check them against your own records.' },
  { key: 'pests', re: /Pest and disease penalties/, farm: () => 'My pest and disease numbers are estimates. Your agronomist will know local pressure.' },
  { key: 'freeze', re: /^Freeze injury uses NASA POWER daily minimum/,
    farm: () => 'I count a freeze when a night after March 1 gets colder than the wheat can take at its stage. I use weather for the wider area, so low spots may get colder, and I don’t count snow cover.' },
];

/** Every raw gap and local-review note, once each. */
function allGaps(cmp) {
  const review = [...Object.values(cmp.notes.byField).flatMap((n) => n.review), ...cmp.notes.farm.localReview];
  return [...new Set([...cmp.gaps, ...cmp.notes.farm.informationGaps, ...review])];
}

/**
 * The gaps in Manami's words: { farm: [grouped lines], byField: { id: [card lines] }, unmatched: [raw] }.
 * A gap naming a field two fields share stays farm-wide.
 */
export function gapLines(cmp) {
  const byName = idsByName(cmp.fields);
  const byField = Object.fromEntries(cmp.fields.map((f) => [f.id, []]));
  const hits = new Map(); // entry -> matches, in the order first seen
  const lone = []; // card-only lines for a field that couldn't be told apart
  const unmatched = [];
  for (const g of allGaps(cmp)) {
    const e = GAP_PHRASE.find((x) => x.re.test(g));
    if (!e) { unmatched.push(g); continue; }
    const m = e.re.exec(g);
    if (!hits.has(e)) hits.set(e, []);
    hits.get(e).push(m);
    const id = e.field ? byName.get(m[1]) : null;
    if (id && e.card) byField[id].push(e.card(m));
    else if (e.field && !e.farm && e.card) lone.push(`For ${m[1]}, ${lowerFirst(e.card(m))}`);
  }
  const farm = [...hits].filter(([e]) => e.farm).map(([e, ms]) => e.farm(ms));
  for (const id of Object.keys(byField)) byField[id] = [...new Set(byField[id])];
  return { farm: [...new Set([...farm, ...lone])], byField, unmatched };
}

// ---- the walk ----

/** Stop 0: this season if the farmer keeps going. */
export function introLine(cmp) {
  const y0 = cmp.years[0];
  const rep = cmp.fields.filter((f) => f.isRepeat0);
  if (!rep.length) return `This is ${y0} if you keep going, your rotation as it is.`;
  const byCrop = new Map();
  for (const f of rep) {
    const c = f.byKind.current.seasons[0].crop;
    if (!byCrop.has(c)) byCrop.set(c, []);
    byCrop.get(c).push(f.name);
  }
  if (byCrop.size > 2) return `This is ${y0} if you keep going. ${rep.length} of your fields grow the same crop again.`;
  const parts = [...byCrop].map(([c, ns]) => `${names(ns)} ${ns.length === 1 ? 'grows' : 'grow'} ${word(c)} again`);
  return `This is ${y0} if you keep going. ${parts.join(', and ')}.`;
}

/** Stop 1: the farm flips to the pick. */
export function flipLine(cmp) {
  const y0 = cmp.years[0];
  const n = [...seasonChanges(cmp, 'priority')[0].values()].filter((v) => v === 'crop').length;
  const gain = cmp.totals.priority.expectedGM - cmp.totals.current.expectedGM;
  const beats = cmp.totals.priority.probBeatsCurrent;
  const s2 = n ? `It changes ${n} field${n === 1 ? '' : 's'} in ${y0}.` : `It keeps your ${y0} crops and changes later seasons.`;
  // earning less, say what it buys instead of how rarely it beats keeping going
  const dSoil = cmp.totals.priority.endSoil100 - cmp.totals.current.endSoil100;
  const covers = coverAddFields(cmp).length;
  const buys = [];
  if (dSoil > 0) buys.push(`the soil ends ${points(dSoil)} higher`);
  if (covers) buys.push(`${covers} field${covers === 1 ? '' : 's'} ${covers === 1 ? 'gets' : 'get'} a winter cover`);
  const s3 = gain <= -500 && buys.length
    ? `Over 3 seasons it earns about ${about(gain)} less, and in return ${buys.join(' and ')}.`
    : `Over 3 seasons it earns about ${about(gain)} ${moreLess(gain)}${beats != null ? `, and beats keeping going in ${Math.round(beats * 100)}% of the weather years I tried` : ''}.`;
  return `Here’s my pick. ${s2} ${s3}`;
}

/** Stop 2: the field the pick gains most on (null when no field gains more than $1k). */
export function gainLine(cmp) {
  const f = gainField(cmp);
  if (!f) return null;
  const y = firstCropChange(cmp, f.id);
  const p = f.byKind.priority.seasons, c = f.byKind.current.seasons;
  const year = cmp.years[y];
  const d = acreGain(p[y], c[y]);
  let s2;
  if (sameCrops(p[y], c[y])) s2 = `Same ${cellWords(p[y])} here in ${year}, but it earns about ${perAcre(Math.abs(d))} ${moreLess(d)} an acre.`;
  else {
    const repeats = c[y].crop === prevCrop(f, c, y);
    const than = `${repeats ? 'more ' : ''}${word(c[y].crop)}`;
    s2 = d === 0
      ? `${cap(cellWords(p[y]))} here in ${year} ${verb(p[y].crop, 'earn')} about as much an acre as ${than}.`
      : `${cap(cellWords(p[y]))} here in ${year} ${verb(p[y].crop, 'earn')} about ${perAcre(Math.abs(d))} ${moreLess(d)} an acre than ${than}.`;
  }
  const nNext = y < 2 && p[y + 1].nCredit > 0 && !(c[y + 1].nCredit > 0);
  const s3 = nNext ? ` The ${short(p[y].crop)} also ${verb(p[y].crop, 'leave')} nitrogen for the ${year + 1} ${word(p[y + 1].crop)}.` : '';
  return `${f.name} gains the most, about ${about(f.diff.priority)} over 3 seasons. ${s2}${s3}`;
}

/** Stop 3: the same crop, but more cash an acre (null when there's no such season). */
export function sameCropLine(cmp) {
  const g = gainField(cmp);
  const pick = sameCropPick(cmp, g ? [g.id] : []);
  if (!pick) return null;
  const f = fieldOf(cmp, pick.id);
  const y = pick.season;
  const p = f.byKind.priority.seasons, c = f.byKind.current.seasons;
  let s2 = '';
  const dy = p[y].yield - c[y].yield;
  if (c[y].drag < 0 && !(p[y].drag < 0) && dy >= 1) {
    s2 = ` ${cap(word(p[y].crop))} after ${short(prevCrop(f, p, y))} ${verb(p[y].crop, 'yield')} about ${Math.round(dy)} ${p[y].unit || 'bu'} more than ${word(c[y].crop)} after ${short(prevCrop(f, c, y))}.`;
  }
  return `Same ${cellWords(p[y])} on ${f.name} in ${cmp.years[y]}, but it earns about ${perAcre(pick.delta)} more an acre.${s2}`;
}

/** Stop 4: where the pick earns less, and what it buys there (null when it earns less nowhere). */
export function giveUpLine(cmp) {
  const lose = giveUpFields(cmp);
  if (!lose.length) return null;
  const f = lose[0];
  const p = f.byKind.priority.seasons, c = f.byKind.current.seasons;
  // "the one place" only when no other field earns less at all (not just by more than $500)
  const alone = cmp.fields.every((x) => x === f || x.diff.priority >= 0);
  const s1 = alone
    ? `${f.name} is the one place my pick earns less, about ${about(f.diff.priority)} over 3 seasons.`
    : `${f.name} gives up the most on my pick, about ${about(f.diff.priority)} over 3 seasons.`;
  const s2 = p[2].soil100 - c[2].soil100 >= 5
    ? ` It ends on ${endWords(p)}, so its soil scores ${p[2].soil100} in ${cmp.years[2]} instead of ${c[2].soil100}.`
    : '';
  let s3 = '';
  const y = p.findIndex((s) => s.warnings.some((w) => w.lens === 'erosion' && w.severity >= 2));
  const m = y >= 0 && /leaves about ([\d.]+)% ground cover/.exec(p[y].warnings.find((w) => w.lens === 'erosion' && w.severity >= 2).reason);
  if (m) s3 = ` Careful: ${short(p[y].crop)} in ${cmp.years[y]} ${verb(p[y].crop, 'leave')} this slope only about ${coverWord(Number(m[1]))} covered.`;
  return `${s1}${s2}${s3}`;
}

// when the plans differ but the pick gives up under $1k of cash and next to no nitrogen
// (it isn't the most-profit plan, so don't say it is)
const COSTS_NEXT_TO_NOTHING = 'My pick earns about as much as the most-profit plan, so it costs you next to nothing.';

/**
 * Stop 5: the most-profit plan next to the pick (null when they are the same plan). Measured in
 * cash, as the tiles are: the planner's profitCost also counts the nitrogen left, which isn't cash.
 */
export function vsProfitLine(cmp) {
  if (samePlans(cmp, 'maxProfit', 'priority')) return null;
  const t = cmp.totals;
  const dGm = t.maxProfit.expectedGM - t.priority.expectedGM;
  if (Math.abs(dGm) < 1000 && Math.abs(cmp.price.nCarried) <= 500) return COSTS_NEXT_TO_NOTHING;
  const dBad = t.priority.p10GM - t.maxProfit.p10GM;
  const dSoil = t.priority.endSoil100 - t.maxProfit.endSoil100;
  const s1 = Math.abs(dGm) < 500 ? 'The most-profit plan earns about the same as mine.' : `The most-profit plan earns about ${about(dGm)} ${moreLess(dGm)} than mine.`;
  const bad = Math.abs(dBad) < 500 ? 'A bad year is about the same' : `A bad year is about ${about(dBad)} ${dBad > 0 ? 'worse' : 'better'}`;
  const soil = dSoil === 0 ? 'the soil ends the same' : `the soil ends ${points(Math.abs(dSoil))} ${dSoil > 0 ? 'lower' : 'higher'}`;
  return `${s1} ${bad}, and ${soil}.`;
}

const WEIGHT_WORD = { profit: 'profit', soilHealth: 'soil health', water: 'water' };
// what the farmer asked for first, for "You asked me to …"
const ASK_WORD = { profit: 'put profit first', soilHealth: 'look after the soil first', water: 'save water', risk: 'keep risk low' };

/**
 * Stop 6 (and the Notes): how much say each priority got. Said as what I did; "matters most to you"
 * only when the farmer put that priority first and it got the most say on its own.
 */
export function weightsLine(weights) {
  if (!weights?.top) return 'I weighed your priorities just as you set them.';
  const asked = weights.asked ?? null;
  // biggest say first; on a tie, what the farmer asked for first
  const say = Object.entries(weights.pcts).filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || (b[0] === asked) - (a[0] === asked));
  if (!say.length) return 'I weighed your priorities just as you set them.';
  const W = (k) => WEIGHT_WORD[k];
  const [topKey, topPct] = say[0];
  const tied = say.filter(([, v]) => v === topPct);
  const mine = asked === topKey && tied.length === 1;
  const it = mine ? 'it' : W(topKey);
  let split;
  if (say.length === 1) split = `I gave ${it} all of the say`;
  else if (tied.length > 1) {
    const rest = say.slice(tied.length);
    split = `I gave ${joinAnd(tied.map(([k]) => W(k)))} ${share(topPct)} of the say each${rest.length ? ` and ${joinAnd(rest.map(([k]) => W(k)))} the rest` : ''}`;
  } else if (say.length === 2) split = `I gave ${it} ${share(topPct)} of the say and ${W(say[1][0])} the rest`;
  else split = `I gave ${it} ${share(topPct)} of the say, ${W(say[1][0])} ${share(say[1][1])} and ${W(say[2][0])} the rest`;
  const plentiful = weights.waterPlentiful && !(weights.pcts.water > 0);
  // the farmer's own first pick got no say at all: lead with that, and why
  if (asked && asked !== 'risk' && !(weights.pcts[asked] > 0)) {
    const why = asked === 'water' && plentiful ? 'water’s plentiful here' : 'it doesn’t change the plans here';
    return `You asked me to ${ASK_WORD[asked]}, but ${why}, so I left it out. ${split}.`;
  }
  let s1;
  if (mine) s1 = say.length === 1 ? `${cap(W(topKey))} is all that counts for you, so I gave it all of the say.` : `${cap(W(topKey))} matters most to you, so ${split}.`;
  else if (asked === 'risk') s1 = `You asked me to keep risk low, so I count a bad year more. ${split}.`;
  else s1 = `${split}.`;
  const water = plentiful ? ' Water’s plentiful here, so I left it out.' : '';
  return `${s1}${water}`;
}

// what a season's careful-or-worse warnings are mostly about, for stop 7 (first wins a tie)
const TOPICS = [
  { test: (w) => /rootworm/i.test(w.reason), say: 'rootworm', tail: ', where corn follows corn' },
  { test: (w) => w.lens === 'erosion', say: 'thin ground cover' },
  { test: (w) => /white mold/i.test(w.reason), say: 'white mold' },
  { test: (w) => /cyst nematode|SCN/.test(w.reason), say: 'cyst nematode' },
  { test: (w) => w.lens === 'repeat', say: 'the same crop again' },
  { test: (w) => w.lens === 'pest', say: 'pests' },
  { test: (w) => w.lens === 'water', say: 'water' },
  { test: (w) => w.lens === 'land', say: 'how well the ground suits the crop' },
  { test: (w) => w.lens === 'market', say: 'selling the crop' },
  { test: (w) => w.lens === 'shade', say: 'shade' },
  { test: (w) => w.lens === 'frost', say: 'spring freezes on the wheat' },
  { test: () => true, say: 'a few things' },
];

/** Stop 7: what to watch most on the pick. */
export function watchLine(cmp) {
  const y = watchSeason(cmp);
  const flags = flagsFor(cmp, 'priority', null, y).filter((x) => x.worst >= 2);
  if (!flags.length) return 'Nothing on my pick needs much watching. The blue dots are small notes.';
  const count = TOPICS.map((t) => flags.filter((x) => x.warnings.some((w) => w.severity >= 2 && t.test(w))));
  const best = count.reduce((a, fs, i) => (fs.length > count[a].length ? i : a), 0);
  const t = TOPICS[best];
  const who = names(count[best].map((x) => fieldOf(cmp, x.id).name));
  const red = flags.some((x) => x.worst >= 3), amber = flags.some((x) => x.worst === 2);
  const dots = red ? (amber ? 'Red and amber dots' : 'Red dots') : 'Amber dots';
  return `${dots} are what I’d watch most. In ${cmp.years[y]}, that’s ${t.say} on ${who}${t.tail || ''}. Tap a field, or open Why and watch out for the full list.`;
}

/** Stop 8: over to the farmer. */
export const yourTurnLine = () => 'Your turn. Tap a field to pick its plan, then press Use this plan.';

/** Instead of stops 1 to 7, when the pick hardly changes anything (see isGoodFit). */
export function goodFitLine(cmp) {
  const n = cmp ? coverOnlyFields(cmp).length : 0;
  if (!n) return 'Your rotation is already a good fit. My pick changes little over the 3 seasons.';
  const adds = coverAddFields(cmp).length === n;
  const fields = `${n} field${n === 1 ? '' : 's'}`;
  const gain = cmp.totals.priority.expectedGM - cmp.totals.current.expectedGM;
  const cost = gain < 0 ? 'which costs under $1k over 3 seasons' : 'and earns about the same over 3 seasons';
  return `Your rotation is already a good fit. My pick keeps your crops and only ${adds ? 'adds a winter cover on' : 'changes the winter covers on'} ${fields}, ${cost}.`;
}

// ---- the weather ----

/** The fields' names for a list of ids. */
const namesOf = (cmp, ids) => names([...ids].map((id) => fieldOf(cmp, id).name));

/**
 * The walk's frost stop: where the pick sows wheat a spring freeze can hurt, how often one did, and
 * how much I take off for it (never in dollars). Null when the pick has no freeze.
 */
export function frostLine(cmp) {
  const st = frostStop(cmp);
  if (!st) return null;
  const seasons = st.ids.map((id) => fieldOf(cmp, id).byKind.priority.seasons[st.season]);
  const fz = seasons.reduce((a, s) => (s.freeze.pct > a.pct ? s.freeze : a), seasons[0].freeze);
  const crops = [...new Set(seasons.map((s) => s.crop))];
  const caveat = frostCaveat(cmp.facts?.state ?? null, fz.stage);
  return `My pick sows ${joinAnd(crops.map(word))} on ${namesOf(cmp, st.ids)} for the ${cmp.years[st.season]} harvest. ${springsWords(fz)}, a night got cold enough to hurt it, so I take ${frostCut(fz)} off.${caveat ? ` ${caveat}` : ''}`;
}

/** The status line for the card's freeze peek: "A spring freeze on the farm in 2028. It could hurt the wheat on …". */
export function frostPeekLine(cmp, season, ids) {
  return `A spring freeze on the farm in ${cmp.years[season]}. It could hurt the wheat on ${namesOf(cmp, ids)}.`;
}

/** The walk's dry stop, where water is the weather worry (null where it isn't, or no field runs short). */
export function dryLine(cmp, season) {
  if (!dryIds(cmp, 'priority', season).size) return null;
  return `Water is the big weather worry here, so dry years are the ones to plan for. The drops show the fields my pick leaves short of water in ${cmp.years[season]}.`;
}

/** Explore's first line when the walk is skipped. */
export function skipHintLine(cmp) {
  const f = gainField(cmp);
  return f ? `Have a look round. ${f.name} changes the most. Start there if you like.` : 'Have a look round. Tap any field to see its three plans.';
}

/** The line for a stop from reelStops() (null when the stop has nothing to say). */
export function reelLine(cmp, stop) {
  const say = {
    intro: introLine, flip: flipLine, gain: gainLine, sameCrop: sameCropLine, giveUp: giveUpLine, vsProfit: vsProfitLine,
    why: (c) => weightsLine(c.weights), watch: watchLine, yourTurn: yourTurnLine, goodFit: goodFitLine,
    frost: frostLine, dry: (c, st) => dryLine(c, st.season ?? 0),
  }[stop.id];
  return say ? say(cmp, stop) : null;
}

// ---- the field card ----

/** The card's Manami note for a field on a view. */
export function fieldLine(cmp, id, view, choice) {
  const f = fieldOf(cmp, id);
  const cur = f.byKind.current;
  if (sameEverywhere(f)) {
    const crops = [...new Set(cur.seasons.map((s) => s.crop))];
    if (crops.length === 1) return `${f.name} already grows ${word(crops[0])} every season, so all three plans leave it be.`;
    const said = crops.map((c, i) => (i ? short(c) : word(c)));
    return `${f.name} already turns ${joinAnd(said)}, so all three plans leave it be.`;
  }
  if (view === 'current') return `Keeping going means ${seqWords(cur.seasons)} here.`;
  const kind = view === 'mix' ? kindFor(choice, id) : view;
  const mine = f.byKind[kind];
  const subject = SUBJECT[view];
  if (mine.seasons.every((s, y) => sameCrops(s, cur.seasons[y]))) return `${subject} keeps your rotation here: ${seqWords(cur.seasons)}.`;
  const d = mine.total - cur.total;
  if (d >= 500) return `${subject} grows ${seqWords(mine.seasons)} here. That earns about ${about(d)} more than keeping going.`;
  if (d <= -500) {
    const p = mine.seasons;
    if (p[2].soil100 - cur.seasons[2].soil100 >= 5) return `${subject} earns about ${about(d)} less here, but it ends on ${endWords(p)}.`;
    return `${subject} grows ${seqWords(p)} here. That earns about ${about(d)} less than keeping going.`;
  }
  return `${subject} grows ${seqWords(mine.seasons)} here. That earns about the same as keeping going.`;
}

/** The card's cover-crop note (the first season with a winter cover), or null. */
export function coverLine(cmp, id, view, choice) {
  const f = fieldOf(cmp, id);
  const kind = view === 'mix' ? kindFor(choice, id) : view;
  const seasons = f.byKind[kind].seasons;
  const y = seasons.findIndex((s) => s.cover);
  if (y < 0) return null;
  const s = seasons[y];
  const who = { priority: 'I’d sow', current: 'you’d sow' }[kind] || `${SPEECH[kind]} sows`;
  const cost = s.coverCost ? `It costs about ${perAcre(Math.abs(s.coverCost))} an acre, and the soil scores ${s.soil100} that season.` : `The soil scores ${s.soil100} that season.`;
  return `In ${cmp.years[y]} ${who} ${word(s.cover)} after the ${word(s.crop)} to cover the ground over winter. ${cost}`;
}

/** Manami's answer to a pick in the card: "Got it: Home place keeps going." */
export function pickedLine(name, kind) {
  const how = { current: 'keeps going', maxProfit: 'goes for the most profit', priority: 'goes with my pick' }[kind] || 'goes with your plan';
  return `Got it: ${name} ${how}.`;
}

/** The tooltip for a field on the island: { title, note, sev }. */
export function tipFor(cmp, id, view, season, choice) {
  const f = fieldOf(cmp, id);
  const e = viewField(cmp, id, view, choice);
  const s = e.seasons[season];
  const title = `${f.name} · ${cmp.years[season]}: ${CROP_NAME[s.crop] || s.crop}${s.cover ? ` + ${short(s.cover)} cover` : ''}`;
  const h = headline(s.warnings);
  let note;
  if (h) note = sevPhrase(h, here(warnCtx(cmp, id, view, season, choice)));
  else if (sameEverywhere(f)) note = 'Same in all three plans.';
  else if ((view === 'mix' ? kindFor(choice, id) : view) === 'current') note = `About ${moneyAbout(e.total)} here over 3 seasons if you keep going.`;
  else {
    const d = e.total - f.byKind.current.total;
    note = Math.abs(d) < 500 ? 'About the same as keeping going over 3 seasons.' : `${about(d)} ${moreLess(d)} than keeping going over 3 seasons.`;
  }
  return { title, note, sev: s.worst };
}

// ---- the dock and the Notes ----

/** "Use my pick": the save button's label for a view. */
export function saveLabel(view) {
  return { current: 'Use Keep going', maxProfit: 'Use Most profit', priority: 'Use my pick', mix: 'Use this plan' }[view] || 'Use this plan';
}

/** The caption under the dock: what a coin is worth, and why a bad year isn't split by field. */
export function captionLine(coinValue) {
  return `Each coin is about ${moneyAbout(coinValue)} over 3 seasons. A bad year is farm-wide; I can’t split it by field.`;
}

/** "#futMix": what the farmer's own plan earns. */
export function mixLine(cmp, choice, mixScore) {
  const k = mixKind(cmp, mixScore, choice);
  if (k) return `Your plan: ${planName(k)} on every field, about ${money(cmp.totals[k].expectedGM)} over 3 seasons.`;
  return mixScore ? `Your plan: a mix of plans, about ${money(mixScore.expectedGM)} over 3 seasons.` : 'Your plan: a mix of plans. Working it out…';
}

const diffWords = (d) => (Math.abs(d) < 500 ? 'about the same as keeping going' : `${about(d)} ${moreLess(d)} than keeping going`);

/**
 * The season radio's screen-reader label: "2027, about $132k, $16k more than keeping going.", with
 * " Frost risk on the wheat." when a field's wheat has a spring freeze that season.
 */
export function seasonLabel(cmp, view, season, choice) {
  const cash = seasonCashFor(cmp, view, choice)[season];
  const year = cmp.years[season];
  const frost = frostIds(cmp, view, season, choice).size ? ' Frost risk on the wheat.' : '';
  if (view === 'current') return `${year}, about ${money(cash)}.${frost}`;
  return `${year}, about ${money(cash)}, ${diffWords(cash - cmp.seasonCash.current[season])}.${frost}`;
}

/** What the island shows in a season, for the status line: grouped by crop, or counted. */
function islandWords(cmp, view, season, choice) {
  const groups = new Map();
  for (const f of cmp.fields) {
    const w = cellWords(entryOf(f, view, choice).seasons[season]);
    if (!groups.has(w)) groups.set(w, []);
    groups.get(w).push(f.name);
  }
  if (cmp.fields.length <= 6) {
    const listed = [...groups].map(([w, ns]) => `${w} on ${joinAnd(ns)}`);
    const text = listed.length > 2 ? `${listed.slice(0, -1).join(', ')}, and ${listed[listed.length - 1]}` : listed.join(', and ');
    if (`The island shows ${text}.`.split(/\s+/).length <= 24) return text;
  }
  // counted by main crop, with the covers said once at the end
  const mains = new Map();
  let covered = 0, cover = null;
  for (const f of cmp.fields) {
    const s = entryOf(f, view, choice).seasons[season];
    mains.set(s.crop, (mains.get(s.crop) || 0) + 1);
    if (s.cover) { covered++; cover = s.cover; }
  }
  const counted = [...mains].sort((a, b) => b[1] - a[1])
    .map(([c, n], i) => (i ? `${n} of ${word(c)}` : `${n} field${n === 1 ? '' : 's'} of ${word(c)}`));
  // the most crops that still fit one sentence (long crop names, many crops), then the covers if they fit
  const fits = (s) => `The island shows ${s}.`.split(/\s+/).length <= 24;
  let k = Math.min(4, counted.length);
  while (k > 1 && !fits(joinAnd(counted.slice(0, k)))) k--;
  const base = joinAnd(counted.slice(0, k));
  const withCover = covered ? `${base}, ${covered} with a ${short(cover)} cover` : base;
  return fits(withCover) ? withCover : base;
}

/** "#futStatus": the view and season in words, for screen readers (Explore only). */
export function statusLine(cmp, view, season, choice, mixScore) {
  const y = cmp.years[season];
  let s1;
  if (view === 'current') s1 = `${planName(view)}, ${y}: your rotation as it is.`;
  else {
    const n = [...seasonChanges(cmp, view, choice)[season].values()].filter((v) => v === 'crop').length;
    s1 = `${planName(view)}, ${y}: ${n === 0 ? 'no fields change' : n === 1 ? '1 field changes' : `${n} fields change`}.`;
  }
  const cash = tiles(cmp, view, mixScore, choice)[0];
  let s2 = '';
  if (cash.value != null) s2 = view === 'current' ? ` About ${money(cash.value)} over 3 seasons.` : ` About ${money(cash.value)} over 3 seasons, ${diffWords(cash.diff)}.`;
  return `${s1}${s2} The island shows ${islandWords(cmp, view, season, choice)}.`;
}

/**
 * The price of the farmer's priorities, from its terms (not its summary, whose water sign reads
 * backwards): what the pick gives up next to the most-profit plan, and what it gets in return.
 * Cash and nitrogen are said apart (not as the planner's profitCost, which adds them up).
 */
export function priceLine(price) {
  if (!price || price.samePlan) return 'My pick is the most-profit plan here, so it costs you nothing.';
  // under $1k of cash reads as the same; under $500 of nitrogen isn't worth a word
  const cash = Math.abs(price.cash) < 1000 ? 0 : price.cash;
  const n = Math.abs(price.nCarried) <= 500 ? 0 : price.nCarried;
  if (!cash && !n) return COSTS_NEXT_TO_NOTHING;
  let s1;
  if (!cash) s1 = `My pick earns about as much cash as the most-profit plan, ${n > 0 ? 'and' : 'but'} leaves ${about(n)} ${moreLess(n)} nitrogen in the ground`;
  else if (cash > 0) s1 = `Next to the most-profit plan, mine earns about ${about(cash)} more cash${n ? ` ${n > 0 ? 'and' : 'but'} leaves ${about(n)} ${moreLess(n)} nitrogen in the ground` : ''}`;
  else {
    const costs = [`${about(cash)} of cash`];
    if (n < 0) costs.push(`${about(n)} of nitrogen left in the ground`);
    s1 = `Next to the most-profit plan, mine gives up about ${costs.join(' and ')}${n > 0 ? ` but leaves ${about(n)} more nitrogen in the ground` : ''}`;
  }
  const gains = [], losses = [];
  if (price.p10 >= 500) gains.push(`a bad year is ${about(price.p10)} better`);
  else if (price.p10 <= -500) losses.push(`a bad year is ${about(price.p10)} worse`);
  const pts = Math.round(price.soilAvgPts);
  if (pts > 0) gains.push(`the soil scores ${points(pts)} higher on average`);
  else if (pts < 0) losses.push(`the soil scores ${points(-pts)} lower on average`);
  let s2 = '';
  if (gains.length) s2 = `In return ${gains.join(', and ')}${losses.length ? `, but ${losses.join(' and ')}` : ''}.`;
  else if (losses.length) s2 = `${cap(losses.join(', and '))}.`;
  // with real weather the water numbers are inches a season; without, only a crop-water index (no unit to say)
  const w = price.waterIn;
  const more = w > 0 ? 'more' : 'less';
  let s3 = '';
  if (price.waterInches === false) s3 = Math.abs(w) < 0.05 ? '' : `It needs a little ${more} water.`;
  else if (Math.abs(w) >= 0.05) s3 = `It uses ${Math.abs(w) < 1 ? 'a little ' : ''}${more} water, about ${Math.abs(w).toFixed(1)} in a season.`;
  return [s1 && `${s1}.`, s2, s3].filter(Boolean).join(' ');
}

/** How often a crop follows beans on a plan, and what the nitrogen saves each time. */
export function nLine(cmp, view, choice) {
  const hits = new Map(); // "corn after soybeans" -> credits
  for (const f of cmp.fields) {
    const seasons = entryOf(f, view, choice).seasons;
    seasons.forEach((s, y) => {
      if (!(s.nCredit > 0)) return;
      const key = `${s.crop}|${prevCrop(f, seasons, y)}`;
      if (!hits.has(key)) hits.set(key, []);
      hits.get(key).push(s.nCredit);
    });
  }
  if (!hits.size) return `No crop follows beans ${IN_PLAN[view]}, so there’s no nitrogen credit to count.`;
  const [key, credits] = [...hits].reduce((a, b) => (b[1].length > a[1].length ? b : a));
  const [crop, prev] = key.split('|');
  const avg = credits.reduce((a, b) => a + b, 0) / credits.length;
  return `${cap(word(crop))} ${verb(crop, 'follow')} ${short(prev)} ${times(credits.length)} ${IN_PLAN[view]}, and each time it saves about ${perAcre(avg)} an acre of nitrogen.`;
}

/** The nitrogen a plan leaves after its 3 seasons (not cash), or null when there's next to none. */
export function nCarriedLine(cmp, view, mixScore, choice) {
  let t;
  if (view === 'mix') { const k = mixKind(cmp, mixScore, choice); t = k ? cmp.totals[k] : totalsOf(mixScore); } else t = cmp.totals[view];
  if (!t || !(t.nCarried >= 50)) return null;
  return `It also leaves about ${about(t.nCarried)} of nitrogen in the ground for ${cmp.years[0] + 3}. That isn’t cash, so I don’t count it.`;
}

/** Where the weather years came from. */
export function weatherLine(weather) {
  const place = weather?.place ?? /weather for (.+?) \(/.exec(weather?.source || '')?.[1] ?? null;
  const n = weather?.years || 0;
  if (n < 2) return 'I couldn’t get real weather records here, so I tried each plan in one average year.';
  if (!place || place === 'this farm') return `I tried each plan against ${n} years of real weather for your farm.`;
  return `I tried each plan against ${n} years of real weather from ${place}.`;
}

/** Every line the plan views can say for a comparison, for the lint test (and nothing else). */
export function allLines(cmp, { choice, mixScore } = {}) {
  const views = [...KINDS, 'mix'];
  const out = [introLine(cmp), flipLine(cmp), gainLine(cmp), sameCropLine(cmp), giveUpLine(cmp), vsProfitLine(cmp),
    weightsLine(cmp.weights), watchLine(cmp), yourTurnLine(), goodFitLine(cmp), skipHintLine(cmp), priceLine(cmp.price), weatherLine(cmp.weather),
    captionLine(coinPlan(cmp).value), frostLine(cmp)];
  for (const wheat of [false, true]) out.push(weatherRiskLine(cmp.weatherRisk, { wheat, irrigated: !!cmp.facts?.irrigated }));
  const gaps = gapLines(cmp);
  out.push(...gaps.farm, ...Object.values(gaps.byField).flat());
  for (const view of views) {
    out.push(nLine(cmp, view, choice), nCarriedLine(cmp, view, mixScore, choice), mixLine(cmp, choice, mixScore));
    out.push(...farmRiskLines(cmp, view, mixScore, choice).lines, ...watchRows(cmp, view, choice).map((r) => r.text));
    for (const f of cmp.fields) {
      out.push(fieldLine(cmp, f.id, view, choice), coverLine(cmp, f.id, view, choice), pickedLine(f.name, view));
      out.push(...watchItems(cmp, f.id, view, choice).map((w) => w.text));
      for (const y of [0, 1, 2]) {
        const tip = tipFor(cmp, f.id, view, y, choice);
        out.push(tip.note, statusLine(cmp, view, y, choice, mixScore), seasonLabel(cmp, view, y, choice));
      }
    }
    for (const y of [0, 1, 2]) {
      const ids = frostIds(cmp, view, y, choice);
      if (ids.size) out.push(frostPeekLine(cmp, y, ids));
    }
  }
  for (const y of [0, 1, 2]) out.push(dryLine(cmp, y));
  return out.filter((s) => s != null);
}
