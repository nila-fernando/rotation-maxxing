_Run 2026-11-15 with the wheat freeze model (damage ranges fixed before this run). CropScape did not answer for Story, Boone and Saline during this run, so their 'sample' rows are empty; point-mode rows are valid. Bad wheat year = actual < 0.8 of trend (fixed before the run)._


# Backtest: NASA POWER water balance vs county yields (2001-2024)

## Summary (* = held-out county)

| County | Crop | Soils | r | Mean abs. error | Spread model / actual | Worst real year (actual / model) |
|---|---|---|---|---|---|---|
| Story County | corn | point | 0.20 | 16% | 0.18 / 0.10 | 2013: 0.76 / 0.78 |
| Story County | corn | sample | too few years (0) | | | |
| Story County | soybeans | point | 0.02 | 14% | 0.13 / 0.11 | 2003: 0.71 / 0.92 |
| Story County | soybeans | sample | too few years (0) | | | |
| Boone County * | corn | point | 0.31 | 20% | 0.24 / 0.09 | 2012: 0.80 / 0.46 |
| Boone County | corn | sample | too few years (0) | | | |
| Boone County * | soybeans | point | 0.17 | 15% | 0.16 / 0.11 | 2003: 0.79 / 0.87 |
| Boone County | soybeans | sample | too few years (0) | | | |
| Saline County | winter-wheat | point | 0.02 | 21% | 0.21 / 0.21 | 2007: 0.35 / 1.31 |
| Saline County | winter-wheat | sample | too few years (0) | | | |
| Saline County | winter-wheat+freeze | point | 0.19 | 23% | 0.19 / 0.21 | 2007: 0.35 / 0.89 |
| Saline County | winter-wheat+freeze | sample | too few years (0) | | | |
| Saline County | sorghum | point | 0.88 | 15% | 0.14 / 0.29 | 2002: 0.53 / 0.76 |
| Saline County | sorghum | sample | too few years (0) | | | |
| Saline County | soybeans | point | 0.87 | 15% | 0.17 / 0.32 | 2023: 0.42 / 0.83 |
| Saline County | soybeans | sample | too few years (0) | | | |
| McPherson County * | winter-wheat | point | 0.03 | 22% | 0.21 / 0.22 | 2007: 0.29 / 1.27 |
| McPherson County * | winter-wheat | sample | 0.01 | 23% | 0.21 / 0.22 | 2007: 0.29 / 1.31 |
| McPherson County * | winter-wheat+freeze | point | 0.13 | 26% | 0.22 / 0.22 | 2007: 0.29 / 0.85 |
| McPherson County * | winter-wheat+freeze | sample | 0.12 | 26% | 0.23 / 0.22 | 2007: 0.29 / 0.88 |
| McPherson County * | sorghum | point | 0.83 | 16% | 0.12 / 0.28 | 2011: 0.41 / 0.82 |
| McPherson County * | sorghum | sample | 0.85 | 15% | 0.13 / 0.28 | 2011: 0.41 / 0.78 |
| McPherson County * | soybeans | point | 0.76 | 12% | 0.16 / 0.23 | 2022: 0.52 / 0.80 |
| McPherson County * | soybeans | sample | 0.77 | 12% | 0.17 / 0.23 | 2022: 0.52 / 0.79 |

## Wheat freeze detection (K-State C646 thresholds, NASA POWER Tmin)

**Saline County**: 3 hits, 0 misses, 20 false alarms (bad year = actual < 0.8 of trend).

| Year | Freeze flagged | Stage | Min temp (F) / threshold | Date | Actual / trend | Outcome |
|---|---|---|---|---|---|---|
| 2001 | yes | tillering | -9 / 12 | 2001-02-10 | 0.99 | false alarm |
| 2002 | yes | tillering | 5 / 12 | 2002-02-01 | 0.87 | false alarm |
| 2003 | yes | tillering | 2 / 12 | 2003-01-23 | 1.45 | false alarm |
| 2004 | yes | tillering | -3 / 12 | 2004-02-07 | 1.12 | false alarm |
| 2005 | yes | tillering | -8 / 12 | 2005-01-14 | 0.98 | false alarm |
| 2006 | yes | tillering | 5 / 12 | 2006-02-18 | 1.03 | false alarm |
| 2007 | yes | jointing | 17 / 24 | 2007-04-07 | 0.35 | hit |
| 2008 | yes | tillering | -3 / 12 | 2008-01-02 | 1.07 | false alarm |
| 2009 | yes | tillering | 5 / 12 | 2009-01-15 | 1.09 | false alarm |
| 2010 | yes | tillering | -7 / 12 | 2010-01-08 | 0.96 | false alarm |
| 2011 | yes | tillering | -2 / 12 | 2011-02-02 | 1.01 | false alarm |
| 2012 | yes | tillering | 8 / 12 | 2012-02-11 | 1.04 | false alarm |
| 2013 | yes | jointing | 22 / 24 | 2013-04-24 | 1.22 | false alarm |
| 2014 | yes | tillering | -7 / 12 | 2014-01-06 | 0.68 | hit |
| 2015 | yes | tillering | 0 / 12 | 2015-02-02 | 0.89 | false alarm |
| 2016 | yes | tillering | 4 / 12 | 2016-01-10 | 1.21 | false alarm |
| 2017 | yes | tillering | 10 / 12 | 2017-01-06 | 1.20 | false alarm |
| 2018 | yes | jointing | 22 / 24 | 2018-04-16 | 0.71 | hit |
| 2019 | yes | tillering | -4 / 12 | 2019-03-04 | 1.02 | false alarm |
| 2020 | yes | jointing | 24 / 24 | 2020-04-13 | 1.05 | false alarm |
| 2021 | yes | tillering | -9 / 12 | 2021-02-15 | 1.13 | false alarm |
| 2022 | yes | tillering | 3 / 12 | 2022-02-23 | 0.86 | false alarm |
| 2023 | yes | tillering | 9 / 12 | 2023-02-24 | 0.87 | false alarm |

**McPherson County**: 3 hits, 0 misses, 20 false alarms (bad year = actual < 0.8 of trend).

| Year | Freeze flagged | Stage | Min temp (F) / threshold | Date | Actual / trend | Outcome |
|---|---|---|---|---|---|---|
| 2001 | yes | tillering | -5 / 12 | 2001-02-10 | 0.92 | false alarm |
| 2002 | yes | tillering | 5 / 12 | 2002-03-03 | 1.00 | false alarm |
| 2003 | yes | tillering | 3 / 12 | 2003-01-23 | 1.27 | false alarm |
| 2004 | yes | tillering | -2 / 12 | 2004-02-07 | 1.06 | false alarm |
| 2005 | yes | heading | 30 / 30 | 2005-05-02 | 1.08 | false alarm |
| 2006 | yes | jointing | 21 / 24 | 2006-03-24 | 0.99 | false alarm |
| 2007 | yes | jointing | 17 / 24 | 2007-04-07 | 0.29 | hit |
| 2008 | yes | tillering | 2 / 12 | 2008-01-02 | 1.21 | false alarm |
| 2009 | yes | tillering | 6 / 12 | 2009-01-15 | 1.08 | false alarm |
| 2010 | yes | tillering | -5 / 12 | 2010-01-08 | 0.89 | false alarm |
| 2011 | yes | tillering | -1 / 12 | 2011-02-02 | 0.96 | false alarm |
| 2012 | yes | tillering | 9 / 12 | 2012-02-12 | 1.08 | false alarm |
| 2013 | yes | jointing | 22 / 24 | 2013-04-24 | 1.21 | false alarm |
| 2014 | yes | tillering | -6 / 12 | 2014-01-06 | 0.66 | hit |
| 2015 | yes | tillering | 6 / 12 | 2015-01-07 | 0.99 | false alarm |
| 2016 | yes | tillering | 4 / 12 | 2016-01-10 | 1.32 | false alarm |
| 2017 | yes | tillering | 11 / 12 | 2017-01-06 | 1.24 | false alarm |
| 2018 | yes | jointing | 23 / 24 | 2018-04-16 | 0.91 | false alarm |
| 2019 | yes | tillering | -1 / 12 | 2019-03-04 | 0.98 | false alarm |
| 2020 | yes | tillering | 8 / 12 | 2020-02-13 | 1.10 | false alarm |
| 2021 | yes | tillering | -8 / 12 | 2021-02-15 | 0.92 | false alarm |
| 2022 | yes | tillering | 3 / 12 | 2022-02-23 | 0.97 | false alarm |
| 2023 | yes | tillering | 9 / 12 | 2023-01-30 | 0.73 | hit |


## Story County, IA

- Point soil (centroid): Webster clay loam, Bemis moraine, 0 to 2 percent slopes (AWC 0.18).
- Cropland sample: 0 points from 150 draws (CDL 2020); mean AWC NaN; 0 map units: .
- Only 0 of 15 cropland points found in 150 draws.

### corn

| Year | Actual / trend | Model (point) | Model (sample) |
|---|---|---|---|
| 2001 | 0.93 | 1.07 |  |
| 2002 | 1.08 | 1.05 |  |
| 2003 | 1.00 | 0.85 |  |
| 2004 | 1.13 | 1.16 |  |
| 2005 | 1.11 | 0.89 |  |
| 2006 | 1.08 | 0.84 |  |
| 2007 | 1.05 | 1.15 |  |
| 2008 | 0.92 | 1.18 |  |
| 2009 | 1.00 | 1.17 |  |
| 2010 | 0.93 | 1.18 |  |
| 2011 | 0.92 | 1.06 |  |
| 2012 | 0.88 | 0.53 |  |
| 2013 | 0.76 | 0.78 |  |
| 2014 | 0.93 | 1.18 |  |
| 2015 | 1.02 | 1.18 |  |
| 2016 | 1.14 | 1.18 |  |
| 2017 | 1.07 | 0.85 |  |
| 2018 | 1.02 | 1.18 |  |
| 2019 | 0.99 | 1.17 |  |
| 2020 | 0.77 | 0.91 |  |
| 2021 | 1.04 | 0.78 |  |
| 2022 | 1.06 | 0.86 |  |
| 2023 | 1.07 | 0.82 |  |
| 2024 | 1.08 | 1.07 |  |

### soybeans

| Year | Actual / trend | Model (point) | Model (sample) |
|---|---|---|---|
| 2001 | 0.98 | 1.02 |  |
| 2002 | 1.05 | 1.01 |  |
| 2003 | 0.71 | 0.92 |  |
| 2004 | 1.09 | 1.13 |  |
| 2005 | 1.26 | 0.91 |  |
| 2006 | 1.09 | 0.88 |  |
| 2007 | 1.13 | 1.07 |  |
| 2008 | 0.96 | 1.15 |  |
| 2009 | 1.06 | 1.12 |  |
| 2010 | 0.97 | 1.15 |  |
| 2011 | 1.02 | 1.03 |  |
| 2012 | 0.95 | 0.67 |  |
| 2013 | 0.77 | 0.84 |  |
| 2014 | 0.88 | 1.15 |  |
| 2015 | 0.95 | 1.15 |  |
| 2016 | 1.07 | 1.15 |  |
| 2017 | 1.05 | 0.85 |  |
| 2018 | 0.94 | 1.12 |  |
| 2019 | 0.88 | 1.10 |  |
| 2020 | 0.91 | 0.90 |  |
| 2021 | 1.09 | 0.85 |  |
| 2022 | 1.02 | 0.89 |  |
| 2023 | 1.08 | 0.88 |  |
| 2024 | 1.05 | 1.09 |  |

## Boone County, IA (held out)

- Point soil (centroid): Cylinder loam, 0 to 2 percent slopes (AWC 0.11).
- Cropland sample: 0 points from 150 draws (CDL 2020); mean AWC NaN; 0 map units: .
- Only 0 of 15 cropland points found in 150 draws.

### corn

| Year | Actual / trend | Model (point) | Model (sample) |
|---|---|---|---|
| 2001 | 0.94 | 1.03 |  |
| 2002 | 1.04 | 1.06 |  |
| 2003 | 1.02 | 0.80 |  |
| 2004 | 1.14 | 1.20 |  |
| 2005 | 1.13 | 0.84 |  |
| 2006 | 1.00 | 0.86 |  |
| 2007 | 1.05 | 1.13 |  |
| 2008 | 0.94 | 1.31 |  |
| 2009 | 1.03 | 1.19 |  |
| 2010 | 0.91 | 1.32 |  |
| 2011 | 1.01 | 0.97 |  |
| 2012 | 0.80 | 0.46 |  |
| 2013 | 0.83 | 0.65 |  |
| 2014 | 0.97 | 1.29 |  |
| 2015 | 1.02 | 1.32 |  |
| 2016 | 1.10 | 1.32 |  |
| 2017 | 1.00 | 0.73 |  |
| 2018 | 1.00 | 1.20 |  |
| 2019 | 1.00 | 1.16 |  |
| 2020 | 0.81 | 0.80 |  |
| 2021 | 1.05 | 0.76 |  |
| 2022 | 1.01 | 0.78 |  |
| 2023 | 1.12 | 0.78 |  |
| 2024 | 1.06 | 1.08 |  |

### soybeans

| Year | Actual / trend | Model (point) | Model (sample) |
|---|---|---|---|
| 2001 | 0.94 | 0.99 |  |
| 2002 | 1.10 | 1.03 |  |
| 2003 | 0.79 | 0.87 |  |
| 2004 | 1.15 | 1.14 |  |
| 2005 | 1.22 | 0.90 |  |
| 2006 | 1.07 | 0.92 |  |
| 2007 | 1.14 | 1.05 |  |
| 2008 | 0.91 | 1.21 |  |
| 2009 | 1.05 | 1.11 |  |
| 2010 | 0.93 | 1.25 |  |
| 2011 | 1.00 | 0.99 |  |
| 2012 | 0.88 | 0.67 |  |
| 2013 | 0.79 | 0.76 |  |
| 2014 | 0.93 | 1.19 |  |
| 2015 | 0.98 | 1.25 |  |
| 2016 | 1.08 | 1.21 |  |
| 2017 | 1.01 | 0.80 |  |
| 2018 | 0.95 | 1.12 |  |
| 2019 | 0.92 | 1.08 |  |
| 2020 | 0.86 | 0.85 |  |
| 2021 | 1.08 | 0.85 |  |
| 2022 | 1.00 | 0.85 |  |
| 2023 | 1.12 | 0.85 |  |
| 2024 | 1.06 | 1.08 |  |

## Saline County, KS

- Point soil (centroid): Crete silt loam, 3 to 7 percent slopes (AWC 0.18).
- Cropland sample: 0 points from 150 draws (CDL 2020); mean AWC NaN; 0 map units: .
- Only 0 of 15 cropland points found in 150 draws.

### winter-wheat

| Year | Actual / trend | Model (point) | Model (sample) |
|---|---|---|---|
| 2001 | 0.99 | 0.97 |  |
| 2002 | 0.87 | 0.71 |  |
| 2003 | 1.45 | 0.91 |  |
| 2004 | 1.12 | 1.19 |  |
| 2005 | 0.98 | 1.11 |  |
| 2006 | 1.03 | 0.77 |  |
| 2007 | 0.35 | 1.31 |  |
| 2008 | 1.07 | 1.23 |  |
| 2009 | 1.09 | 1.17 |  |
| 2010 | 0.96 | 1.29 |  |
| 2011 | 1.01 | 0.89 |  |
| 2012 | 1.04 | 0.64 |  |
| 2013 | 1.22 | 0.91 |  |
| 2014 | 0.68 | 0.90 |  |
| 2015 | 0.89 | 1.13 |  |
| 2016 | 1.21 | 1.12 |  |
| 2017 | 1.20 | 1.08 |  |
| 2018 | 0.71 | 0.67 |  |
| 2019 | 1.02 | 1.33 |  |
| 2020 | 1.05 | 1.16 |  |
| 2021 | 1.13 | 1.05 |  |
| 2022 | 0.86 | 0.88 |  |
| 2023 | 0.87 | 0.74 |  |

### winter-wheat+freeze

| Year | Actual / trend | Model (point) | Model (sample) |
|---|---|---|---|
| 2001 | 0.99 | 0.88 |  |
| 2002 | 0.87 | 0.64 |  |
| 2003 | 1.45 | 0.82 |  |
| 2004 | 1.12 | 1.07 |  |
| 2005 | 0.98 | 1.00 |  |
| 2006 | 1.03 | 0.69 |  |
| 2007 | 0.35 | 0.89 |  |
| 2008 | 1.07 | 1.10 |  |
| 2009 | 1.09 | 1.05 |  |
| 2010 | 0.96 | 1.16 |  |
| 2011 | 1.01 | 0.80 |  |
| 2012 | 1.04 | 0.58 |  |
| 2013 | 1.22 | 0.61 |  |
| 2014 | 0.68 | 0.81 |  |
| 2015 | 0.89 | 1.02 |  |
| 2016 | 1.21 | 1.01 |  |
| 2017 | 1.20 | 0.97 |  |
| 2018 | 0.71 | 0.46 |  |
| 2019 | 1.02 | 1.20 |  |
| 2020 | 1.05 | 0.78 |  |
| 2021 | 1.13 | 0.94 |  |
| 2022 | 0.86 | 0.79 |  |
| 2023 | 0.87 | 0.67 |  |

### sorghum

| Year | Actual / trend | Model (point) | Model (sample) |
|---|---|---|---|
| 2001 | 0.97 | 0.92 |  |
| 2002 | 0.53 | 0.76 |  |
| 2003 | 0.66 | 0.85 |  |
| 2004 | 1.43 | 1.15 |  |
| 2005 | 1.05 | 1.05 |  |
| 2006 | 0.88 | 0.92 |  |
| 2007 | 1.26 | 1.16 |  |
| 2008 | 1.23 | 1.16 |  |
| 2009 | 1.52 | 1.16 |  |
| 2010 | 1.02 | 1.13 |  |
| 2011 | 0.56 | 0.92 |  |
| 2012 | 0.62 | 0.72 |  |
| 2013 | 1.24 | 1.04 |  |
| 2014 | 0.95 | 0.99 |  |
| 2015 | 1.30 | 1.07 |  |
| 2017 | 0.77 | 0.95 |  |
| 2020 | 1.15 | 1.16 |  |
| 2024 | 0.84 | 0.92 |  |

### soybeans

| Year | Actual / trend | Model (point) | Model (sample) |
|---|---|---|---|
| 2001 | 1.09 | 0.92 |  |
| 2002 | 0.70 | 0.75 |  |
| 2003 | 0.59 | 0.86 |  |
| 2004 | 1.17 | 1.14 |  |
| 2005 | 0.90 | 1.02 |  |
| 2006 | 0.93 | 0.95 |  |
| 2007 | 1.10 | 1.10 |  |
| 2008 | 1.35 | 1.26 |  |
| 2009 | 1.65 | 1.21 |  |
| 2010 | 0.99 | 1.11 |  |
| 2011 | 0.53 | 0.87 |  |
| 2012 | 0.66 | 0.72 |  |
| 2013 | 1.22 | 1.11 |  |
| 2014 | 0.90 | 0.95 |  |
| 2015 | 1.16 | 1.01 |  |
| 2016 | 1.39 | 1.22 |  |
| 2017 | 0.73 | 0.85 |  |
| 2019 | 1.38 | 1.30 |  |
| 2020 | 1.25 | 1.21 |  |
| 2021 | 1.08 | 0.94 |  |
| 2022 | 0.62 | 0.84 |  |
| 2023 | 0.42 | 0.83 |  |
| 2024 | 0.63 | 0.90 |  |

## McPherson County, KS (held out)

- Point soil (centroid): Tobin silt loam, occasionally flooded (AWC 0.21).
- Cropland sample: 15 points from 87 draws (CDL 2020); mean AWC 0.18; 8 map units: Crete silt loam, 0 to 1 percent slopes, loess plains and breaks (4); Smolan silty clay loam, 1 to 3 percent slopes (3); Crete silt loam, 1 to 3 percent slopes, loess plains and breaks (2); Ladysmith silty clay loam, 0 to 1 percent slopes (2); Irwin silty clay loam, 1 to 3 percent slopes (1).

### winter-wheat

| Year | Actual / trend | Model (point) | Model (sample) |
|---|---|---|---|
| 2001 | 0.92 | 0.95 | 0.95 |
| 2002 | 1.00 | 0.76 | 0.75 |
| 2003 | 1.27 | 0.96 | 0.95 |
| 2004 | 1.06 | 1.19 | 1.22 |
| 2005 | 1.08 | 1.16 | 1.16 |
| 2006 | 0.99 | 0.76 | 0.74 |
| 2007 | 0.29 | 1.27 | 1.31 |
| 2008 | 1.21 | 1.24 | 1.25 |
| 2009 | 1.08 | 1.25 | 1.25 |
| 2010 | 0.89 | 1.20 | 1.20 |
| 2011 | 0.96 | 0.70 | 0.68 |
| 2012 | 1.08 | 0.66 | 0.65 |
| 2013 | 1.21 | 0.87 | 0.89 |
| 2014 | 0.66 | 0.98 | 0.95 |
| 2015 | 0.99 | 1.10 | 1.12 |
| 2016 | 1.32 | 1.16 | 1.16 |
| 2017 | 1.24 | 1.09 | 1.08 |
| 2018 | 0.91 | 0.67 | 0.66 |
| 2019 | 0.98 | 1.28 | 1.32 |
| 2020 | 1.10 | 1.15 | 1.14 |
| 2021 | 0.92 | 1.03 | 1.02 |
| 2022 | 0.97 | 0.90 | 0.89 |
| 2023 | 0.73 | 0.74 | 0.75 |

### winter-wheat+freeze

| Year | Actual / trend | Model (point) | Model (sample) |
|---|---|---|---|
| 2001 | 0.92 | 0.86 | 0.85 |
| 2002 | 1.00 | 0.68 | 0.68 |
| 2003 | 1.27 | 0.86 | 0.86 |
| 2004 | 1.06 | 1.08 | 1.10 |
| 2005 | 1.08 | 0.47 | 0.46 |
| 2006 | 0.99 | 0.51 | 0.50 |
| 2007 | 0.29 | 0.85 | 0.88 |
| 2008 | 1.21 | 1.12 | 1.12 |
| 2009 | 1.08 | 1.12 | 1.13 |
| 2010 | 0.89 | 1.08 | 1.08 |
| 2011 | 0.96 | 0.63 | 0.61 |
| 2012 | 1.08 | 0.59 | 0.58 |
| 2013 | 1.21 | 0.59 | 0.60 |
| 2014 | 0.66 | 0.88 | 0.86 |
| 2015 | 0.99 | 0.99 | 1.01 |
| 2016 | 1.32 | 1.05 | 1.05 |
| 2017 | 1.24 | 0.98 | 0.97 |
| 2018 | 0.91 | 0.45 | 0.45 |
| 2019 | 0.98 | 1.15 | 1.19 |
| 2020 | 1.10 | 1.04 | 1.03 |
| 2021 | 0.92 | 0.93 | 0.92 |
| 2022 | 0.97 | 0.81 | 0.80 |
| 2023 | 0.73 | 0.67 | 0.67 |

### sorghum

| Year | Actual / trend | Model (point) | Model (sample) |
|---|---|---|---|
| 2001 | 0.88 | 0.92 | 0.90 |
| 2002 | 0.78 | 0.84 | 0.84 |
| 2003 | 0.67 | 0.91 | 0.89 |
| 2004 | 1.47 | 1.14 | 1.17 |
| 2005 | 1.13 | 1.08 | 1.07 |
| 2006 | 0.66 | 0.91 | 0.90 |
| 2007 | 1.25 | 1.14 | 1.16 |
| 2008 | 1.33 | 1.14 | 1.17 |
| 2009 | 1.30 | 1.14 | 1.17 |
| 2010 | 1.01 | 1.09 | 1.08 |
| 2011 | 0.41 | 0.82 | 0.78 |
| 2012 | 0.59 | 0.71 | 0.71 |
| 2013 | 1.13 | 1.01 | 1.05 |
| 2014 | 1.22 | 1.06 | 1.03 |
| 2015 | 1.29 | 1.05 | 1.05 |
| 2016 | 0.92 | 1.14 | 1.17 |
| 2017 | 0.93 | 1.00 | 0.97 |
| 2018 | 1.24 | 1.00 | 1.03 |
| 2020 | 1.09 | 1.11 | 1.13 |
| 2021 | 1.15 | 1.01 | 0.99 |
| 2022 | 0.55 | 0.89 | 0.85 |
| 2024 | 0.97 | 0.93 | 0.93 |

### soybeans

| Year | Actual / trend | Model (point) | Model (sample) |
|---|---|---|---|
| 2001 | 0.91 | 0.89 | 0.89 |
| 2002 | 0.97 | 0.83 | 0.83 |
| 2003 | 0.85 | 0.88 | 0.87 |
| 2004 | 1.30 | 1.19 | 1.19 |
| 2005 | 1.00 | 1.05 | 1.04 |
| 2006 | 0.94 | 0.92 | 0.93 |
| 2007 | 0.94 | 1.14 | 1.13 |
| 2008 | 1.15 | 1.25 | 1.26 |
| 2009 | 1.32 | 1.20 | 1.21 |
| 2010 | 0.97 | 1.05 | 1.05 |
| 2011 | 0.62 | 0.76 | 0.75 |
| 2012 | 0.70 | 0.71 | 0.72 |
| 2013 | 0.98 | 1.13 | 1.15 |
| 2014 | 1.09 | 1.00 | 0.98 |
| 2015 | 1.04 | 1.01 | 1.00 |
| 2016 | 1.37 | 1.28 | 1.30 |
| 2017 | 0.89 | 0.87 | 0.84 |
| 2018 | 1.38 | 1.07 | 1.11 |
| 2019 | 1.07 | 1.26 | 1.26 |
| 2020 | 0.92 | 1.10 | 1.10 |
| 2021 | 1.05 | 0.97 | 0.96 |
| 2022 | 0.52 | 0.80 | 0.79 |
| 2023 | 0.52 | 0.84 | 0.85 |
| 2024 | 1.08 | 0.92 | 0.93 |

