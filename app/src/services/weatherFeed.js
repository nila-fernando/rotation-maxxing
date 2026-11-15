// The farm's current weather, from Open-Meteo (open-meteo.com): free, no key, and it answers the
// browser directly (CORS open). Its data is CC BY 4.0, credited in the time-of-day popover
// (WEATHER_CREDIT). Note its free API is for non-commercial use; a paid plan (or the US National
// Weather Service, api.weather.gov) would be the switch for a commercial launch: only
// fetchCurrent() would change.
//
//   const feed = startWeatherFeed({ place: () => ({ lat, lon }), onReading })
//   feed.refresh()   ask now      feed.stop()
//
// It asks every 20 minutes (src/island/weather.js refreshDelay) while the page is in view, again
// when it comes back into view after a while, and when the connection comes back. Offline or failing, it says nothing and
// the farm shows fair weather (onReading(null) once a reading is too old to trust).
import { isStale, MAX_AGE_MS, refreshDelay } from '../island/weather.js';

const API = 'https://api.open-meteo.com/v1/forecast';
export const WEATHER_CREDIT = 'Weather: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0)';

/**
 * The current conditions at a place: { code, cloud, wind, gusts, precip, snowfall, isDay, time }
 * (wind and gusts in mph, precipitation in mm, snowfall in cm, time an ISO string in local time).
 */
export async function fetchCurrent({ lat, lon }, { signal, fetchImpl = globalThis.fetch } = {}) {
  const url = `${API}?${new URLSearchParams({
    latitude: Number(lat).toFixed(3), // (about 100 m: plenty for the weather, and no closer than needed)
    longitude: Number(lon).toFixed(3),
    current: 'weather_code,cloud_cover,precipitation,snowfall,wind_speed_10m,wind_gusts_10m,is_day',
    wind_speed_unit: 'mph',
    timezone: 'auto',
  })}`;
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return readingFrom(await res.json());
}

/** Open-Meteo's answer -> a reading (throws on one without a weather code). */
export function readingFrom(json) {
  const c = json?.current;
  if (!c || !Number.isFinite(c.weather_code)) throw new Error('No current weather in the answer');
  return {
    code: c.weather_code,
    cloud: c.cloud_cover ?? null,
    wind: c.wind_speed_10m ?? 0,
    gusts: c.wind_gusts_10m ?? 0,
    precip: c.precipitation ?? 0,
    snowfall: c.snowfall ?? 0,
    isDay: c.is_day === 1,
    time: c.time ?? null,
  };
}

/**
 * Keeps asking for the weather at `place()` (null: nowhere yet, so nothing is asked).
 * @param {object} o
 * @param {() => ({lat: number, lon: number}|null)} o.place
 * @param {(reading: object|null) => void} o.onReading
 * @param {Function} [o.fetchImpl]   (tests)
 */
export function startWeatherFeed({ place, onReading, fetchImpl, now = () => Date.now() } = {}) {
  let timer = 0;
  let failures = 0;
  let lastAt = 0; // when the last good reading came
  let busy = null;
  let stopped = false;

  const schedule = (ms) => { clearTimeout(timer); if (!stopped) timer = setTimeout(refresh, ms); };

  async function refresh() {
    clearTimeout(timer);
    if (stopped || busy) return;
    if (globalThis.document?.visibilityState === 'hidden') return; // nobody's looking: asked again when they are
    const where = place();
    if (!where || !Number.isFinite(where.lat) || !Number.isFinite(where.lon)) { schedule(refreshDelay(0)); return; }
    if (globalThis.navigator?.onLine === false) { fail(); return; } // the 'online' event asks again
    const ctl = new AbortController();
    const giveUp = setTimeout(() => ctl.abort(), 12000);
    busy = ctl;
    try {
      const reading = await fetchCurrent(where, { signal: ctl.signal, fetchImpl });
      if (stopped) return;
      failures = 0;
      lastAt = now();
      onReading(reading);
      schedule(refreshDelay(0));
    } catch {
      if (!stopped) fail();
    } finally {
      clearTimeout(giveUp);
      busy = null;
    }
  }

  function fail() {
    failures++;
    // a reading too old to trust goes: fair weather until a new one comes
    if (lastAt && now() - lastAt > MAX_AGE_MS) { lastAt = 0; onReading(null); }
    schedule(refreshDelay(failures));
  }

  const onVisible = () => { if (document.visibilityState === 'visible' && isStale(lastAt, now())) refresh(); };
  const onOnline = () => refresh();
  globalThis.document?.addEventListener('visibilitychange', onVisible);
  globalThis.addEventListener?.('online', onOnline);
  refresh();

  return {
    refresh,
    stop() {
      stopped = true;
      clearTimeout(timer);
      busy?.abort();
      globalThis.document?.removeEventListener('visibilitychange', onVisible);
      globalThis.removeEventListener?.('online', onOnline);
    },
  };
}
