// "Ask Manami": a chat panel where the farmer asks about their farm and Manami answers (streamed).
// The answers come from Claude through the app's own server (server/ai); her tools run here
// (src/ai/context.js). Without the server (GitHub Pages, or no key) the panel says so plainly.
//
//   const ask = createAskManami({ host, endpoint })
//   ask.open({ focus: { kind: 'field', field_id, name } | null, opener })
//   ask.close()

import { asset } from '../ui/asset.js';
import { buildFarmContext, createClientTools, toolStatusLine } from '../ai/context.js';
import { createSession, errorLine, probeHealth } from '../ai/runner.js';

const FACE = asset('/manami.svg');
const SEEN_KEY = 'askManami.seen';
const CLOSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>';
const SEND_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l15-7-5 15-2.5-6z" fill="currentColor" fill-opacity=".25" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>';

export const ASK_LINES = {
  hello: 'Ask me anything about your farm: your fields, their history, the soil, the plans, or how the app works.',
  helloField: (name) => `Ask me anything about ${name}.`,
  privacy: 'Your questions and farm details go to Anthropic’s Claude so I can answer.',
  offline: 'Asking me questions needs the online helper, and it isn’t on here yet. Everything else on the farm works as usual.',
  noKey: 'Asking me questions needs the online helper. On this computer it needs a Claude key in app/.env, then a restart of the app.',
  checking: 'One moment…',
};

const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

export function suggestionsFor(focus) {
  if (focus?.kind === 'field' && focus.name) {
    return [`What has ${focus.name} grown lately?`, `Is anything about ${focus.name} a worry?`, `What should go on ${focus.name} next?`];
  }
  return ['What do I grow on each field?', 'Which field needs a look first?', 'What do the plans say?'];
}

/**
 * @param {object} o
 * @param {object} o.host        { fields, report, profile, place, plansData, savedPlan, today }
 * @param {string|null} o.endpoint  null when there is no AI server (GitHub Pages)
 * @param {() => void} [o.onOpen] [o.onClose]
 */
export function createAskManami({ host, endpoint, onOpen, onClose }) {
  const root = document.createElement('section');
  root.className = 'ask';
  root.id = 'ask';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-labelledby', 'askTitle');
  root.innerHTML = `
    <div class="ask__top">
      <img class="ask__face" src="${FACE}" alt="" width="40" height="36">
      <div class="ask__heading">
        <h2 class="ask__title" id="askTitle">Ask Manami</h2>
        <p class="ask__about" id="askAbout"></p>
      </div>
      <button class="btn btn--quiet btn--small ask__reset" type="button" hidden>Start over</button>
      <button class="checkup__close ask__close" type="button" aria-label="Close Ask Manami">${CLOSE_SVG}</button>
    </div>
    <ol class="ask__log" aria-live="polite" aria-relevant="additions text" tabindex="-1"></ol>
    <p class="ask__status" role="status" aria-live="polite"></p>
    <div class="ask__chips" role="group" aria-label="Questions you could ask"></div>
    <form class="ask__form">
      <label class="sr-only" for="askInput">Your question for Manami</label>
      <textarea class="ask__input" id="askInput" rows="1" maxlength="4000" placeholder="Ask Manami about your farm" autocomplete="off"></textarea>
      <button class="btn btn--primary ask__send" type="submit" aria-label="Ask">${SEND_SVG}</button>
    </form>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const log = $('.ask__log'), status = $('.ask__status'), chips = $('.ask__chips'), form = $('.ask__form');
  const input = $('.ask__input'), send = $('.ask__send'), about = $('#askAbout'), reset = $('.ask__reset');

  const tools = createClientTools(host);
  const session = endpoint ? createSession({ endpoint, getContext: () => buildFarmContext(host), tools }) : null;
  let health = null; // null: not asked yet; a promise while asking; then { ai, reason }
  let focus = null;
  let opener = null;
  let ac = null;

  const line = (who, text) => {
    const li = document.createElement('li');
    li.className = `ask__msg ask__msg--${who}`;
    const name = document.createElement('span');
    name.className = 'sr-only';
    name.textContent = who === 'me' ? 'You: ' : 'Manami: ';
    const p = document.createElement('p');
    p.textContent = text;
    li.append(name, p);
    log.appendChild(li);
    li.scrollIntoView({ block: 'end' });
    return p;
  };
  const setChips = (list) => {
    chips.replaceChildren(...list.map((q) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ask__chip';
      b.textContent = q;
      b.addEventListener('click', () => submit(q));
      return b;
    }));
    chips.hidden = !list.length;
  };
  const setEnabled = (on) => {
    input.disabled = !on;
    send.disabled = !on;
    chips.querySelectorAll('button').forEach((b) => { b.disabled = !on; });
  };

  async function checkHealth() {
    if (!session) return { ai: false, reason: 'no_endpoint' };
    if (health?.ai) return health; // once she can answer, she stays able (a failure says so per question)
    health = await probeHealth(endpoint);
    return health;
  }

  async function submit(text) {
    const q = String(text || '').trim();
    if (!q || !session || session.busy) return;
    input.value = '';
    fit();
    chips.hidden = true;
    line('me', q);
    const out = line('manami', '');
    out.parentElement.classList.add('is-typing');
    setEnabled(false);
    ac = new AbortController();
    try {
      const answer = await session.ask(q, {
        focus,
        signal: ac.signal,
        statusFor: (name, inp) => toolStatusLine(name, inp, host),
        onUpdate: ({ text: t, status: s }) => {
          status.textContent = s || '';
          if (t != null) out.textContent = t;
          out.scrollIntoView({ block: 'end' });
        },
      });
      out.textContent = answer;
    } catch (e) {
      if (e?.name === 'AbortError') { out.textContent = 'I stopped there.'; } else out.textContent = errorLine(e?.code);
    } finally {
      ac = null;
      status.textContent = '';
      out.parentElement.classList.remove('is-typing');
      reset.hidden = !session.history.length;
      setEnabled(true);
      if (!root.hidden) input.focus({ preventScroll: true });
    }
  }

  const fit = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; input.style.overflowY = input.scrollHeight > 140 ? 'auto' : 'hidden'; };
  input.addEventListener('input', fit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(input.value); }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(input.value); });
  $('.ask__close').addEventListener('click', () => close());
  reset.addEventListener('click', () => {
    if (session?.busy) return;
    session?.reset();
    log.replaceChildren();
    reset.hidden = true;
    greet();
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

  function greet() {
    line('manami', focus?.kind === 'field' && focus.name ? ASK_LINES.helloField(focus.name) : ASK_LINES.hello);
    setChips(suggestionsFor(focus));
  }

  async function open({ focus: f = null, opener: o = null } = {}) {
    opener = o || document.activeElement;
    const changed = JSON.stringify(f) !== JSON.stringify(focus);
    focus = f;
    about.textContent = focus?.kind === 'field' && focus.name ? `About ${focus.name}` : 'About your farm';
    root.hidden = false;
    document.body.classList.add('ask-open');
    onOpen?.();
    if (!log.children.length || (changed && !session?.history.length)) { log.replaceChildren(); greet(); }
    else if (changed) setChips(suggestionsFor(focus));
    setEnabled(false);
    status.textContent = ASK_LINES.checking;
    const h = await checkHealth();
    status.textContent = '';
    if (root.hidden) return;
    if (!h.ai) {
      chips.hidden = true;
      if (!root.querySelector('.ask__msg--off')) line('manami', h.reason === 'no_key' ? ASK_LINES.noKey : ASK_LINES.offline).parentElement.classList.add('ask__msg--off');
      $('.ask__close').focus({ preventScroll: true });
      return;
    }
    if (!safeGet(SEEN_KEY)) {
      const p = line('manami', ASK_LINES.privacy);
      p.parentElement.classList.add('ask__msg--note');
      safeSet(SEEN_KEY, '1');
    }
    setEnabled(!session.busy);
    input.focus({ preventScroll: true });
  }

  function close() {
    if (root.hidden) return;
    ac?.abort();
    root.hidden = true;
    document.body.classList.remove('ask-open');
    onClose?.();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }

  return { open, close, get isOpen() { return !root.hidden; }, el: root };
}
