// The "Your rotation" tab's parts for "Plan my next seasons" (src/screens/plansPanel.js):
//
//   switchHtml(cmp, rot, selected, { showMix })   the "Plan to show" radiogroup and the pattern note
//   ribbonHtml(rot, { selectedKind, open, stories })  the ribbon table: two past seasons (faded, "was"),
//                                                 three planned ones with a link sign into each, a
//                                                 verdict chip per field, the acre split and a legend.
//                                                 No money on the ribbon.
//   storyHtml(rot, cmp, id, { choice, place, years })  a field's story: the lead, 3 season cards
//                                                 (Why, When with a season strip, Watch), the why-not,
//                                                 money last, and the "Plan for {field}" pick
//   checkHtml(rows, { baseLabel })                the 5-row rotation check
//   wireRibbon(el, { onToggle, onSelect })        story buttons, switch arrows, pick arrows → dispose()
//
// Plain HTML strings (no DOM until wireRibbon), so node:test reads them. Manami's words come from
// rotationVoice and calendarVoice (plain text, escaped here); every crop icon is a cropBadge, so the
// shared crop tooltip names it. A plain <table>: no grid role, no roving tabindex in the cells.
import CAL from '../../data/crop-calendar.json' with { type: 'json' };
import { cropBadge, cropName, tipListAttr } from '../ui/cropTip.js';
import { LINK_ICONS } from '../ui/rotationIcons.js';
import { PLAN_ICONS, TILE_ICONS, LENS_ICONS } from '../ui/futureIcons.js';
import { seasonStripSvg } from '../ui/seasonStrip.js';
import { linkLabel } from '../plan/rotationStory.js';
import { patternNote, fieldLead, changeReason, whyNotLine, fieldMoneyLine, cellSr } from '../plan/rotationVoice.js';
import { seasonWhenLine } from '../plan/calendarVoice.js';
import { short, watchItems } from '../plan/futuresVoice.js';
import { kindFor } from '../plan/compareFutures.js';
import { PLANS, CROP_NAME } from '../plan/planNames.js';
import { moneyAbout } from '../ui/money.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// an id inside an attribute selector (field ids are plain, but a quote or backslash mustn't break it)
const attrSel = (s) => String(s ?? '').replace(/["\\]/g, '\\$&');

/** The plan names on the switch and the pick, plus the farmer's own mix. */
export const PLAN_NAME = { ...Object.fromEntries(PLANS.map((p) => [p.kind, p.name])), mix: 'Your plan' };
const LINK_ORDER = ['repeat', 'nitrogen', 'break', 'same-family'];
// the split's crops in a steady order (corn first, then beans, then the rest), not by acres
const CROP_ORDER = Object.keys(CROP_NAME);
const cropRank = (id) => { const i = CROP_ORDER.indexOf(id); return i < 0 ? CROP_ORDER.length : i; };
const cropKey = (id) => (['corn', 'soybeans'].includes(id) ? id : /wheat|oats|barley|rye/.test(id || '') ? 'grain' : 'other');

/** The farm's calendar gaps (what the sowing dates don't cover yet), for Good to know. */
export const calendarGaps = () => [...(CAL?.gaps || [])];

// ---- the plan switch ----

/** The crops a plan grows each season, for its segment's tip: "2027 Corn and Soybeans". */
function planTipAttr(rot) {
  const years = rot?.years || [];
  const list = years.map((year, y) => {
    const crops = [...new Set((rot.fields || []).map((f) => f.seasons?.[y]?.crop).filter(Boolean))].sort((a, b) => cropRank(a) - cropRank(b));
    return crops.length ? `${year} ${crops.map((c) => cropName(c)).join(' and ')}` : '';
  }).filter(Boolean);
  return list.length ? ` data-crop-tip-list="${esc(list.join(';'))}"` : '';
}

/**
 * The "Plan to show" radiogroup: Keep going · Most profit · Manami's pick (Recommended), and Your
 * plan once the farmer's picks differ by field. The selected one is in the tab order (arrows move
 * and select). Under it, one quiet line: the pattern note. rot is the selected plan's rotation.
 * cmp is not needed for the words today; it stays in the signature for the spec's callers.
 */
export function switchHtml(cmp, rot, selected = 'priority', { showMix = false, rots = {} } = {}) {
  void cmp;
  const kinds = ['current', 'maxProfit', 'priority', ...(showMix ? ['mix'] : [])];
  const on = kinds.includes(selected) ? selected : 'priority';
  const segs = kinds.map((kind) => {
    const isOn = kind === on;
    const tip = planTipAttr(rots[kind] || (isOn ? rot : null));
    return `<button type="button" role="radio" class="rib-switch__seg rib-switch__seg--${kind}${isOn ? ' is-on' : ''}" data-kind="${kind}" aria-checked="${isOn}" tabindex="${isOn ? 0 : -1}"${tip}>`
      + `<span class="rib-switch__icon" aria-hidden="true">${PLAN_ICONS[kind] || ''}</span><span class="rib-switch__name">${esc(PLAN_NAME[kind])}</span>`
      + `${kind === 'priority' ? '<span class="rib-switch__badge">Recommended</span>' : ''}</button>`;
  }).join('');
  const note = rot ? patternNote(rot) : '';
  return `<div class="rib-switch" role="radiogroup" aria-label="Plan to show">${segs}</div>${note ? `<p class="rib-switch__note">${esc(note)}</p>` : ''}`;
}

// ---- the ribbon ----

/** A link sign's words for screen readers and the legend. */
const linkWords = (kind) => linkLabel(kind) || '';

/** A ribbon cell's screen-reader words (rotationVoice.cellSr, or plain words while it says nothing). */
function cellWords(field, season) {
  const said = cellSr(field, season);
  if (said) return said;
  const prev = season.link?.prev;
  const after = prev ? `, after ${cropName(prev).toLowerCase()}` : '';
  const how = season.link?.kind ? ` ${linkWords(season.link.kind)}.` : '';
  return `${field.name}, ${season.year}: ${cropName(season.crop, { cover: season.cover })}${after}.${how}`;
}

function plannedCell(field, season) {
  const kind = season.link?.kind;
  const sign = kind && LINK_ICONS[kind] ? `<span class="rib__link rib__link--${esc(kind)}" aria-hidden="true">${LINK_ICONS[kind]}</span>` : '';
  const blanket = season.cover ? `<span class="rib__blanket" aria-hidden="true">${LINK_ICONS.cover}</span>` : '';
  // the badge is aria-hidden: the cell's sr-only words name the crop, what came before and the link
  const badge = cropBadge(season.crop, { key: season.key, year: season.year, after: season.link?.prev, cover: season.cover, inControl: true });
  return `<td class="rib__cell${kind ? ` rib__cell--${esc(kind)}` : ''}${season.cover ? ' rib__cell--cover' : ''}">${sign}${badge}${blanket}<span class="sr-only">${esc(cellWords(field, season))}</span></td>`;
}

function pastCell(p, old) {
  if (!p?.crop) return `<td class="rib__past${old ? ' rib__y--old' : ''}"><span class="sr-only">not known</span></td>`;
  return `<td class="rib__past${old ? ' rib__y--old' : ''}">${cropBadge(p.crop, { year: p.year, size: 'sm' })}</td>`;
}

/** "289 ac corn · 253 ac beans": a season's acres by crop, in the steady crop order. */
export function splitParts(entry) {
  return Object.entries(entry?.byCrop || {}).filter(([, ac]) => ac > 0)
    .sort((a, b) => cropRank(a[0]) - cropRank(b[0]))
    .map(([crop, ac]) => ({ crop, acres: Math.round(ac), words: `${Math.round(ac)} ac ${short(crop)}` }));
}

function splitBar(parts) {
  return `<span class="rib-split__bar" aria-hidden="true">${parts.map((p) => `<span class="rib-split__seg rib-split__seg--${cropKey(p.crop)}" style="flex-grow:${p.acres}"></span>`).join('')}</span>`;
}

/**
 * The ribbon table for one plan (`rot`, from rotationStory.rotationOf), its legend and the acre
 * split. open: the field ids whose story is open; stories: id → the story's HTML (storyHtml), each
 * in a row of its own right under its field (hidden while closed).
 */
export function ribbonHtml(rot, { selectedKind, open = new Set(), stories = {} } = {}) {
  const fields = rot?.fields || [];
  const years = rot?.years || [];
  const past = rot?.pastYears || [];
  if (!fields.length || !years.length) return '';
  const kind = selectedKind || rot.view || 'priority';
  const cols = 1 + past.length + years.length;
  const head = `<tr><th scope="col" class="rib__fieldh">Field</th>${past.map((y, i) => `<th scope="col" class="rib__past${i < past.length - 1 ? ' rib__y--old' : ''}"><span class="rib__was">was</span> ${y}</th>`).join('')}${years.map((y) => `<th scope="col" class="rib__yh">${y}</th>`).join('')}</tr>`;

  const rows = fields.map((f) => {
    const isOpen = open.has(f.id);
    const tips = tipListAttr((f.seasons || []).map((s) => ({ year: s.year, cropId: s.crop, cover: s.cover })));
    const verdict = f.verdict?.words ? `<span class="rib__verdict rib__verdict--${esc(f.verdict.key)}">${esc(f.verdict.words)}</span>` : '';
    const btn = `<button type="button" class="rib__open" data-field="${esc(f.id)}" aria-expanded="${isOpen}" aria-controls="story-${esc(f.id)}"${tips}>`
      + `<span class="rib__name">${esc(f.name)}</span><span class="rib__acres">${Math.round(f.acres)} ac</span>${verdict}`
      + '<svg class="rib__chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    const pastCells = past.map((y, i) => pastCell((f.past || []).find((p) => p.year === y), i < past.length - 1)).join('');
    const cells = years.map((y, i) => plannedCell(f, { year: y, ...(f.seasons?.[i] || {}) })).join('');
    const story = `<tr class="rib__story" id="story-${esc(f.id)}"${isOpen ? '' : ' hidden'}><td colspan="${cols}">${stories[f.id] || ''}</td></tr>`;
    return `<tr class="rib__row${isOpen ? ' is-open' : ''}" data-field="${esc(f.id)}"><th scope="row" class="rib__fieldc">${btn}</th>${pastCells}${cells}</tr>${story}`;
  }).join('');

  const split = years.map((year) => splitParts((rot.split || []).find((s) => s.year === year)));
  const hasSplit = split.some((p) => p.length);
  const foot = hasSplit ? `<tfoot class="rib__foot"><tr><th scope="row" class="rib__fieldc rib__splith">Acres</th>${past.map((_, i) => `<td class="rib__past${i < past.length - 1 ? ' rib__y--old' : ''}"></td>`).join('')}`
    + `${split.map((parts) => `<td class="rib-split">${parts.map((p) => `<span class="rib-split__words">${esc(p.words)}</span>`).join('')}${splitBar(parts)}</td>`).join('')}</tr></tfoot>` : '';
  // on a phone the columns are too narrow for the words: the same split as a list under the table
  const phoneSplit = hasSplit ? `<ul class="rib-splitlist" aria-label="Acres by crop">${years.map((year, i) => (split[i].length ? `<li><b>${year}</b> ${esc(split[i].map((p) => p.words).join(' · '))}${splitBar(split[i])}</li>` : '')).join('')}</ul>` : '';

  const present = new Set(fields.flatMap((f) => (f.seasons || []).map((s) => s.link?.kind).filter(Boolean)));
  const hasCover = fields.some((f) => (f.seasons || []).some((s) => s.cover));
  const legendKinds = [...LINK_ORDER.filter((k) => present.has(k)), ...(hasCover ? ['cover'] : [])];
  const legend = legendKinds.length ? `<ul class="rib-legend" aria-label="What the signs mean">${legendKinds.map((k) => `<li class="rib-legend__item rib-legend__item--${k}"><span class="rib__link rib__link--${k}" aria-hidden="true">${LINK_ICONS[k] || ''}</span>${esc(linkWords(k))}</li>`).join('')}</ul>` : '';

  const caption = `${PLAN_NAME[kind] || 'The plan'}, field by field: what each field grew in ${past.join(' and ')}, then the plan for ${years[0]} to ${years[years.length - 1]}. Open a field for its story.`;
  return `<div class="rib-wrap"><table class="rib rib--${esc(kind)}" data-kind="${esc(kind)}"><caption class="sr-only">${esc(caption)}</caption>`
    + `<thead>${head}</thead><tbody>${rows}</tbody>${foot}</table></div>${phoneSplit}${legend}`;
}

// ---- a field's story ----

const SEV_CLASS = { 0: 'info', 1: 'note', 2: 'careful', 3: 'stop' };

function seasonCard(rot, cmp, f, s, y, { place, view, choice }) {
  const field = (cmp?.fields || []).find((x) => x.id === f.id) || f;
  const why = changeReason(s, { field, history: field.history || [], prevSeason: y > 0 ? f.seasons[y - 1] : null });
  const when = seasonWhenLine(s.crop, s.year, place);
  const strip = when ? seasonStripSvg(s.crop, s.year, place, { cover: s.cover || null }) : '';
  let watch = [];
  try { watch = cmp ? watchItems(cmp, f.id, view, choice).filter((w) => w.season === y) : []; } catch { watch = []; }
  // (a repeat's Why already says its warnings: Watch keeps only what it doesn't)
  if (why) watch = watch.filter((w) => !why.includes(w.text));
  const name = cropName(s.crop, { cover: s.cover });
  const badge = cropBadge(s.crop, { key: s.key, year: s.year, after: s.link?.prev, cover: s.cover, inControl: true });
  return `<li class="story-card">
    <h4 class="story-card__h">${badge}<span class="story-card__year">${s.year}</span> <span class="story-card__crop">${esc(name)}</span></h4>
    ${why ? `<p class="story-card__row"><b class="story-card__k">Why</b> ${esc(why)}</p>` : ''}
    ${when ? `<div class="story-card__row story-card__when"><p><b class="story-card__k">When</b> ${esc(when)}</p>${strip}</div>` : ''}
    ${watch.length ? `<ul class="story-card__watch" aria-label="Watch">${watch.map((w) => `<li class="story-card__w story-card__w--${SEV_CLASS[w.severity] || 'note'}"><b class="story-card__k">${esc(w.label || 'Watch')}</b> ${esc(w.text)}</li>`).join('')}</ul>` : ''}
  </li>`;
}

/** The "Plan for {field}" radios: one .plan-cell per plan, with its crops and about its cash. */
function pickHtml(cmp, f, choice) {
  const cf = (cmp?.fields || []).find((x) => x.id === f.id);
  if (!cf) return '';
  const picked = kindFor(choice, f.id);
  const cells = PLANS.map(({ kind, name }) => {
    const e = cf.byKind[kind];
    if (!e) return '';
    const on = picked === kind;
    const years = cmp.years || [];
    const items = e.seasons.map((s, i) => ({ year: years[i], cropId: s.crop, cover: s.cover }));
    const crops = items.map((it) => cropName(it.cropId, { cover: it.cover })).join(', ');
    const cash = `about ${moneyAbout(e.total)}`;
    return `<button type="button" class="plan-cell${on ? ' is-on' : ''}" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-field="${esc(f.id)}" data-kind="${kind}"`
      + ` aria-label="${esc(`${f.name}: ${name}, ${crops}, ${cash} over 3 seasons`)}"${tipListAttr(items)}>`
      + `<span class="plan-cell__name">${esc(name)}</span><span class="plan-cell__crops">${e.seasons.map((s, i) => cropBadge(s.crop, { key: s.key, year: years[i], cover: s.cover, size: 'sm', inControl: true })).join('')}</span>`
      + `<span class="plan-cell__cash">${esc(cash)}</span></button>`;
  }).join('');
  const hid = `pick-h-${esc(f.id)}`;
  return `<div class="story__pick"><h4 class="story__pickh" id="${hid}">Plan for ${esc(f.name)}</h4>
    <div class="story__cells" role="radiogroup" aria-labelledby="${hid}">${cells}</div>
    <p class="story__picked" id="picked-${esc(f.id)}" aria-live="polite"></p></div>`;
}

/**
 * A field's story, under its ribbon row: the lead, a card per season (Why, When and its strip,
 * Watch), the why-not (only when the facts allow one), the money line (always last of the words)
 * and the "Plan for {field}" pick (the .plan-cell radios, as plansPanel's click handler wants them).
 */
export function storyHtml(rot, cmp, id, { choice = {}, place = null, years } = {}) {
  const f = (rot?.fields || []).find((x) => x.id === id);
  if (!f) return '';
  const view = rot.view || 'priority';
  const ys = years || rot.years || [];
  const seasons = (f.seasons || []).map((s, i) => ({ year: ys[i], ...s }));
  // (without the comparison there is no lead, why-not or pick: the cards still say what grows)
  const lead = cmp ? fieldLead(rot, cmp, id) : '';
  const shownKind = view === 'mix' ? kindFor(choice, id) : view;
  const whyNot = shownKind === 'priority' && cmp ? whyNotLine(cmp, id) : null;
  const moneyWords = fieldMoneyLine(rot, id);
  const cards = seasons.map((s, y) => seasonCard(rot, cmp, { ...f, seasons }, s, y, { place, view, choice })).join('');
  return `<div class="story" role="group" aria-label="${esc(`${f.name}, the story`)}">
    ${lead ? `<p class="story__lead">${esc(lead)}</p>` : ''}
    <ol class="story__seasons">${cards}</ol>
    ${whyNot ? `<p class="story__whynot">${esc(whyNot)}</p>` : ''}
    ${moneyWords ? `<p class="story__money">${esc(moneyWords)}</p>` : ''}
    ${pickHtml(cmp, f, choice)}
  </div>`;
}

// ---- the rotation check ----

const CHECK_ICON = {
  repeats: LINK_ICONS.repeat, repeat: LINK_ICONS.repeat,
  handoffs: LINK_ICONS.nitrogen, nitrogen: LINK_ICONS.nitrogen,
  rootworm: LENS_ICONS.pest, pest: LENS_ICONS.pest,
  cover: LINK_ICONS.cover,
  soil: TILE_ICONS.soil,
};

/**
 * The 5-row rotation check (rotationVoice.checkRows): icon · label · this plan's value · the
 * comparison in quieter words ("keeping going: 9", or "my pick: 2" when Keep going is on show).
 * A base that already says whose it is ("keeping going: 9") is shown as it is.
 */
export function checkHtml(rows = [], { baseLabel = 'keeping going' } = {}) {
  if (!rows?.length) return '';
  const items = rows.map((r) => {
    const base = r.base == null || r.base === '' ? '' : /^(keeping going|my pick)\b/i.test(String(r.base)) ? String(r.base) : `${baseLabel}: ${r.base}`;
    const mood = r.better === true ? ' is-better' : r.better === false ? ' is-worse' : '';
    return `<li class="rot-check__row rot-check__row--${esc(r.key)}${mood}"><span class="rot-check__icon" aria-hidden="true">${CHECK_ICON[r.key] || ''}</span>`
      + `<span class="rot-check__label">${esc(r.label)}<span class="sr-only">:</span></span> <span class="rot-check__value">${esc(r.value)}`
      // (the comparison follows its value, as a small tag, wherever the value ends)
      + `${base ? ` <span class="rot-check__base"><span class="sr-only">, </span>${esc(base)}</span>` : ''}</span></li>`;
  }).join('');
  return `<section class="rot-check" aria-labelledby="rotCheckH"><h3 class="plans__h" id="rotCheckH">Rotation check</h3><ul class="rot-check__list">${items}</ul></section>`;
}

// ---- wiring ----

const ARROWS = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

/** The next radio in a group for an arrow, Home or End key (wrapping), or null for other keys. */
export function nextIndex(key, i, n) {
  if (!n) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  if (!(key in ARROWS)) return null;
  return (i + ARROWS[key] + n) % n;
}

/**
 * Wires the ribbon's controls inside `el` (delegated, so a re-render needs no new wiring):
 * - a row button opens or closes its story (aria-expanded and the story row's hidden), focus stays;
 *   onToggle(id, open)
 * - the plan switch: click, arrows, Home and End move and select; onSelect(kind)
 * - the "Plan for {field}" radios: arrows, Home and End move and pick (a click, so the panel's own
 *   click handler does the picking)
 * Returns dispose().
 */
export function wireRibbon(el, { onToggle, onSelect } = {}) {
  if (!el?.addEventListener) return function dispose() {};
  const onClick = (e) => {
    const btn = e.target.closest?.('.rib__open');
    if (btn && el.contains(btn)) {
      const id = btn.dataset.field;
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      btn.closest('.rib__row')?.classList.toggle('is-open', open);
      const story = el.querySelector(`[id="story-${attrSel(id)}"]`);
      if (story) story.hidden = !open;
      onToggle?.(id, open);
      return;
    }
    const seg = e.target.closest?.('.rib-switch__seg');
    if (seg && el.contains(seg) && seg.getAttribute('aria-checked') !== 'true') onSelect?.(seg.dataset.kind);
  };
  const onKey = (e) => {
    const seg = e.target.closest?.('.rib-switch__seg');
    const cell = !seg && e.target.closest?.('.story__cells .plan-cell');
    const item = seg || cell;
    if (!item) return;
    const group = [...item.parentElement.querySelectorAll(seg ? '.rib-switch__seg' : '.plan-cell')];
    const j = nextIndex(e.key, group.indexOf(item), group.length);
    if (j == null) return;
    e.preventDefault();
    const to = group[j];
    if (seg) {
      for (const b of group) b.tabIndex = b === to ? 0 : -1;
      to.focus();
      if (to.getAttribute('aria-checked') !== 'true') onSelect?.(to.dataset.kind);
    } else {
      for (const b of group) b.tabIndex = b === to ? 0 : -1;
      to.focus();
      to.click();
    }
  };
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
  return function dispose() {
    el.removeEventListener('click', onClick);
    el.removeEventListener('keydown', onKey);
  };
}
