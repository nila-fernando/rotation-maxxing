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

## Wheat freeze after the green-up scope fix: 5 Kansas counties (2026-11-15)

**The fix.** The first freeze run flagged January–February nights as "tillering" injury. But C646 Table 1 covers *spring* stages. C646 p. 5: "Spring tillering of wheat in Kansas usually begins during late February and continues through March". So freezes now count only from 1 March, a date derived from that wording.

This flaw was found **during validation**. It is a scope correction, not tuning: the thresholds, damage ranges and bad-year cut-off were not changed. Full tables: `backtest-2026-11-15-greenup.md`.

| County | Set | Hits | Misses | False alarms | Wheat r: water only → + freeze | Mean error | Soils |
|---|---|---|---|---|---|---|---|
| Saline | development | 3 | 0 | 6 | 0.02 → 0.24 | 21% → 22% | sample |
| McPherson | held out (not for this fix†) | 2 | 1 | 6 | 0.00 → 0.18 | 23% → 26% | sample |
| Sumner | new | 3 | 2 | 5 | −0.19 → 0.05 | 30% → 29% | sample |
| Reno | new | 2 | 2 | 7 | 0.02 → 0.18 | 26% → 27% | sample |
| Thomas | new | 1 | 1 | 4 | 0.46 → 0.56 | 22% → 23% | sample |

Before the fix, Saline and McPherson each had 20 false alarms; now they have 6.

† McPherson was held out for the water model, but its false alarms in the first freeze run are part of what led to this fix. So for the freeze fix only **Sumner, Reno and Thomas** are independent tests. Their correlation gains (−0.19 → 0.05, 0.02 → 0.18, 0.46 → 0.56, over about 24 seasons each) are small enough to be noise.

**Without the 2014 tillering events:** 7 hits (not 11), 3 misses, 28 false alarms. Those 4 "hits" all came from 2–3 March tillering flags in a drought year.

**Hits**
- **2007:** detected in every central and southern county: jointing or boot, 17–23 F on 7 April.
- **Also:** 2018 (Saline), 2009 (Sumner), 2004 (Thomas).
- **2014 counts as a hit in four counties,** via a 3 March tillering freeze. 2014 was also a drought year, so that credit may be partly coincidental.

**False alarms (28)** fit the documented limitations rather than a scoring flaw:
- **20 of the 28 are within 3 F of the threshold.** A ~50 km grid-cell *daily* minimum can't tell a brief dip from the **two hours** of exposure C646 assumes.
- **Low spots and the canopy** also differ from the grid-cell air temperature.

**Misses** (2006, 2011, 2015, 2023) are years with no freeze flag at all, and they are drought years. That's the water model's job, not the freeze detector's.

**Overall:** wheat correlation rises in all five counties (by 0.10–0.24); mean error is roughly unchanged (−1 to +3 points).

**Summer crops on the three new counties:** sorghum r = 0.86 / 0.98 / 0.66 (Sumner / Reno / Thomas); soybeans 0.71 / 0.82 / −0.01. Thomas soybeans has little data and is far western.

## Wheat freeze with green-up from warmth: 5 Kansas counties (2026-11-15, after review)

**The fix.** The 1 March date comes from a Kansas sentence in C646. On the Ames, Iowa record it flagged "tillering" freezes in 13 of 24 years while the wheat had only 1–187 growing degrees (dormant). Green-up now also needs **5 days in a row averaging 41 F (5 °C) or more**. That rule is a **design value**, and green-up is still never before 1 March. Thresholds, damage ranges and the bad-year cut-off are unchanged. Full tables: `backtest-2026-11-15-thermal-greenup.md`.

| County | Set | Hits | Misses | False alarms | Wheat r: water only → + freeze | Mean error | Soils |
|---|---|---|---|---|---|---|---|
| Saline | development | 2 | 1 | 2 | 0.02 → 0.23 | 21% → 22% | sample |
| McPherson | held out (not for the freeze fixes) | 1 | 2 | 4 | 0.00 → 0.15 | 23% → 26% | sample |
| Sumner | new | 2 | 3 | 3 | −0.19 → 0.01 | 30% → 30% | sample |
| Reno | new | 1 | 3 | 5 | 0.02 → 0.15 | 26% → 28% | sample |
| Thomas | new | 1 | 1 | 3 | 0.46 → 0.57 | 22% → 22% | sample |

- **No tillering flags remain** in any county. Every flag is now at jointing or later (17–30 F, 23 March to 2 May).
- **Hits 11 → 7, false alarms 28 → 17.** The 4 lost hits are exactly the 2014 tillering ones, so against the run without them, hits are unchanged and false alarms fall by 11.
- **2007 is still detected in all four central and southern counties**, plus 2018 (Saline), 2009 (Sumner) and 2004 (Thomas).
- **Correlation gains are smaller** (by 0.01–0.04 against the 1 March run), because 2014 no longer earns credit. On the three independent counties they stay small (+0.20, +0.13, +0.11), so treat freeze risk as a plausible signal, not a validated one.
- **Ames, Iowa now flags no freezes** in 2001–2024.

**Model frozen (2026-11-15).** No new modelling features after this; remaining limitations are listed in `ALGORITHM.md` and `DATA_GAPS`.

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
