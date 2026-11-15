// The US county a point is in, from the FCC Census Block API (keyless, CORS open).
//
//   countyAt([lng, lat])  ->  Promise<{ fips: '20169', stateFips: '20', countyCode: '169',
//                                       name: 'Saline County', state: 'KS', stateName: 'Kansas' }>
//
// Throws when the lookup fails or the point isn't in a US county: the caller says there's no
// market data, never guesses a county.
export const FCC_BLOCK = 'https://geo.fcc.gov/api/census/block/find';
const TIMEOUT_MS = 15000;

export const countyUrl = ([lng, lat]) => `${FCC_BLOCK}?latitude=${lat.toFixed(5)}&longitude=${lng.toFixed(5)}&format=json`;

/** The county from an FCC answer, or null when the point isn't in one. */
export function parseCounty(json) {
  const fips = json?.County?.FIPS;
  const st = json?.State;
  if (json?.status !== 'OK' || !/^\d{5}$/.test(fips || '') || !st?.code) return null;
  return { fips, stateFips: fips.slice(0, 2), countyCode: fips.slice(2), name: json.County.name, state: st.code, stateName: st.name };
}

export async function countyAt(point, { fetchFn = globalThis.fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetchFn(countyUrl(point), { signal: ctrl.signal });
  } catch {
    throw new Error('the county lookup (FCC Census API) did not answer');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`the county lookup (FCC Census API) failed (HTTP ${res.status})`);
  const county = parseCounty(await res.json());
  if (!county) throw new Error('the farm isn’t inside a US county the FCC Census API knows');
  return county;
}
