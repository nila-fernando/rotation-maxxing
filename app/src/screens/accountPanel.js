// The account button and its panel: the farms saved on this device and in the farmer's account,
// signing in with an emailed link, and signing out. Nothing in here is needed to use the app: the
// farm saves on this device without signing in (src/save/localStore.js).
//
//   const panel = createAccountPanel({ auth, sync, getCloud, local, getOpen, onOpenFarm, onNewFarm, onDeletedOpen })
//   panel.open()   panel.close()   panel.refresh()   panel.notice(text)
import { linkErrorReason } from '../save/auth.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LINK_ERRORS = {
  rate: 'That’s a lot of links in a short time. Please wait a few minutes, then try again.',
  email: 'That email doesn’t look quite right. Could you check it?',
  network: 'I can’t reach the sign-in service right now. Check your connection and try again. Your farm is still saved on this device.',
  closed: 'New sign-ups are switched off just now. Your farm is still saved on this device.',
  other: 'Something went wrong sending the link. Please try again in a moment.',
};

const SYNC_LINES = {
  idle: 'Your farms save to your account as you go.',
  saving: 'Saving to your account…',
  saved: 'Your farms are saved to your account.',
  offline: 'You’re offline. Your farm is safe on this device, and I’ll save it to your account when you’re back.',
  error: 'I couldn’t reach your account just now. Your farm is safe on this device, and I’ll try again soon.',
  'no-tables': 'Saving to your account isn’t switched on yet, so your farms save on this device for now.',
};

const day = (iso) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
};

/**
 * @param {object} o
 * @param {ReturnType<import('../save/auth.js').createAuth>} o.auth
 * @param {ReturnType<import('../save/cloudSync.js').createSync>} o.sync
 * @param {() => Promise<ReturnType<import('../save/cloudSync.js').createCloud>>} o.getCloud
 * @param {ReturnType<import('../save/localStore.js').createLocalStore>} o.local
 * @param {() => { localId: string|null, demo: boolean, busy: boolean }} o.getOpen   the farm on screen
 * @param {(localId: string) => void} o.onOpenFarm
 * @param {() => void} o.onNewFarm
 * @param {(localId: string) => void} o.onDeletedOpen
 */
export function createAccountPanel({ auth, sync, getCloud, local, getOpen, onOpenFarm, onNewFarm, onDeletedOpen }) {
  const btn = document.getElementById('acctBtn');
  const root = document.getElementById('acct');
  const body = document.getElementById('acctBody');
  const title = document.getElementById('acctTitle');

  let view = 'form'; // 'form' | 'sent'
  let email = '';
  let sentTo = '';
  let error = '';
  let note = ''; // a line from outside (a sign-in link that expired, say)
  let sending = false;
  let cloudFarms = null; // null: not asked | 'loading' | 'missing' | 'failed' | farms[]
  let confirmId = null; // the farm asking "Delete it?"
  let busyId = null; // a farm being opened or deleted
  let said = ''; // the last thing that happened ("Deleted.")

  btn.addEventListener('click', () => (root.hidden ? open() : close()));
  document.getElementById('acctClose').addEventListener('click', () => close());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !root.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
  }, true);
  document.addEventListener('pointerdown', (e) => {
    if (!root.hidden && !root.contains(e.target) && !btn.contains(e.target)) close({ restoreFocus: false });
  }, true);

  function paintButton() {
    const u = auth.user;
    btn.classList.toggle('is-in', !!u);
    const label = u ? `Your farms and account (signed in as ${u.email})` : 'Your farms and sign-in';
    btn.setAttribute('aria-label', label);
    btn.title = u ? 'Your farms (signed in)' : 'Your farms and sign-in';
  }
  auth.onChange(() => { paintButton(); cloudFarms = null; confirmId = null; if (!root.hidden) { loadCloud(); render(); } });
  paintButton();

  async function open() {
    if (!root.hidden) return;
    root.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('acct-open');
    said = '';
    confirmId = null;
    render();
    title.focus({ preventScroll: true });
    if (auth.user) loadCloud();
  }

  function close({ restoreFocus = true } = {}) {
    if (root.hidden) return;
    const had = root.contains(document.activeElement);
    root.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('acct-open');
    if (restoreFocus && had && btn.getClientRects().length) btn.focus({ preventScroll: true });
  }

  async function loadCloud() {
    const u = auth.user;
    if (!u) return;
    cloudFarms = 'loading';
    render();
    const ok = await sync.recheck();
    if (auth.user?.id !== u.id) return;
    if (!ok) { cloudFarms = sync.status === 'no-tables' ? 'missing' : 'failed'; render(); return; }
    try {
      const cloud = await getCloud();
      const list = await cloud.listFarms(u.id);
      if (auth.user?.id === u.id) cloudFarms = list;
    } catch (e) {
      console.warn('Your farms', e);
      if (auth.user?.id === u.id) cloudFarms = 'failed';
    }
    render();
  }

  /** This device's farms and the account's, one row per farm. */
  function farms() {
    const uid = auth.user?.id;
    const openId = getOpen().localId;
    const rows = local.all().sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1)).map((s) => {
      const link = uid ? s.cloud?.[uid] : null;
      const sum = { name: String(s.farm?.label || 'My farm'), fields: s.fields.length, acres: Math.round(s.fields.reduce((a, f) => a + (Number(f.acres) || 0), 0)) };
      return { key: `l:${s.id}`, localId: s.id, cloudId: link && !link.gone ? link.id : null, ...sum, savedAt: s.savedAt, demo: !!s.farm?.demo, open: s.id === openId };
    });
    if (Array.isArray(cloudFarms)) {
      const known = new Set(rows.map((r) => r.cloudId).filter(Boolean));
      const listed = new Set(cloudFarms.map((f) => f.id));
      // a farm deleted from the account elsewhere is still here on this device
      for (const r of rows) if (r.cloudId && !listed.has(r.cloudId)) r.cloudId = null;
      for (const f of cloudFarms) {
        if (known.has(f.id)) continue;
        rows.push({ key: `c:${f.id}`, localId: null, cloudId: f.id, name: f.name, fields: f.fields, acres: f.acres, savedAt: f.updatedAt, demo: false, open: false });
      }
    }
    return rows;
  }

  function farmRow(r) {
    const where = r.localId && r.cloudId ? 'On this device and in your account' : r.localId ? 'On this device' : 'In your account';
    const meta = [`${r.fields} field${r.fields === 1 ? '' : 's'}`, r.acres ? `${r.acres} ac` : null, r.savedAt ? `saved ${day(r.savedAt)}` : null].filter(Boolean).join(' · ');
    const busy = busyId === r.key;
    if (confirmId === r.key) {
      return `<li class="acct-farm is-confirm" data-key="${esc(r.key)}">
        <p class="acct-farm__ask" id="ask-${esc(r.key)}">Delete <b>${esc(r.name)}</b>${r.cloudId && r.localId ? ' from this device and your account' : r.cloudId ? ' from your account' : ''}? This can’t be undone.</p>
        <div class="acct-farm__go">
          <button type="button" class="btn btn--small acct-danger" data-act="delete-yes" aria-describedby="ask-${esc(r.key)}"${busy ? ' disabled' : ''}>${busy ? 'Deleting…' : 'Delete'}</button>
          <button type="button" class="btn btn--quiet btn--small" data-act="delete-no">Keep it</button>
        </div>
      </li>`;
    }
    return `<li class="acct-farm${r.open ? ' is-open' : ''}" data-key="${esc(r.key)}">
      <div class="acct-farm__text">
        <b class="acct-farm__name">${esc(r.name)}</b>
        <span class="acct-farm__meta">${esc(meta)}</span>
        <span class="acct-farm__where">${esc(where)}${r.demo ? ' (the demo farm stays on this device)' : ''}</span>
      </div>
      <div class="acct-farm__go">
        ${r.open ? '<span class="acct-farm__now">Open now</span>' : `<button type="button" class="btn btn--quiet btn--small" data-act="open" aria-label="Open ${esc(r.name)}"${busy ? ' disabled' : ''}>${busy ? 'Opening…' : 'Open'}</button>`}
        <button type="button" class="acct-farm__del" data-act="delete" aria-label="Delete ${esc(r.name)}" title="Delete">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>
        </button>
      </div>
    </li>`;
  }

  function render() {
    if (root.hidden) return;
    const u = auth.user;
    const focusKey = document.activeElement?.closest?.('.acct-farm')?.dataset.key;
    const focusAct = document.activeElement?.dataset?.act;
    const focusInput = document.activeElement?.id === 'acctEmail';
    const openNow = getOpen();
    let top;
    if (!u) {
      title.textContent = 'Save your farm';
      const form = view === 'sent'
        ? `<div class="acct__sent" role="status">
            <p><b>Check your email!</b> I sent a sign-in link to <b>${esc(sentTo)}</b>. Open it on this device to sign in. It works once, for the next hour.</p>
            <button type="button" class="linkish acct__again" data-act="again">Use a different email</button>
          </div>`
        : `<form class="acct__form" novalidate>
            <label class="acct__label" for="acctEmail">Email</label>
            <div class="acct__row">
              <input class="acct__input" id="acctEmail" type="email" name="email" autocomplete="email" inputmode="email" spellcheck="false"
                placeholder="you@example.com" value="${esc(email)}" required${error ? ' aria-invalid="true" aria-describedby="acctErr"' : ''}>
              <button class="btn btn--primary btn--small" type="submit"${sending ? ' disabled' : ''}>${sending ? 'Sending…' : 'Email me a link'}</button>
            </div>
            ${error ? `<p class="acct__error" id="acctErr" role="alert">${esc(error)}</p>` : ''}
          </form>`;
      top = `<p class="acct__lead">Your farm already saves on this device, no sign-in needed. Sign in to keep your farms in your account too, and open them on any device.</p>
        ${note ? `<p class="acct__note" role="status">${esc(note)}</p>` : ''}
        ${form}`;
    } else {
      title.textContent = 'Your farms';
      const line = SYNC_LINES[sync.status] || SYNC_LINES.idle;
      top = `<div class="acct__who"><span>Signed in as <b>${esc(u.email || 'you')}</b></span>
          <button type="button" class="linkish acct__out" data-act="signout">Sign out</button></div>
        ${note ? `<p class="acct__note" role="status">${esc(note)}</p>` : ''}
        <p class="acct__sync" role="status" data-status="${esc(sync.status)}">${esc(line)}${openNow.demo ? ' The demo farm saves on this device only.' : ''}</p>`;
    }
    const rows = farms();
    const loading = u && cloudFarms === 'loading' ? '<p class="acct__muted" role="status">Looking for the farms in your account…</p>' : '';
    const failed = u && cloudFarms === 'failed' ? '<p class="acct__muted">I couldn’t load the farms in your account just now.</p>' : '';
    const list = rows.length
      ? `<ul class="acct__farms">${rows.map(farmRow).join('')}</ul>`
      : '<p class="acct__muted">No saved farms yet. Pick your fields and press “Continue to my farm”, and I’ll keep them here.</p>';
    const fresh = openNow.busy ? '<button type="button" class="btn btn--quiet btn--small acct__new" data-act="new">Start a new farm</button>' : '';
    body.innerHTML = `${top}
      <h3 class="acct__h" id="acctFarmsH" tabindex="-1">${u ? 'Saved farms' : 'Farms on this device'}</h3>
      ${loading}${failed}${list}
      ${said ? `<p class="acct__said" role="status">${esc(said)}</p>` : ''}
      ${fresh}`;
    // keep the keyboard where it was
    if (focusInput) body.querySelector('#acctEmail')?.focus();
    else if (focusKey) {
      const li = body.querySelector(`.acct-farm[data-key="${CSS.escape(focusKey)}"]`);
      (li?.querySelector(`[data-act="${focusAct}"]`) || li?.querySelector('button'))?.focus();
    }
  }

  body.addEventListener('input', (e) => { if (e.target.id === 'acctEmail') email = e.target.value; });
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    const value = body.querySelector('#acctEmail')?.value.trim() || '';
    email = value;
    error = '';
    note = '';
    sending = true;
    render();
    const res = await auth.sendLink(value);
    sending = false;
    if (res.ok) { view = 'sent'; sentTo = value; render(); body.querySelector('.acct__again')?.focus(); return; }
    error = LINK_ERRORS[res.reason] || LINK_ERRORS.other;
    render();
    body.querySelector('#acctEmail')?.focus();
  });

  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'again') { view = 'form'; error = ''; render(); body.querySelector('#acctEmail')?.focus(); return; }
    if (act === 'signout') {
      await auth.signOut();
      view = 'form';
      said = 'Signed out. Your farms are still saved on this device.';
      render();
      title.focus({ preventScroll: true });
      return;
    }
    if (act === 'new') { close({ restoreFocus: false }); onNewFarm(); return; }
    const li = b.closest('.acct-farm');
    const row = li && farms().find((r) => r.key === li.dataset.key);
    if (!row) return;
    if (act === 'delete') { confirmId = row.key; said = ''; render(); body.querySelector('[data-act="delete-no"]')?.focus(); return; }
    if (act === 'delete-no') { confirmId = null; render(); body.querySelector(`.acct-farm[data-key="${CSS.escape(row.key)}"] [data-act="delete"]`)?.focus(); return; }
    if (act === 'delete-yes') { await remove(row); return; }
    if (act === 'open') await openFarm(row);
  });

  async function remove(row) {
    busyId = row.key;
    render();
    try {
      if (row.cloudId && auth.user) await (await getCloud()).deleteFarm(row.cloudId);
    } catch (e) {
      console.warn('Delete farm', e);
      busyId = null;
      said = linkErrorReason(e) === 'network' || !e?.code
        ? 'I couldn’t reach your account to delete it just now. Please try again in a moment.'
        : 'I couldn’t delete it from your account. Please try again in a moment.';
      render();
      return;
    }
    if (row.localId) local.remove(row.localId);
    if (Array.isArray(cloudFarms) && row.cloudId) cloudFarms = cloudFarms.filter((f) => f.id !== row.cloudId);
    busyId = null;
    confirmId = null;
    said = `Deleted ${row.name}.${row.open ? ' It stays on screen until you leave, but it won’t be saved any more.' : ''}`;
    if (row.open && row.localId) onDeletedOpen(row.localId);
    render();
    body.querySelector('#acctFarmsH')?.focus({ preventScroll: true });
  }

  async function openFarm(row) {
    if (row.localId) { close({ restoreFocus: false }); onOpenFarm(row.localId); return; }
    const u = auth.user;
    if (!u) return;
    busyId = row.key;
    render();
    try {
      const snap = await (await getCloud()).loadFarm(row.cloudId, u.id);
      if (!snap || !snap.fields.length) throw new Error('That farm has no fields saved.');
      if (!local.put(snap)) throw new Error('Could not keep it on this device');
      busyId = null;
      close({ restoreFocus: false });
      onOpenFarm(snap.id, { snapshot: snap });
    } catch (e) {
      console.warn('Open farm', e);
      busyId = null;
      said = 'I couldn’t open that farm just now. Please try again in a moment.';
      render();
    }
  }

  return {
    open,
    close,
    get isOpen() { return !root.hidden; },
    /** Redraws (the sync status changed, a farm was saved). */
    refresh() { paintButton(); render(); },
    /** A line at the top of the panel, and the panel opened to show it. */
    notice(text) { note = text; open(); render(); },
  };
}
