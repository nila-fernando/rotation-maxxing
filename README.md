# rotation-maxxing

Crop-rotation scoring algorithm for **Field Shift: Adapting Farms with NASA Data** (NASA Space Apps 2026).

Given a US farm (paddocks, land, last 3 years of crops), the farmer's priorities, local market prices and a pool of weather years, it returns three 3-year rotation plans:
- the current rotation continued
- the max-profit plan
- the plan that best fits the farmer's priorities

It also says what the priorities cost in profit. Every number comes with labelled terms so the mascot can explain it.

This repo is **only the algorithm**: TypeScript in strict mode with zero runtime dependencies. There is no UI and no data fetching. The 3D frontend is built separately. See [ALGORITHM.md](ALGORITHM.md) for how it works, every formula, and every constant and placeholder.

## Install and test

Requires Node 20+.

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

const priorities: Priorities = { profit: 60, soilHealth: 50, water: 30, risk: 40 }; // 0-100, 50 = neutral

const market: Market = {
  soybeans: { localDemand: 8000, localPrice: 10.6, distantPrice: 10.9, freightPerUnit: 0.45 }, // per bu
};

const scenarios = syntheticWeatherForTestsOnly(1, 30, ['corn', 'soybeans', 'winter-wheat', 'oats']); // pass real scenarios in production

const result = generatePlans(farm, priorities, market, scenarios, { seed: 42 });
result.plans.priority.expectedGM;      // $ over 3 years
result.plans.priority.p10GM;           // bad-year (10th percentile) $
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

## Data

`src/algorithm/croptraits.ts` holds sourced US crop traits (NASS, ERS, NDSU, FAO-56/61, Seifert 2017, UW/MDA, NRCS). Missing values are `null` and are reported as information gaps; they are never guessed. Placeholders are marked as such: currently the tillage residue-retention table, and the per-state season spans, which are empty until Handbook 628 values are entered. The full list is in [ALGORITHM.md](ALGORITHM.md#everything-a-teammate-can-tune-or-needs-to-source).
