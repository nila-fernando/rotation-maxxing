// The runners behind the farm's loading checklist (src/data/farmLoad.js): one per data source,
// each reporting every field (or the farm) as done, none (no data here) or failed.
import { fillCropHistory } from './cdlHistory.js';
import { fillSoil } from './soilSurvey.js';
import { fillSlope } from './terrain.js';
import { farmRain } from './rain.js';
import { fillNdvi } from './greenness.js';
import { HISTORY_YEARS } from './fieldReport.js';

/**
 * @param {object} o
 * @param {{status: Function}} o.markets   src/data/market.js createMarkets()
 * @param {(field) => object} [o.known]   crop years already known per field (the demo data's CSB)
 */
export function farmRunners({ markets, known = () => ({}), years = HISTORY_YEARS } = {}) {
  return {
    crops: ({ fields, signal, field }) => fillCropHistory(fields, { years, known, signal, onField: field }),
    soil: ({ fields, signal, field }) => fillSoil(fields, { signal, onField: field }),
    slope: ({ fields, signal, field }) => fillSlope(fields, { signal, onField: field }),
    rain: async ({ point, signal, settle }) => {
      if (!point) { settle('none', null, 'no fields to locate the farm by'); return; }
      const rain = await farmRain(point, { signal });
      settle(rain ? 'done' : 'none', rain, rain ? null : 'NASA POWER has no full rain record here');
    },
    greenness: ({ fields, signal, field }) => fillNdvi(fields, { signal, onField: field }),
    market: async ({ point, settle }) => {
      const s = await markets.status(point);
      settle(s.state, null, s.reason || null);
    },
  };
}
