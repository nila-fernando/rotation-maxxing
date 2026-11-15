# API for the 3D frontend

How to call the rotation planner from the frontend. For how it works inside, see [ALGORITHM.md](ALGORITHM.md).

All functions are synchronous and pure except `buildFarm`, which fetches data. Import from `src/algorithm` (planner) and `src/data/buildFarm` (data).

**Conventions**

| Topic | Convention |
|---|---|
| Units | US units: acres, yields in each crop's unit (`bu`, `lb`, `ton`) per acre, dollars, inches of water, tons/acre of soil loss |
| Years | 0-based within the 3-year horizon (`yearIndex` 0 = next season) |
| History | oldest first |
| Crop ids | `corn`, `soybeans`, `winter-wheat`, `spring-wheat`, `sorghum`, `cotton`, `alfalfa`, `oats`, `barley`, `sunflower`, `canola`, `dry-beans`, `cereal-rye` (cover only), `fallow` |
| Paddock polygons | `{ "lngLat": [[lng, lat], ...] }` or `{ "localM": [[x, y], ...] }` (metres, +y north) |
| Explanations | Every number shown to a farmer comes with `terms`: `{ label, value, unit, basis, sources? }`. `basis` is one of `sourced`, `input`, `design`, `placeholder`, `proxy`, `assumption`. `sources` are ids you can resolve with `describeSource(id)`. |

## Stability

| Stable: build against it | May still change |
|---|---|
| Function names and argument order below | Wording of every `label`, `reason`, `reasons[]`, `risks[]`, `informationGaps[]`, `localReview[]` (treat as display text) |
| `Farm`, `Paddock`, `Land`, `Priorities`, `Market`, `Plan` / `SeasonSlot` shapes | Order and number of `terms` and `objectiveTerms` |
| `Warning` shape `{ lens, severity, reason }` and the 8 lens names | Thresholds behind warning severities |
| `PlanResult.weatherRisk` shape. `PlanResult` top-level numbers: `expectedGM`, `p10GM`, `probBeatsCurrent`, `nitrogenCarriedForward`, `riskAdjustedProfit`, `soilHealth`, `endSoilHealth`, `soilHealthRange`, `waterUse`, `objective`, `rankStability` | Scale of `soilHealth` and `objective` (composite indices; their weights are design choices) |
| `paddocks[].years[]`: `cropId`, `yieldPerAcre`, `yieldUnit`, `grossMarginPerAcre`, `soilHealthIndex`, `erosionTonsPerAcre`, `waterUseIndex` | Units of `waterUseIndex`: inches with NASA POWER data, a unitless kc index without it |
| `exclusions[paddockId][]`: `{ cropId, kind, reason }` | New `Exclusion.kind` values may be added |
| `FarmState` and `SeasonReport` shapes | `WeatherScenario` internals (`byPaddock`, `byPaddockAfter`, `water`): treat as opaque and pass through |
| | `GenerateResult.stats`, `referenceBounds` and `replanning` details; `buildFarm` provenance strings |

## Changes since the first version of this page

| Field | Change | Stability |
|---|---|---|
| `PlanResult.weatherRisk` | **New.** `{ waterLimited, aridityIndex, aridityClass, message }`. Use `message` for the "is weather risk about water here?" note. | Shape stable; message wording may change |
| `objectiveTerms` | The last entry now explains the water weight, e.g. "Water is plentiful here (aridity index 0.90, humid), so water use counts for little" | Display text |
| `years[].terms` for winter wheat | May include "Freeze risk: in 3 of 24 years, temperatures fell below the jointing threshold (K-State C646); average effect" | Display text |
| `risks[]` | Plans with winter wheat may include a freeze-risk line | Display text |
| `waterUseIndex` (NASA POWER farms) | Dryland now means water **used** (crop ET or fallow evaporation), not the shortfall | Number stable; meaning documented |
| `WeatherScenario` | New internal fields `climate`, `freeze` (per year) and `freezeRisk` (pool average) | Opaque: pass through |

Example `weatherRisk` for a humid Iowa farm:

```json
{
  "waterLimited": false,
  "aridityIndex": 0.9,
  "aridityClass": "humid",
  "message": "Weather risk here is mostly not about water (humid, aridity index 0.90): wet springs, floods, wind and frost matter more, and the model doesn't capture most of those yet."
}
```

## generatePlans(farm, priorities, market, scenarios, options?)

This returns three plans: the current rotation continued, max profit, and the plan that best fits the farmer's priorities. It also returns what those priorities cost.

**Input**
- `farm`: a `Farm` (example below)
- `priorities`: `{ profit, soilHealth, water, risk }`, each 0-100 (50 = neutral). `risk` only sets how much bad years count.
- `market`: per crop, `{ localDemand, localPrice, distantPrice, freightPerUnit, outlook? }`. Can be `{}`.
- `scenarios`: the weather pool, from `buildFarm` (or `syntheticWeatherForTestsOnly` in demos)
- `options`: `seed`, `mcSamples`, `mcTopK`, `previousPlan`, ...

```json
{
  "latitude": 42.03,
  "state": "IA",
  "confirmedBuyers": [],
  "constraints": {
    "irrigation": "dryland",
    "missingEquipment": [
      "hayEquipment"
    ]
  },
  "paddocks": [
    {
      "id": "n40",
      "name": "North 40",
      "acres": 40,
      "polygon": {
        "lngLat": [
          [
            -93.64,
            42.034
          ],
          [
            -93.635,
            42.034
          ],
          [
            -93.635,
            42.0377
          ],
          [
            -93.64,
            42.0377
          ]
        ]
      },
      "land": {
        "slopePct": 3,
        "texture": "loam",
        "drainage": "moderate",
        "salinityECe": 0.4,
        "ph": 6.4,
        "awcInPerIn": 0.18,
        "kFactor": 0.28,
        "tFactorTonsPerAcre": 5
      },
      "history": [
        "corn",
        "soybeans",
        "corn"
      ],
      "availableCrops": [
        "corn",
        "soybeans",
        "oats",
        "winter-wheat",
        "cereal-rye",
        "fallow"
      ],
      "tillage": "reduced",
      "tileDrained": true
    }
  ]
}
```

**Output.** `{ plans: { current, maxProfit, priority }, priceOfPriorities, exclusions, referenceBounds, stats, replanning? }`. Each plan has the same shape. This is a real result, with its arrays trimmed:

```json
{
  "kind": "priority",
  "plan": {
    "sequences": {
      "n40": [
        {
          "main": "soybeans"
        },
        {
          "main": "corn"
        },
        {
          "main": "soybeans"
        }
      ],
      "s40": [
        {
          "main": "corn"
        },
        {
          "main": "soybeans"
        },
        {
          "main": "corn",
          "cover": "cereal-rye"
        }
      ]
    }
  },
  "paddocks": [
    {
      "paddockId": "n40",
      "name": "North 40",
      "acres": 40,
      "sequence": [
        "soybeans",
        "corn",
        "soybeans"
      ],
      "years": [
        {
          "year": 0,
          "cropId": "soybeans",
          "yieldPerAcre": 49.616,
          "yieldUnit": "bu",
          "grossMarginPerAcre": 252.006,
          "soilHealthIndex": 0.342,
          "erosionTonsPerAcre": 5.09,
          "waterUseIndex": 18.246,
          "terms": [
            {
              "label": "US average Soybeans yield",
              "value": 52.3,
              "unit": "bu/ac",
              "basis": "sourced",
              "sources": [
                "nassCropSummary2025",
                "nassCropProductionNov2026"
              ]
            },
            {
              "label": "Soybean cyst nematode (SCN): 1 host year(s) earlier in the last 3",
              "value": -1.046,
              "unit": "bu/ac",
              "basis": "design"
            },
            {
              "label": "White mold: 1 host crop year(s) in the last 3",
              "value": -1.538,
              "unit": "bu/ac",
              "basis": "design"
            },
            {
              "label": "Shade (tolerance unknown, midpoint assumed; 0.1% shaded)",
              "value": -0.028,
              "unit": "bu/ac",
              "basis": "assumption",
              "sources": [
                "fao56"
              ]
            }
          ]
        }
      ]
    }
  ],
  "expectedGM": 63174.322,
  "p10GM": 42907.346,
  "probBeatsCurrent": 0,
  "nitrogenCarriedForward": 812,
  "marginBreakdown": [
    {
      "label": "Cash margin, expected over the plan",
      "value": 63174.322,
      "unit": "$",
      "basis": "input"
    },
    {
      "label": "  of which: N credits used within the plan (fertiliser you don't buy)",
      "value": 2436,
      "unit": "$",
      "basis": "sourced"
    },
    {
      "label": "Nitrogen carried forward: NOT cash (fertiliser saved after the plan, only if corn follows)",
      "value": 812,
      "unit": "$",
      "basis": "sourced"
    }
  ],
  "riskAdjustedProfit": 55879.531,
  "soilHealth": 0.561,
  "endSoilHealth": 0.552,
  "soilHealthRange": {
    "p10": 0.558,
    "p90": 0.586
  },
  "waterUse": 19.41,
  "objective": 0.846,
  "objectiveTerms": [
    {
      "label": "Profit (risk-adjusted, lambda 0.40): 88% of the way from worst to best, weight 55%",
      "value": 0.482,
      "unit": "score",
      "basis": "design"
    },
    {
      "label": "Soil health: 80% of the way from worst to best, weight 45%",
      "value": 0.363,
      "unit": "score",
      "basis": "design"
    }
  ],
  "localReview": [
    "Yields start from US averages: compare them with your own records or county yields before trusting the dollar figures.",
    "Pest and disease penalties (white mold, nematodes, repeats) are estimates: check local pressure with your agronomist."
  ],
  "weatherRisk": {
    "waterLimited": false,
    "aridityIndex": 0.898,
    "aridityClass": "humid",
    "message": "Weather risk here is mostly not about water (humid, aridity index 0.90): wet springs, floods, wind and frost matter more, and the model doesn't capture most of those yet."
  },
  "rankStability": 0.735,
  "reasons": [
    "Best match for your priorities: profit 55%, soil health 45%, water 0%; risk lambda 0.40.",
    "North 40, year 2: N credit from Soybeans (35 lb N/ac x $0.58/lb) saves $20/ac of fertiliser."
  ],
  "risks": [
    "North 40, year 1: White mold risk: Soybeans after 1 recent host year(s).",
    "North 40, year 3: White mold risk: Soybeans after 1 recent host year(s)."
  ],
  "informationGaps": [
    "No local market data for Corn (grain); using the US average price with no demand cap.",
    "No local market data for Winter wheat; using the US average price with no demand cap."
  ]
}
```

In this example the priority plan is the current rotation plus a rye cover crop. So it never beats the current plan on cash (`probBeatsCurrent` is 0), and the price of the priorities is the cover crop's cost ($37/ac x 40 ac):

```json
{
  "profitCost": 1480,
  "soilHealthGain": 0.013,
  "waterUseReduction": 0,
  "p10Change": -1480,
  "terms": [
    {
      "label": "Cash margin given up (expected)",
      "value": -1480,
      "unit": "$",
      "basis": "design"
    },
    {
      "label": "Change in nitrogen carried forward (not cash)",
      "value": 0,
      "unit": "$",
      "basis": "design"
    }
  ],
  "summary": "Your priorities cost about $1,480 in expected profit over 3 years. In return: soil health +0.013, water use -0.000, bad-year margin -$1,480."
}
```

`exclusions` holds the "why not X?" answers:

```json
{
  "n40": [
    {
      "cropId": "spring-wheat",
      "kind": "availability",
      "reason": "Spring wheat (other spring) seed isn't available locally for North 40."
    },
    {
      "cropId": "sorghum",
      "kind": "availability",
      "reason": "Grain sorghum seed isn't available locally for North 40."
    }
  ]
}
```

**Plan shape** (`plan` in every result). The `cover` slot holds a winter cover crop:

```json
{
  "sequences": {
    "n40": [
      {
        "main": "soybeans"
      },
      {
        "main": "corn"
      },
      {
        "main": "soybeans"
      }
    ],
    "s40": [
      {
        "main": "corn"
      },
      {
        "main": "soybeans"
      },
      {
        "main": "corn",
        "cover": "cereal-rye"
      }
    ]
  }
}
```

## evaluatePlan(farm, plan, priorities, market, scenarios, options?)

This scores a plan the farmer built. It uses the same numbers as `generatePlans`, so results are comparable. It returns one `PlanResult` with `kind: "custom"` and `rankStability: null`.

- Every paddock needs exactly 3 slots, each with a `main` crop.
- Hard-rule breaks and severity-2+ placement warnings appear in `risks`.

```json
{
  "kind": "custom",
  "expectedGM": 52539.029,
  "p10GM": 34757.619,
  "probBeatsCurrent": 0,
  "nitrogenCarriedForward": 0,
  "soilHealth": 0.561,
  "waterUse": 20.619,
  "objective": 0.719,
  "rankStability": null,
  "risks": [
    "North 40, year 1: White mold risk: Soybeans after 1 recent host year(s).",
    "South 40, year 2: White mold risk: Soybeans after 1 recent host year(s)."
  ]
}
```

## checkPlacement(farm, plan, paddockId, yearIndex, cropId, options?)

Drag-and-drop feedback. Rules only (no Monte Carlo), so a call takes well under 5 ms.

- Other cells of the plan may be empty (`main: null`).
- `options.market` enables the `market` lens.
- Returns warnings sorted by severity, highest first.
- **Lenses:** `nitrogen`, `pest`, `water`, `erosion`, `repeat`, `shade`, `market`, `land`
- **Severity:** 1 = note, 2 = caution, 3 = don't

```json
[
  {
    "lens": "repeat",
    "severity": 2,
    "reason": "Corn (grain) again after Corn (grain): about 2.0% yield drag."
  },
  {
    "lens": "pest",
    "severity": 2,
    "reason": "Corn rootworm: corn on corn usually needs rootworm control."
  },
  {
    "lens": "nitrogen",
    "severity": 1,
    "reason": "No legume before this corn: no N credit, so budget the full N rate."
  }
]
```

## buildFarm(input, fetch?)  (`src/data/buildFarm`)

Draw fields and get a planner-ready farm. It calls NASA POWER, SSURGO and CropScape, all keyless. It is async and can take a few seconds. Anything the farmer enters wins over fetched data.

```json
{
  "fields": [
    {
      "id": "n40",
      "name": "North 40",
      "polygon": [
        [
          -93.64,
          42.034
        ],
        [
          -93.635,
          42.034
        ],
        [
          -93.635,
          42.0377
        ],
        [
          -93.64,
          42.0377
        ]
      ],
      "availableCrops": [
        "corn",
        "soybeans",
        "oats",
        "winter-wheat",
        "cereal-rye",
        "fallow"
      ],
      "tillage": "reduced",
      "tileDrained": true
    }
  ],
  "state": "IA",
  "weatherYears": [
    2001,
    2024
  ]
}
```

**Output:** `{ farm, scenarios, weather, provenance, gaps }`
- `farm`: a `Farm`, ready to edit and pass to the planner
- `scenarios`: the weather pool; pass it through unchanged
- `provenance[fieldId]`: `{ soil: "Coland clay loam ...", history: ["2022: Corn", ...] }`
- `gaps`: what couldn't be filled

## createFarmState / adoptPlan / updateAfterSeason / replan

The season loop: plan, the farmer picks a plan, the season happens, the farmer reports, then re-plan.

```ts
let state = createFarmState(farm, scenarios, 2026);
const plans = replan(state, priorities, market);          // same output as generatePlans
state = adoptPlan(state, plans.plans.priority.plan);       // the plan the farmer chose
const { state: next, notes } = updateAfterSeason(state, report, { weather: observedYear });
const again = replan(next, priorities, market);            // stays close to the adopted plan
```

**`SeasonReport`.** Events `hail`, `flood` and `replant` mean that season's yield isn't used for learning.

```json
{
  "season": 2026,
  "paddocks": [
    {
      "paddockId": "n40",
      "cropId": "soybeans",
      "yieldPerAcre": 61,
      "events": []
    },
    {
      "paddockId": "s40",
      "cropId": "corn",
      "yieldPerAcre": 205,
      "events": [
        "hail"
      ]
    }
  ]
}
```

**`updateAfterSeason`** returns the new state, and `notes` to show the farmer:

```json
[
  "North 40: Soybeans yielded 61.0 vs 54.2 predicted (+13%). Field factor now +4% from 1 season(s).",
  "South 40: Corn (grain) yield recorded but not used to calibrate (hail)."
]
```

The field's learned yield factor is stored on the paddock (`paddock.yieldCalibration`):

```json
{
  "soybeans": {
    "factor": 1.044,
    "logMean": 0.043,
    "logSd": 0.12,
    "seasons": 1,
    "records": [
      {
        "season": 2026,
        "reported": 61,
        "predicted": 54.19,
        "used": true
      }
    ]
  }
}
```

**`replan`** returns `generatePlans` output plus `replanning`:
- `changedShare`
- `changes[]`: `{ paddockId, year, from, to }`
- `withoutSwitchingCost?`: what would win if changes were free

```json
{
  "changedShare": 0,
  "changes": []
}
```

`FarmState` is plain JSON (`farm`, `nextSeason`, `weatherPool`, `adoptedPlan?`, `log[]`), so it can be saved and restored as is.
