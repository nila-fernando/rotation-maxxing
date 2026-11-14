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
