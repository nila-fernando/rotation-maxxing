// The farm-sounds switch at the end of the hub's top bar: a speaker with its sound waves (on), or
// crossed out (off). A toggle button (aria-pressed), so a keyboard and a screen reader get it as
// one; its name stays "Farm sounds" while the pressed state says which way it is.
//
//   bindSoundToggle(button, ambience)   -> unbind()

const ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" fill-opacity=".18"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.8a7.4 7.4 0 0 1 0 10.4"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" fill-opacity=".18"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';

export function bindSoundToggle(button, ambience) {
  if (!button || !ambience) return () => {};
  const paint = ({ on, available }) => {
    button.hidden = !available; // no Web Audio here: no switch
    button.setAttribute('aria-pressed', String(on));
    button.title = on ? 'Farm sounds on' : 'Farm sounds off';
    button.classList.toggle('is-off', !on);
    const icon = on ? ICON_ON : ICON_OFF;
    if (button.dataset.icon !== (on ? 'on' : 'off')) { button.dataset.icon = on ? 'on' : 'off'; button.innerHTML = icon; }
  };
  const onClick = () => ambience.toggle();
  button.addEventListener('click', onClick);
  const off = ambience.onChange(paint);
  return () => { off(); button.removeEventListener('click', onClick); };
}
