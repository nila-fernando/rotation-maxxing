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
1. **Equipment.** The farmer has said they lack equipment the crop needs (`farm.constraints.missingEquipment`; `EQUIPMENT_NEEDED` is a design list: alfalfa needs hay equipment, cotton a picker). This applies to the farmer's own plans too (a severity-3 `land` warning).
1. **Contract-market gate.** This is a design decision, not data. Dry beans, sunflower and canola are marked `requiresBuyer: true` in `croptraits.ts`, because their local markets are thin. They are recommended only if they appear in `farm.confirmedBuyers`; otherwise the reason is "Needs a confirmed buyer". Farmers can still place them in their own plan, where `checkPlacement` raises a `market` warning.
2. **Salinity.** Maas–Hoffman relative yield
   `relYield = 1 − slope/100 × (ECe − threshold)` (FAO-61) is below `SALINITY_MIN_RELATIVE_YIELD`.
   Crops rated tolerant with no published threshold (oats) are allowed, and that is recorded as a gap.
3. **Soil pH and drainage** (FAO EcoCrop, expert opinion; see *Land suitability* below). Excluded only outside the crop's pH min..max or outside its tolerated drainage classes.
4. **Incomplete economics (recommended plans only).** The crop is a cash crop and something its profit depends on is missing. Today this applies to **alfalfa**: it has a sourced cost (ISU 2026), but its establishment-year yield isn't sourced, so its first-year margin would be overstated. Farmers can still put alfalfa in their own plan.
5. **Cereal rye is a cover crop**, offered only in the winter cover slot, never as a main crop.

A 3-year sequence is removed when it breaks a **hard rotation rule**. History counts, so the rules apply across the history/plan boundary:

- Sunflower, canola and dry beans can't follow themselves (`NO_BACK_TO_BACK_CROPS`).
- An alfalfa stand can't run longer than `ALFALFA_MAX_STAND_YEARS`. A longer run would mean replanting alfalfa straight after alfalfa, which autotoxicity rules out.

**Not checked:** frost and winter hardiness (EcoCrop killing temperatures are unusable). Slope belongs in erosion (RUSLE), not suitability. Crops that aren't usual in the farm's state (Handbook 628, IA/KS) get a severity-1 warning, not an exclusion.

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
yield = US average yield × salinity × pH × drainage × rotation factors × (1 − shade loss) × weather multiplier
```

Every model is wrapped by `withCalibration()`, which multiplies by the field's learned yield factor (see *The season loop*). The weather multiplier is per field when the pool came from NASA POWER.

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
                  (corn 75, sorghum 1.35/lb, soybean 60, wheat 100, barley 70, oats 80, rye 90 lb/bu)
retained        = residue × tillage-system retention × over-winter decomposition
                  (NRCS VA Tech Note Table 2 per operation; which operations a system means is DESIGN;
                   fragile residue keeps less; unknown fragility counts as fragile)
cover           = 1 − exp(−k × retained)
                  k chosen so 2,600 lb corn or 1,500 lb small-grain/soy residue → 60% cover (NRCS)
groundCover     = cover × (1 − BARE_MONTH_COVER_DISCOUNT × bareMonths / 12)
```

Special cases:
- An alfalfa stand scores 1 − C, where C = 0.020 (NRCS legume meadow).
- Fallow scores 0.
- Canola, sunflower, dry beans, cotton and alfalfa have **no residue factor**. They get a gap, not another crop's number.
- **With SSURGO K and T and NASA POWER rain**, (a) becomes an erosion score: `1 − A/T` from RUSLE (see *Erosion*), still discounted for bare months.
- A winter cover crop fills up to `COVER_CROP_MONTHS` bare months (design).
- `soilHealthRange` reports the index at the 10th and 90th percentile of the tillage low..high ranges. Cover only rises with retention, so those are exactly the P10/P90 of a farm-wide uniform draw.
- Using the corn (coarse) curve for sorghum is an assumption.

**(b) Nitrogen.** The N credit midpoint divided by the largest credit in the table.

**(c) Diversity / pest break.** Starts at 1. Subtract `DIVERSITY_DEDUCTIONS.sameFamily` if the crop is the same family as last year, and `sharedPestGroup` if it shares a pest group with last year's crop. A continuing alfalfa stand counts as 1.

**(d) Organic matter, PROXY.** Residue lb/ac divided by the largest residue in the table. This is labelled as a proxy in the terms. Real soil carbon change will come from APSIM.

**Water-use index.** Lower is better.

With a NASA POWER weather pool, the water score is field-specific, in inches per season:
- **dryland:** water used from the field (crop ET, or bare-soil evaporation for fallow)
- **irrigated:** irrigation water applied

Otherwise it falls back to `kc mid × months occupied / 12`. Fallow is 0 (known: no crop). A crop missing from the water balance gets the field's worst value, and a gap is recorded.

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
   It is measured over CROPPED acres: fallow isn't a crop family, and leaving land empty doesn't diversify revenue.
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

**Water counts as much as water is scarce.** The water slider is multiplied by a scarcity factor before the weights are normalised:

```
aridity index AI = mean annual precipitation / mean annual FAO-56 ET0       (NASA POWER, over the weather pool)
classes (UNEP 1997, as tabulated in Zomer, Xu & Trabucco 2022, Sci Data 9:409):
  < 0.03 hyper-arid | 0.03–0.2 arid | 0.2–0.5 semi-arid | 0.5–0.65 dry sub-humid | > 0.65 humid
  (an exact boundary value goes to the wetter class: our choice)
scarcity = 0 at AI ≥ 0.65, rising linearly to 1 at AI ≤ 0.20       ← DESIGN curve between the UNEP anchors
w_water  = slider_water × scarcity, then normalised with profit and soil
```

| Case | Scarcity |
|---|---|
| Irrigated farms | Always 1: irrigation water is a real cost |
| Unknown climate (no daily weather) | 1 |

On NASA POWER data:

| Location | Aridity index | Class | Scarcity |
|---|---|---|---|
| Ames | 0.90 | humid | 0 |
| Saline County KS | 0.49 | semi-arid | 0.35 |

So neutral Iowa plans no longer trade a fallow year for lower water use. A high water slider in Kansas can still choose fallow. The factor is shown in every plan's `objectiveTerms`, for example "Water is plentiful here (aridity index 0.90, humid), so water use counts for little".

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

## NASA and USDA data (`src/data/`, `climate.ts`)

`buildFarm(fields)` fills a planner-ready farm from keyless services, and records where every value came from. Farmer-entered values always win.

| Service | Gives | Used for |
|---|---|---|
| **NASA POWER** daily (temperature, rain, radiation, humidity, wind) | one call per farm | water balance, weather pool, rainfall erosivity |
| **SSURGO** (Soil Data Access) at each field centroid | AWC (top 150 cm), K, T, pH, EC, OM, texture, drainage, map-unit slope | water balance, RUSLE, suitability |
| **Cropland Data Layer** (CropScape), majority of 5 points per field | last 3 years of crops | history and "current rotation" |

CropScape needs EPSG:5070 coordinates; the projection is implemented and checked against `pyproj`. CropScape's intermittent 5xx errors are retried; a year that still fails becomes "unknown" with a gap. Adapters are tested offline on recorded responses (`src/data/__tests__/fixtures`).

## Water balance (`et0.ts`, `waterBalance.ts`, `climate.ts`)

```
ET0      FAO-56 Penman-Monteith, daily (checked against FAO-56 Examples 8 and 18)
ETm      = Kc(day) × ET0          Kc curve from FAO-56 Table 11 stage lengths and Table 12 Kc
TAW      = 1000 × AWC × Zr        Zr grows from 0.175 m (FAO-56 Annex 8) to the LARGER Table 22 value (footnote 1:
                                  for rainfed stress modelling on unrestricted soils), capped by SSURGO restrictive layers
Ks       = (TAW − Dr) / ((1 − p) TAW) once depletion passes RAW = p × TAW
Ya/Ym    = 1 − Ky × (1 − ΣETa / ΣETm)       Ky from FAO-66 Table 1 (FAO-33 values)
multiplier(field, crop, year) = Ya/Ym ÷ mean dryland Ya/Ym over all years
```

Dividing by the dryland mean keeps the national yield meaning "an average year", and lets irrigated fields come out above average. Irrigated fields are refilled to field capacity when depletion passes RAW, until the seasonal allocation runs out. Planting uses the Handbook 628 active-start date where available.

**Soil-water carryover (one season of memory).** Each crop starts with the root zone left by what came before. The water at planting depends on the previous crop:
- **Previous crop:** that crop's season (starting full; cut short if the next crop is planted before it's harvested), then the off-season. In the off-season, bare-soil evaporation (FAO-56 Ch. 7) is reduced by the previous crop's residue mulch (FAO-56 Ch. 11: TEW −5% per 10% cover) and refilled by rain.
- **Fallow:** bare soil from 1 January of the fallow year until planting.
- **Unknown predecessor:** a predecessor with no water parameters gets the average start.

As the new crop's roots grow, they reach that carried-over subsoil water. The weather pool stores multipliers per previous crop (`byPaddockAfter`), so the yield of wheat after fallow differs from wheat after sorghum.

On recorded weather:

| Location | Corn after fallow vs after soybean | Note |
|---|---|---|
| Ames, 24 years | +3% | humid; little storage benefit |
| Saline County KS, 2011–2014 | +16% | fallow-before-wheat is a real Plains practice |

The 2012 drought makes the gap much larger in short records.

**Simplifications:**
- no surface runoff, no capillary rise
- frozen soil and snow are not modelled (winter evaporation is overstated)
- linear root growth
- the crop before the previous one is forgotten

These make the model drought-sensitive: in the first test, 2012 corn in central Iowa came out at 57% of normal. The backtest checks this: see `reports/`. Kansas summer crops track well (r ≈ 0.9); Iowa is still about 2× too drought-sensitive (likely shallow water table / capillary rise). **No Ky** is sourced for oats, barley or canola, and **no stage lengths** for canola, alfalfa cutting cycles or rye. Those crops don't vary with weather (gap).

## Erosion (`erosion.ts`)

```
A  = R × K × LS × C × P           tons/acre/year
R  = Σ daily EI / 17.02           EI = a × P^1.81 (a = 0.41 Apr–Sep, 0.18 Oct–Mar; Richardson 1983), US units (ARS)
K, T from SSURGO; LS from slope and slope length (AH703 eqs. 4-1..4-5; 72.6 ft assumed if unknown)
C  = 1 fallow (by definition); 0.020 established alfalfa; else exp(−0.035 × % residue cover) (AH703 eq. 5-12)
P  = 1
```

Canopy and residue decay are not modelled, so row-crop A is conservative. With R, K and T known, the soil index's cover component becomes `1 − A/T` (then the bare-month discount). Central Iowa R from POWER came out at 79–227 per year (mean about 144), close to published isoerodent values (about 150–175); gridded daily rain smooths intensity.

## Winter cover crop (`SeasonSlot.cover`)

Cereal rye can follow a summer-harvested crop and precede a spring-planted one. It never goes around winter wheat or inside an alfalfa stand, and needs rye seed to be available.

**Sourced effects:**
- $37/ac, the SARE 2019 median for all cover crops
- no change to the next corn yield (Marcillo & Miguez 2017, grass covers)

**Design effect:** it fills up to 7 bare months in the soil index.

**Gaps:**
- RUSLE C for rye
- spring water use (about 1 in per 1,000 lb/ac biomass, UNL; biomass unknown)
- N tie-up

**How the search picks it.** A cover's effects stay within its paddock-year, so for each weight vector the search adds a cover only where `w_soil × share × Δsoil / soil range > w_profit × cost / profit range`. This decision is independent per year, so no 8× enumeration is needed. The max-profit plan never takes one.

## Land suitability (`landSuitability.ts`, FAO EcoCrop)

These values are expert opinion: global, not US-calibrated, and wheat is a single entry for winter and spring.

**pH: plateau curve.** The yield multiplier is 1 inside optMin..optMax and falls linearly to 0 at min / max. The crop is excluded only outside min..max. Unknown pH means the check is skipped, with a gap.

**Drainage.**
- **Mapping (design):** SSURGO classes map to EcoCrop as excessive → E, well → W, moderately well → W, poor → I. EcoCrop's I still needs its exact definition confirmed.
- **Tile drainage** counts as one class better.
- **Outside the crop's tolerated classes:** excluded.
- **Tolerated but not optimal:** × `DRAINAGE_SUBOPTIMAL_FACTOR`, an unsourced design value.

## The season loop (`update.ts`)

```
state = createFarmState(farm, weatherPool, 2026)
plans = replan(state, priorities, market)            // 2026-2028
state = adoptPlan(state, plans.plans.priority.plan)
... season ...
{ state } = updateAfterSeason(state, report, { weather: observed2026 })
plans = replan(state, priorities, market)            // 2027-2029, close to the adopted plan
```

`updateAfterSeason` does four things:
- **History:** the reported crop becomes the newest year.
- **Weather pool:** the observed weather year joins the pool.
- **Land:** optional updates.
- **Calibration:** each field's yield factor is updated per crop from reported vs predicted yield. The prediction uses that season's *actual* weather and neighbours, before calibration.

Calibration uses shrinkage on the log scale:

```
prior   log f ~ N(0, 0.15²)                              CALIBRATION_PRIOR_SD
season  log(reported / predicted) ~ N(log f, 0.20²)      CALIBRATION_OBS_SD
posterior mean = (Σ log r / 0.20²) / (1/0.15² + n/0.20²)
```

One season moves the factor only part of the way, and it converges as seasons accumulate. Seasons flagged hail, flood or replant are recorded but not used.

`replan` stays close to the adopted plan through a switching cost: `SWITCHING_PENALTY_WEIGHT` × the acre-weighted share of planned paddock-years changed. It never applies to max-profit. `GenerateResult.replanning` lists the changes, and what would win if changes were free.

## Evidence (`evidence.ts`)

Every sourced term carries `sources` (ids). `describeSource(id)` resolves any id across croptraits, the update file, soil, water and data sources. A test checks that every sourced number in real plans resolves. Each plan also has `localReview`, the list of things to check with an agronomist before acting.

## Backtest (`scripts/backtest.ts`)

`npm run backtest` builds the water-balance yield anomalies for Story County, IA and Saline County, KS, 2001–2024, from NASA POWER and SSURGO.

With `NASS_API_KEY` set, it also pulls QuickStats county yields, detrends them linearly, and reports:
- correlation
- mean absolute anomaly error
- the worst year, real vs model

Without a key it lists the model's worst years. 2012 is the worst for every county and crop.

## Spring freeze injury to winter wheat (`frost.ts`)

```
growing degrees (F) = max(0, (Tmax + Tmin)/2 − 32), summed from 1 January       Kansas Mesonet formula
stage               = < 800 tillering | 800–1200 jointing | 1200–1400 boot | 1400–1600 heading |
                      1600–2000 flowering | 2000–2400 milk | 2400–2800 dough | ≥ 2800 mature
freeze event        = a night ON OR AFTER 1 MARCH with NASA POWER Tmin ≤ the C646 injurious temperature for the stage:
                      tillering 12 F, jointing 24, boot 28, heading 30, flowering 30, milk 28, dough 28
season damage       = the worst event's C646 yield effect → design range:
                      slight-to-moderate U(0.80, 1.00), moderate-to-severe U(0.50, 0.85), severe U(0.20, 0.60)
```

**Sourced:** the freeze thresholds and the qualitative yield effects (K-State C646, Table 1), and the growing-degree formula (Kansas Mesonet).

**Design or assumption:**
- The damage ranges are **unsourced design values**, chosen before validation. Midpoints are used in the search; Monte Carlo draws within the range with common random numbers.
- Assigning each overlapping Mesonet stage band to one C646 stage is a design choice.
- The 1 January start is an **assumption**. The Mesonet page doesn't state it, but it's corroborated: Tribune KS 2026 has a Mesonet season total of 4,346 F, and NASA POWER from 1 January to 30 June gives 4,443 F.

**Scope fix: freezes count from spring green-up (1 March).** C646 Table 1 covers *spring* growth stages. C646 (p. 5) says: "Spring tillering of wheat in Kansas usually begins during late February and continues through March." The first version counted freezes from 1 January, so it applied spring thresholds to dormant, cold-hardened winter wheat. That was outside the source's scope.

The flaw was found during validation: 20 false alarms per county, nearly all January–February nights below 12 F. It was fixed by counting events from 1 March, a date derived from C646's wording. This is a scope correction, not tuning: the thresholds and damage ranges were not changed. Growing degrees still accumulate from 1 January for staging.

**Limits:**
- the daily minimum temperature is for a ~50 km grid cell
- C646's thresholds assume two hours of exposure, which daily data can't resolve
- snow cover isn't modelled

**Check:** Saline KS on 6–8 April 2007 reached 17–20 F at about 900 GDD (jointing), so it is flagged. K-State SRP 982 reports 46% of the crop jointed by 2 April, then record cold in early April.

Plans with wheat say, for example, "Freeze risk: in 3 of 24 years, temperatures fell below the jointing threshold (K-State C646)."

## Is weather risk about water here? (`PlanResult.weatherRisk`)

`waterLimited` is true when the aridity index is below 0.65 (drier than humid). For humid farms, `message` says weather risk is mostly not about water: wet springs, floods, wind and frost matter more, and most of those aren't modelled. The backtest supports this: Iowa yields barely track the water balance, while Kansas summer crops do (r ≈ 0.8–0.9).

## Fallow and the water score (FAO-56 bare-soil evaporation)

Fallow isn't free on water: bare soil evaporates. With daily weather, fallow follows FAO-56 Ch. 11 for non-growing periods. That is the Ch. 7 evaporation balance with Kcb = Kc min = 0:

```
Ke = Kr × Kc max,  Kc max = 1.2 (eq. 72 with h = 0)
Kr = 1 while De ≤ REW, else (TEW − De)/(TEW − REW)          (eq. 74)
De = De − rain + E, within 0..TEW                            (eqs. 77, 78)
REW/TEW: FAO-56 Table 19 midpoints for the field's texture (sand 4.5/9, loam 9/19, silt 9.5/24, clay 10/25.5 mm)
```

Fallow is scored over the same May–Sep window as summer crops. The surface starts dry; runoff and frozen-soil effects are ignored.

**The dryland water score is now water used**, in inches: crop ET, or bare-soil evaporation for fallow. The shortfall is no longer used, because it already lowers yield and would be counted twice. Irrigated farms are still scored on irrigation applied.

**Without daily weather,** fallow gets FAO-56's dry bare-soil minimum (Kc 0.15). That is a lower bound, and it's flagged.

**Result.** With NASA POWER weather, neutral priorities on an Iowa farm after soy–soy no longer choose fallow; fallow appears only when the water slider is high. With the no-weather fallback it can still appear.

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
| `EQUIPMENT_NEEDED` | alfalfa: hay; cotton: picker | Equipment exclusions |
| `DRAINAGE_SUBOPTIMAL_FACTOR` | 0.9 | **Unsourced magnitude** |
| `COVER_CROP_ID` / `COVER_CROP_MONTHS` | cereal-rye / 7 | Cover slot; bare months filled |
| `CALIBRATION_PRIOR_SD` / `CALIBRATION_OBS_SD` | 0.15 / 0.20 | Field calibration shrinkage |
| `CALIBRATION_EXCLUDED_EVENTS` | hail, flood, replant | One-off seasons not learned from |
| `SWITCHING_PENALTY_WEIGHT` | 0.05 | Re-planning stability |
| `FREEZE_DAMAGE_FACTORS`, `WHEAT_GDD_STAGES` (`croptraits.ts`) | ranges above | Freeze damage (unsourced design); stage mapping (design) |
| `SCARCITY_CURVE` (`waterParams.ts`) | 0 at AI 0.65 → 1 at AI 0.20 | Water weight vs aridity (design; anchors are UNEP classes) |

Also:
- `FALLBACK_SEASONS` in `seasons.ts`: summer May–Sep, winter Oct–Jul, perennial uses summer. Used for states without a Handbook 628 row (only IA and KS are entered).
- In `croptraits.ts`: `TILLAGE_SYSTEMS` (which operations each tillage system means) and the season span rule (`plant.activeStart -> harvest.activeEnd`). Both are design.
- The SSURGO → EcoCrop drainage mapping, and the 0.175 m initial root depth (midpoint of FAO-56's 0.15–0.20 m).
- The linear **height ramp** in `shade.ts` (`heightInMonth`): an assumption.
- In `croptraits.ts`: `sensitiveMonths` (winter wheat Apr–Jun) and `requiresBuyer` (dry beans, sunflower, canola). Both are design decisions, not data.

### Placeholders and data to source

| Item | Where | Status |
|---|---|---|
| Season spans for states other than IA and KS | `croptraits.ts` `SEASONS` | Fallback spans used |
| Ky for oats, barley, canola; FAO-56 stage lengths for canola, alfalfa, rye | `waterParams.ts` | Not sourced: these crops don't vary with weather |
| RUSLE C, Kc and biomass for a rye cover crop | `waterParams.ts` | Not sourced |
| Fallow evaporation without daily weather | `waterParams.ts` | Dry bare-soil minimum (lower bound) |
| Frozen soil / snow in the off-season; runoff; capillary rise | `waterBalance.ts` | Not modelled |
| Fallow field operations cost | `cropData.ts` | Shown as $0 (gap) |
| Crop height through the season | `shade.ts` | Linear ramp assumption |
| Dry bean margin | `croptraits.ts` | National yield and US price vs a North Dakota cost: likely overstated |
| Shade tolerance, frost / winter hardiness | `croptraits.ts` | null for every crop |
| Residue factors for canola, sunflower, dry beans, cotton, alfalfa | `soilData.ts` | Not sourced |
| Alfalfa establishment-year yield | `constants.ts` | Not sourced (alfalfa is not recommended until then; its ISU cost is in) |
| Rye height and roots; fallow field-operation costs | `croptraits.ts` | Not sourced |
| Magnitudes of the pest-repeat and white-mold penalties | `constants.ts` | Unsourced design values |
| Legume N credits to wheat and sorghum | — | Not modelled (corn only) |
| Corn/soy price correlation; 10+ years of prices for σ | — | Not modelled / 3 years only |
| State/county yields instead of national | `croptraits.ts` | National only |

See also `DATA_GAPS` in `croptraits.ts`.
