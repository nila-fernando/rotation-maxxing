// The US county a point is in, from the FCC Census Block API (keyless, CORS open).
//
//   countyAt([lng, lat])  ->  Promise<{ fips: '20169', stateFips: '20', countyCode: '169',
//                                       name: 'Saline County', state: 'KS', stateName: 'Kansas' }>
//
// Throws when the lookup fails (Unreachable: it didn't answer) or the point isn't in a US county:
// the caller says there's no market data, never guesses a county.
import { Unreachable, fetchRetry } from './net.js';

export const FCC_BLOCK = 'https://geo.fcc.gov/api/census/block/find';
const TIMEOUT_MS = 10000;

export const countyUrl = ([lng, lat]) => `${FCC_BLOCK}?latitude=${lat.toFixed(5)}&longitude=${lng.toFixed(5)}&format=json`;

/** The county from an FCC answer, or null when the point isn't in one. */
export function parseCounty(json) {
  const fips = json?.County?.FIPS;
  const st = json?.State;
  if (json?.status !== 'OK' || !/^\d{5}$/.test(fips || '') || !st?.code) return null;
  return { fips, stateFips: fips.slice(0, 2), countyCode: fips.slice(2), name: json.County.name, state: st.code, stateName: st.name };
}

export async function countyAt(point, { fetchFn = globalThis.fetch, signal = null, clock } = {}) {
  let res;
  try {
    res = await fetchRetry(fetchFn, countyUrl(point), {}, { timeoutMs: TIMEOUT_MS, attempts: 3, backoffMs: 500, signal, clock });
  } catch (e) {
    throw new Unreachable('the county lookup (FCC Census API) did not answer', { timedOut: e?.timedOut });
  }
  if (res.status >= 500) throw new Unreachable(`the county lookup (FCC Census API) failed (HTTP ${res.status})`, { status: res.status });
  if (!res.ok) throw new Error(`the county lookup (FCC Census API) failed (HTTP ${res.status})`);
  let json;
  try { json = await res.json(); } catch { throw new Unreachable('the county lookup (FCC Census API) sent an unreadable answer'); }
  const county = parseCounty(json);
  if (!county) throw new Error('the farm isn’t inside a US county the FCC Census API knows');
  return county;
}
