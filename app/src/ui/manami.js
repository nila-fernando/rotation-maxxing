// Manami, the app's guide: a round avatar in the bottom-left corner with a speech bubble.
// Every screen talks through this one component, so she keeps her spot as the app moves along.
//
//   manami.say('Hi!', { actions: [{ label: 'Go', primary: true, onClick }] })
//   manami.hide()
//   manami.collapse()   just her face; tap it to read the message again

import { asset } from './asset.js';

const AVATAR_SRC = asset('/manami.svg');

export function createManami(host) {
  host.classList.add('manami');
  host.innerHTML = `
    <button class="manami__avatar" type="button" aria-label="Manami’s message" aria-expanded="true">
      <img src="${AVATAR_SRC}" alt="" width="64" height="58">
    </button>
    <div class="manami__bubble" role="status" aria-live="polite" tabindex="-1">
      <p class="manami__name">Manami</p>
      <p class="manami__text"></p>
      <div class="manami__actions"></div>
    </div>`;
  const text = host.querySelector('.manami__text');
  const actions = host.querySelector('.manami__actions');
  const bubble = host.querySelector('.manami__bubble');
  const avatar = host.querySelector('.manami__avatar');
  const setCollapsed = (on) => {
    host.classList.toggle('is-collapsed', on);
    avatar.setAttribute('aria-expanded', String(!on));
  };
  avatar.addEventListener('click', () => setCollapsed(!host.classList.contains('is-collapsed')));
  let token = 0;

  /**
   * Show a line from Manami. A new line replaces the old one with a small hop.
   * @param {string} line
   * @param {{actions?: {label: string, onClick: () => void, primary?: boolean}[], focus?: boolean}} [opts]
   *   focus: move keyboard focus to her first button (or her bubble). Focus is also kept with her when
   *   it was already on one of her buttons, since those are replaced.
   */
  function say(line, { actions: buttons = [], focus = false } = {}) {
    const id = ++token;
    const wasShown = host.classList.contains('is-shown');
    const hadFocus = host.contains(document.activeElement);
    text.textContent = line;
    actions.replaceChildren(...buttons.map(({ label, onClick, primary }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = primary ? 'btn btn--primary btn--small' : 'btn btn--quiet btn--small';
      b.textContent = label;
      b.addEventListener('click', onClick);
      return b;
    }));
    actions.hidden = buttons.length === 0;
    host.classList.add('is-shown');
    setCollapsed(false);
    if (focus || hadFocus) (actions.querySelector('button') || bubble).focus({ preventScroll: true });
    if (wasShown) {
      host.classList.remove('is-hop');
      void host.offsetWidth; // restart the hop animation
      if (id === token) host.classList.add('is-hop');
    }
  }

  function hide() {
    token++;
    host.classList.remove('is-shown', 'is-hop');
  }

  /** Tucks the bubble away (just her face stays); tapping her face brings it back. */
  function collapse() {
    if (host.classList.contains('is-shown') && !host.contains(document.activeElement)) setCollapsed(true);
  }

  return { say, hide, collapse, el: host };
}
