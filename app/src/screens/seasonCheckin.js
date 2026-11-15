// The season check-in: Manami asks how a season went, field by field (what grew, the yield, anything
// unusual, a note), then the planner learns from it (src/plan/seasons.js) and she says what she took
// from each field. A workspace like the jar test: it opens over the farm, one at a time (main.js).
//
//   const panel = createSeasonCheckin({ getFields, getReports, today, onSave, onSeePlans, onOpen, onClose })
//   panel.open({ season? })   panel.close()   panel.isOpen
//   onSave(report) -> Promise<{ lines: string[], weather: 'observed' | 'average' | null }>
//
// Steps: 'ask' (the cards) -> 'tuning' (the planner replays the season) -> 'done' (her words).

import { CROP_CHOICES } from '../fields/cropEdits.js';
import { CROP_STYLE } from '../island/crops.js';
import { cropBadge } from '../ui/cropTip.js';
import { asset } from '../ui/asset.js';
import { SEASON_EVENTS, cleanReports, normalizeReport, seasonsDue, seasonsOpen, unitFor, unitWords, yieldOk } from '../plan/seasons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);

/** The crop a field most likely grew in `season`, to start its card with: what's on record, else none. */
export function likelyCrop(field, season) {
  const name = field?.crops?.[season];
  if (!name) return null;
  const key = Object.keys(CROP_STYLE).find((k) => CROP_STYLE[k].label.toLowerCase() === String(name).toLowerCase() || k === String(name).toLowerCase());
  return key || null;
}

/** A blank (or saved) report as the cards' working copy: { [fieldId]: { crop, yield, events, notes } }. */
export function draftFor(fields, season, saved = null) {
  const out = {};
  for (const f of fields || []) {
    const r = saved?.fields?.[f.id];
    out[f.id] = {
      crop: r?.crop ?? likelyCrop(f, season),
      yield: r?.yield ?? '',
      events: [...(r?.events || [])],
      notes: r?.notes || '',
    };
  }
  return out;
}

/** What still needs saying before saving (null when it's fine): a yield that can't be right. */
export function draftProblem(draft, names = new Map()) {
  for (const [id, d] of Object.entries(draft)) {
    if (d.yield === '' || d.yield == null) continue;
    const unit = d.crop ? unitFor(d.crop) : null;
    const y = Number(d.yield);
    if (!unit) return `${names.get(id) || 'A field'}: I can’t take a yield for that crop yet. Leave it blank.`;
    if (!yieldOk(y, unit)) return `${names.get(id) || 'A field'}: ${d.yield} ${unitWords(unit)} doesn’t look right. Check the number?`;
  }
  return null;
}

export function createSeasonCheckin({ getFields, getReports, today = () => new Date(), onSave, onSeePlans, onOpen, onClose }) {
  const root = $('season');
  const body = $('seasonBody');
  const foot = $('seasonFoot');
  const years = $('seasonYears');
  const title = $('seasonTitle');
  const live = $('seasonLive');
  let season = null;
  let draft = {};
  let step = 'ask';
  let outcome = null;
  let opener = null;
  let seq = 0;

  const fields = () => getFields() || [];
  const names = () => new Map(fields().map((f) => [f.id, f.name]));
  const savedFor = (y) => cleanReports(getReports()).find((r) => r.season === y) || null;

  function open({ season: want = null } = {}) {
    const open = seasonsOpen(today(), fields(), getReports());
    if (!open.length) return false;
    const due = seasonsDue(today(), fields(), getReports());
    season = want && open.includes(want) ? want : (due[due.length - 1] ?? open[open.length - 1]);
    draft = draftFor(fields(), season, savedFor(season));
    step = 'ask';
    outcome = null;
    opener = document.activeElement;
    root.hidden = false;
    document.body.classList.add('season-open');
    onOpen?.();
    render();
    title.focus({ preventScroll: true });
    return true;
  }

  function close({ restore = true } = {}) {
    if (root.hidden) return;
    seq++; // (an answer still coming is let go)
    root.hidden = true;
    document.body.classList.remove('season-open');
    onClose?.();
    if (restore && opener?.isConnected) opener.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- drawing
  function render() {
    const open = seasonsOpen(today(), fields(), getReports());
    title.textContent = `How did ${season} go?`;
    years.hidden = open.length < 2 || step !== 'ask';
    years.innerHTML = open.map((y) => `<button type="button" role="radio" class="season__year" data-year="${y}" aria-checked="${y === season}" tabindex="${y === season ? 0 : -1}">${y}</button>`).join('');
    if (step === 'ask') renderAsk();
    else if (step === 'tuning') renderTuning();
    else renderDone();
  }

  function renderAsk() {
    const saved = savedFor(season);
    const cards = fields().map((f) => {
      const d = draft[f.id];
      const unit = d.crop ? unitFor(d.crop) : null;
      const options = [`<option value=""${d.crop ? '' : ' selected'}>Choose</option>`]
        .concat(CROP_CHOICES.map((c) => `<option value="${c.key}"${c.key === d.crop ? ' selected' : ''}>${esc(c.label)}</option>`)).join('');
      const icon = d.crop ? cropBadge(null, { key: d.crop, name: CROP_STYLE[d.crop]?.label, sub: String(season), inControl: true, cls: 'crop-ico' }) : '<span class="season-card__noicon" aria-hidden="true"></span>';
      const chips = SEASON_EVENTS.map((e) => `<button type="button" class="season-chip" data-field="${esc(f.id)}" data-event="${e.key}" aria-pressed="${d.events.includes(e.key)}">${esc(e.label)}</button>`).join('');
      return `<li class="season-card" data-field="${esc(f.id)}">
        <div class="season-card__head"><span class="season-card__icon">${icon}</span><span class="season-card__name">${esc(f.name)}</span><span class="season-card__acres">${Math.round(f.acres || 0)} ac</span></div>
        <div class="season-card__row">
          <label class="season-field"><span class="season-field__label">Grew</span><select class="season-field__input" data-crop="${esc(f.id)}">${options}</select></label>
          <label class="season-field"><span class="season-field__label">Yield${unit ? `, ${esc(unitWords(unit))}` : ''}</span><input class="season-field__input" type="number" inputmode="decimal" min="0" step="any" placeholder="${unit ? 'Leave blank if unsure' : 'No yield for this crop'}" data-yield="${esc(f.id)}" value="${esc(d.yield)}"${unit ? '' : ' disabled'}></label>
        </div>
        <div class="season-card__events" role="group" aria-label="Anything unusual on ${esc(f.name)}?"><span class="season-field__label">Anything unusual?</span><div class="season-chips">${chips}</div></div>
        <label class="season-field season-field--note"><span class="season-field__label">Notes, if you like</span><input class="season-field__input" type="text" maxlength="280" data-notes="${esc(f.id)}" value="${esc(d.notes)}" placeholder="Late frost, a wet spring, a new variety…"></label>
      </li>`;
    }).join('');
    body.innerHTML = `
      <div class="season__manami"><img src="${asset('/manami.svg')}" alt="" width="40" height="36"><p>Tell me how each field did in ${season}. I’ll check it against that year’s real weather and tune your next three seasons. Leave anything you’re not sure of blank.</p></div>
      <ul class="season-cards">${cards}</ul>`;
    foot.innerHTML = `<p class="season__problem" role="alert" id="seasonProblem"></p>
      <button class="btn btn--quiet btn--small" type="button" data-act="later">Later</button>
      <button class="btn btn--primary btn--small" type="button" data-act="save">${saved ? 'Save and tune again' : 'Save and tune my plans'}</button>`;
  }

  function renderTuning() {
    body.innerHTML = `<p class="season__wait" role="status"><span class="plans__spinner" aria-hidden="true"></span>Checking ${season} against that year’s weather and tuning your plans…</p>`;
    foot.innerHTML = '';
  }

  function renderDone() {
    const o = outcome || {};
    const weather = o.weather === 'observed'
      ? `I used ${season}’s real weather at your farm, from NASA POWER.`
      : o.weather === 'average' ? `I couldn’t get ${season}’s weather yet, so I compared with an average year. I’ll look again next time.` : '';
    const lines = o.lines?.length
      ? `<ul class="season-said">${o.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
      : `<p class="season__note">${esc(o.error || 'Saved. There was nothing for me to compare yet: add a yield next time and I’ll learn from it.')}</p>`;
    body.innerHTML = `
      <div class="season__manami"><img src="${asset('/manami.svg')}" alt="" width="40" height="36"><p>Thanks! Here’s what ${season} taught me.</p></div>
      ${lines}
      ${weather ? `<p class="season__note">${esc(weather)}</p>` : ''}`;
    foot.innerHTML = `<button class="btn btn--quiet btn--small" type="button" data-act="edit">Change my answers</button>
      <button class="btn btn--quiet btn--small" type="button" data-act="close">Done</button>
      <button class="btn btn--primary btn--small" type="button" data-act="plans">See my new plans</button>`;
    live.textContent = `Saved. ${o.lines?.length || 0} fields compared.`;
  }

  // ---------------------------------------------------------------- doing
  async function save() {
    const problem = draftProblem(draft, names());
    if (problem) { $('seasonProblem').textContent = problem; return; }
    const report = normalizeReport({ season, savedAt: new Date().toISOString(), fields: draft }, { fieldIds: new Set(fields().map((f) => f.id)) });
    const mine = ++seq;
    step = 'tuning';
    render();
    try {
      outcome = await onSave(report);
    } catch (e) {
      outcome = { lines: [], error: `Saved, but I couldn’t tune the plans just now (${e?.message || 'the planner stopped'}). I’ll try again when you open them.` };
    }
    if (mine !== seq || root.hidden) return;
    step = 'done';
    render();
    title.focus({ preventScroll: true });
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest?.('button');
    if (!t) return;
    if (t.id === 'seasonClose' || t.dataset.act === 'later' || t.dataset.act === 'close') { close(); return; }
    if (t.dataset.act === 'save') { save(); return; }
    if (t.dataset.act === 'edit') { step = 'ask'; draft = draftFor(fields(), season, savedFor(season)); render(); return; }
    if (t.dataset.act === 'plans') { close({ restore: false }); onSeePlans?.(); return; }
    if (t.dataset.year) { season = Number(t.dataset.year); draft = draftFor(fields(), season, savedFor(season)); render(); return; }
    if (t.dataset.event) {
      const d = draft[t.dataset.field];
      const k = t.dataset.event;
      d.events = d.events.includes(k) ? d.events.filter((x) => x !== k) : [...d.events, k];
      t.setAttribute('aria-pressed', String(d.events.includes(k)));
    }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.crop) {
      draft[t.dataset.crop].crop = t.value || null;
      if (!t.value || !unitFor(t.value)) draft[t.dataset.crop].yield = '';
      const focusId = t.dataset.crop;
      renderAsk(); // (the yield's unit follows the crop)
      body.querySelector(`[data-crop="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
    }
  });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.yield) draft[t.dataset.yield].yield = t.value;
    if (t.dataset.notes) draft[t.dataset.notes].notes = t.value;
    const p = $('seasonProblem');
    if (p?.textContent) p.textContent = '';
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !root.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
  });

  return { open, close, get isOpen() { return !root.hidden; }, get season() { return season; } };
}
