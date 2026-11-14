// US-only place search.
//
// Suggestions as you type come from Photon (photon.komoot.io), which is built for search-as-you-type
// on OpenStreetMap data. Nominatim's usage policy forbids autocomplete, so it is only used for one
// look-up when the farmer presses Enter and Photon had nothing (or was down).
//
// Every result is a "place": { id, kind, label, detail, lat, lon, bounds? }
//   kind   'house' | 'street' | 'place' | 'county' | 'other'
//   bounds [[south, west], [north, east]] for areas (towns, counties), when the service gives one

const PHOTON = 'https://photon.komoot.io/api/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
/** All 50 states plus territories near them, as minLon,minLat,maxLon,maxLat. */
const US_BBOX = '-179.9,18.5,-66.5,71.6';
/** Biases ranking toward the middle of the lower 48. */
const US_CENTER = { lat: 39.8, lon: -98.6 };

export const SEARCH_CREDIT = 'Search: <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

const cache = new Map();

/**
 * Suggestions for what has been typed so far.
 * @param {string} query
 * @param {AbortSignal} [signal]
 * @returns {Promise<object[]>}
 */
export async function suggest(query, signal) {
  const q = query.trim();
  if (q.length < 3) return [];
  const key = q.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const url = `${PHOTON}?${new URLSearchParams({
    q, limit: '12', lang: 'en', bbox: US_BBOX, lat: String(US_CENTER.lat), lon: String(US_CENTER.lon),
  })}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const json = await res.json();
  const places = dedupe((json.features || []).map(fromPhoton).filter(Boolean)).slice(0, 6);
  cache.set(key, places);
  return places;
}

/**
 * One full search, for Enter with no suggestion to pick. US only.
 * @param {string} query
 * @param {AbortSignal} [signal]
 */
export async function lookup(query, signal) {
  const q = query.trim();
  if (!q) return [];
  // Photon has no US county areas, so a county goes straight to Nominatim
  if (looksLikeCounty(q)) {
    try {
      const found = await nominatim(q, signal);
      const counties = found.filter((p) => p.kind === 'county');
      if (counties.length) return counties;
      if (found.length) return found;
    } catch (e) {
      if (e.name === 'AbortError') throw e; // otherwise Nominatim is down: try Photon below
    }
  }
  try {
    const fromSuggest = await suggest(q, signal);
    if (fromSuggest.length) return fromSuggest;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
  }
  return nominatim(q, signal);
}

/** "Story County", "Tensas Parish", "Kenai Peninsula Borough" (not "co", which is also Colorado) */
export function looksLikeCounty(query) {
  const q = query.trim();
  return q.length >= 5 && /\b(county|parish|borough|census area)\b/i.test(q) && !/^\d/.test(q);
}

async function nominatim(q, signal) {
  const url = `${NOMINATIM}?${new URLSearchParams({ q, format: 'jsonv2', countrycodes: 'us', limit: '5', addressdetails: '1' })}`;
  const res = await fetch(url, { signal, headers: { 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return dedupe((await res.json()).map(fromNominatim).filter(Boolean));
}

// ------------------------------------------------------------------ shaping results

const STATE_ABBR = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
  Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI',
  Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH',
  Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
  Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
  Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC', 'Puerto Rico': 'PR',
};
const abbr = (state) => STATE_ABBR[state] || state;

function kindOf(type) {
  if (type === 'house') return 'house';
  if (type === 'street') return 'street';
  if (type === 'county') return 'county';
  if (['city', 'town', 'village', 'hamlet', 'district', 'locality', 'suburb', 'postcode'].includes(type)) return 'place';
  return 'other';
}

function fromPhoton(f) {
  const p = f.properties || {};
  if (p.countrycode !== 'US') return null;
  if (p.type === 'state' || p.type === 'country') return null; // too big to be a farm
  const [lon, lat] = f.geometry?.coordinates || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const kind = kindOf(p.type);
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const label = kind === 'house' ? (street || p.name) : (p.name || street);
  if (!label) return null;
  const town = p.city || p.town || p.village || p.locality || p.district;
  const detail = join([
    kind === 'house' || kind === 'street' ? town : null,
    kind === 'county' ? null : p.county,
    abbr(p.state),
    kind === 'house' ? p.postcode : null,
  ].filter((part) => part && part !== label));
  // Photon's extent is [minLon, maxLat, maxLon, minLat]
  const e = p.extent;
  const bounds = Array.isArray(e) && e.length === 4 ? [[e[3], e[0]], [e[1], e[2]]] : null;
  return { id: `${p.osm_type}${p.osm_id}`, kind, label, detail, lat, lon, bounds };
}

function fromNominatim(r) {
  const a = r.address || {};
  if (a.country_code && a.country_code !== 'us') return null;
  const lat = +r.lat, lon = +r.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // US house numbers (TIGER, address points) come back as class=place, type=house, addresstype=place
  const isHouse = r.type === 'house' || r.category === 'building' || r.addresstype === 'building' || !!a.house_number;
  const type = r.addresstype || r.type;
  const kind = isHouse ? 'house' : type === 'road' ? 'street' : kindOf(type);
  const label = kind === 'house' ? join([a.house_number, a.road], ' ') || r.name : r.name || r.display_name.split(',')[0];
  const detail = join([a.city || a.town || a.village, kind === 'county' ? null : a.county, abbr(a.state)].filter((part) => part && part !== label));
  const b = r.boundingbox; // [south, north, west, east] as strings
  const bounds = Array.isArray(b) && b.length === 4 ? [[+b[0], +b[2]], [+b[1], +b[3]]] : null;
  return { id: `${r.osm_type}${r.osm_id}`, kind, label, detail, lat, lon, bounds };
}

function join(parts, sep = ', ') {
  return [...new Set(parts.filter(Boolean))].join(sep);
}

function dedupe(places) {
  const seen = new Set();
  return places.filter((p) => {
    const key = `${p.label}|${p.detail}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
