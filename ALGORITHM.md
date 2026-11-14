# How the rotation algorithm works

This is the scoring engine behind Field Shift's rotation planner. It takes a farm (paddocks, land, the last 3 years of crops), the farmer's priorities, local market prices and a pool of weather years. It returns three 3-year plans, every number in them explained.

All code is in `src/algorithm/`. Every function is pure: there is no I/O, no clock and no global state. All randomness comes from one seeded RNG, so the same inputs and seed always give the same answer.

**Data vs design.** Numbers come from three places, and every number the mascot shows is tagged with which one (`Term.basis`):

| Where | What | Tag |
|---|---|---|
| `croptraits.ts`, `soilData.ts` | Sourced data (NASS, ERS, NDSU, FAO-56, FAO-61, Seifert 2017, UW/MDA, NRCS) | `sourced` |
| Caller inputs | Market, weather years, land, priorities | `input` |
| `constants.ts` | Modelling choices we can tune | `design` |
| Placeholder tables | Waiting for a source | `placeholder` |
| Stand-ins | e.g. residue standing in for organic matter | `proxy` |
| Fallbacks for missing data | e.g. unknown shade tolerance = 0.5 | `assumption` |

A `null` in the data is a real data gap. The code never fills it with a guess. The term is skipped, scores 0, or gets a worst-case or midpoint value (rules below), and the plan's `informationGaps` says so.

**Fallow is not missing data.** It means "no crop", so its yield, operating cost, kc (water use) and height are known zeros (`FALLOW_KNOWN` in `cropData.ts`). That makes fallow the best water user and gives it zero revenue. Its field operations (weed control, tillage passes) are a real cost we haven't sourced, so that is flagged as a gap.

---

## Stage 1: hard filters (`filters.ts`, `rotation.ts`)

A crop is removed from a paddock, with a plain-English reason (the mascot's "why not X?"), when any of these holds:

1. **Seed availability.** It isn't in `paddock.availableCrops`.
1. **Contract-market gate.** This is a design decision, not data. Dry beans, sunflower and canola are marked `requiresBuyer: true` in `croptraits.ts`, because their local markets are thin. They are recommended only if they appear in `farm.confirmedBuyers`; otherwise the reason is "Needs a confirmed buyer". Farmers can still place them in their own plan, where `checkPlacement` raises a `market` warning.
2. **Salinity.** Maas–Hoffman relative yield
   `relYield = 1 − slope/100 × (ECe − threshold)` (FAO-61) is below `SALINITY_MIN_RELATIVE_YIELD`.
   Crops rated tolerant with no published threshold (oats) are allowed, and that is recorded as a gap.
3. **Incomplete economics (recommended plans only).** The crop is a cash crop but its yield, price or cost is missing, so its profit can't be computed. Today this applies to **alfalfa**, which has no operating cost. Farmers can still put alfalfa in their own plan, where its margin is flagged as incomplete. Fallow and cereal rye (cover) have $0 revenue, and their unknown cost is flagged.

A 3-year sequence is removed when it breaks a **hard rotation rule**. History counts, so the rules apply across the history/plan boundary:

- Sunflower, canola and dry beans can't follow themselves (`NO_BACK_TO_BACK_CROPS`).
- An alfalfa stand can't run longer than `ALFALFA_MAX_STAND_YEARS`. A longer run would mean replanting alfalfa straight after alfalfa, which autotoxicity rules out.

**Not checked yet:** pH, drainage/waterlogging, frost and slope suitability. These traits are `null` for every crop in `croptraits.ts`. Each plan lists this as an information gap.

## Stage 2: gross margin per crop, year and paddock

```
yield        = YieldModel.yieldFor(paddock, sequence, year, weatherYear)
gross margin = yield × effective price − operating cost + N credit × N price      ($/ac)
```

### The yield model (`yieldModel.ts`)

Yield sits behind a `YieldModel` interface. Search and Monte Carlo only call `yieldFor`, so an APSIM lookup-table model can be swapped in later without touching them.

- **Contract:** the result may depend only on the paddock, its history, `sequence[0..year]`, the weather year and adjacent paddocks' crops that year. The search caches on exactly those inputs.
- **Soil overrides:** a process model can also return `soil.groundCover` and `soil.organicMatter` terms, which replace components (a) and (d) of the soil health index.

The shipped model is **TraitYieldModel**:

```
yield = US average yield × salinity factor × rotation factors × (1 − shade loss) × weather multiplier
```

Each factor becomes a labelled term in yield units, for example "Corn after corn (year 2 in a row) yield drag: −3.6 bu/ac". The terms add up exactly to the yield.

### Rotation factors (`rotation.ts`)

Sourced effects (`ROTATION_EFFECTS` in `croptraits.ts`):

| Rule | Effect | Source |
|---|---|---|
| Corn after corn, 2nd year in a row | −2% | UNL CropWatch 2020 |
| Corn after corn, 3rd+ year | −5.5% | UNL CropWatch 2020 |
| Soybean after soybean | −10.3% | Seifert 2017 |
| Corn after soybean | No drag. National yields are mostly rotated corn, so the "rotation boost" is the absence of the corn-on-corn drag. | Seifert 2017 |

Soft rules (`ROTATION_RULES` in `constants.ts`). These magnitudes are **not sourced** and are design choices:

| Rule | Effect |
|---|---|
| White mold host after hosts (soybean, dry beans, canola, sunflower, alfalfa) | −`whiteMoldPerHostYear` × host years in the last 3. ×`whiteMoldHistoryMultiplier` if the paddock has a white-mold history flag. |
| Other pest group (SCN, rootworm) hosted last year | −`pestRepeatBackToBack` |
| Other pest group hosted 2–3 years ago | −`pestRepeatPerEarlierHostYear` per host year. Skipped for `oneYearBreakGroups` (corn rootworm). |
| Same crop again with no sourced effect (cotton, wheat, sorghum...) | −`sameCropRepeatUnsourced`. Continuous cotton is soft, not banned. |
| Alfalfa establishment year | × `ALFALFA_ESTABLISHMENT_YIELD_FACTOR`. It is **null (not sourced)**, so no adjustment is made yet and a gap is recorded. |

When a sourced same-crop penalty applies (corn on corn, soy on soy), the generic pest penalties are skipped for that year. The field numbers already include disease effects, so applying both would double-count. Consecutive alfalfa years are one stand and get no repeat or pest penalties.

### Nitrogen credit

`nCreditToNextCornLbPerAcre` is sourced as credit **to following corn**. So only corn receives it:

```
credit $/ac = midpoint(low, high) lb N/ac × N price
```

The N price defaults to `NITROGEN_PRICE_PER_LB` ($0.58, NDSU). With the current data:
- soybean → corn: 35 lb
- alfalfa → corn: 145 lb
- dry beans → corn: 20 lb

Credits to other crops are not modelled (gap).

### Operating cost

`operatingCostPerAcre` (ERS 2027F or NDSU 2026). A null cost is shown as $0 and flagged.

## Stage 3: market pressure (`market.ts`)

Production is pooled across the farm for each crop and year:

```
revenue = min(production, localDemand) × localPrice
        + max(0, production − localDemand) × max(0, distantPrice − freight)
```

Both prices are scaled by the optional `outlook`. The effective price per paddock is revenue / production. Crops with no market entry use the US average price with no demand cap (gap). The cap couples paddocks together, so it is handled in the farm-wide search (stage 5).

## Stage 4: shade as an edge effect (`shade.ts`, `seasons.ts`, `geometry.ts`)

Northern hemisphere only. Latitude < 0 throws a clear error. A tall crop shades the neighbour on its **north** side, and only in months when **both crops are in the field and it is actually taller**:

```
window           = shaded crop's sensitiveMonths if set (winter wheat: Apr–Jun), else its whole season
declination      = 23.44° × sin(360° × (284 + day) / 365), at the midpoint of that window
sun elevation    = 90° − latitude + declination                     (floored at MIN_SUN_ELEVATION_DEG)
height(month)    = max height × min(1, months since planting / (season length / 2)), 0 outside the season
shadow(month)    = max(0, tall height(month) − shaded height(month)) / tan(elevation)
shaded fraction  = mean over window months of shadow(month) × shared north edge (east-west width) / shaded paddock area
yield loss       = shaded fraction × (1 − shade tolerance of the shaded crop)
```

**Height ramp: an assumption.** Height grows linearly from 0 at planting to the FAO-56 maximum at mid-season, then stays there. It is not sourced and there are no per-crop growth curves. It is what makes corn (May–Sep) next to winter wheat (sensitive Apr–Jun) close to zero: corn is still short in May and June.

**Inputs and units**
- Polygons can be lat/lng. They are converted to local metres (equirectangular around the farm centroid, +y north), and adjacency is computed from shared edges.
- Heights are FAO-56 maximum heights in metres.
- Seasons come from the crop's per-state span (Handbook 628, not entered yet). Until then they use the fallback spans: summer crops May–Sep (window midpoint mid-July, about +21.5°), winter wheat Oct–Jul.
- Winter wheat has `sensitiveMonths` Apr–Jun (a design choice), so its sun angle comes from mid-May (about +19°), not its season midpoint around 1 March (about −8°).

**Unknown shade tolerance** (currently every crop):
- The deterministic search uses `SHADE_TOLERANCE_UNKNOWN_DETERMINISTIC` (0.5), labelled "Shade (tolerance unknown, midpoint assumed)".
- Monte Carlo draws Uniform(0, 1) once per crop per sample, shared across all paddocks and plans. This widens P10 without adding noise to plan comparisons.
- The shaded fraction is always computed, because the geometry is real. When a sourced tolerance is added, the null check is the only branch, so it replaces both.

**Deliberate simplification.** Only the **noon** shadow is modelled. Morning and evening shadows are longer but fall east–west and move during the day. Noon shade is the one that sits on the north neighbour. On a 40-acre square the loss is well under 1%; on a 10 m × 200 m strip it is several percent.

## Soil health index and water (`soilHealth.ts`)

`soilHealthIndex` is a **composite index from 0 to 1, not a measured soil property**:

```
index = 0.35 × groundCover + 0.20 × nitrogen + 0.25 × diversity + 0.20 × organicMatterProxy
```

The weights are `SOIL_INDEX_WEIGHTS`, a design choice. A component with missing data scores 0 and is flagged, so unknown data never makes a crop look better.

**(a) Ground cover / erosion.**

```
residue lb/ac   = yield × NRCS residue factor
                  (corn 75 lb/bu, sorghum 1.35 lb/lb, soybean 60 lb/bu, wheat 100 lb/bu)
retained        = residue × tillage retention          (TILLAGE_RESIDUE_RETENTION, PLACEHOLDER)
cover           = 1 − exp(−k × retained)
                  k chosen so 2,600 lb corn or 1,500 lb small-grain/soy residue → 60% cover (NRCS)
groundCover     = cover × (1 − BARE_MONTH_COVER_DISCOUNT × bareMonths / 12)
```

Special cases:
- An alfalfa stand scores 1 − C, where C = 0.020 (NRCS legume meadow).
- Fallow scores 0.
- Canola, sunflower, dry beans, cotton, oats, barley and cereal rye have **no residue factor**. They get a gap, not another crop's number.
- Using the corn (coarse) curve for sorghum is an assumption.

**(b) Nitrogen.** The N credit midpoint divided by the largest credit in the table.

**(c) Diversity / pest break.** Starts at 1. Subtract `DIVERSITY_DEDUCTIONS.sameFamily` if the crop is the same family as last year, and `sharedPestGroup` if it shares a pest group with last year's crop. A continuing alfalfa stand counts as 1.

**(d) Organic matter, PROXY.** Residue lb/ac divided by the largest residue in the table. This is labelled as a proxy in the terms. Real soil carbon change will come from APSIM.

**Water-use index.** Lower is better.

```
water = FAO-56 kc mid × months occupied / 12
```

Fallow is 0. An unknown kc (cereal rye) gets the table's worst value, and a gap is recorded.

## Stage 5: plan search (`search.ts`, `farmModel.ts`)

1. **Enumerate.** Per paddock, list every allowed 3-year sequence: allowed crops cubed, minus hard-rule breaks. Pre-score what doesn't depend on other paddocks (costs, N credits, soil, water, end-of-horizon value) with shade-free expected yields.

2. **Reference bounds, computed once per farm.** For each criterion, sum each paddock's best and worst sequence:
   - profit at local price with no cap and no shade
   - acre-weighted soil
   - acre-weighted water

   Every plan is normalised against these fixed bounds, never against the handful of candidate plans. So adding or removing a candidate can't flip the winner.

3. **Coordinate descent.** Start from each paddock's standalone best. Then repeatedly re-optimise one paddock at a time, with the others fixed, until nothing changes (or `MAX_DESCENT_ITERATIONS`). Each step re-scores the farm objective, which includes:
   - market caps (farm-wide revenue)
   - shade (only the moved paddock and its neighbours are re-yielded, through a cache)
   - the crop-variety penalty

   Descent runs under five weight vectors to produce candidates:
   - profit only, λ = 0 (the max-profit search)
   - the farmer's weights
   - the farmer's weights shifted +`CANDIDATE_WEIGHT_SHIFT` toward soil
   - ... toward water
   - ... toward profit

4. **End-of-horizon value**, so the last year isn't planted for cash alone with the soil ignored:
   - **$:** N left for next year's corn (final crop's credit × N price) is added to the profit criterion. A stand of alfalfa still standing is credited the same way.
   - **Soil:** the final year's soil index counts (1 + `END_SOIL_WEIGHT`) times in the soil criterion.

5. **Crop-variety penalty:**
   ```
   penalty = VARIETY_PENALTY_WEIGHT × λ × mean over years of Σ_family max(0, family share − VARIETY_MAX_FAMILY_SHARE)
   ```
   It is scaled by λ because concentration in one family is a risk. So at risk = 0 it is off, and the max-profit plan is never constrained by it.

## Stage 6: uncertainty (`montecarlo.ts`)

### Cash vs nitrogen carried forward

Every plan reports these separately so the farmer never reads leftover N as cash:
- `expectedGM` / `p10GM`: the **cash** margin. This includes N credits used *within* the plan, which is fertiliser you don't buy.
- `nitrogenCarriedForward`: the value of N left after the final year. It is **not cash**, and is realised only if corn follows.

`marginBreakdown` gives both as labelled terms. Ranking (the max-profit pick and the profit criterion) uses their sum.

Monte Carlo runs only on:
- the top `MC_TOP_K` candidates by deterministic objective
- the max-profit candidate
- the current rotation

**Common random numbers.** Each of `MC_SAMPLES` samples draws:
- one whole weather year per horizon year from the supplied pool, with all crops' multipliers together
- one log-normal price path
- one shade-tolerance value per crop with unknown tolerance

Every paddock and every plan uses the same draws, so plan-to-plan differences are real, not sampling noise.

```
price multiplier ~ exp(σZ − σ²/2)         mean 1; σ = std. dev. of ln(price) over croptraits byYear
expected GM      = mean of farm GM over samples (3-year total)
P10 GM           = 10th percentile
P(beats current) = share of samples where plan GM > current GM (same sample)
riskAdjusted     = expected − λ × (expected − P10),  λ = risk / 100 × LAMBDA_MAX   (LAMBDA_MAX = 1)
```

**Rank stability:** each slider is jittered uniformly by ±`RANK_JITTER` (15), `RANK_JITTER_SAMPLES` times. Rank stability is the share of jitters in which the plan ranks first.

**Known gaps:**
- Prices are independent per crop and year. The **corn/soybean price correlation is missing.**
- σ comes from only 3 marketing years, so it understates long-run volatility.

## Objective and the three plans (`objective.ts`, `api.ts`)

```
weights      w = slider / (profit + soilHealth + water)     (all zero → equal weights)
profit       = riskAdjusted GM + end-of-horizon $
norm(c)      = (value − worst_c) / (best_c − worst_c)        (fixed bounds from stage 5)
objective    = w_profit × norm(profit) + w_soil × norm(soil) + w_water × norm(water) − variety penalty
```

The risk slider does one job: it sets λ (and with it the variety penalty). It is not a criterion weight.

| Plan | Definition |
|---|---|
| **Current** | Each paddock's shortest repeating pattern from the last 3 years, carried forward. This is the baseline. |
| **Max profit** | Highest **expected** GM + end-of-horizon N value, with λ = 0. Its P10 is always reported beside it. A cautious farmer's "max profit" is therefore never quietly a safe plan. |
| **Priority** | Highest objective among the Monte Carlo candidates. With profit = 100 and everything else 0, it is the max-profit plan. |

**Price of priorities** = max-profit (expected GM + end $) − priority (expected GM + end $). It is reported with what the farmer gets for it: soil-health gain, water-use reduction and the P10 change.

## Explaining numbers

Every per-year result carries `terms`:
- yield steps
- effective price (with the local/distant split)
- revenue, operating cost, N credit, gross margin
- soil components, soil index, water use

Each plan also carries `objectiveTerms`, `reasons`, `risks` and `informationGaps`. `checkPlacement` returns `{lens, severity, reason}` warnings for the 3D planner. The lenses are land, repeat, pest, nitrogen, water, erosion, shade and market. It runs the rules only (no Monte Carlo) and takes well under 5 ms.

---

## Everything a teammate can tune or needs to source

### Design constants (`constants.ts`)

| Constant | Value | What it does |
|---|---|---|
| `HORIZON_YEARS` | 3 | Plan length |
| `NO_BACK_TO_BACK_CROPS` | sunflower, canola, dry-beans | Hard rule |
| `ALFALFA_MAX_STAND_YEARS` | 4 | Hard rule |
| `SALINITY_MIN_RELATIVE_YIELD` | 0.5 | Salinity exclusion cut-off |
| `ROTATION_RULES.pestRepeatBackToBack` | 0.05 | **Unsourced magnitude** |
| `ROTATION_RULES.pestRepeatPerEarlierHostYear` | 0.02 | **Unsourced magnitude** |
| `ROTATION_RULES.pestWindowYears` | 3 | Look-back window |
| `ROTATION_RULES.whiteMoldPerHostYear` | 0.03 | **Unsourced magnitude** |
| `ROTATION_RULES.whiteMoldHistoryMultiplier` | 2 | Paddock white-mold flag |
| `ROTATION_RULES.sameCropRepeatUnsourced` | 0.03 | **Unsourced magnitude** (cotton, wheat, sorghum repeats) |
| `ROTATION_RULES.oneYearBreakGroups` | cornRootworm | Only last year counts for these |
| `ALFALFA_ESTABLISHMENT_YIELD_FACTOR` | **null** | **Needs a source** |
| `SHADE_TOLERANCE_UNKNOWN_DETERMINISTIC` | 0.5 | Midpoint for unknown tolerance |
| `MIN_SUN_ELEVATION_DEG` | 5 | Keeps shadows finite |
| `SHADE_WARNING_FRACTIONS` | 2% / 5% / 15% | checkPlacement severity 1/2/3 |
| `SOIL_INDEX_WEIGHTS` | 0.35 / 0.20 / 0.25 / 0.20 | cover / N / diversity / OM proxy |
| `BARE_MONTH_COVER_DISCOUNT` | 0.5 | Cover lost per bare year-fraction |
| `DIVERSITY_DEDUCTIONS` | 0.5 / 0.5 | Same family / shared pest group |
| `LAMBDA_MAX` | 1 | risk = 100 optimises P10 |
| `VARIETY_MAX_FAMILY_SHARE` | 0.6 | Family share cap per year |
| `VARIETY_PENALTY_WEIGHT` | 1 | Objective units per unit of excess share (× λ) |
| `END_SOIL_WEIGHT` | 1 | Final year counts double in soil |
| `MAX_DESCENT_ITERATIONS` | 20 | Coordinate-descent cap |
| `CANDIDATE_WEIGHT_SHIFT` | 25 | Slider shift for extra candidates |
| `MC_SAMPLES` / `MC_TOP_K` | 200 / 4 | Monte Carlo size (also options) |
| `RANK_JITTER` / `RANK_JITTER_SAMPLES` | 15 / 200 | Rank stability |
| `P_LOW` | 0.1 | P10 |
| `EROSION_WARNING_LEVELS` | 2 / 4 / 8 | slope% × (1 − cover) |
| `MARKET_WARNING_EXCESS` | >0 / 25% / 50% | Share sold at the distant price |
| `WATER_HIGH_KC` / `WATER_SENSITIVE_P` | 1.15 / 0.45 | Water lens on sandy soil |

Also:
- `FALLBACK_SEASONS` in `seasons.ts`: summer May–Sep, winter Oct–Jul, perennial uses summer. Used until Handbook 628 values are entered.
- The linear **height ramp** in `shade.ts` (`heightInMonth`): an assumption.
- In `croptraits.ts`: `sensitiveMonths` (winter wheat Apr–Jun) and `requiresBuyer` (dry beans, sunflower, canola). Both are design decisions, not data.

### Placeholders and data to source

| Item | Where | Status |
|---|---|---|
| Tillage residue retention (0.3 / 0.6 / 0.9) | `soilData.ts` `TILLAGE_RESIDUE_RETENTION` | **Placeholder**: a teammate will supply |
| Season spans by state (IA, KS first) | `croptraits.ts` `season` | Empty: [Ag Handbook 628](https://esmis.nal.usda.gov/concern/publications/vm40xr56k) |
| Fallow field operations cost | `cropData.ts` | Shown as $0 (gap) |
| Crop height through the season | `shade.ts` | Linear ramp assumption |
| Dry bean margin | `croptraits.ts` | National yield and US price vs a North Dakota cost: likely overstated |
| Shade tolerance, frost, waterlogging, pH range | `croptraits.ts` | null for every crop |
| Residue factors for canola, sunflower, dry beans, cotton, oats, barley, cereal rye | `soilData.ts` | Not sourced |
| Alfalfa operating cost and establishment-year yield | `croptraits.ts`, `constants.ts` | Not sourced (alfalfa is not recommended until then) |
| Cereal rye cover and fallow costs; rye height, roots, kc | `croptraits.ts` | Not sourced |
| Magnitudes of the pest-repeat and white-mold penalties | `constants.ts` | Unsourced design values |
| Legume N credits to wheat and sorghum | — | Not modelled (corn only) |
| Corn/soy price correlation; 10+ years of prices for σ | — | Not modelled / 3 years only |
| Slope suitability per crop | — | Not checked (only the erosion warning) |
| State/county yields instead of national | `croptraits.ts` | National only |

See also `DATA_GAPS` in `croptraits.ts`.
