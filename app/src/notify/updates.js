// Farm updates for the bell in the header: the week's weather at the farm (frost, heavy rain, strong
// wind, heat, a dry spell), the climate trend from NASA rain, and what the farm is waiting on (the
// season check-in). Worked out from real data the app already has, never made up.
//
//   fetchForecast({ lat, lon })            -> Promise<Forecast | null>   (Open-Meteo, 7 days, keyless)
//   buildUpdates({ today, forecast, fields, seasonsDue })  -> [{ id, kind, title, body, action? }]
//   unseenCount(updates, seen)             how many the farmer hasn't opened yet
//
// Forecast = { days: [{ date: 'YYYY-MM-DD', minF, maxF, rainIn, gustMph }] }

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

export async function fetchForecast({ lat, lon }, { fetchImpl = globalThis.fetch, signal } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const q = new URLSearchParams({
    latitude: lat.toFixed(3), longitude: lon.toFixed(3),
    daily: 'temperature_2m_min,temperature_2m_max,precipitation_sum,wind_gusts_10m_max',
    temperature_unit: 'fahrenheit', precipitation_unit: 'inch', wind_speed_unit: 'mph',
    timezone: 'auto', forecast_days: '7',
  });
  try {
    const res = await fetchImpl(`${OPEN_METEO}?${q}`, { signal });
    if (!res.ok) return null;
    return forecastFrom(await res.json());
  } catch {
    return null;
  }
}

/** Open-Meteo's daily arrays as days (missing values left out). */
export function forecastFrom(json) {
  const d = json?.daily;
  if (!Array.isArray(d?.time)) return null;
  const n = (a, i) => (Array.isArray(a) && Number.isFinite(a[i]) ? a[i] : null);
  return {
    days: d.time.map((date, i) => ({
      date, minF: n(d.temperature_2m_min, i), maxF: n(d.temperature_2m_max, i), rainIn: n(d.precipitation_sum, i), gustMph: n(d.wind_gusts_10m_max, i),
    })),
  };
}

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** "Tuesday" for a date this week ("today", "tomorrow" for the first two). */
export function dayName(date, today) {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((day - t0) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return DAY[day.getDay()];
}
const r = (x) => Math.round(x);
const r1 = (x) => Math.round(x * 10) / 10;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The farm's updates, most pressing first. */
export function buildUpdates({ today = new Date(), forecast = null, fields = [], seasonsDue = [] } = {}) {
  const out = [];
  const days = (forecast?.days || []).filter((d) => d.date);

  // frost: the coldest night at or below freezing
  const frost = days.filter((d) => d.minF != null && d.minF <= 32).sort((a, b) => a.minF - b.minF)[0];
  if (frost) {
    out.push({
      id: `frost|${frost.date}`, kind: 'frost',
      title: `Frost ${dayName(frost.date, today) === 'today' ? 'tonight' : `${dayName(frost.date, today)} night`}`,
      body: `A low of ${r(frost.minF)}°F at the farm. ${frost.minF <= 28 ? 'A hard freeze: anything still green or just sown can be hurt.' : 'A light frost: tender plants may need cover.'}`,
    });
  }
  // heavy rain: the wettest day with an inch or more
  const wet = days.filter((d) => d.rainIn != null && d.rainIn >= 1).sort((a, b) => b.rainIn - a.rainIn)[0];
  if (wet) {
    out.push({
      id: `rain|${wet.date}`, kind: 'rain', title: `Heavy rain ${dayName(wet.date, today)}`,
      body: `About ${r1(wet.rainIn)} in forecast. Low spots and fresh tillage may wash; field work waits a day or two after.`,
    });
  }
  // strong wind
  const windy = days.filter((d) => d.gustMph != null && d.gustMph >= 45).sort((a, b) => b.gustMph - a.gustMph)[0];
  if (windy) {
    out.push({ id: `wind|${windy.date}`, kind: 'wind', title: `Strong wind ${dayName(windy.date, today)}`, body: `Gusts to ${r(windy.gustMph)} mph. Not a day for spraying.` });
  }
  // heat
  const hot = days.filter((d) => d.maxF != null && d.maxF >= 95).sort((a, b) => b.maxF - a.maxF)[0];
  if (hot) {
    out.push({ id: `heat|${hot.date}`, kind: 'heat', title: `Heat ${dayName(hot.date, today)}`, body: `A high of ${r(hot.maxF)}°F. Crops in flower feel it most.` });
  }
  // a dry week, in the growing season (April to September)
  const month = today.getMonth();
  const total = days.reduce((s, d) => s + (d.rainIn || 0), 0);
  if (days.length >= 5 && month >= 3 && month <= 8 && total < 0.1) {
    out.push({ id: `dry|${days[0].date}`, kind: 'dry', title: 'A dry week ahead', body: `Almost no rain in the next ${days.length} days.` });
  }

  // what the farm is waiting on: the season check-in
  const y = seasonsDue[seasonsDue.length - 1];
  if (y) {
    out.push({
      id: `season|${y}`, kind: 'season', title: `How did ${y} go?`,
      body: `Tell me each field’s crop and yield, and I’ll tune your next three seasons to how your fields really do.`,
      action: { label: 'Tell Manami', act: 'season' },
    });
  }

  // the climate trend: recent growing seasons against the 30-year normal (NASA POWER, per farm)
  const rain = fields.find((f) => f.rain?.growingSeasonRainMm?.length && Number.isFinite(f.rain.avg30yrRainMm))?.rain;
  if (rain) {
    const recent = [...rain.growingSeasonRainMm].sort((a, b) => a.year - b.year).slice(-3);
    const avg = recent.reduce((s, x) => s + x.value, 0) / recent.length;
    const ratio = avg / rain.avg30yrRainMm;
    if (ratio < 0.9 || ratio > 1.1) {
      const dry = ratio < 1;
      out.push({
        id: `climate|${recent[recent.length - 1].year}|${dry ? 'dry' : 'wet'}`, kind: 'climate',
        title: `${cap(dry ? 'drier' : 'wetter')} than normal lately`,
        body: `The last ${recent.length} growing seasons averaged ${r1(avg / 25.4)} in of rain, against ${r1(rain.avg30yrRainMm / 25.4)} in normally (April to September). ${dry ? 'Your plans weigh dry years in.' : 'Your plans weigh wet years in.'}`,
        action: { label: 'See the plans', act: 'plans' },
      });
    } else {
      out.push({
        id: `climate|${recent[recent.length - 1].year}|normal`, kind: 'climate', title: 'Rain close to normal lately',
        body: `The last ${recent.length} growing seasons averaged ${r1(avg / 25.4)} in of rain, about the ${r1(rain.avg30yrRainMm / 25.4)} in normal.`,
      });
    }
  }
  return out;
}

/** How many updates the farmer hasn't opened yet (seen: a Set of ids). */
export const unseenCount = (updates, seen) => updates.filter((u) => !seen.has(u.id)).length;
