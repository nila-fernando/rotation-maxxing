_Run 2026-11-15 after replacing US-average base yields with NASS county base yields (non-irrigated, ratio method). Same farm, soil, weather and seed as `climate-compare-saline.md`._

# Saline County, KS: county base yields, and a sanity check against K-State budgets

## Base yields used (NASS Quick Stats, non-irrigated)

| Crop | Base yield | How |
|---|---|---|
| Corn | 84.3 bu/ac | 2021-2025 all-practice mean 116.9 x 0.721 (county non-irrigated/all ratio, 15 years 2000-2018) |
| Soybeans | 25.0 bu/ac | 2021-2025 mean 27.7 x 0.904 (county, 7 years 2000-2007) |
| Grain sorghum | 69.4 bu/ac | 2017, 2020, 2024 mean (only 3 county years since 2016) x 0.956 (county) |
| Winter wheat | 44.7 bu/ac | 2019-2025 (5 available years) mean x 1.00 (county) |
| Oats | 55.2 bu/ac | KS state, all practices (county series too old) |

Recent county all-practice yields include the 2022-2023 drought (soybeans 19.7 and 13.7 bu/ac). For comparison, the last county non-irrigated corn yields NASS published were 73.1 (2017) and 60.9 (2018).

## Plans (field 1 sequence; expected cash margin over 3 years, 4 x 40 ac)

| Plan | US-average yields (accepted run) | County yields, none | County yields, present |
|---|---|---|---|
| current | sorghum>wheat>soy: $26,234, P10 $6,946 | sorghum>wheat>soy: -$17,136 (-$36/ac/yr), P10 -$29,697 | -$17,572 (-$37/ac/yr), P10 -$31,866 |
| maxProfit | corn>corn>soy: $125,392, P10 $60,507 | **fallow>sorghum>soy**: $1,480 ($3/ac/yr), P10 -$12,651 | $1,778 ($4/ac/yr), P10 -$11,198 |
| priority | soy>corn>soy: $120,678, P10 $64,554 | **fallow>oats>soy**: -$6,999 (-$15/ac/yr), P10 -$15,394 | -$6,553 (-$14/ac/yr), P10 -$15,150 |

Ranks are unchanged by the climate adjustment (3, 2, 1). The corn-heavy plan is gone, but the result is now implausible the other way: fallow wins and the current rotation loses money.

## Sanity check: average-year margin per acre vs K-State dryland budgets

Ours = base yield x US price - US operating cost (ERS 2027 forecast), before soil, rotation and weather factors. K-State = "Returns above direct expenses", middle yields, from the 2027 KSU Farm Management Guide budgets (dated Nov-01-2026), non-irrigated, North Central (NC) and South Central (SC) Kansas. K-State direct expenses include crop insurance, operator labor and operating interest; no government payments.

| Crop | Ours: yield, price, cost -> margin | K-State NC | K-State SC | Ballpark? |
|---|---|---|---|---|
| Corn | 84.3 bu, $4.30, $506 -> **-$143** | 120 bu, $4.72, $370.44 -> **$195.96** | 110 bu, $4.81, $333.30 -> **$195.80** | No: $340 low |
| Grain sorghum | 69.4 bu, $4.21, $204 -> **$89** | 120 bu, $4.83, $261.49 -> **$318.11** | 110 bu, $4.71, $228.76 -> **$289.34** | No: $200-230 low |
| Wheat | 44.7 bu, $5.61, $183 -> **$68** | continuous 37 bu, $7.09, $229.19 -> **$33.14**; rotation 62 bu -> **$198.57** | continuous 37 bu, $7.19, $215.74 -> **$50.29** | Yes vs continuous; low vs rotation |
| Soybeans | 25.0 bu, $10.87, $274 -> **-$2** | 45 bu, $12.38, $220.29 -> **$336.81** | 40 bu, $12.49, $198.24 -> **$301.36** | No: $300-340 low |

**Where the gap comes from** (vs NC, in $/ac):

| Crop | Yield | Price | Cost |
|---|---|---|---|
| Corn | -$168 (35.7 bu fewer) | -$35 | -$136 (US cost $506 vs $370) |
| Sorghum | -$244 (50.6 bu fewer) | -$43 | +$57 (ours lower) |
| Soybeans | -$248 (20 bu fewer) | -$38 | -$54 |

So:
1. **Yields:** NASS county averages (including two drought years) sit well below K-State's planning "middle yields". Ours are what was actually harvested on average in Saline County; K-State's are budget assumptions. Neither is wrong, but they answer different questions.
2. **Costs:** the ERS US-total corn cost ($506) is far above dryland Kansas ($333-370). Soybeans too ($274 vs $198-220).
3. **Prices:** US 2023-2025 marketing-year averages are $0.4-1.6/bu below K-State's 2027 projections.

**Not in this table, but in the plans:** SSURGO gives the Crete silt loam at the county centroid a surface pH of 5.7. The land-suitability factor then cuts sorghum by 30% and wheat by 60% (FAO EcoCrop optimum 6-7). With a county base yield, which already reflects typical county soils, that partly double-counts. It is the main reason the current rotation's wheat year earns -$89/ac.

## Sources

- USDA NASS Quick Stats, survey yields (county and state; all practices, non-irrigated, irrigated), retrieved 2026-11-15: https://quickstats.nass.usda.gov/
- Ibendahl, O'Brien, Lancaster, with Shoup (SC) / Duncan (NC): KSU Farm Management Guide 2027 cost-return budgets, non-irrigated, dated Nov-01-2026, agmanager.info (https://agmanager.info/node/34291):
  - Corn, NC: https://agmanager.info/sites/default/files/wysiwyg/Corn%20Cost-Return%20Budget%20in%20North%20Central%20Kansas__Nov-01-2026_1.pdf
  - Corn, SC: https://agmanager.info/sites/default/files/wysiwyg/Corn%20Cost-Return%20Budget%20in%20South%20Central%20Kansas__Nov-01-2026.pdf
  - Grain sorghum, NC: https://agmanager.info/sites/default/files/wysiwyg/Grain%20Sorghum%20Cost-Return%20Budget%20in%20North%20Central%20Kansas__Nov-01-2026_0.pdf
  - Grain sorghum, SC: https://agmanager.info/sites/default/files/wysiwyg/Grain%20Sorghum%20Cost-Return%20Budget%20in%20South%20Central%20Kansas__Nov-01-2026.pdf
  - Wheat (continuous), NC: https://agmanager.info/sites/default/files/wysiwyg/Wheat%20%28Continuous%29%20Cost-Return%20Budget%20in%20North%20Central%20KS__Nov-01-2026.pdf
  - Wheat (rotation), NC: https://agmanager.info/sites/default/files/wysiwyg/Wheat%20%28Rotation%29%20Cost-Return%20Budget%20in%20North%20Central%20KS__Nov-01-2026.pdf
  - Wheat (continuous), SC: https://agmanager.info/sites/default/files/wysiwyg/Wheat%20%28Continuous%29%20Cost-Return%20Budget%20in%20South%20Central%20KS__Nov-01-2026.pdf
  - Soybean, NC: https://agmanager.info/sites/default/files/wysiwyg/Soybean%20Cost-Return%20Budget%20in%20North%20Central%20Kansas__Nov-01-2026.pdf
  - Soybean, SC: https://agmanager.info/sites/default/files/wysiwyg/Soybean%20Cost-Return%20Budget%20in%20South%20Central%20Kansas__Nov-01-2026.pdf
- K-State does not publish a single "central Kansas" budget. Which region (NC or SC) K-State assigns Saline County to was not checked; both are shown.

---

## Full script output (`npm run climate-compare -- saline`)

# Present-climate adjustment: effect on plans (planning season 2027)

## Saline County, KS

Grid cell 38.875, -97.625; soil Crete silt loam, 3 to 7 percent slopes; models MIROC6, MPI-ESM1-2-HR, MRI-ESM2-0, IPSL-CM6A-LR, ACCESS-CM2.

### Base yields and average-year margin per acre (before rotation, soil and weather factors)

| Crop | Base yield | Level, practice | Price | Operating cost | Yield x price - cost |
|---|---|---|---|---|---|
| Winter wheat | 44.7 bu/ac | Saline County, KS (county), non-irrigated (ratio 1.00) | $5.61 | $183 | $68 |
| Grain sorghum | 69.4 bu/ac | Saline County, KS (county), non-irrigated (ratio 0.96) | $4.21 | $204 | $89 |
| Soybeans | 25.0 bu/ac | Saline County, KS (county), non-irrigated (ratio 0.90) | $10.87 | $274 | $-2 |
| Corn (grain) | 84.3 bu/ac | Saline County, KS (county), non-irrigated (ratio 0.72) | $4.30 | $506 | $-143 |
| Oats | 55.2 bu/ac | KS (state), all | $3.49 | $198 | $-5 |

### Shift applied to the oldest pool year (2001 -> 2027), 5-model mean

| Variable | Unit | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tasmax | C | +1.07 | +0.93 | +0.82 | +0.97 | +1.26 | +1.45 | +1.66 | +1.86 | +2.01 | +1.91 | +1.58 | +1.33 |
| tasmin | C | +0.92 | +0.76 | +0.80 | +0.92 | +1.09 | +1.23 | +1.43 | +1.53 | +1.59 | +1.40 | +1.29 | +1.03 |
| pr | % | +10.9* | +7.1* | +11.0 | +10.4 | +5.7* | +1.3* | -7.1* | -11.1 | -12.0 | -12.9 | -5.4* | -3.1* |
| hurs | RH points | -0.51* | -0.44* | -0.33* | -0.40* | -1.18* | -1.74* | -2.70 | -2.93 | -3.24 | -2.77 | -1.83 | -1.00* |
| rsds | % | -0.0* | +0.2* | +0.2* | +0.7* | +1.3 | +1.7 | +1.8 | +2.0 | +2.1 | +1.8 | +0.7* | +0.3* |
| sfcWind | % | -0.4* | +0.1* | -0.5* | -1.0* | -0.3* | -0.1* | +0.4* | +0.1* | +1.4* | +0.9* | -0.0* | -0.8* |

\* = trend smaller than 2x its standard error (likely noise): 32 of 72 month-variable shifts.

### Plans: none vs present

| Plan | Sequence (field 1), none -> present | Expected GM (none) | P10 (none) | Expected GM (present) | P10 (present) | Rank none -> present |
|---|---|---|---|---|---|---|
| current | sorghum>winter-wheat>soybeans -> sorghum>winter-wheat>soybeans | $-17,136 ($-36/ac/yr) | $-29,697 | $-17,572 ($-37/ac/yr) | $-31,866 | 3 -> 3 |
| maxProfit | fallow>sorghum>soybeans -> fallow>sorghum>soybeans | $1,480 ($3/ac/yr) | $-12,651 | $1,778 ($4/ac/yr) | $-11,198 | 2 -> 2 |
| priority | fallow>oats>soybeans -> fallow>oats>soybeans | $-6,999 ($-15/ac/yr) | $-15,394 | $-6,553 ($-14/ac/yr) | $-15,150 | 1 -> 1 |

Explanation shown: "Weather shifted to the model-projected 2027 climate using NASA NEX-GDDP-CMIP6 (5 climate models); older years shifted more. 2001 replayed ~3.0 F warmer in Jul (daily highs, model-projected change)."

