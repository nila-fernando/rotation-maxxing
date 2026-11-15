// Step 3 · Manami's check-in, shown while the farm's data loads.
//
// The satellite map stays visible but dimmed. Manami asks three tap-only questions, one at a time,
// each with Skip, while a checklist on the right ticks off the data sources. The data is local, so
// the timing is faked (about 1.5 s a row).
//
// Rules: the screen never moves on while a question is open (if the checklist finishes first it
// waits); if the answers finish first, Manami shares a fun fact until the checklist is done.
// The answers become farmProfile { priorities[], irrigatedFieldIds[], excludedCrops[] }.

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

const CHECKLIST = [
  { label: 'Crop history, 8 years', source: 'USDA CSB' },
  { label: 'Soil', source: 'USDA SSURGO' },
  { label: 'Terrain and slope', source: 'NASA SRTM' },
  { label: 'Weather 1981–present', source: 'NASA POWER' },
  { label: 'Yields and prices', source: 'USDA NASS, AMS' },
  { label: 'Costs per acre', source: 'USDA ERS' },
];
const ROW_MS = 1500;

// True facts only: the data here is still partly placeholder, so no "your farm" numbers yet.
const FUN_FACTS = [
  'Landsat satellites have photographed every farm in Iowa since 1972. That’s how we can look back at your fields.',
  'In 2000, the Space Shuttle Endeavour mapped the height of almost all of Earth’s land in just 11 days. Your slope numbers come from that mission.',
  'Every year, USDA maps the crop in every field of the lower 48 states from satellite images. That’s where your crop history comes from.',
  'NASA’s POWER project turns satellite and weather-model data into daily weather for any spot on Earth, back to 1981.',
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const progressEl = $('checklistProgress');

  let run = 0; // bumped by start/stop so a stale run's timers do nothing

  /**
   * @param {{fields: {id: string, name: string, acres: number}[]}} o
   * @returns {Promise<object>} the farmProfile, once both the answers and the checklist are done
   */
  async function start({ fields }) {
    const id = ++run;
    const alive = () => id === run;
    manami.hide();
    root.hidden = false;
    document.body.classList.add('checkin-on');
    requestAnimationFrame(() => root.classList.add('is-in'));

    let dataIn = false;
    const checklistDone = runChecklist(alive).then(() => { dataIn = true; });
    const profile = await askAll(fields, alive); // the screen never moves on mid-question
    if (!alive()) return null;

    // the answers came first: one fun fact until the data is in
    const factShown = !dataIn;
    if (factShown) showFact();
    await checklistDone;
    if (!alive()) return null;
    await showDone(profile, factShown);
    if (!alive()) return null;
    onDone(profile);
    return profile;
  }

  function stop() {
    run++;
    root.classList.remove('is-in');
    root.hidden = true;
    document.body.classList.remove('checkin-on');
  }

  // ---------------------------------------------------------------- the checklist
  async function runChecklist(alive) {
    listEl.replaceChildren(...CHECKLIST.map((row, i) => {
      const li = document.createElement('li');
      li.className = 'check-row';
      li.dataset.state = i === 0 ? 'loading' : 'waiting';
      li.innerHTML = `<span class="check-row__mark" aria-hidden="true"></span>
        <span class="check-row__label"></span><span class="check-row__source"></span>`;
      li.querySelector('.check-row__label').textContent = row.label;
      li.querySelector('.check-row__source').textContent = row.source;
      return li;
    }));
    setProgress(0);
    const rows = [...listEl.children];
    for (let i = 0; i < rows.length; i++) {
      rows[i].dataset.state = 'loading';
      await wait(ROW_MS);
      if (!alive()) return;
      rows[i].dataset.state = 'done';
      setProgress(i + 1);
    }
  }

  function setProgress(n) {
    const total = CHECKLIST.length;
    progressEl.textContent = n < total ? `${n} of ${total} loaded` : 'All your farm data is in';
    $('checklistBar').style.setProperty('--done', String(n / total));
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

  function showFact() {
    const fact = FUN_FACTS[Math.floor(Math.random() * FUN_FACTS.length)];
    card.innerHTML = `
      <p class="checkin-q__step">Thanks! Nearly there…</p>
      <h2 class="checkin-q__title" tabindex="-1">Fun fact</h2>
      <p class="checkin-fact"></p>`;
    card.querySelector('.checkin-fact').textContent = fact;
    bump();
    card.querySelector('.checkin-q__title').focus({ preventScroll: true });
  }

  async function showDone(profile, afterFact) {
    card.innerHTML = `
      <p class="checkin-q__step">All set</p>
      <h2 class="checkin-q__title" tabindex="-1">Your farm is ready!</h2>
      <p class="checkin-fact"></p>`;
    const main = PRIORITIES.find((p) => p.key === profile.priorities[0]);
    card.querySelector('.checkin-fact').textContent = `I’ll plan with ${main ? main.label.toLowerCase() : 'profit'} first in mind.`;
    bump();
    card.querySelector('.checkin-q__title').focus({ preventScroll: true });
    await wait(afterFact ? 1600 : 1200);
  }

  function bump() {
    card.classList.remove('is-new');
    void card.offsetWidth;
    card.classList.add('is-new');
  }

  return { start, stop };
}
