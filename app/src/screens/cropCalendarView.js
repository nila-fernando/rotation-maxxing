// The "When to sow" tab of "Plan my next seasons": season radios, Manami's line (where the work
// falls and the planting order), jobs by month (the main content: an h4 per month, then a list of
// jobs, each "dates · job · fields (acres) · source"), a card per crop with honest date labels and
// a season strip, the frost line, one line per change of crop, and where the dates come from.
//
// calendarTabHtml returns the tabpanel's inner HTML; wireCalendarTab wires the season radios.
// The plan rows come from the rotation story (rotationStory.rotationOf): rot.fields[].seasons[y]
// {crop, cover}; when it has no fields yet, the compared plans (cmp.fields[].byKind) are read instead.
import {
  windowsFor, coverFor, handoff, jobsByMonth, gapsFor, fmt, rangeWords, CALENDAR, LABEL, STATE_NAME,
} from '../plan/cropCalendar.js';
import {
  cropWindowLine, frostLine, handoffLine, monthLine, workOrderLine, calendarIntroLine, gapLine,
  coverLine, SOURCE_LINES, SRC_CHIP, monthHeading,
} from '../plan/calendarVoice.js';
import { word, short, names } from '../plan/futuresVoice.js';
import { CROP_NAME } from '../plan/planNames.js';
import { cropBadge } from '../ui/cropTip.js';
import { CAL_ICONS } from '../ui/rotationIcons.js';
import { LENS_ICONS } from '../ui/futureIcons.js';
import { seasonStripSvg } from '../ui/seasonStrip.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const acresWords = (n) => `${Math.round(Number(n) || 0)} ac`;
const DOT = '<span class="cal-sep" aria-hidden="true">·</span>';

export const MCCC_URL = 'https://www.midwestcovercrops.org/selector-tools/';

/** A source chip: the short name, with the full source for screen readers. */
function srcChip(src) {
  if (!src) return '';
  const full = CALENDAR.sources?.[src]?.title ?? src;
  return `<span class="src-chip cal-src" data-src="${esc(src)}"><span class="sr-only">Source: ${esc(full)}. </span><span aria-hidden="true">${esc(SRC_CHIP[src] ?? src)}</span></span>`;
}

/**
 * One season's plan rows, in the farm's field order: [{fieldId, name, acres, crop, cover, year, prev, prevCover}].
 * @param {object} rot  rotationOf(...) result
 * @param {object} cmp  compareFutures(...) result (field order, history, and the fallback plans)
 */
export function seasonRows(rot, cmp, season = 0) {
  const years = rot?.years?.length ? rot.years : (cmp?.years ?? []);
  const year = years[season];
  const order = (cmp?.fields ?? []).map((f) => f.id);
  const histOf = (id) => (cmp?.fields ?? []).find((f) => f.id === id)?.history ?? [];
  let fields;
  if (rot?.fields?.length) {
    fields = rot.fields.map((f) => ({ id: f.id, name: f.name, acres: f.acres, seasons: f.seasons, last: f.past?.at(-1)?.crop ?? histOf(f.id).at(-1) ?? null }));
  } else {
    const view = rot?.view && rot.view !== 'mix' ? rot.view : 'priority';
    fields = (cmp?.fields ?? []).map((f) => ({ id: f.id, name: f.name, acres: f.acres, seasons: f.byKind?.[view]?.seasons ?? [], last: f.history?.at(-1) ?? null }));
  }
  const rank = (id) => { const i = order.indexOf(id); return i < 0 ? 1e6 : i; };
  return fields
    .filter((f) => f.seasons?.[season])
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((f) => {
      const s = f.seasons[season];
      const before = season > 0 ? f.seasons[season - 1] : null;
      return {
        fieldId: f.id, name: f.name, acres: f.acres, crop: s.crop ?? s.main, cover: s.cover ?? null, year,
        prev: before ? (before.crop ?? before.main) : f.last, prevCover: before?.cover ?? null,
      };
    });
}

/** The words of one job: "Plant corn", "Drill the rye cover". */
function jobWhat(j) {
  if (j.kind === 'plant') return `Plant ${word(j.crop)}`;
  if (j.kind === 'harvest') return j.crop === 'alfalfa' ? 'Cut the alfalfa' : `Harvest ${word(j.crop)}`;
  if (j.kind === 'coverSeed') return `Drill the ${short(j.crop)} cover`;
  return `End the ${short(j.crop)} cover, at or before planting`;
}
const jobWhen = (j) => (j.kind === 'coverEnd' ? `by ${fmt(j.to)}` : j.by ? `by ${fmt(j.to)}` : rangeWords(j.from, j.to));
const JOB_ICON = { plant: 'plant', harvest: 'harvest', coverSeed: 'plant', coverEnd: 'clock' };

function jobHtml(j, year) {
  const badge = cropBadge(j.crop, { year, sub: `${jobWhat(j)} · ${jobWhen(j)}` });
  return `<li class="cal-job cal-job--${esc(j.kind)}" data-kind="${esc(j.kind)}" data-crop="${esc(j.crop)}">`
    + `<span class="cal-job__when">${esc(jobWhen(j))}</span>${DOT}`
    + `<span class="cal-job__icon" aria-hidden="true">${CAL_ICONS[JOB_ICON[j.kind]] ?? ''}</span>${badge}`
    + `<span class="cal-job__what">${esc(jobWhat(j))}</span>${DOT}`
    + `<span class="cal-job__where">${esc(names(j.names, 99))} (${esc(acresWords(j.acres))})</span>${DOT}`
    + `${srcChip(j.src)}</li>`;
}

/** A labelled date row in a crop card. */
const dlRow = (dt, dd, src) => `<div class="cal-dl__row"><dt>${esc(dt)}</dt><dd>${esc(dd)} ${srcChip(src)}</dd></div>`;

function cropCardHtml(cropId, rows, year, place) {
  const acres = rows.reduce((a, r) => a + (Number(r.acres) || 0), 0);
  const head = `<h4 class="cal-crop__name">${cropBadge(cropId, { year })}<span>${esc(CROP_NAME[cropId] ?? cap(word(cropId)))}</span><span class="cal-crop__acres">${esc(acresWords(acres))}</span></h4>`;
  const w = windowsFor(cropId, place);
  if (!w) return `<article class="cal-crop cal-crop--gap" data-crop="${esc(cropId)}">${head}<p class="cal-crop__say">${esc(gapLine(cropId, place))}</p></article>`;
  const rowsHtml = [];
  const b = w.sow.best, u = w.sow.usual, r = w.sow.recent, ins = w.sow.insurance, h = w.harvest.usual;
  const fall = w.sow.plantsFallBefore ? ', the fall before' : '';
  if (b?.to) rowsHtml.push(dlRow(b.secondary ? `${LABEL.best}, a farmer group’s advice` : LABEL.best, `${b.from ? rangeWords(b.from, b.to) : `by ${fmt(b.to)}`}${fall}`, b.src));
  if (u?.active[0]) rowsHtml.push(dlRow(LABEL.usual, `${rangeWords(u.active[0], u.active[1])}${fall}`, u.src));
  if (r?.p50) rowsHtml.push(dlRow(LABEL.recent, `${fmt(r.p50)} (${r.years}, state-wide)`, r.src));
  if (ins?.final) rowsHtml.push(dlRow(`${LABEL.insurance}${ins.what === 'spring' ? ', spring seeding' : ''}`, `${fmt(ins.final)}, ${ins.scopeWords}`, ins.src));
  if (h?.active[0]) rowsHtml.push(dlRow(cropId === 'alfalfa' ? 'Cuttings mostly' : LABEL.harvest, rangeWords(h.active[0], h.active[1]), h.src));
  const cover = rows.find((x) => x.cover)?.cover ?? null;
  return `<article class="cal-crop" data-crop="${esc(cropId)}">${head}<dl class="cal-dl">${rowsHtml.join('')}</dl>`
    + `<div class="cal-crop__strip">${seasonStripSvg(cropId, year, place, { cover })}</div>`
    + `<p class="cal-crop__say">${esc(cropWindowLine(cropId, place))}</p></article>`;
}

function coverCardHtml(coverId, rows, year, place) {
  const c = coverFor(coverId, place);
  const acres = rows.reduce((a, r) => a + (Number(r.acres) || 0), 0);
  const head = `<h4 class="cal-crop__name">${cropBadge(coverId, { year, cover: null })}<span>${esc(CROP_NAME[coverId] ?? cap(word(coverId)))} cover</span><span class="cal-crop__acres">${esc(acresWords(acres))}</span></h4>`;
  if (!c) return `<article class="cal-crop cal-crop--gap" data-crop="${esc(coverId)}">${head}<p class="cal-crop__say">${esc(gapLine(coverId, place))}</p></article>`;
  return `<article class="cal-crop cal-crop--cover" data-crop="${esc(coverId)}">${head}<dl class="cal-dl">`
    + dlRow('Seed it', rangeWords(c.seed[0], c.seed[1]), c.src)
    + dlRow('End it', `${c.terminate}${c.zoneConfirmed ? '' : ' (check your county’s rule)'}`, c.termSrc ?? c.src)
    + `</dl><p class="cal-crop__say">${esc(coverLine(coverId, place))}</p></article>`;
}

/** A crop to suggest for a clash: one whose handoff into `next` is ok. */
function betterBefore(next, prev, year, place) {
  return ['soybeans', 'oats', 'corn'].find((c) => c !== prev && handoff(c, next, year, place).fit === 'ok') ?? null;
}

/** One line per change of crop (fields with the same change share it), plus each planned cover. */
function handoffLines(rows, year, place) {
  const groups = new Map();
  const add = (prev, next, seasonYear, row) => {
    const key = `${prev}>${next}>${seasonYear}`;
    const g = groups.get(key) ?? { prev, next, seasonYear, names: [] };
    g.names.push(row.name);
    groups.set(key, g);
  };
  for (const r of rows) {
    if (r.prev && r.crop && r.prev !== r.crop) add(r.prev, r.crop, year, r);
    if (r.cover) add(r.crop, r.cover, year + 1, r);
  }
  const out = [];
  for (const g of groups.values()) {
    const h = handoff(g.prev, g.next, g.seasonYear, place);
    const line = handoffLine(h, { field: names(g.names), prev: g.prev, next: g.next, betterAfter: h.fit === 'clash' ? betterBefore(g.next, g.prev, g.seasonYear, place) : null });
    if (line) out.push({ ...g, fit: h.fit, line });
  }
  return out;
}

/**
 * "Where these dates come from": only the sources the tab actually shows for this farm (a Kansas farm
 * isn't told about Iowa State or the Ames station), each with its caveat, then the place's gaps.
 * @param {Set<string>} used  the src ids behind the dates on the tab
 */
function sourcesHtml(place, used = new Set()) {
  const srcs = CALENDAR.sources ?? {};
  const stName = STATE_NAME[place?.state] ?? null;
  const items = SOURCE_LINES.filter((s) => s.ids.some((id) => used.has(id))).map((s) => {
    const id = s.ids.find((x) => used.has(x)) ?? s.ids[0];
    const url = srcs[id]?.url ?? srcs[s.ids[0]]?.url;
    const link = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(s.title)}<span class="sr-only"> (opens in a new tab)</span></a>` : esc(s.title);
    // the progress pace is the farm's own state's, not always Iowa's
    const caveat = stName ? s.caveat.replace(/^Iowa-wide/, `${stName}-wide`) : s.caveat;
    return `<li class="cal-sources__item" data-src="${esc(s.ids.join(' '))}">${link}<span class="cal-sources__caveat">${esc(caveat)}</span></li>`;
  }).join('');
  const api = [...used].some((id) => srcs[id]?.apiNotice) ? '<p class="cal-sources__note">This product uses the NASS API but is not endorsed or certified by NASS.</p>' : '';
  const gaps = gapsFor(place);
  return `<details class="cal-sources"><summary>Where these dates come from</summary>${items ? `<ul class="cal-sources__list">${items}</ul>` : ''}${api}`
    + (gaps.length ? `<p class="cal-sources__gaps-title">Not covered yet</p><ul class="cal-sources__gaps">${gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : '')
    + `<p class="cal-sources__more">For cover crop dates by county, try the <a class="cal-mccc" href="${MCCC_URL}" target="_blank" rel="noopener">Midwest Cover Crops Council selector<span class="sr-only"> (opens in a new tab)</span></a>.</p></details>`;
}

function seasonRadios(years, season) {
  return `<div class="cal-seasons" role="radiogroup" aria-label="Season to show">${years.map((y, i) => {
    const on = i === season;
    return `<button type="button" class="cal-seasons__btn" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-season="${i}">${esc(y)}</button>`;
  }).join('')}</div>`;
}

/** The inner HTML of the "When to sow" tabpanel. */
export function calendarTabHtml({ rot, cmp, place, season = 0 } = {}) {
  const years = rot?.years?.length ? rot.years : (cmp?.years ?? []);
  if (!years.length) return '';
  const s = Math.max(0, Math.min(years.length - 1, Number(season) || 0));
  const year = years[s];
  const rows = seasonRows(rot, cmp, s);
  // no plan rows yet (nothing to date): the caller shows its own "not ready" line, never a false gap
  if (!rows.length) return '';
  const crops = [...new Set(rows.map((r) => r.crop).filter(Boolean))];
  const covers = [...new Set(rows.map((r) => r.cover).filter(Boolean))];
  const known = crops.some((c) => windowsFor(c, place));
  const head = seasonRadios(years, s);

  if (!known) {
    const gaps = [...new Set((crops.length ? crops : ['corn']).map((c) => gapLine(c, place)))];
    return `<div class="cal" data-season="${s}">${head}<div class="cal-gap" role="note"><p class="cal-say">${esc(calendarIntroLine(place))}</p>`
      + `${gaps.map((g) => `<p class="cal-gap__line">${esc(g)}</p>`).join('')}</div>${sourcesHtml(place, new Set())}</div>`;
  }

  const jobs = jobsByMonth(rows, place);
  const order = workOrderLine(jobs);
  const say = `<p class="cal-say">${esc(calendarIntroLine(place))}${order ? ` ${esc(order)}` : ''}</p>`;
  const months = jobs.map((m) => {
    const line = monthLine(m.month, m.jobs, place);
    return `<h4 class="cal-month" data-month="${m.month}">${esc(monthHeading(m.month, m.year))}</h4>`
      + (line ? `<p class="cal-month__say">${esc(line)}</p>` : '')
      + `<ul class="cal-joblist">${m.jobs.map((j) => jobHtml(j, year)).join('')}</ul>`;
  }).join('');
  const jobsHtml = `<section class="cal-jobs"><h3 class="cal-h">Jobs by month</h3>${months || `<p class="cal-empty">${esc(gapLine(crops[0], place))}</p>`}</section>`;

  const cards = crops.map((c) => cropCardHtml(c, rows.filter((r) => r.crop === c), year, place))
    .concat(covers.map((c) => coverCardHtml(c, rows.filter((r) => r.cover === c), year, place))).join('');
  const cardsHtml = `<section class="cal-crops"><h3 class="cal-h">The crops in ${esc(year)}</h3><div class="cal-crops__grid">${cards}</div></section>`;

  const frost = frostLine(place);
  const frostHtml = frost ? `<p class="cal-frost"><span class="cal-frost__icon" aria-hidden="true">${LENS_ICONS.frost}</span><span>${esc(frost)}</span>${srcChip('noaaNormals')}</p>` : '';

  const hand = handoffLines(rows, year, place);
  const handHtml = hand.length
    ? `<section class="cal-handoffs"><h3 class="cal-h">From one crop to the next</h3><ul class="cal-handoffs__list">${hand.map((h) => `<li class="cal-handoff cal-handoff--${esc(h.fit)}" data-fit="${esc(h.fit)}">${esc(h.line)}</li>`).join('')}</ul></section>`
    : '';

  const used = new Set([
    ...crops.flatMap((c) => windowsFor(c, place)?.srcs ?? []),
    ...covers.flatMap((c) => { const cv = coverFor(c, place); return cv ? [cv.src, cv.termSrc] : []; }),
    ...jobs.flatMap((m) => m.jobs.map((j) => j.src)),
    ...(frost ? ['noaaNormals'] : []),
  ].filter(Boolean));
  return `<div class="cal" data-season="${s}">${head}${say}${jobsHtml}${cardsHtml}${frostHtml}${handHtml}${sourcesHtml(place, used)}</div>`;
}

/** Wires the season radios (click, arrows, Home and End). Returns dispose(). */
export function wireCalendarTab(el, { onSeason } = {}) {
  if (!el?.addEventListener) return function dispose() {};
  const radios = () => [...el.querySelectorAll('.cal-seasons [role="radio"]')];
  const pick = (i) => {
    const list = radios();
    if (!list.length) return;
    const n = ((i % list.length) + list.length) % list.length;
    onSeason?.(n);
    // the caller re-renders the panel: put focus back on the chosen radio
    const again = el.querySelector(`.cal-seasons [data-season="${n}"]`) ?? radios()[n];
    for (const r of radios()) { const on = r === again; r.setAttribute('aria-checked', String(on)); r.tabIndex = on ? 0 : -1; }
    again?.focus?.();
  };
  const onClick = (e) => {
    const b = e.target?.closest?.('.cal-seasons [role="radio"]');
    if (b && el.contains(b)) pick(Number(b.dataset.season));
  };
  const onKey = (e) => {
    const b = e.target?.closest?.('.cal-seasons [role="radio"]');
    if (!b || !el.contains(b)) return;
    const i = Number(b.dataset.season);
    const last = radios().length - 1;
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: last }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    pick(to);
  };
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
  return function dispose() {
    el.removeEventListener('click', onClick);
    el.removeEventListener('keydown', onKey);
  };
}
