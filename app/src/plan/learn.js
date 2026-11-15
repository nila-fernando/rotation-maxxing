// Learning from the farmer's season reports (src/plan/seasons.js), for the planner worker: the reports
// are replayed season by season on the farm as it stood before them (the planner's updateAfterSeason),
// each with that season's real weather when it can be had. What comes out is each field's learned
// yield factor per crop, the observed seasons as weather years, and the planner's log and notes.
//
//   const learned = await learnFrom({ farmBefore, reports }, poolScenarios, cropIds, dailyFor)
//     dailyFor(season) -> Promise<DailyWeather | null>: the season and the year before, at the farm
//   const farm = tuned(farmNow, learned)      the farm to plan, with the fields' learned factors
//
// Pure apart from dailyFor (the worker fetches NASA POWER; the tests hand in the bundled record).

import { createFarmState, updateAfterSeason } from '../vendor/rotation-maxxing/algorithm/update.ts';
import { scenariosFromDailyWeather } from '../vendor/rotation-maxxing/algorithm/climate.ts';

export async function learnFrom(learn, poolScenarios, cropIds, dailyFor) {
  const reports = (learn?.reports || []).filter((r) => r.paddocks?.length);
  if (!reports.length || !learn.farmBefore) return null;
  let state = createFarmState(learn.farmBefore, poolScenarios, reports[0].season);
  const notes = [];
  const observed = [];
  for (const report of reports) {
    const daily = await dailyFor(report.season).catch(() => null);
    let weather = null;
    if (daily) {
      try {
        const res = scenariosFromDailyWeather(state.farm, daily, { crops: cropIds, years: [report.season] });
        weather = res.scenarios.find((s) => String(s.label || '').startsWith(String(report.season))) || null;
      } catch { weather = null; }
    }
    observed.push({ season: report.season, ok: !!weather });
    if (weather) weather = { ...weather, label: `${report.season} (your season, NASA POWER)` };
    const out = updateAfterSeason(state, report, weather ? { weather } : {});
    state = out.state;
    notes.push(...out.notes);
  }
  const calibration = Object.fromEntries(state.farm.paddocks.filter((p) => p.yieldCalibration).map((p) => [p.id, p.yieldCalibration]));
  const weathers = Array.isArray(state.weatherPool) ? state.weatherPool.slice(poolScenarios.length) : [];
  return { calibration, weathers, log: state.log, notes, observed };
}

/** The farm to plan, with what the reports taught each field. */
export function tuned(farm, learned) {
  if (!learned) return farm;
  return { ...farm, paddocks: farm.paddocks.map((p) => (learned.calibration[p.id] ? { ...p, yieldCalibration: learned.calibration[p.id] } : p)) };
}
