// The big "find your farm" search bar with a US-only suggestion list (an ARIA combobox).
// Messages ("no match") go to a separate live status line, not into the listbox.
import { looksLikeCounty, lookup, SEARCH_CREDIT, suggest } from '../services/geocode.js';

const DEBOUNCE_MS = 250;
const ICONS = {
  house: '<path d="M4 11.5 12 5l8 6.5V20H4z" fill="currentColor" opacity=".18"/><path d="M3 12l9-7.5 9 7.5M6 10.5V20h12v-9.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  county: '<path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z" fill="currentColor" opacity=".18"/><path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2zM9 4v14M15 6v14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  pin: '<path d="M12 21s-7-6.6-7-12a7 7 0 0 1 14 0c0 5.4-7 12-7 12z" fill="currentColor" opacity=".18"/><path d="M12 21s-7-6.6-7-12a7 7 0 0 1 14 0c0 5.4-7 12-7 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="9" r="2.6" fill="currentColor"/>',
};
const iconFor = (kind) => ICONS[kind === 'house' || kind === 'street' ? 'house' : kind === 'county' || kind === 'find-county' ? 'county' : 'pin'];

/**
 * @param {object} parts
 * @param {HTMLFormElement} parts.form
 * @param {HTMLInputElement} parts.input
 * @param {HTMLElement} parts.list      the listbox
 * @param {HTMLElement} parts.status    a live region for "no match" messages
 * @param {(place: object) => void} parts.onPick
 * @param {() => void} [parts.onOffline]  search couldn't be reached
 */
export function createSearchBox({ form, input, list, status, onPick, onOffline }) {
  let places = [];
  let active = -1;
  let stale = false; // the text changed since `places` arrived
  let timer = 0;
  let controller = null;

  function setOpen(on) {
    list.hidden = !on;
    input.setAttribute('aria-expanded', String(on));
    if (!on) setActive(-1);
  }

  function setActive(i) {
    active = i;
    [...list.querySelectorAll('[role="option"]')].forEach((el, j) => el.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', `place-${i}`);
    else input.removeAttribute('aria-activedescendant');
    list.querySelector(`#place-${i}`)?.scrollIntoView({ block: 'nearest' });
  }

  function setStatus(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  function show(newPlaces) {
    places = newPlaces;
    stale = false;
    list.replaceChildren();
    places.forEach((p, i) => {
      const li = document.createElement('li');
      li.id = `place-${i}`;
      li.className = 'suggestion';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.innerHTML = `<svg class="suggestion__icon" viewBox="0 0 24 24" aria-hidden="true">${iconFor(p.kind)}</svg>
        <span class="suggestion__text"><b></b><small></small></span>`;
      li.querySelector('b').textContent = p.label;
      li.querySelector('small').textContent = p.detail || (p.kind === 'county' ? 'County' : '');
      li.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the input
      li.addEventListener('click', () => choose(p));
      li.addEventListener('pointermove', () => { if (active !== i) setActive(i); });
      list.appendChild(li);
    });
    if (places.length) {
      const credit = document.createElement('li');
      credit.className = 'suggestions__credit';
      credit.setAttribute('role', 'presentation');
      credit.innerHTML = SEARCH_CREDIT;
      list.appendChild(credit);
    }
    setOpen(places.length > 0);
    setActive(-1);
  }

  async function choose(place) {
    if (place.kind === 'find-county') { // the "find this county" row: one full look-up, then go
      input.value = place.query;
      const found = await run(place.query, { full: true });
      if (found?.length) choose(found[0]);
      return;
    }
    input.value = place.kind === 'house' && place.detail ? `${place.label}, ${place.detail}` : place.label;
    setOpen(false);
    setStatus('');
    onPick(place);
  }

  async function run(query, { full = false } = {}) {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    if (full) { setOpen(false); setStatus('Searching…'); }
    try {
      let found = full ? await lookup(query, signal) : await suggest(query, signal);
      if (signal.aborted) return null;
      // Photon has no county areas: offer the county itself first, found on Enter or click
      if (!full && looksLikeCounty(query) && !found.some((p) => p.kind === 'county')) {
        found = [{ id: 'find-county', kind: 'find-county', query: query.trim(), label: query.trim(), detail: 'Find this county' }, ...found];
      }
      show(found);
      setStatus(full && !found.length ? 'No US match yet. Try a full street address, a town, or a county name.' : '');
      return found;
    } catch (e) {
      if (e.name === 'AbortError') return null;
      show([]);
      setStatus('');
      onOffline?.();
      return null;
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    stale = true;
    setActive(-1);
    setStatus('');
    const q = input.value;
    if (q.trim().length < 3) {
      controller?.abort();
      show([]);
      return;
    }
    timer = setTimeout(() => run(q), DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    const n = stale ? 0 : places.length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      if (list.hidden) setOpen(true);
      setActive((active + 1) % n);
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      if (list.hidden) setOpen(true);
      setActive(active <= 0 ? n - 1 : active - 1);
    } else if (e.key === 'Escape' && (!list.hidden || !status.hidden)) {
      e.stopPropagation();
      setOpen(false);
      setStatus('');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearTimeout(timer);
    if (!stale && active >= 0 && places[active]) return choose(places[active]);
    const q = input.value.trim();
    if (!q) return;
    // Enter before (or instead of) picking a suggestion: search in full and take the best match
    const found = await run(q, { full: true });
    if (found?.length) choose(found[0]);
  });

  input.addEventListener('blur', () => setTimeout(() => setOpen(false), 120));
  input.addEventListener('focus', () => { if (places.length && !stale) setOpen(true); });

  return {
    focus: () => input.focus({ preventScroll: true }),
    clear: () => { input.value = ''; show([]); setStatus(''); },
    close: () => { setOpen(false); setStatus(''); },
  };
}
