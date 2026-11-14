# rotation-maxxing

Crop-rotation scoring algorithm for **Field Shift: Adapting Farms with NASA Data** (NASA Space Apps 2026).

Given a US farm (paddocks, land, last 3 years of crops), the farmer's priorities, local market prices and a pool of weather years, it returns three 3-year rotation plans:
- the current rotation continued
- the max-profit plan
- the plan that best fits the farmer's priorities

It also says what the priorities cost in profit. Every number comes with labelled terms so the mascot can explain it.

This repo is the algorithm plus a thin data layer: TypeScript in strict mode with zero runtime dependencies. The algorithm (`src/algorithm`) is pure; `src/data` is the only code that makes network calls. There is no UI. The 3D frontend is built separately. See [ALGORITHM.md](ALGORITHM.md) for how it works, every formula, and every constant and placeholder. Frontend developers: start with [API.md](API.md).

## Install and test

Requires Node 20+ (uses the built-in `fetch`).

```sh
npm install
npm test            # Vitest, includes a performance test (8 paddocks x 14 crops < 2 s)
npm run typecheck   # tsc --noEmit (strict)
```

## Using the API

Everything is exported from `src/algorithm/index.ts`.

```ts
import {
  generatePlans,
  evaluatePlan,
  checkPlacement,
  planFromCrops,
  syntheticWeatherForTestsOnly, // TEST/DEMO ONLY: synthetic weather, not real data
  type Farm,
  type Priorities,
  type Market,
} from './src/algorithm';

const farm: Farm = {
  latitude: 42.0,
  state: 'IA',
  paddocks: [
    {
      id: 'north40',
      name: 'North 40',
      acres: 40,
      // lng/lat degrees (converted to local metres internally), or { localM: [[x, y], ...] }
      polygon: { lngLat: [[-93.60, 42.010], [-93.595, 42.010], [-93.595, 42.0136], [-93.60, 42.0136]] },
      land: { slopePct: 3, texture: 'loam', drainage: 'good', salinityECe: 0.8, ph: 6.4 },
      history: ['corn', 'soybeans', 'corn'], // oldest first
      availableCrops: ['corn', 'soybeans', 'winter-wheat', 'oats', 'cereal-rye', 'fallow'],
      tillage: 'reduced', // optional, default 'reduced'
    },
    // ...
  ],
};

// Specialty crops (dry beans, sunflower, canola) are only recommended with a confirmed buyer:
farm.confirmedBuyers = ['sunflower'];

const priorities: Priorities = { profit: 60, soilHealth: 50, water: 30, risk: 40 }; // 0-100, 50 = neutral

const market: Market = {
  soybeans: { localDemand: 8000, localPrice: 10.6, distantPrice: 10.9, freightPerUnit: 0.45 }, // per bu
};

const scenarios = syntheticWeatherForTestsOnly(1, 30, ['corn', 'soybeans', 'winter-wheat', 'oats']); // pass real scenarios in production

const result = generatePlans(farm, priorities, market, scenarios, { seed: 42 });
result.plans.priority.expectedGM;      // CASH margin, $ over 3 years
result.plans.priority.p10GM;           // bad-year (10th percentile) cash margin $
result.plans.priority.nitrogenCarriedForward; // N left after year 3, $: NOT cash
result.plans.priority.marginBreakdown; // labelled cash vs carried-forward N
result.plans.priority.paddocks[0]?.years[0]?.terms; // labelled explanation
result.priceOfPriorities.summary;      // "Your priorities cost about $X ... In return: ..."
result.exclusions['north40'];          // "why not X?" answers

// Farmer-built plan: same scoring, for feedback
const mine = evaluatePlan(farm, planFromCrops({ north40: ['soybeans', 'winter-wheat', 'corn'] }), priorities, market, scenarios);

// Drag-and-drop highlighting (yearIndex is 0-based); fast, rules only
const warnings = checkPlacement(farm, mine.plan, 'north40', 1, 'corn', { market });
// -> [{ lens: 'nitrogen', severity: 1, reason: '...' }, ...]
```

### Options

`generatePlans(..., options)` accepts:

| Option | Default | What it does |
|---|---|---|
| `seed` | 1 | Seed for every random draw |
| `mcSamples` | 200 | Monte Carlo samples |
| `mcTopK` | 4 | Candidate plans that get Monte Carlo |
| `maxIterations` | 20 | Coordinate-descent iteration cap |
| `rankJitterSamples` | 200 | Priority jitters for rank stability |
| `nitrogenPricePerLb` | $0.58 (NDSU) | Price used to value N credits |
| `endOfHorizon` | true | Count the N and soil left behind after year 3 |
| `crops` | `croptraits.ts` | Replacement crop table |
| `yieldModel` | `TraitYieldModel` | Any implementation of the `YieldModel` interface (e.g. a future APSIM lookup) |

Southern-hemisphere farms (latitude < 0) throw an error for now, because the shade logic assumes the sun is to the south.

## From a pin to a plan: NASA and USDA data

`src/data/` fetches what the planner needs from keyless services:
- **NASA POWER:** daily weather
- **SSURGO:** soil
- **Cropland Data Layer:** the last 3 years of crops

It turns them into a farm plus a weather pool built with a FAO-56 water balance. This is the only code that touches the network.

```ts
import { buildFarm } from './src/data/buildFarm';
import { generatePlans } from './src/algorithm';

const built = await buildFarm({
  fields: [{ id: 'n40', name: 'North 40', polygon: [[-93.64, 42.03], [-93.63, 42.03], [-93.63, 42.034], [-93.64, 42.034]],
             availableCrops: ['corn', 'soybeans', 'oats', 'winter-wheat', 'cereal-rye', 'fallow'], tileDrained: true }],
  state: 'IA',
  weatherYears: [2001, 2024],
});
const plans = generatePlans(built.farm, priorities, market, built.scenarios);
built.gaps;        // what couldn't be filled
built.provenance;  // where each field's soil and history came from
```

## The season loop: plan, grow, report, re-plan

```ts
import { createFarmState, adoptPlan, updateAfterSeason, replan } from './src/algorithm';

let state = createFarmState(built.farm, built.scenarios, 2026);
const first = replan(state, priorities, market);
state = adoptPlan(state, first.plans.priority.plan);

// After harvest: what was grown and how it did, plus that season's NASA POWER weather year.
const { state: next, notes } = updateAfterSeason(state, {
  season: 2026,
  paddocks: [{ paddockId: 'n40', cropId: 'corn', yieldPerAcre: 204, events: [] }],
}, { weather: observed2026 });

const again = replan(next, priorities, market);  // 2027-2029, stays close to the adopted plan
again.replanning;                                // what changed, and what would win if changes were free
```

Each field learns a yield factor from the reports, with shrinkage so one odd year can't swing the plan. Hail, flood and replant years are recorded but not learned from.

## Backtest

```sh
npm run backtest                    # model's weather-driven yield anomalies, 2001-2024 (keyless)
NASS_API_KEY=... npm run backtest   # + USDA QuickStats county yields: correlation, error, worst year
```

## Data

`src/algorithm/croptraits.ts` holds sourced US crop traits (NASS, ERS, NDSU, FAO-56/61, Seifert 2017, UW/MDA, NRCS). Missing values are `null` and are reported as information gaps; they are never guessed. Placeholders are marked as such: currently the tillage residue-retention table, and the per-state season spans, which are empty until Handbook 628 values are entered. The full list is in [ALGORITHM.md](ALGORITHM.md#everything-a-teammate-can-tune-or-needs-to-source).
