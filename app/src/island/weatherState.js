// The weather on the island right now, in one place: the island's look follows it (seasons.js,
// through timeTravel.js), and anything else that wants to know (ambient sound, say) can listen.
//
//   import { farmWeather } from './island/weatherState.js'
//   farmWeather.state        { look, intensity, wind, source, picked, live, at }  (frozen)
//     look       'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'storm' | 'snow' | 'wind' (src/island/weather.js)
//     intensity  0..1, how heavy (rain, snow) or how thick (cloud, fog)
//     wind       0..1, calm to wild
//     source     'live' (the farm's real weather), 'preview' (picked in the popover or ?weather=),
//                'none' (no reading yet, or offline: fair weather)
//     picked     the previewed look, or null for Live
//     live       the last real reading ({ look, intensity, wind, reading, at }) or null
//   const off = farmWeather.subscribe((state, prev) => ...)   called on every change (not at once)
//   farmWeather.setLive(reading)   a reading from src/services/weatherFeed.js (null: none, fair weather)
//   farmWeather.pick('rain')       preview a look; pick(null) goes back to Live
import { lookFromReading, pickedWeather } from './weather.js';

const round = (v) => Math.round(v * 100) / 100;

export function createWeatherState({ now = () => Date.now() } = {}) {
  const listeners = new Set();
  let live = null;
  let picked = null;
  let state = compute();

  function compute() {
    const w = picked ? pickedWeather(picked) : live ? live : { look: 'clear', intensity: 0, wind: 0 };
    const source = picked ? 'preview' : live ? 'live' : 'none';
    return Object.freeze({ look: w.look, intensity: round(w.intensity), wind: round(w.wind), source, picked, live, at: now() });
  }

  function update() {
    const prev = state;
    const next = compute();
    if (next.look === prev.look && next.intensity === prev.intensity && next.wind === prev.wind
      && next.source === prev.source && next.picked === prev.picked && next.live === prev.live) return;
    state = next;
    for (const fn of [...listeners]) {
      try { fn(state, prev); } catch (err) { console.error(err); }
    }
  }

  return {
    get state() { return state; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** The farm's real weather (a reading from weatherFeed.js), or null when there's none. */
    setLive(reading) {
      live = reading ? Object.freeze({ ...lookFromReading(reading), reading, at: now() }) : null;
      update();
    },
    /** Preview a look ('rain'...), or null for Live. */
    pick(look) {
      picked = look || null;
      update();
    },
  };
}

/** The app's one weather state (the island and the ambient sound share it). */
export const farmWeather = createWeatherState();
