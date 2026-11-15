// Step 3 · Manami's check-in, shown while the farm's data loads.
//
// The satellite map stays visible but dimmed. Manami asks three tap-only questions, one at a time,
// each with Skip, while a checklist on the right shows each data source's real progress (from the
// farm's load, src/data/farmLoad.js): checking, done, no data here, or couldn't reach.
//
// Rules: the screen never moves on while a question is open (if the data is in first it waits); if
// the answers finish first, Manami says what she's still waiting on until every source has settled
// (each has its own time limit, so this ends). Then the island. The answers become
// farmProfile { priorities[], irrigatedFieldIds[], excludedCrops[] }.
//
//   checkIn.start({ fields, load })   the check-in: questions, then the island once the data is in
//   checkIn.wait({ load })            just the checklist and Manami waiting (the dev shortcuts)

import { createTurntable } from '../ui/rotateManami.js';
import { settledShare, statusText } from '../data/loadStatus.js';

// Line icons (24×24, drawn with currentColor) in the same style as the toolbar. No emoji in the UI.
const ICON = {
  profit: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14.6 9.4c-.5-.9-1.5-1.4-2.6-1.4-1.5 0-2.6.8-2.6 1.9 0 1.2 1.1 1.7 2.7 2s2.8.9 2.8 2.1-1.2 2-2.8 2c-1.3 0-2.4-.6-2.8-1.5M12 6.4V8M12 16v1.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  'soil-health': '<path d="M12 20v-7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 13c0-3.6-2.6-6.2-6.4-6.2 0 3.6 2.6 6.2 6.4 6.2zM12 11.2c0-3.1 2.2-5.6 5.8-5.6 0 3.1-2.2 5.6-5.8 5.6z" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M5.5 20h13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  'saving-water': '<path d="M12 3.6s-6 6.5-6 10.5a6 6 0 0 0 12 0c0-4-6-10.5-6-10.5z" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9.2 14.6a2.9 2.9 0 0 0 2.4 2.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  'low-risk': '<path d="M12 3.2l7 2.9v5.4c0 4.4-3 7.7-7 9.4-4-1.7-7-5-7-9.4V6.1z" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
};

export const PRIORITIES = [
  { key: 'profit', label: 'Profit', icon: ICON.profit },
  { key: 'soil-health', label: 'Soil health', icon: ICON['soil-health'] },
  { key: 'saving-water', label: 'Saving water', icon: ICON['saving-water'] },
  { key: 'low-risk', label: 'Low risk', icon: ICON['low-risk'] },
];
export const CROPS = [
  { key: 'corn', label: 'Corn' },
  { key: 'soybeans', label: 'Soybeans' },
  { key: 'wheat', label: 'Wheat' },
  { key: 'oats', label: 'Oats' },
  { key: 'alfalfa', label: 'Alfalfa' },
  { key: 'sorghum', label: 'Sorghum' },
];
export const DEFAULT_PROFILE = Object.freeze({ priorities: ['profit'], irrigatedFieldIds: [], excludedCrops: [] });

// how Manami names each source while she's waiting on it
const WAITING_NAME = {
  crops: 'crop history',
  soil: 'the soil survey',
  slope: 'the slope',
  rain: 'rain records',
  greenness: 'satellite greenness',
  market: 'local yields and prices',
};

// True facts only (no "your farm" numbers here).
const FUN_FACTS = [
  'Landsat satellites have photographed every farm in the US since 1972. That’s how we can look back at your fields.',
  'In 2000, the Space Shuttle Endeavour mapped the height of almost all of Earth’s land in just 11 days.',
  'Every year, USDA maps the crop in every field of the lower 48 states from satellite images. That’s where your crop history comes from.',
  'NASA’s POWER project turns satellite and weather-model data into daily weather for any spot on Earth, back to 1981.',
];

/** "crop history and satellite greenness", "crop history, the soil survey and the slope". */
export function listNames(keys) {
  const names = keys.map((k) => WAITING_NAME[k] || k);
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Manami's line while the farmer waits on the data (sources still loading, from the tracker). */
export function waitingLine(rows) {
  const left = rows.filter((r) => r.state === 'loading').map((r) => r.key);
  if (!left.length) return 'That’s everything in.';
  const slow = left.includes('crops') ? ' Crop history is checked year by year for every field, so it’s the slow one.' : '';
  return `I’m still waiting on ${listNames(left)}. I’ll show you your farm the moment it’s all in.${slow}`;
}

/** What Manami says about the sources that didn't come in, or ''. */
export function missingLine(rows) {
  const failed = rows.filter((r) => r.failed > 0).map((r) => r.key);
  if (!failed.length) return '';
  return `I couldn’t reach everything: ${listNames(failed)} didn’t all come in. I’ll say where it’s missing, and you can try again from there.`;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const acres = (n) => `${Math.round(n).toLocaleString('en-US')} ac`;

/**
 * @param {object} o
 * @param {{hide: Function}} o.manami   the corner Manami steps aside; the check-in panel is her voice here
 * @param {(profile: object) => void} o.onDone
 */
export function createCheckIn({ manami, onDone }) {
  const $ = (id) => document.getElementById(id);
  const root = $('checkin');
  const card = $('checkinCard');
  const listEl = $('checklistRows');
  const turntable = createTurntable($('checklist')); // Manami turning on top of the checklist (src/ui/rotateManami.js)
  const progressEl = $('checklistProgress');

  let run = 0; // bumped by start/stop so a stale run's timers do nothing

  /**
   * @param {{fields: {id: string, name: string, acres: number}[], load: object}} o
   *   load: the farm's data load (src/data/farmLoad.js): its tracker and whenSettled()
   * @returns {Promise<object>} the farmProfile, once both the answers and the data are in
   */
  async function start({ fields, load }) {
    const id = ++run;
    const alive = () => id === run;
    open();
    bindChecklist(load.tracker);

    const profile = await askAll(fields, alive); // the screen never moves on mid-question
    if (!alive()) return null;

    // the answers came first: Manami says what she's still waiting on, until it's all in
    const waited = !load.settled;
    if (waited) showWaiting(load.tracker, alive, { step: 'Thanks! Nearly there…' });
    await load.whenSettled();
    if (!alive()) return null;
    await showDone(profile, waited, load.tracker);
    if (!alive()) return null;
    unbind();
    onDone(profile);
    return profile;
  }

  /**
   * Just the checklist and Manami waiting, until every source has settled (the dev shortcuts
   * ?hub=N and ?reveal=N). Resolves true then, or false if stopped first.
   */
  async function wait({ load }) {
    const id = ++run;
    const alive = () => id === run;
    open();
    bindChecklist(load.tracker);
    showWaiting(load.tracker, alive, { step: 'One moment' });
    await load.whenSettled();
    if (!alive()) return false;
    unbind();
    return true;
  }

  function open() {
    manami.hide();
    root.hidden = false;
    document.body.classList.add('checkin-on');
    requestAnimationFrame(() => root.classList.add('is-in'));
    turntable.start();
  }

  function stop() {
    run++;
    unbind();
    turntable.stop();
    root.classList.remove('is-in');
    root.hidden = true;
    document.body.classList.remove('checkin-on');
  }

  // ---------------------------------------------------------------- the checklist
  // one row per data source, kept in step with the load's tracker
  let unbindFn = null;
  function unbind() {
    unbindFn?.();
    unbindFn = null;
  }

  function bindChecklist(tracker) {
    unbind();
    const rows = tracker.all();
    listEl.replaceChildren(...rows.map((r) => {
      const li = document.createElement('li');
      li.className = 'check-row';
      li.dataset.key = r.key;
      li.innerHTML = `<span class="check-row__mark" aria-hidden="true"></span>
        <span class="check-row__label"></span><span class="check-row__source"></span><span class="check-row__detail"></span>`;
      li.querySelector('.check-row__label').textContent = r.label;
      li.querySelector('.check-row__source').textContent = r.source;
      return li;
    }));
    const paint = () => paintChecklist(tracker.all());
    paint();
    unbindFn = tracker.subscribe(paint);
  }

  function paintChecklist(rows) {
    for (const r of rows) {
      const li = listEl.querySelector(`[data-key="${r.key}"]`);
      if (!li) continue;
      li.dataset.state = r.state;
      li.classList.toggle('is-partial', r.state === 'done' && r.failed > 0);
      li.querySelector('.check-row__detail').textContent = statusText(r);
      li.title = r.reason && r.state !== 'loading' ? r.reason : '';
    }
    const total = rows.length;
    const n = rows.filter((r) => r.state !== 'loading').length;
    const missing = rows.some((r) => r.failed > 0);
    progressEl.textContent = n < total ? `${n} of ${total} checked` : missing ? 'Everything’s checked' : 'All your farm data is in';
    $('checklistBar').style.setProperty('--done', String(settledShare(rows)));
    $('checklist').classList.toggle('is-complete', n === total);
  }

  // ---------------------------------------------------------------- the questions
  async function askAll(fields, alive) {
    const priorities = await ask({
      step: 1,
      question: 'What matters most to you this year?',
      hint: 'Pick one, and a second if it’s a tie.',
      options: PRIORITIES,
      max: 2,
      min: 1,
      ordered: true,
      fallback: DEFAULT_PROFILE.priorities,
    }, alive);
    if (!alive()) return null;

    const irrigatedFieldIds = await askIrrigation(fields, alive);
    if (!alive()) return null;

    const excludedCrops = await ask({
      step: 3,
      question: 'Any crops you won’t or can’t grow?',
      hint: 'Tap any that are off the table.',
      options: CROPS,
      max: CROPS.length,
      min: 0,
      fallback: DEFAULT_PROFILE.excludedCrops,
      nextLabel: (n) => (n ? 'Done' : 'None, all fine'),
    }, alive);
    if (!alive()) return null;

    return { priorities, irrigatedFieldIds, excludedCrops };
  }

  /**
   * One chip question. Resolves with the picked keys, or the fallback on Skip.
   * ordered: keep the order they were tapped (first pick = main priority).
   */
  function ask({ step, question, hint, options, max, min, ordered = false, fallback, nextLabel }, alive) {
    return new Promise((resolve) => {
      let picks = [];
      const render = () => {
        card.querySelectorAll('.chip').forEach((chip) => {
          const at = picks.indexOf(chip.dataset.key);
          chip.setAttribute('aria-pressed', String(at >= 0));
          const badge = chip.querySelector('.chip__order');
          if (badge) badge.textContent = ordered && at >= 0 && max > 1 ? String(at + 1) : '';
        });
        const next = card.querySelector('[data-act="next"]');
        next.disabled = picks.length < min;
        if (nextLabel) next.textContent = nextLabel(picks.length);
      };
      showQuestion({ step, question, hint, options, multi: max > 1, nextText: nextLabel ? nextLabel(0) : 'Next' }, {
        onChip: (key) => {
          if (picks.includes(key)) picks = picks.filter((k) => k !== key);
          else if (picks.length < max) picks = [...picks, key];
          else if (max === 1 || ordered) picks = [...picks.slice(1), key]; // a third tap replaces the oldest
          render();
        },
        onNext: () => { if (alive() && picks.length >= min) resolve(picks); },
        onSkip: () => { if (alive()) resolve([...fallback]); },
      });
      render();
    });
  }

  /** "Do you irrigate?" All / Some / None, and with Some, a chip per field. */
  function askIrrigation(fields, alive) {
    return new Promise((resolve) => {
      let choice = null;
      let ticked = [];
      const fieldChips = fields.map((f) => ({ key: f.id, label: `${f.name} · ${acres(f.acres)}` }));
      const render = () => {
        card.querySelectorAll('.chip[data-group="main"]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.key === choice)));
        const sub = card.querySelector('.checkin-q__sub');
        sub.hidden = choice !== 'some';
        sub.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(ticked.includes(c.dataset.key))));
        const next = card.querySelector('[data-act="next"]');
        next.disabled = !choice || (choice === 'some' && ticked.length === 0);
      };
      showQuestion({
        step: 2,
        question: 'Do you irrigate?',
        hint: 'Pick one.',
        options: [{ key: 'all', label: 'All fields' }, { key: 'some', label: 'Some fields' }, { key: 'none', label: 'None' }],
        multi: false,
        sub: { label: 'Which ones?', options: fieldChips },
      }, {
        onChip: (key, group) => {
          if (group === 'sub') ticked = ticked.includes(key) ? ticked.filter((k) => k !== key) : [...ticked, key];
          else choice = key;
          render();
        },
        onNext: () => {
          if (!alive() || !choice || (choice === 'some' && !ticked.length)) return;
          if (choice === 'all') resolve(fields.map((f) => f.id));
          else if (choice === 'some') resolve(fields.map((f) => f.id).filter((fid) => ticked.includes(fid))); // in list order
          else resolve([]);
        },
        onSkip: () => { if (alive()) resolve([...DEFAULT_PROFILE.irrigatedFieldIds]); },
      });
      render();
    });
  }

  /** Renders a question card. Chips are toggle buttons; Skip and Next sit at the bottom. */
  function showQuestion({ step, question, hint, options, multi, sub, nextText = 'Next' }, { onChip, onNext, onSkip }) {
    // icons are our own static markup; labels (which can include farmer-typed field names) are set as text below
    const chip = (o, group) => `<button type="button" class="chip" data-key="${o.key}" data-group="${group}" aria-pressed="false">
        ${o.icon ? `<svg class="chip__icon" viewBox="0 0 24 24" aria-hidden="true">${o.icon}</svg>` : ''}<span class="chip__label"></span><span class="chip__order" aria-hidden="true"></span></button>`;
    card.innerHTML = `
      <p class="checkin-q__step">Question ${step} of 3</p>
      <h2 class="checkin-q__title" id="checkinQuestion" tabindex="-1"></h2>
      <p class="checkin-q__hint"></p>
      <div class="checkin-q__chips" role="group" aria-labelledby="checkinQuestion">${options.map((o) => chip(o, 'main')).join('')}</div>
      ${sub ? `<div class="checkin-q__sub" hidden><p class="checkin-q__hint">${sub.label}</p>
        <div class="checkin-q__chips" role="group" aria-label="${sub.label}">${sub.options.map((o) => chip(o, 'sub')).join('')}</div></div>` : ''}
      <div class="checkin-q__actions">
        <button type="button" class="btn btn--quiet btn--small" data-act="skip">Skip</button>
        <button type="button" class="btn btn--primary btn--small" data-act="next" disabled></button>
      </div>`;
    card.querySelector('.checkin-q__title').textContent = question;
    card.querySelector('.checkin-q__hint').textContent = hint;
    card.querySelector('[data-act="next"]').textContent = nextText;
    // labels set as text, so field names typed by the farmer can't inject markup
    const labels = [...options, ...(sub?.options || [])];
    card.querySelectorAll('.chip').forEach((c, i) => { c.querySelector('.chip__label').textContent = labels[i].label; });
    card.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => onChip(c.dataset.key, c.dataset.group)));
    card.querySelector('[data-act="next"]').addEventListener('click', onNext);
    card.querySelector('[data-act="skip"]').addEventListener('click', onSkip);
    card.dataset.multi = String(multi);
    bump();
    card.querySelector('.checkin-q__title').focus({ preventScroll: true });
  }

  /** "Still getting your farm's data…": what Manami is waiting on, kept up to date, and a fun fact. */
  function showWaiting(tracker, alive, { step }) {
    const fact = FUN_FACTS[Math.floor(Math.random() * FUN_FACTS.length)];
    card.innerHTML = `
      <p class="checkin-q__step"></p>
      <h2 class="checkin-q__title" tabindex="-1">Still getting your farm’s data…</h2>
      <p class="checkin-fact checkin-wait"></p>
      <p class="checkin-aside"><b>Fun fact:</b> <span></span></p>`;
    card.querySelector('.checkin-q__step').textContent = step;
    card.querySelector('.checkin-aside span').textContent = fact;
    const line = card.querySelector('.checkin-wait');
    const say = () => {
      const text = waitingLine(tracker.all());
      if (line.textContent !== text) line.textContent = text; // (read out only when it changes)
    };
    say();
    const off = tracker.subscribe(() => { if (alive() && line.isConnected) say(); else off(); });
    bump();
    card.querySelector('.checkin-q__title').focus({ preventScroll: true });
  }

  async function showDone(profile, afterWait, tracker) {
    card.innerHTML = `
      <p class="checkin-q__step">All set</p>
      <h2 class="checkin-q__title" tabindex="-1">Your farm is ready!</h2>
      <p class="checkin-fact"></p>`;
    const main = PRIORITIES.find((p) => p.key === profile.priorities[0]);
    const missing = missingLine(tracker.all());
    card.querySelector('.checkin-fact').textContent = `I’ll plan with ${main ? main.label.toLowerCase() : 'profit'} first in mind.${missing ? ` ${missing}` : ''}`;
    bump();
    card.querySelector('.checkin-q__title').focus({ preventScroll: true });
    await pause(missing ? 3200 : afterWait ? 1600 : 1200);
  }

  function bump() {
    card.classList.remove('is-new');
    void card.offsetWidth;
    card.classList.add('is-new');
  }

  return { start, wait, stop };
}
