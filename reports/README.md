# Backtest reports

`npm run backtest` (needs `NASS_API_KEY` in the environment) compares the model's
weather-driven yield anomalies (NASA POWER + SSURGO through the FAO-56 water
balance) with USDA NASS QuickStats county yields, detrended linearly, 2001-2024.

| County / crop | r (baseline -> root depth) | Mean abs. error | Model spread vs actual (sd) |
|---|---|---|---|
| Story IA / corn | 0.23 -> 0.20 | 18% -> 16% | 0.21 -> 0.18 vs 0.10 |
| Story IA / soybeans | 0.06 -> 0.02 | 15% -> 14% | 0.15 -> 0.13 vs 0.11 |
| Saline KS / winter wheat | 0.01 -> 0.02 | 22% -> 21% | 0.21 -> 0.21 vs 0.21 |
| Saline KS / sorghum | 0.89 -> 0.88 | 14% -> 15% | 0.15 -> 0.14 vs 0.29 |
| Saline KS / soybeans | 0.87 -> 0.87 | 15% -> 15% | 0.17 -> 0.16 vs 0.32 |

## Cropland soil sampling and held-out counties

Each county is run two ways:
- **point:** SSURGO at the county centroid
- **sample:** 15 seeded random points on CDL 2020 corn/soy/wheat/sorghum pixels, which makes the soil average area-weighted over cropland

Boone IA and McPherson KS are held out: never used while building the model. See `backtest-2026-11-14-sampled.md` for the full tables.

| County / crop | r point → sample | Error point → sample | Spread model / actual |
|---|---|---|---|
| Story IA / corn | 0.20 → 0.21 | 16% → 17% | 0.18 / 0.10 |
| Boone IA* / corn | 0.31 → 0.32 | 20% → 15% | 0.24 → 0.18 / 0.09 |
| Boone IA* / soybeans | 0.17 → 0.14 | 15% → 14% | 0.16 → 0.13 / 0.11 |
| Saline KS / sorghum | 0.88 → 0.88 | 15% | 0.14 / 0.29 |
| McPherson KS* / sorghum | 0.83 → 0.85 | 16% → 15% | 0.12 → 0.14 / 0.28 |
| McPherson KS* / soybeans | 0.76 → 0.78 | 12% | 0.16 → 0.17 / 0.23 |
| Saline / McPherson* wheat | ≈ 0 | 21–23% | 2007: 0.35 / 0.29 actual vs ≈ 1.3 model (freeze) |

**What sampling showed**
- **It helps when the centroid lands on an unrepresentative soil.** Boone's centroid is a sandy Cylinder loam (water-holding capacity 0.11) on cropland that is mostly Canisteo and Clarion (0.18).
- **Kansas summer-crop skill holds on the held-out county** (r ≈ 0.8).
- **Iowa fails on typical upland cropland too** (Clarion, Nicollet, Canisteo). So the earlier "bottomland water table" explanation was wrong, or a minor factor. Iowa is humid (aridity index 0.90), and its bad years are mostly not drought: 2008 floods, a wet 2013 spring, the August 2020 derecho. Meanwhile the model caps every unstressed year at the same multiplier.

## Wheat freeze model (2026-11-15)

The damage ranges and the "bad year" threshold (< 0.8 of trend) were fixed before this run. Full tables: `backtest-2026-11-15-freeze.md`.

**(a) Detection, sourced parts only**

| County | Hits | Misses | False alarms |
|---|---|---|---|
| Saline | 3 | 0 | 20 |
| McPherson* | 3 | 0 | 20 |

- Almost every false alarm is a **January–February night below 12 F counted as "tillering"**. C646's thresholds are for *spring* growth stages, after the wheat breaks winter dormancy, and counting from 1 January treats dormant wheat as tillering. This is a flaw in the design, not in the data.
- **Jointing-or-later events:**
  - Saline: 2007 (17 F, actual 0.35), 2013 (22 F, 1.22), 2018 (22 F, 0.71), 2020 (24 F, 1.05)
  - McPherson: 2005 heading (30 F, 1.08), 2006 (21 F, 0.99), 2007 (17 F, 0.29), 2013 (22 F, 1.21), 2018 (23 F, 0.91)
- **2007 is detected in both counties.**

**(b) Correlation and error, point soils, before → after**

| County | r | Mean error | 2007 model (actual) |
|---|---|---|---|
| Saline wheat | 0.02 → 0.19 | 21% → 23% | 1.31 → 0.89 (0.35) |
| McPherson* wheat | 0.03 → 0.13 | 22% → 26% | 1.27 → 0.85 (0.29) |

The correlation improves, mainly from 2007, but the error gets worse because of the midwinter false alarms.

**Reading this**

**Kansas summer crops: the model tracks the dry years well** (r ≈ 0.9), but its swings are about half the real ones.

**Iowa: too drought-sensitive.**
- The model's swings are about 2x the real ones, and 2012 corn comes out at 0.52 vs 0.88 actual.
- Using the deeper FAO-56 root depth helped only slightly.
- Likely cause: the Story County point is bottomland ("occasionally flooded" Coland clay loam) with a shallow water table that feeds crops in dry years. The model has no capillary rise.
- The model also caps every non-stressed year at the same multiplier, which inflates its spread.

**Kansas winter wheat isn't water-limited in its worst years.** 2007 was 35% of trend, consistent with the widely reported April 2007 freeze, which the model can't see. Iowa 2008 and 2010 look like wet years; excess water isn't modelled either.

**Next candidates (not done)**
- Shallow water table / capillary rise from SSURGO water-table depth
- Freeze risk from NASA POWER minimum temperatures
- An empirical amplitude calibration across many counties, not just two
