#!/usr/bin/env node
// Builds data/crop-calendar.json, the app's bundled crop timing (Iowa and Kansas, Story County in
// full), from saved public-data downloads. Node 22+, no dependencies. Build-only: nothing in src
// imports this file, and the app fetches nothing at runtime.
//
// USAGE
//   node scripts/build-crop-calendar.mjs --from <downloadsDir> [--out data/crop-calendar.json]
//   node scripts/build-crop-calendar.mjs --from <downloadsDir> --check   (exit 1 if the JSON differs)
//   node scripts/build-crop-calendar.mjs --fetch [--out ...]              (downloads into os.tmpdir()/crop-calendar/ first)
//
// <downloadsDir> holds (the --fetch mode writes the same layout):
//   dl628/h628.txt          USDA NASS Agricultural Handbook 628 (2010), the fixed-width text
//   iem/CP.csv CH.csv SP.csv SH.csv KS_WWH.csv
//                           NASS Crop Progress weekly series (IA corn and soybeans planted and
//                           harvested, KS winter wheat harvested), as served by the Iowa Environmental
//                           Mesonet. A build input only: the numbers are NASS's and NASS is cited.
//   cp/p14.txt … p22.txt, cp/h28.txt … h33.txt
//                           NASS weekly Crop Progress reports, weeks 14–22 and 28–33 of 2025. Only the
//                           "2020-2024 Average" column of Iowa's oats planted / harvested rows is read.
//   rma/dates.txt           USDA RMA ADM 2026 record A00200 (2026_A00200_Date_YTD.txt, pipe-delimited)
//   noaa/ames.csv           NOAA NCEI 1991–2020 normals, station USC00130200 (Ames 8 WSW)
//
// MANUAL PATH (how the committed v1 JSON was checked by hand against the same files):
//   - h628.txt: the "Usual Planting and Harvesting Dates by Crop - Iowa" and "- Kansas" tables. These
//     rows are NOT written to the JSON (the app reads them from the vendored planner's SEASONS); the
//     script only prints any difference from the vendor.
//   - iem/*.csv: 10/50/90% dates per year by linear interpolation, 0% assumed a week before the first
//     report (a port of tools/pct.py), then the mean day of the year over 2021–2025.
//   - cp/: Iowa oats, the 2020–2024 average column, interpolated the same way.
//   - rma/dates.txt: grep '|19|169|' for Story County and take the state mode over all 99 counties,
//     insurance plans 01–03 (Yield Protection, Revenue Protection, RP with harvest price exclusion);
//     forage seeding (alfalfa) is only offered under plan 50, so that is read for it.
//   - noaa/ames.csv: ANN-TMIN-PRBLST-T32FP50 (median last spring 32°F) and -T32FP10 (only a 10% chance
//     of a freeze after this date: our p90), ANN-TMIN-PRBFST-T32FP50 and -T28FP50 (hard freeze).
//   - HAND below: the Iowa State, Practical Farmers of Iowa and NRCS rows, each with its source id.
//
// Progress input: --progress iem (the default, the CSVs above) or --progress quickstats --key $NASS_KEY
// (the NASS Quick Stats API at build time; the key is never written anywhere, and the JSON then sets
// sources.nassProgress.apiNotice so the app shows NASS's required notice).
import { readFileSync, writeFileSync, mkdirSync, existsSync, createReadStream } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { inflateRawSync } from 'node:zlib';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILT = '2026-11-15';
const DAY = 86400000;

// ---------------------------------------------------------------------------------------------
// sources (json.sources): every src id in the JSON is one of these
// ---------------------------------------------------------------------------------------------

export const SOURCES = {
  h628: {
    title: 'USDA NASS, Field Crops Usual Planting and Harvesting Dates, Agricultural Handbook 628',
    url: 'https://esmis.nal.usda.gov/sites/default/release-files/vm40xr56k/dv13zw65p/z603r1055/planting-10-29-2010.txt',
    year: 2010,
    licence: 'US government work, public domain (17 U.S.C. §105)',
    caveat: 'Long-run dates from about 1990–2009. Planting is earlier now.',
  },
  nassProgress: {
    title: 'USDA NASS Crop Progress: Iowa corn and soybeans 2021–2025, Iowa oats 2020–2024 average, Kansas winter wheat harvest 2021–2025',
    url: 'https://esmis.nal.usda.gov/concern/publications/8336h188j',
    year: 2025,
    licence: 'US government work, public domain',
    caveat: 'State-wide pace, not your county.',
  },
  rma2026: {
    title: 'USDA RMA Actuarial Data Master 2026, A00200 Date, insurance plans 01–03 (forage seeding: plan 50)',
    url: 'https://pubfs-rma.fpac.usda.gov/pub/References/actuarial_data_master/2026/',
    year: 2026,
    licence: 'US government work, public domain',
    caveat: 'Insurance deadlines, not best dates.',
  },
  isuCorn2010: {
    title: 'Abendroth and Elmore, Updated planting date recommendations for Iowa, Iowa State University Extension',
    url: 'https://crops.extension.iastate.edu/cropnews/2010/04/updated-planting-date-recommendations-iowa',
    year: 2010,
    licence: 'Cited facts only',
    caveat: 'Best corn windows for Iowa by region.',
  },
  isuLicht2020: {
    title: 'Licht, Updated views on corn and soybean planting recommendations, Iowa State University Extension',
    url: 'https://crops.extension.iastate.edu/post/updated-views-corn-and-soybean-planting-recommendations',
    year: 2020,
    licence: 'Cited facts only',
    caveat: 'When yields start to slip, and the soil temperature to wait for.',
  },
  pfiWheat: {
    title: 'Practical Farmers of Iowa, Delayed planting for winter small grains',
    url: 'https://practicalfarmers.org/2018/10/delayed-planting-for-winter-small-grains',
    year: 2018,
    licence: 'Cited facts only',
    caveat: 'A farmer group’s advice on wheat, not a trial.',
    secondary: true,
  },
  nrcsRyeIA2025: {
    title: 'NRCS and Iowa State, Cereal Rye Cover Crop Fact Sheet for Iowa',
    url: 'https://nrcs-prod.azureedge.us/sites/default/files/2025-05/Cereal%20Rye%20Cover%20Crop%20Fact%20Sheet.pdf',
    year: 2025,
    licence: 'US government work, public domain',
    caveat: 'Seeding dates for cost-share programs. Check your county’s termination rule.',
  },
  nrcsTermV4: {
    title: 'USDA NRCS Cover Crop Termination Guidelines, version 4',
    url: 'https://secure.in.gov/isda/files/Termination_Guidelines_Designed_6.28_10.24am_002.pdf',
    year: 2019,
    licence: 'US government work, public domain',
    caveat: 'The zone map is an image; the Iowa zone is not confirmed.',
  },
  noaaNormals: {
    title: 'NOAA NCEI 1991–2020 U.S. Climate Normals, freeze dates, station USC00130200 (Ames 8 WSW)',
    url: 'https://www.ncei.noaa.gov/data/normals-annualseasonal/1991-2020/access/USC00130200.csv',
    year: 2021,
    licence: 'US government work, public domain',
    caveat: 'One weather station, the nearest to the farm.',
  },
};

// ---------------------------------------------------------------------------------------------
// HAND: the rows that are written guidance, not datasets. Each carries its source id.
// ---------------------------------------------------------------------------------------------

export const HAND = {
  IA: {
    corn: {
      // isuCorn2010: northwest and central Iowa reach 98–100% of top yield planted Apr 15 to May 9
      // (95–100% Apr 15 to May 18). Story County is central Iowa.
      best: { from: '04-15', to: '05-09', note: '98% of top yield in central Iowa', src: 'isuCorn2010' },
      // isuLicht2020: yield losses are expected for corn planted after May 18, and planting should
      // wait for soil at 50°F and rising.
      lossAfter: { date: '05-18', src: 'isuLicht2020' },
      soilCue: 'isuLicht2020',
    },
    soybeans: {
      // isuLicht2020: soybean yield losses after May 20; the same 50°F-and-rising soil cue. No start date given.
      best: { from: null, to: '05-20', note: 'yields slip after May 20', src: 'isuLicht2020' },
      soilCue: 'isuLicht2020',
    },
    'winter-wheat': {
      // pfiWheat (secondary): the best window for winter wheat in Iowa is about Oct 1 to Oct 10.
      best: { from: '10-01', to: '10-10', note: 'a farmer group’s advice', src: 'pfiWheat', secondary: true },
    },
  },
  cover: {
    'cereal-rye': {
      IA: {
        // nrcsRyeIA2025: seed cereal rye from mid-August to late October (dates from the Midwest Cover
        // Crops Council), read as Aug 15 to Oct 31. nrcsTermV4 zone 3: terminate at or before planting;
        // the zone map is an image, so the Iowa zone is not confirmed (zoneConfirmed false).
        seed: ['08-15', '10-31'], terminate: 'at or before planting', zoneConfirmed: false, src: 'nrcsRyeIA2025', termSrc: 'nrcsTermV4',
      },
    },
  },
};

export const GAPS = [
  'Handbook 628 dates are from about 1990–2009.',
  'No Iowa planting pace for winter wheat.',
  'No Story County insurance dates for wheat.',
  'The NRCS termination zone for Iowa isn’t confirmed.',
];

/** The counties written in full (only the demo county in v1: Story County, Iowa). */
const COUNTIES = { '19169': { name: 'Story County, IA', state: 'IA', region: 'central Iowa' } };

// ---------------------------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const mmddOf = (ms) => { const d = new Date(ms); return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const dayOfYear = (ms) => { const d = new Date(ms); return Math.round((ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY) + 1; };
/** A day of the year, read on the 2025 calendar (as tools/pct.py does). */
const mmddOfDoy = (n) => mmddOf(Date.UTC(2025, 0, 1) + (n - 1) * DAY);
/** Python's round(): halves go to the even neighbour (pct.py used it). */
const pyRound = (x) => { const f = Math.floor(x); const d = x - f; if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1; return Math.round(x); };

/**
 * When cumulative progress first reaches t%, by linear interpolation between weekly reports. With
 * assumeZeroWeekBefore, 0% is assumed a week before the first report. → ms (UTC) or null.
 */
function crossing(series, t, assumeZeroWeekBefore) {
  const pts = series.map((r) => ({ d: Date.parse(`${r.date}T00:00:00Z`), v: Number(r.pct) })).sort((a, b) => a.d - b.d);
  if (!pts.length) return null;
  let prev = assumeZeroWeekBefore ? { d: pts[0].d - 7 * DAY, v: 0 } : pts[0];
  for (const p of pts) {
    if (p.v >= t) {
      if (p.v === prev.v) return p.d;
      const f = (t - prev.v) / (p.v - prev.v);
      return prev.d + pyRound(f * ((p.d - prev.d) / DAY)) * DAY;
    }
    prev = p;
  }
  return null;
}

/**
 * The 10%, 50% and 90% dates ("MM-DD") of one season's weekly cumulative progress.
 * @param {Array<{date:string, pct:number}>} series  date 'YYYY-MM-DD'
 * @returns {{p10:string|null, p50:string|null, p90:string|null}}
 */
export function pctDates(series, { assumeZeroWeekBefore = true } = {}) {
  const at = (t) => { const ms = crossing(series ?? [], t, assumeZeroWeekBefore); return ms == null ? null : mmddOf(ms); };
  return { p10: at(10), p50: at(50), p90: at(90) };
}

/**
 * Several years' progress → one {p10, p50, p90, years}. Each percentile is the mean day of the year
 * over the years (each year's own day count, then read on the 2025 calendar), rounded: a port of
 * tools/pct.py, which the research values came from. (The spec said median; the means are what the
 * research and the spec's own JSON hold, so the mean is kept. See the track report.)
 * @param {Record<string, Array<{date, pct}>>} perYear  year → series
 */
export function averageYears(perYear, { from = 2021, to = 2025 } = {}) {
  const years = Object.keys(perYear).map(Number).filter((y) => y >= from && y <= to).sort();
  const out = {};
  for (const [key, t] of [['p10', 10], ['p50', 50], ['p90', 90]]) {
    const doys = years.map((y) => crossing(perYear[y], t, true)).filter((ms) => ms != null).map(dayOfYear);
    out[key] = doys.length ? mmddOfDoy(pyRound(doys.reduce((a, b) => a + b, 0) / doys.length)) : null;
  }
  return { ...out, years: years.length ? `${years[0]}–${years[years.length - 1]}` : null };
}

// ---------------------------------------------------------------------------------------------
// Handbook 628
// ---------------------------------------------------------------------------------------------

const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Sept: 9, Oct: 10, Nov: 11, Dec: 12 };
const STATE_CODE = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY',
  Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
  Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA',
  Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'New England': 'NE6',
};
/** Handbook row names (with the printed typos fixed first) → planner crop ids. */
const H628_CROP = {
  'Corn for grain': 'corn', Soybeans: 'soybeans', 'Wheat, winter': 'winter-wheat', 'Wheat, spring': 'spring-wheat',
  'Oats, spring': 'oats', 'Barley, spring': 'barley', 'Sorghum for grain': 'sorghum', 'Hay, alfalfa': 'alfalfa',
  'Cotton, all': 'cotton', 'Sunflower, all': 'sunflower', Canola: 'canola', 'Dry beans': 'dry-beans', 'Dry edible beans': 'dry-beans',
};
const DATE_TOKEN = /\(NA\)|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec) \d{1,2}/g;
const tokenDate = (t) => { if (t === '(NA)') return null; const [m, d] = t.split(' '); return `${pad(MON[m])}-${pad(Number(d))}`; };

/**
 * Parses the Handbook 628 text's "by Crop - {State}" tables, fixing the printed typos ("Winter, wheat",
 * "Sorhgum"). → { IA: { corn: { plant:{begin, activeStart, activeEnd, end}|null, harvest:{…} } } }.
 * @param {string} text
 */
export function parseH628(text) {
  const out = {};
  let state = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/Winter, wheat/g, 'Wheat, winter').replace(/Sorhgum/g, 'Sorghum');
    const head = /Usual Planting and Harvesting Dates by Crop - (.+?)\s*$/.exec(line);
    if (head) { state = STATE_CODE[head[1].trim()] ?? null; continue; }
    if (!state) continue;
    const row = /^([A-Za-z][A-Za-z ,]*?)\s*\.*:\s*(.*)$/.exec(line);
    if (!row) continue;
    const crop = H628_CROP[row[1].trim()];
    if (!crop) continue;
    let dates = (row[2].match(DATE_TOKEN) ?? []).map(tokenDate);
    // no planting dates (hay) prints three (NA)s: begin, most active, end
    if (dates.length === 7 && dates.slice(0, 3).every((d) => d == null)) dates = [null, ...dates];
    if (dates.length !== 8) continue;
    const win = (a) => (a.every((d) => d == null) ? null : { begin: a[0], activeStart: a[1], activeEnd: a[2], end: a[3] });
    (out[state] ??= {})[crop] = { plant: win(dates.slice(0, 4)), harvest: win(dates.slice(4, 8)) };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// RMA A00200
// ---------------------------------------------------------------------------------------------

/** RMA commodity codes (A00420) for the planner crops; `type` narrows to one type code. */
export const RMA_COMMODITIES = {
  corn: { code: '0041', type: '016' }, // 016 grain (026 is silage)
  soybeans: { code: '0081' },
  'winter-wheat': { code: '0011', type: '011' }, // 011 winter, 012 spring
  oats: { code: '0016' },
  alfalfa: { code: '0032', plans: ['50'] }, // forage seeding: spring and late-summer seedings
  'cereal-rye': { code: '0094' },
};
const rmaDate = (s) => (/^\d{8}$/.test(s ?? '') ? `${s.slice(4, 6)}-${s.slice(6, 8)}` : null);
const modeOf = (list) => {
  const n = new Map();
  for (const x of list) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
};

/**
 * Collapses A00200 rows for one state to { counties: { fips: { crop: dates } }, rmaState: { crop: dates & {counties, of} } }.
 * dates = { earliest, final, latePlantEnd, salesClosing, endInsurance } (alfalfa: springFinal, lateSummerFinal).
 * Each county takes the mode over its types and practices; the state row is the mode over counties.
 * @param {Iterable<string>|AsyncIterable<string>} lines  pipe-delimited, with or without the header
 */
export async function rmaRows(lines, { state = '19', plans = ['01', '02', '03'], commodities = RMA_COMMODITIES } = {}) {
  const byCode = new Map(Object.entries(commodities).map(([crop, c]) => [c.code, { crop, ...c }]));
  const raw = {}; // crop → fips → [tuple strings]
  for await (const line of lines) {
    if (!line.startsWith('A00200|')) continue;
    const f = line.split('|');
    if (f[7] !== state) continue;
    const c = byCode.get(f[5]);
    if (!c || !(c.plans ?? plans).includes(f[6]) || (c.type && f[10] !== c.type)) continue;
    const fips = `${f[7]}${f[8]}`;
    const tuple = [rmaDate(f[26]), rmaDate(f[27]), rmaDate(f[38]), rmaDate(f[23]), rmaDate(f[31])].map((x) => x ?? '').join('|');
    ((raw[c.crop] ??= {})[fips] ??= []).push(tuple);
  }
  const unpack = (t) => { const [earliest, final, latePlantEnd, salesClosing, endInsurance] = t.split('|').map((x) => x || null); return { earliest, final, latePlantEnd, salesClosing, endInsurance }; };
  const counties = {};
  const rmaState = {};
  for (const [crop, byFips] of Object.entries(raw)) {
    const perCounty = {};
    for (const [fips, tuples] of Object.entries(byFips)) {
      if (crop === 'alfalfa') {
        // two seedings: the spring one (final by June) and the late-summer one
        const finals = tuples.map(unpack).map((d) => d.final).filter(Boolean);
        const spring = modeOf(finals.filter((d) => d < '07-01'));
        const late = modeOf(finals.filter((d) => d >= '07-01'));
        perCounty[fips] = `${spring ?? ''}|${late ?? ''}`;
      } else perCounty[fips] = modeOf(tuples);
    }
    for (const [fips, t] of Object.entries(perCounty)) {
      (counties[fips] ??= {})[crop] = crop === 'alfalfa' ? { springFinal: t.split('|')[0] || null, lateSummerFinal: t.split('|')[1] || null } : unpack(t);
    }
    const all = Object.values(perCounty);
    const mode = modeOf(all);
    const base = crop === 'alfalfa' ? { springFinal: mode.split('|')[0] || null, lateSummerFinal: mode.split('|')[1] || null } : unpack(mode);
    rmaState[crop] = { ...base, counties: all.filter((t) => t === mode).length, of: all.length };
  }
  return { counties, rmaState };
}

// ---------------------------------------------------------------------------------------------
// readers for the downloads
// ---------------------------------------------------------------------------------------------

/** An IEM progress CSV (year,week_ending,num_value,…) → year → [{date, pct}]. */
export function readProgressCsv(text) {
  const by = {};
  const lines = String(text).trim().split(/\r?\n/);
  const head = lines.shift().split(',');
  const iy = head.indexOf('year'), id = head.indexOf('week_ending'), iv = head.indexOf('num_value');
  for (const l of lines) {
    const f = l.split(',');
    if (!f[id]) continue;
    (by[f[iy]] ??= []).push({ date: f[id], pct: Number(f[iv]) });
  }
  return by;
}

const MONTH_FULL = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
/**
 * One weekly Crop Progress report → the 5-year-average point for a table and state:
 * { date: 'YYYY-MM-DD' (this year's week ending), pct } or null. The table's columns are
 * [last year, last week, this week, 5-year average].
 */
export function reportAverage(text, { table = 'Oats Planted', state = 'Iowa' } = {}) {
  const lines = String(text).split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith(`${table} - Selected States`));
  if (at < 0) return null;
  let dates = null, years = null;
  for (let i = at + 1; i < Math.min(lines.length, at + 60); i++) {
    const l = lines[i];
    if (/^\s*State\s*:/.test(l)) dates = l.split(':').slice(1).map((s) => s.trim().replace(/,$/, ''));
    else if (dates && !years && /\d{4}/.test(l)) years = l.split(':').slice(1).map((s) => s.trim());
    else if (l.startsWith(state) && dates && years) {
      const vals = l.split(':')[1].trim().split(/\s+/);
      const [mon, day] = dates[2].split(/\s+/);
      const pct = Number(vals[3]);
      if (!MONTH_FULL[mon] || !Number.isFinite(pct)) return null;
      return { date: `${years[2]}-${pad(MONTH_FULL[mon])}-${pad(Number(day))}`, pct };
    }
  }
  return null;
}

/** NOAA normals CSV → the named columns of its first data row. */
export function readNormals(text) {
  const lines = String(text).trim().split(/\r?\n/);
  const split = (l) => (l.match(/("([^"]*)"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').trim());
  const head = split(lines[0]);
  const row = split(lines[1]);
  return Object.fromEntries(head.map((h, i) => [h, row[i]]));
}
const noaaDate = (s) => (/^\d\d\/\d\d$/.test(s ?? '') ? s.replace('/', '-') : null);

// ---------------------------------------------------------------------------------------------
// the remote zip reader (--fetch only): one member out of a big zip, by HTTP Range requests
// ---------------------------------------------------------------------------------------------

/** A ranged reader over a URL: (start, endInclusive) → Buffer. */
export function httpRange(url) {
  return async (start, end) => {
    const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
    if (r.status !== 206 && r.status !== 200) throw new Error(`${url}: HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  };
}

/**
 * Pulls one member out of a zip that is only reachable by ranged reads (a port of tools/rzip.py):
 * the end-of-central-directory record (zip64 too), then the central directory entry, the local
 * header and the deflated data. `read(start, endInclusive)` returns a Buffer; `size` is the zip's
 * length. Returns the member's bytes. (Small members only are inflated in one go; the RMA dates
 * member is 64 MB compressed, which Node inflates fine.)
 */
export async function zipMember(read, size, name) {
  const tailLen = Math.min(size, 65557 + 20 + 56);
  const tail = await read(size - tailLen, size - 1);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip (no end of central directory)');
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOff = tail.readUInt32LE(eocd + 16);
  const z64 = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
  if ((cdOff === 0xffffffff || cdSize === 0xffffffff) && z64 >= 0) {
    cdSize = Number(tail.readBigUInt64LE(z64 + 40));
    cdOff = Number(tail.readBigUInt64LE(z64 + 48));
  }
  const cd = await read(cdOff, cdOff + cdSize - 1);
  for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
    const method = cd.readUInt16LE(p + 10);
    let comp = cd.readUInt32LE(p + 20), unc = cd.readUInt32LE(p + 24);
    const nLen = cd.readUInt16LE(p + 28), xLen = cd.readUInt16LE(p + 30), cLen = cd.readUInt16LE(p + 32);
    let local = cd.readUInt32LE(p + 42);
    const fname = cd.toString('utf8', p + 46, p + 46 + nLen);
    if (fname === name) {
      // zip64 extra field: the sizes and offset that didn't fit in 32 bits, in this order
      const extra = cd.subarray(p + 46 + nLen, p + 46 + nLen + xLen);
      for (let q = 0; q + 4 <= extra.length;) {
        const id = extra.readUInt16LE(q), len = extra.readUInt16LE(q + 2);
        if (id === 1) {
          let r = q + 4;
          if (unc === 0xffffffff) { unc = Number(extra.readBigUInt64LE(r)); r += 8; }
          if (comp === 0xffffffff) { comp = Number(extra.readBigUInt64LE(r)); r += 8; }
          if (local === 0xffffffff) { local = Number(extra.readBigUInt64LE(r)); }
        }
        q += 4 + len;
      }
      const lh = await read(local, local + 29);
      const dataAt = local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const data = comp ? await read(dataAt, dataAt + comp - 1) : Buffer.alloc(0);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`${name}: compression method ${method} not supported`);
    }
    p += 46 + nLen + xLen + cLen;
  }
  throw new Error(`${name} not in the zip`);
}

const FETCH = {
  'dl628/h628.txt': SOURCES.h628.url,
  'iem/CP.csv': 'https://mesonet.agron.iastate.edu/plotting/auto/plot/127/state:IA::short_desc:CP::w:last.csv',
  'iem/CH.csv': 'https://mesonet.agron.iastate.edu/plotting/auto/plot/127/state:IA::short_desc:CH::w:last.csv',
  'iem/SP.csv': 'https://mesonet.agron.iastate.edu/plotting/auto/plot/127/state:IA::short_desc:SP::w:last.csv',
  'iem/SH.csv': 'https://mesonet.agron.iastate.edu/plotting/auto/plot/127/state:IA::short_desc:SH::w:last.csv',
  'iem/KS_WWH.csv': 'https://mesonet.agron.iastate.edu/plotting/auto/plot/127/state:KS::short_desc:WWH::w:last.csv',
  'noaa/ames.csv': SOURCES.noaaNormals.url,
};
// the 2025 weekly reports (ESMIS release files) whose 2020–2024 average columns give Iowa's oats pace
const ESMIS = 'https://esmis.nal.usda.gov/sites/default/release-files/8336h188j/';
const REPORTS = {
  p14: '1v53mt21h/1z40np70g/prog1425.txt', p15: 'tb09m351z/vh53zs924/prog1525.txt', p16: 'q524mk81n/zg64wj06j/prog1625.txt',
  p17: 'rr173t277/f76259308/prog1725.txt', p18: 'hh63vq35b/h702s3987/prog1825.txt', p19: '9k421b436/xp68nf89d/prog1925.txt',
  p20: 'np1957469/q524mm26s/prog2025.txt', p21: '8049j4596/g445fb889/prog2125.txt', p22: '8336jz98j/bz60ft01c/prog2225.txt',
  h28: 'bz60ft73m/4q77hp930/prog2825.txt', h29: 'k069b623q/5425n918x/prog2925.txt', h30: 'tm70pt55s/ft84bn20m/prog3025.txt',
  h31: 'xs55pc63q/vh53zv83k/prog3125.txt', h32: 'hd76tz59h/d791vf78v/prog3225.txt', h33: '9593wv01x/zc77vr20r/prog3325.txt',
};
const RMA_ZIP = 'https://pubfs-rma.fpac.usda.gov/pub/References/actuarial_data_master/2026/2026_ADM_YTD.zip';

async function fetchAll(dir) {
  const get = async (url, to) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    mkdirSync(dirname(join(dir, to)), { recursive: true });
    writeFileSync(join(dir, to), Buffer.from(await r.arrayBuffer()));
    console.log(`fetched ${to}`);
  };
  for (const [to, url] of Object.entries(FETCH)) await get(url, to);
  for (const [k, path] of Object.entries(REPORTS)) await get(ESMIS + path, `cp/${k}.txt`);
  const head = await fetch(RMA_ZIP, { method: 'HEAD' });
  const size = Number(head.headers.get('content-length'));
  const bytes = await zipMember(httpRange(RMA_ZIP), size, '2026_A00200_Date_YTD.txt');
  mkdirSync(join(dir, 'rma'), { recursive: true });
  writeFileSync(join(dir, 'rma', 'dates.txt'), bytes);
  console.log('fetched rma/dates.txt');
}

/** Quick Stats API progress (build time only; the key is never written). → year → [{date, pct}]. */
async function quickStats(key, { state, commodity, stat }) {
  const q = new URLSearchParams({
    key, source_desc: 'SURVEY', sector_desc: 'CROPS', commodity_desc: commodity, statisticcat_desc: 'PROGRESS',
    unit_desc: `PCT ${stat}`, agg_level_desc: 'STATE', state_alpha: state, year__GE: '2021', format: 'JSON',
  });
  const r = await fetch(`https://quickstats.nass.usda.gov/api/api_GET/?${q}`);
  if (!r.ok) throw new Error(`Quick Stats ${commodity} ${stat}: HTTP ${r.status}`);
  const by = {};
  for (const row of (await r.json()).data ?? []) {
    if (!row.week_ending) continue;
    (by[row.year] ??= []).push({ date: row.week_ending, pct: Number(row.Value) });
  }
  return by;
}

// ---------------------------------------------------------------------------------------------
// the build
// ---------------------------------------------------------------------------------------------

/** Every value in the JSON, from the downloads in `dir`. → the JSON object. */
export async function build(dir, { progress = 'iem', key = null } = {}) {
  const read = (p) => readFileSync(join(dir, p), 'utf8');
  const prog = async (file, q) => (progress === 'quickstats' ? quickStats(key, q) : readProgressCsv(read(`iem/${file}.csv`)));
  const recentOf = async (plantQ, harvestQ) => {
    const plant = plantQ ? averageYears(await prog(plantQ.file, plantQ)) : null;
    const harvest = harvestQ ? averageYears(await prog(harvestQ.file, harvestQ)) : null;
    const years = plant?.years ?? harvest?.years;
    const strip = (x) => (x ? { p10: x.p10, p50: x.p50, p90: x.p90 } : undefined);
    return { years, ...(plant ? { plant: strip(plant) } : {}), ...(harvest ? { harvest: strip(harvest) } : {}), src: 'nassProgress' };
  };

  // oats: the 2020–2024 average column of the 2025 weekly reports
  const oatsSeries = (prefix, weeks, table) => weeks.map((w) => reportAverage(read(`cp/${prefix}${w}.txt`), { table, state: 'Iowa' })).filter(Boolean);
  const oatsPlant = pctDates(oatsSeries('p', [14, 15, 16, 17, 18, 19, 20, 21, 22], 'Oats Planted'));
  const oatsHarvest = pctDates(oatsSeries('h', [28, 29, 30, 31, 32, 33], 'Oats Harvested'));

  // RMA: Story County in full, and the Iowa state mode where a county has no row of its own
  const rma = await rmaRows(createInterface({ input: createReadStream(join(dir, 'rma', 'dates.txt')), crlfDelay: Infinity }), { state: '19' });
  const story = rma.counties['19169'] ?? {};
  const countyCrop = (crop) => {
    const d = story[crop];
    if (!d) return undefined;
    const out = { earliest: d.earliest, final: d.final, latePlantEnd: d.latePlantEnd };
    if (crop === 'corn') { out.salesClosing = d.salesClosing; out.endInsurance = d.endInsurance; }
    return { ...out, src: 'rma2026' };
  };
  const ww = rma.rmaState['winter-wheat'];
  const alf = rma.rmaState.alfalfa;

  // NOAA freeze normals for Ames (Story County)
  const n = readNormals(read('noaa/ames.csv'));
  const frost = {
    station: n.STATION, stationName: 'Ames 8 WSW',
    lastSpring: { p50: noaaDate(n['ANN-TMIN-PRBLST-T32FP50']), p90: noaaDate(n['ANN-TMIN-PRBLST-T32FP10']) },
    firstFall: { p50: noaaDate(n['ANN-TMIN-PRBFST-T32FP50']) },
    hardFreeze: { p50: noaaDate(n['ANN-TMIN-PRBFST-T28FP50']) },
    src: 'noaaNormals',
  };

  const iaCorn = await recentOf({ file: 'CP', state: 'IA', commodity: 'CORN', stat: 'PLANTED' }, { file: 'CH', state: 'IA', commodity: 'CORN', stat: 'HARVESTED' });
  const iaSoy = await recentOf({ file: 'SP', state: 'IA', commodity: 'SOYBEANS', stat: 'PLANTED' }, { file: 'SH', state: 'IA', commodity: 'SOYBEANS', stat: 'HARVESTED' });
  const ksWheat = await recentOf(null, { file: 'KS_WWH', state: 'KS', commodity: 'WHEAT', stat: 'HARVESTED' });

  const sources = structuredClone(SOURCES);
  if (progress === 'quickstats') sources.nassProgress.apiNotice = true;
  const out = {
    version: 1,
    built: BUILT,
    sources,
    states: {
      IA: {
        corn: { recent: iaCorn, ...HAND.IA.corn },
        soybeans: { recent: iaSoy, ...HAND.IA.soybeans },
        oats: { recent: { years: '2020–2024', plant: oatsPlant, harvest: oatsHarvest, src: 'nassProgress' } },
        'winter-wheat': {
          ...HAND.IA['winter-wheat'],
          rmaState: { final: ww.final, latePlantEnd: ww.latePlantEnd, salesClosing: ww.salesClosing, note: `${ww.counties} of Iowa’s counties`, src: 'rma2026' },
        },
        alfalfa: { rmaState: { springFinal: alf.springFinal, lateSummerFinal: alf.lateSummerFinal, note: `${alf.counties} of Iowa’s ${alf.of} counties with forage seeding`, src: 'rma2026' } },
      },
      KS: { 'winter-wheat': { recent: ksWheat } },
    },
    counties: {
      '19169': {
        ...COUNTIES['19169'],
        crops: Object.fromEntries(['corn', 'soybeans', 'oats'].map((c) => [c, countyCrop(c)]).filter(([, v]) => v)),
        frost,
      },
    },
    cover: HAND.cover,
    gaps: GAPS,
  };
  return { json: out, rma, h628: parseH628(read('dl628/h628.txt')) };
}

/** Prints how Handbook 628 differs from the vendored planner's SEASONS (IA and KS). Never writes them. */
async function checkVendor(h628) {
  let SEASONS;
  try {
    ({ SEASONS } = await import(pathToFileURL(join(ROOT, 'src/vendor/rotation-maxxing/algorithm/croptraits.ts')).href));
  } catch (e) {
    console.log(`(vendor check skipped: ${e.message})`);
    return 0;
  }
  let diffs = 0;
  for (const st of ['IA', 'KS']) {
    for (const [crop, row] of Object.entries(SEASONS)) {
      const v = row[st];
      if (!v) continue;
      const h = h628[st]?.[crop];
      const pick = (x) => (x ? { begin: x.begin, activeStart: x.activeStart, activeEnd: x.activeEnd, end: x.end } : null);
      for (const part of ['plant', 'harvest']) {
        const a = JSON.stringify(pick(v[part])), b = JSON.stringify(h?.[part] ?? null);
        if (a !== b) { diffs++; console.log(`628 vs vendor ${st} ${crop} ${part}: vendor ${a}, handbook ${b}`); }
      }
    }
  }
  console.log(diffs ? `${diffs} differences from the vendor (not written)` : 'Handbook 628 matches the vendor SEASONS for IA and KS');
  return diffs;
}

export const stringify = (json) => `${JSON.stringify(json, null, 1)}\n`;

export async function main(argv = process.argv.slice(2)) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const out = resolve(arg('--out') ?? join(ROOT, 'data', 'crop-calendar.json'));
  let dir = arg('--from');
  if (argv.includes('--fetch')) {
    dir = join(tmpdir(), 'crop-calendar');
    await fetchAll(dir);
  }
  if (!dir || !existsSync(dir)) {
    console.log('usage: node scripts/build-crop-calendar.mjs --from <downloadsDir> [--out file] [--check] | --fetch');
    process.exitCode = 2;
    return;
  }
  const progress = arg('--progress') ?? 'iem';
  const key = progress === 'quickstats' ? (arg('--key') ?? process.env.NASS_KEY) : null;
  if (progress === 'quickstats' && !key) throw new Error('--progress quickstats needs --key or NASS_KEY');
  const { json, h628 } = await build(dir, { progress, key });
  await checkVendor(h628);
  const text = stringify(json);
  if (argv.includes('--check')) {
    const same = existsSync(out) && readFileSync(out, 'utf8') === text;
    console.log(same ? `${out} is up to date` : `${out} differs from a fresh build`);
    if (!same) process.exitCode = 1;
    return;
  }
  writeFileSync(out, text);
  console.log(`wrote ${out} (${Buffer.byteLength(text)} bytes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
