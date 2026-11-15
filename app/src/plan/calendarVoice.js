// Manami's sowing and harvest lines for the "When to sow" tab and the field stories. Every line
// passes futuresVoice.lintLine (at most 3 sentences of 24 words, curly apostrophes, no planner
// words). Insurance dates are always "the last day for full insurance", never "best", and a state
// row is never "here" (only a county row is). Plain text: the caller escapes it.
// (crop words from planNames, not futuresVoice: builder.js's timing lens reads these lines, and
// futuresVoice imports builder.js)
import { CROP_WORD, CROP_NAME } from './planNames.js';
import {
  windowsFor, coverFor, frostFor, regionOf, hasCounty, dayOf, fmt, rangeWords, partWords, monthName, STATE_NAME, LABEL,
} from './cropCalendar.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const plainCrop = (name) => String(name || '').replace(/\s*\(.*?\)/g, '').trim().toLowerCase();
const wordsOf = (id) => CROP_WORD[id] || { word: plainCrop(CROP_NAME[id] || id), short: plainCrop(CROP_NAME[id] || id), plural: false };
/** "soybeans": the crop the first time in a line (as futuresVoice.word). */
const word = (id) => wordsOf(id).word;
/** "beans": the crop once it has been named (as futuresVoice.short). */
const short = (id) => wordsOf(id).short;
/** Field names in a sentence (as futuresVoice.names): "a, b and c", or "8 of your fields" past `max`. */
const names = (list, max = 3) => (list.length > max ? `${list.length} of your fields`
  : list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);
const plural = (id) => !!CROP_WORD[id]?.plural;
/** "comes" for corn, "come" for soybeans. */
const verb = (id, stem) => (plural(id) ? stem : `${stem}s`);
const isAre = (id) => (plural(id) ? 'are' : 'is');
const stateName = (place) => STATE_NAME[place?.state] ?? null;
const stateWords = (place) => stateName(place) ?? 'your state';

/** "Apr 15 to May 9", "by May 20", or the usual run "Apr 25 to May 18, as most farms do". */
function sowWords(w) {
  const b = w.sow.best;
  if (b?.from && b.to) return rangeWords(b.from, b.to);
  if (b?.to) return `by ${fmt(b.to)}`;
  const u = w.sow.usual;
  if (u?.active[0] && u.active[1]) return `${rangeWords(u.active[0], u.active[1])}, as most farms do`;
  return null;
}

/** The insurance sentence: "The last day for full insurance here is May 31." */
function insuranceSentence(w) {
  const i = w?.sow.insurance;
  if (!i?.final) return null;
  const what = i.what === 'spring' ? ` on a spring seeding` : '';
  return `The last day for full insurance${what} ${i.scopeWords} is ${fmt(i.final)}.`;
}

/** §6.9: a crop's sowing window, the recent pace and the last day for full insurance. */
export function cropWindowLine(cropId, place) {
  const w = windowsFor(cropId, place);
  if (!w) return gapLine(cropId, place);
  const W = cap(word(cropId));
  const b = w.sow.best;
  const soil = w.sow.soilCue ? ', once the soil is 50°F and warming' : '';
  const out = [];
  if (b?.secondary && b.from && b.to) out.push(`A farmer group in ${stateWords(place)} advises sowing ${word(cropId)} ${rangeWords(b.from, b.to)}.`);
  else if (b?.from && b.to) out.push(`${W} ${verb(cropId, 'yield')} best sown ${rangeWords(b.from, b.to)}${soil}.`);
  else if (b?.to) out.push(`${W} ${verb(cropId, 'yield')} best sown by ${fmt(b.to)}${soil}.`);
  else {
    out.push(`I don’t have a best sowing window for ${word(cropId)} in ${stateWords(place)} yet.`);
    const u = w.sow.usual;
    if (u?.active[0] && u.active[1]) out.push(`Most farms there plant ${rangeWords(u.active[0], u.active[1])}.`);
  }
  const r = w.sow.recent;
  if (r?.p50 && out.length < 2) out.push(`Lately half of ${stateWords(place)}’s ${word(cropId)} ${isAre(cropId)} in by ${fmt(r.p50)}.`);
  const ins = insuranceSentence(w);
  if (ins) out.push(ins);
  return out.slice(0, 3).join(' ');
}

/** §6.10: a season card's When line, "Sow Apr 15 to May 9. Harvest early October to early November." → string|null */
export function seasonWhenLine(cropId, year, place) {
  void year;
  const w = windowsFor(cropId, place);
  if (!w) return null;
  const h = w.harvest.usual;
  const harvest = h?.active[0] && h.active[1] ? `${partWords(h.active[0])} to ${partWords(h.active[1])}` : null;
  const sow = sowWords(w);
  if (!sow) return harvest ? (cropId === 'alfalfa' ? `Cuttings run ${harvest}.` : `Harvest ${harvest}.`) : null;
  const sowS = w.sow.plantsFallBefore ? `Sow ${sow.replace(/, as most farms do$/, '')} the fall before${sow.endsWith('as most farms do') ? ', as most farms do' : ''}.` : `Sow ${sow}.`;
  return harvest ? `${sowS} Harvest ${harvest}.` : sowS;
}

/** When a crop comes off: "Corn comes off mostly early October to early November. Lately half of Iowa’s corn is harvested by Oct 19." */
export function harvestLine(cropId, place) {
  const w = windowsFor(cropId, place);
  if (!w) return gapLine(cropId, place);
  const h = w.harvest.usual;
  const out = [];
  if (h?.active[0] && h.active[1]) {
    out.push(cropId === 'alfalfa'
      ? `Alfalfa cuttings run mostly ${partWords(h.active[0])} to ${partWords(h.active[1])}.`
      : `${cap(word(cropId))} ${verb(cropId, 'come')} off mostly ${partWords(h.active[0])} to ${partWords(h.active[1])}.`);
  }
  const r = w.harvest.recent;
  if (r?.p50) out.push(`Lately half of ${stateWords(place)}’s ${word(cropId)} ${isAre(cropId)} harvested by ${fmt(r.p50)}.`);
  return out.length ? out.join(' ') : gapLine(cropId, place);
}

/** The town of a weather station: "Ames 8 WSW" -> "Ames". */
const stationTown = (name) => String(name ?? '').replace(/\s+\d.*$/, '').trim() || 'the nearest station';

/** §6.16: frost from the county's NOAA normals → string|null (state rows have none). */
export function frostLine(place) {
  const f = frostFor(place);
  if (!f) return null;
  const out = [`The last spring frost at ${stationTown(f.stationName)} is usually around ${fmt(f.lastSpring.p50)}.`];
  if (f.lastSpring.p90) out.push(`One spring in ten it comes after ${fmt(f.lastSpring.p90)}.`);
  if (f.firstFall?.p50) out.push(`The first fall frost is usually around ${fmt(f.firstFall.p50)}${f.hardFreeze?.p50 ? `, and a hard freeze around ${fmt(f.hardFreeze.p50)}` : ''}.`);
  return out.join(' ');
}

/**
 * §6.11: how one crop hands the field to the next. h is cropCalendar.handoff(prev, next, …).
 * opts { field (names), prev, next (crop ids), betterAfter (crop id or null), scopeWords }.
 */
export function handoffLine(h, { field, prev, next, betterAfter = null, scopeWords } = {}) {
  if (!h?.off || !h.fit || !prev || !next) return '';
  const P = cap(short(prev));
  const comes = verb(prev, 'come');
  const where = field ? ` ${field}` : '';
  if (h.fit === 'clash') {
    const scope = scopeWords ?? h.scopeWords ?? '';
    const last = h.final ? `, and the last day for full insurance on ${short(next)}${scope ? ` ${scope}` : ''} is ${fmt(h.final)}` : '';
    const better = betterAfter && betterAfter !== prev ? ` ${cap(short(next))} ${verb(next, 'fit')} better after ${short(betterAfter)}.` : '';
    return `${P} ${comes} off around ${partWords(h.off)}${last}. That’s too tight.${better}`;
  }
  if (h.fit === 'tight' && next !== 'cereal-rye') {
    return `${P} ${comes} off around ${partWords(h.off)}, right at the end of ${short(next)}’s best window. In a slow fall that’s too late, so have the drill ready.`;
  }
  const first = `${P} ${comes} off${where} around ${partWords(h.off)}.`;
  if (next === 'cereal-rye') {
    return h.fit === 'tight'
      ? `${first} After ${short(prev)} a rye cover is tight, so seed it right behind the combine, by ${partWords(h.coverBy)}.`
      : `${first} Drill the rye cover right after, by ${partWords(h.coverBy)}.`;
  }
  if (h.coverFits && h.coverBy) {
    const seed = h.coverDays != null && h.coverDays <= 15
      ? `After ${short(prev)} a rye cover is tight, so seed it right behind the combine, by ${partWords(h.coverBy)}.`
      : `If you want a rye cover, drill it right after, by ${partWords(h.coverBy)}.`;
    return `${first} ${seed} End it at or before planting the ${short(next)}.`;
  }
  return `${P} ${comes} off${where} around ${partWords(h.off)}, in good time for the ${short(next)}.`;
}

/** The pronoun for a crop just named: "It yields" / "They yield". */
const itThey = (id) => (plural(id) ? 'They yield' : 'It yields');

/**
 * §6.12: one month of jobs (a jobsByMonth entry's jobs). month is the month number.
 * "Plant corn from mid April. It yields best sown by May 9, and the last frost here is usually about Apr 23."
 */
export function monthLine(month, jobs, place) {
  void month;
  const out = [];
  const frost = frostFor(place);
  const plants = (jobs ?? []).filter((j) => j.kind === 'plant');
  const harvests = (jobs ?? []).filter((j) => j.kind === 'harvest');
  plants.forEach((j, i) => {
    const w = windowsFor(j.crop, place);
    const start = j.by ? (w?.sow.usual?.active[0] ?? j.from) : j.from;
    const verbS = i === 0 ? 'Plant' : 'Then plant';
    const bestTo = w?.sow.best?.to;
    const frostWords = i === 0 && frost?.lastSpring?.p50 && dayOf(start) <= dayOf(frost.lastSpring.p90 ?? frost.lastSpring.p50)
      ? `, and the last frost here is usually about ${fmt(frost.lastSpring.p50)}` : '';
    if (bestTo && !w?.sow.best?.secondary) out.push(`${verbS} ${short(j.crop)} from ${partWords(start)}. ${itThey(j.crop)} best sown by ${fmt(bestTo)}${frostWords}.`);
    // a farmer group's advice is said as advice, never as Manami's own "best"
    else if (bestTo) out.push(`${verbS} ${short(j.crop)} from ${partWords(start)}. A farmer group advises sowing by ${fmt(bestTo)}${frostWords}.`);
    // no best window: say what most farms do, never "finish by" a long-run date
    else out.push(`Most farms ${i === 0 ? '' : 'then '}plant ${short(j.crop)} from ${partWords(start)} to ${partWords(j.to)}${frostWords}.`);
    // the usual run can go past the last day for full insurance (Story County oats: Apr 25, not May 2)
    const ins = w?.sow.insurance;
    if (ins?.final && j.to && dayOf(ins.final) < dayOf(j.to)) out.push(`The last day for full insurance ${ins.scopeWords} is ${fmt(ins.final)}.`);
  });
  if (harvests.length >= 2) {
    const [a, b] = harvests;
    out.push(`${cap(short(a.crop))} ${verb(a.crop, 'come')} off first, mostly ${partWords(a.from)} to ${partWords(a.to)}.`);
    out.push(`${cap(short(b.crop))} ${verb(b.crop, 'follow')}, mostly ${partWords(b.from)} to ${partWords(b.to)}.`);
  } else if (harvests.length === 1) {
    const [a] = harvests;
    out.push(a.crop === 'alfalfa'
      ? `Alfalfa cuttings run mostly ${partWords(a.from)} to ${partWords(a.to)}.`
      : `${cap(short(a.crop))} ${verb(a.crop, 'come')} off mostly ${partWords(a.from)} to ${partWords(a.to)}.`);
  }
  for (const j of jobs ?? []) {
    if (j.kind === 'coverSeed') out.push(`Drill the ${short(j.crop)} right after harvest, by ${fmt(j.to)}.`);
    if (j.kind === 'coverEnd') out.push(`End the ${short(j.crop)} at or before planting the ${short(j.before ?? '')}.`.replace(' the .', '.'));
  }
  // whole sentences only, at most 3
  const sentences = out.join(' ').split(/(?<=\.)\s+/).filter(Boolean);
  return sentences.slice(0, 3).join(' ');
}

/** §6.12: the season's planting order. "Plant corn first: North draw, South 40 and East place, Apr 15 to May 9. Then beans on Home place and West 140, by May 20." */
export function workOrderLine(jobsByMonthResult) {
  const plants = (jobsByMonthResult ?? []).flatMap((m) => m.jobs.map((j) => ({ ...j, at: m.year * 1000 + Number(String(j.from).replace('-', '')) }))).filter((j) => j.kind === 'plant').sort((a, b) => a.at - b.at);
  if (!plants.length) return '';
  const when = (j) => (j.by ? `by ${fmt(j.to)}` : rangeWords(j.from, j.to));
  if (plants.length === 1) return `Plant ${short(plants[0].crop)} on ${names(plants[0].names)}, ${when(plants[0])}.`;
  const [a, ...rest] = plants;
  const out = [`Plant ${short(a.crop)} first: ${names(a.names)}, ${when(a)}.`];
  for (const j of rest.slice(0, 2)) out.push(`Then ${short(j.crop)} on ${names(j.names)}, ${when(j)}.`);
  return out.join(' ');
}

/** §6.13: the tab's opening line. */
export function calendarIntroLine(place) {
  const st = stateName(place);
  if (hasCounty(place)) {
    const region = regionOf(place) ?? st;
    return `Here’s when the work falls in ${region}. The dates are from USDA, Iowa State and NOAA.`;
  }
  if (!st) return 'I don’t know which state the farm is in yet, so I don’t have sowing dates.';
  const any = ['corn', 'soybeans', 'winter-wheat', 'oats', 'sorghum'].some((c) => windowsFor(c, place));
  if (!any) return `I don’t have sowing dates for ${st} yet. Your state’s extension office will have local ones.`;
  const isu = ['corn', 'soybeans'].some((c) => windowsFor(c, place)?.srcs.some((s) => s.startsWith('isu')));
  return `Here’s when the work usually falls in ${st}. The dates are from USDA${isu ? ' and Iowa State' : ''}.`;
}

/** §6.14: no dates for a crop here. */
export function gapLine(cropId, place) {
  const st = stateWords(place);
  return `I don’t have sowing dates for ${word(cropId)} in ${st} yet. ${st === 'your state' ? 'Your local extension office will have them.' : 'Your state’s extension office will have local ones.'}`;
}

/** A cover crop's line: "Seed the rye mid August to late October. End it at or before planting." → string|null */
export function coverLine(cropId, place) {
  const c = coverFor(cropId, place);
  if (!c) return null;
  return `Seed the ${short(cropId)} from ${partWords(c.seed[0])} to ${partWords(c.seed[1])}. End it ${c.terminate}, and check your county’s rule.`;
}

/** §4.4: the "Where these dates come from" list (labels, not Manami). */
export const SOURCE_LINES = [
  { ids: ['h628'], title: 'USDA NASS, Field Crops Usual Planting and Harvesting Dates (2010)', caveat: 'Long-run dates from about 1990–2009. Planting is earlier now.' },
  { ids: ['nassProgress'], title: 'USDA NASS Crop Progress, 2021–2025', caveat: 'Iowa-wide pace, not your county.' },
  { ids: ['isuCorn2010', 'isuLicht2020'], title: 'Iowa State University Extension (2010, 2020)', caveat: 'Best windows for Iowa corn and soybeans.' },
  { ids: ['rma2026'], title: 'USDA RMA crop insurance dates, 2026', caveat: 'Insurance deadlines, not best dates.' },
  { ids: ['pfiWheat'], title: 'Practical Farmers of Iowa (2018)', caveat: 'A farmer group’s advice on wheat, not a trial.' },
  { ids: ['nrcsRyeIA2025', 'nrcsTermV4'], title: 'NRCS and Iowa State, Cereal Rye Fact Sheet (2025)', caveat: 'Seeding dates for cost-share programs. Check your county’s termination rule.' },
  { ids: ['noaaNormals'], title: 'NOAA 1991–2020 normals, Ames 8 WSW', caveat: 'One weather station, the nearest to the farm.' },
];

/** The short source chip words for a src id. */
export const SRC_CHIP = {
  h628: 'NASS', nassProgress: 'NASS', rma2026: 'RMA', isuCorn2010: 'ISU', isuLicht2020: 'ISU', pfiWheat: 'PFI',
  nrcsRyeIA2025: 'NRCS', nrcsTermV4: 'NRCS', noaaNormals: 'NOAA',
};

/** The honest label of each date kind, for the crop cards. */
export { LABEL };

/** Every line this module can say for these crops here, for the lint test. */
export function allCalendarLines(place, crops = ['corn', 'soybeans', 'oats', 'winter-wheat', 'alfalfa']) {
  const out = [calendarIntroLine(place), frostLine(place)];
  for (const c of crops) {
    out.push(cropWindowLine(c, place), seasonWhenLine(c, 2027, place), harvestLine(c, place), gapLine(c, place), coverLine(c, place));
  }
  return out.filter(Boolean);
}

/** A month number in a heading: "April 2027". */
export const monthHeading = (month, year) => `${monthName(month)}${year ? ` ${year}` : ''}`;
