// TEST FIXTURE ONLY. The app never plans with these numbers: it fetches the farm's county, crops,
// yields and prices from the FCC Census API and USDA NASS (src/data/market.js) and says "no data"
// when they don't arrive. Tests need a fixed market in the same shape, so this one is made from the
// illustrative county prices kept in data/demo-farm.json, with the crop list the demo used to have.
import { getCounty } from '../src/data/farmData.js';
import { PLANNER_CROP } from '../src/plan/farmInput.js';

const prices = {};
for (const [key, price] of Object.entries(getCounty().prices)) {
  const id = PLANNER_CROP[key];
  if (id) prices[id] = { price, unit: id === 'alfalfa' ? 'ton' : 'bu', year: 2025, level: 'state', place: 'Iowa', source: 'test fixture' };
}

/** A market as src/data/market.js marketFor returns it, for the demo farm (Story County, IA). */
export const demoMarket = Object.freeze({
  ok: true,
  county: { fips: '19169', stateFips: '19', countyCode: '169', name: 'Story County', state: 'IA', stateName: 'Iowa' },
  practice: 'non-irrigated',
  crops: ['corn', 'soybeans', 'oats', 'winter-wheat', 'alfalfa'],
  prices,
  baseYields: {},
  gaps: ['Crops to choose from: those in this test fixture: corn, soybeans, oats, winter wheat, alfalfa, plus fallow and a cereal-rye cover crop.'],
});
