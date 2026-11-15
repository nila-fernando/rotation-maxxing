// The bell in the farm's header and its "Farm updates" popover (src/notify/updates.js for what's in it).
// A popover like your-farms: it closes when anything else opens (main.js). New updates show a count on
// the bell; opening the popover marks them seen (kept on this device).
//
//   const panel = createUpdatesPanel({ getUpdates, onAction })
//   panel.refresh()   (the farm changed, or the forecast came in)   panel.open()   panel.close()   panel.isOpen
//   getUpdates() -> Promise<update[]>      onAction(act)  ('season' | 'plans')

import { unseenCount } from '../notify/updates.js';

const KEY = 'rotation-maxxing.updates.seen.v1';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SVG = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  frost: SVG('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5L12 6.5l2.5-2M9.5 19.5L12 17.5l2.5 2"/>'),
  rain: SVG('<path d="M7 15.5a4.5 4.5 0 0 1-.6-8.96A5.5 5.5 0 0 1 17 8a3.8 3.8 0 0 1 .5 7.5z" fill="currentColor" fill-opacity=".18"/><path d="M8 18.5l-1 2M12 18.5l-1 2M16 18.5l-1 2"/>'),
  wind: SVG('<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7"/>'),
  heat: SVG('<circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity=".2"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>'),
  dry: SVG('<path d="M12 3.5s6 6.6 6 10.7A6 6 0 0 1 6 14.2C6 10.1 12 3.5 12 3.5z" fill="currentColor" fill-opacity=".15"/><path d="M5 5l14 14"/>'),
  season: SVG('<path d="M4 20h16M8 20v-6M12 20V9M16 20v-9"/><path d="M8 14c-2.2 0-3.4-1.4-3.4-3.4 2.2 0 3.4 1.4 3.4 3.4zM12 9c0-2.4 1.5-4 3.8-4 0 2.4-1.5 4-3.8 4z" fill="currentColor" fill-opacity=".2"/>'),
  climate: SVG('<path d="M4 18h16M6 18V12M10 18V8M14 18v-5M18 18V6"/>'),
};

function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); }
}
function saveSeen(seen) {
  try { localStorage.setItem(KEY, JSON.stringify([...seen].slice(-200))); } catch { /* storage off: they show as new again next time */ }
}

export function createUpdatesPanel({ getUpdates, onAction }) {
  const btn = document.getElementById('notifBtn');
  const root = document.getElementById('notif');
  const body = document.getElementById('notifBody');
  const count = document.getElementById('notifCount');
  let updates = [];
  let seen = loadSeen();
  let seq = 0;

  function paintCount() {
    const n = unseenCount(updates, seen);
    count.hidden = n === 0;
    count.textContent = String(Math.min(n, 9));
    btn.setAttribute('aria-label', n ? `Farm updates, ${n} new` : 'Farm updates');
  }

  function render(newIds = new Set()) {
    if (!updates.length) {
      body.innerHTML = '<p class="notif__empty">Nothing to flag this week. I’ll let you know about frost, heavy rain, strong wind, heat and dry spells at your farm.</p>';
      return;
    }
    body.innerHTML = updates.map((u) => `
      <article class="notif__item notif__item--${esc(u.kind)}${newIds.has(u.id) ? ' is-new' : ''}">
        <span class="notif__icon">${ICON[u.kind] || ICON.climate}</span>
        <h3 class="notif__title">${esc(u.title)}</h3>
        <p class="notif__text">${esc(u.body)}</p>
        ${u.action ? `<button class="btn btn--quiet btn--small notif__act" type="button" data-act="${esc(u.action.act)}">${esc(u.action.label)}</button>` : ''}
      </article>`).join('') + '<p class="notif__src">Weather: Open-Meteo forecast for your farm (CC BY 4.0). Rain trend: NASA POWER.</p>';
  }

  let loaded = false;
  async function refresh() {
    const mine = ++seq;
    try {
      const list = await getUpdates();
      if (mine !== seq) return;
      updates = list || [];
    } catch { updates = []; }
    loaded = true;
    paintCount();
    if (!root.hidden) render();
  }

  function open() {
    if (!loaded) {
      // (the forecast is still on its way: say so, and fill in when it lands)
      body.innerHTML = '<p class="notif__wait">Checking the forecast for your farm…</p>';
      root.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      document.body.classList.add('notif-open');
      refresh().then(() => { if (!root.hidden) { root.hidden = true; document.body.classList.remove('notif-open'); open(); } });
      return;
    }
    const newIds = new Set(updates.filter((u) => !seen.has(u.id)).map((u) => u.id));
    render(newIds);
    root.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('notif-open');
    for (const u of updates) seen.add(u.id);
    saveSeen(seen);
    paintCount();
    document.getElementById('notifTitle').focus({ preventScroll: true });
  }

  function close({ restoreFocus = true } = {}) {
    if (root.hidden) return;
    root.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('notif-open');
    if (restoreFocus) btn.focus({ preventScroll: true });
  }

  btn.addEventListener('click', () => (root.hidden ? open() : close()));
  document.getElementById('notifClose').addEventListener('click', () => close());
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  document.addEventListener('pointerdown', (e) => {
    if (!root.hidden && !root.contains(e.target) && !btn.contains(e.target)) close({ restoreFocus: false });
  });
  body.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-act]');
    if (!b) return;
    close({ restoreFocus: false });
    onAction?.(b.dataset.act);
  });

  return { refresh, open, close, get isOpen() { return !root.hidden; }, get updates() { return updates; } };
}
