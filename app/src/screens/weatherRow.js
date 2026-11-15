// The "Weather" row in the time-of-day popover: Live (the farm's real weather, the default) or one
// look to preview. A radio group like the seasons and festivals above it, with Open-Meteo's credit.
//
//   const row = createWeatherRow({ el, credit, weather, onPick })
//   row.paint()     (after the weather changed)     row.dispose()
import { LOOK_NAMES, liveWords, PICKS } from '../island/weather.js';
import { WEATHER_CREDIT } from '../services/weatherFeed.js';

const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const CLOUD = 'M7.4 14h9.4a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9.2 1.1A2.9 2.9 0 0 0 7.4 14z';
export const WEATHER_ICONS = {
  live: svg('<circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><path d="M8.3 8.3a5.2 5.2 0 0 0 0 7.4M15.7 8.3a5.2 5.2 0 0 1 0 7.4M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2"/>'),
  clear: svg('<circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/><path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5l1.5 1.5M17 17l1.5 1.5M5.5 18.5L7 17M17 7l1.5-1.5"/>'),
  cloudy: svg('<path d="M7 18.5h10.2a3.9 3.9 0 0 0 .4-7.8 5.5 5.5 0 0 0-10.6 1.2A3.3 3.3 0 0 0 7 18.5z" fill="currentColor" fill-opacity=".25"/>'),
  fog: svg('<path d="M4 8h14M6 12h14M4 16h14M7 20h10"/>'),
  rain: svg(`<path d="${CLOUD}" fill="currentColor" fill-opacity=".25"/><path d="M8.6 17l-1 2.6M12.6 17l-1 2.6M16.6 17l-1 2.6"/>`),
  storm: svg(`<path d="${CLOUD}" fill="currentColor" fill-opacity=".25"/><path d="M12.6 15.2l-2.2 3.4h2.8l-1.8 3.2" stroke-width="1.9"/><path d="M7.6 17.2l-.8 2M17.4 17.2l-.8 2"/>`),
  snow: svg('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.6 4.4L12 6l2.4-1.6M9.6 19.6L12 18l2.4 1.6"/>'),
  wind: svg('<path d="M3 9h10.5a2.7 2.7 0 1 0-2.6-3.3M3 13.5h15a2.8 2.8 0 1 1-2.7 3.5M3 18h7"/>'),
};

/**
 * @param {object} o
 * @param {HTMLElement} o.el       the radio group (#dayWeather)
 * @param {HTMLElement} [o.credit] where the weather data's credit goes
 * @param {object} o.weather       the weather state (src/island/weatherState.js)
 * @param {() => void} [o.onPick]  after the farmer picked one (the popover repaints)
 */
export function createWeatherRow({ el, credit, weather, onPick }) {
  const keys = ['live', ...PICKS];
  el.innerHTML = keys.map((k) => `<button type="button" role="radio" class="daypop__theme" data-weather="${k}" aria-checked="false" tabindex="-1">${WEATHER_ICONS[k]}<span>${k === 'live' ? 'Live' : LOOK_NAMES[k]}</span></button>`).join('');
  if (credit) credit.innerHTML = WEATHER_CREDIT;

  function paint() {
    const s = weather.state;
    const on = s.picked || 'live';
    for (const b of el.children) {
      const k = b.dataset.weather;
      b.setAttribute('aria-checked', String(k === on));
      b.tabIndex = k === on ? 0 : -1;
      if (k === 'live') {
        const words = liveWords(s.live);
        b.title = words;
        b.setAttribute('aria-label', `Live (${words.charAt(0).toLowerCase()}${words.slice(1)})`);
      }
    }
  }

  const onClick = (e) => {
    const b = e.target.closest('[data-weather]');
    if (!b) return;
    weather.pick(b.dataset.weather === 'live' ? null : b.dataset.weather);
    paint();
    onPick?.();
  };
  // arrow keys move along the group, as in the seasons and festivals
  const onKey = (e) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const btns = [...el.children];
    const i = Math.max(0, btns.findIndex((b) => b.getAttribute('aria-checked') === 'true'));
    const next = btns[(i + step + btns.length) % btns.length];
    next.click();
    next.focus();
  };
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
  paint();

  return {
    paint,
    dispose() {
      el.removeEventListener('click', onClick);
      el.removeEventListener('keydown', onKey);
      el.replaceChildren();
    },
  };
}
