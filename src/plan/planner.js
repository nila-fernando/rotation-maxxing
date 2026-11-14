// The app's door to the rotation planner: builds the planner's inputs from the app's state and runs
// it in a Web Worker (src/plan/planner.worker.js).
//
//   const planner = createPlanner()
//   const { result, weather, gaps, farm } = await planner.plans({ fields, place, profile, county })
//   result: generatePlans' output (see src/vendor/rotation-maxxing/docs/API.md):
//     result.plans.current / .maxProfit / .priority, result.priceOfPriorities, result.exclusions
import { plannerFarm, plannerMarket, plannerPriorities } from './farmInput.js';

export function createPlanner() {
  let worker = null;
  let nextId = 1;
  const waiting = new Map();
  let cache = { key: null, value: null };
  let lastWeather = null; // what the latest plans were made on: evaluate uses the same, so they compare

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./planner.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const w = waiting.get(data.id);
      if (!w) return;
      waiting.delete(data.id);
      if (data.ok) w.resolve(data); else w.reject(new Error(data.error));
    };
    worker.onerror = (e) => {
      for (const w of waiting.values()) w.reject(new Error(e.message || 'The planner stopped unexpectedly.'));
      waiting.clear();
      worker?.terminate();
      worker = null; // a fresh one next time
    };
    return worker;
  }

  function ask(message) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      ensureWorker().postMessage({ ...message, id });
    });
  }

  /**
   * Three plans for the next 3 seasons: keep going, most profit, and the best fit for the farmer's
   * priorities. Repeat calls with the same inputs return the same answer without re-running.
   */
  async function plans({ fields, place, profile, county, firstSeason = null, seed = 1 }) {
    const { farm, gaps } = plannerFarm({ fields, place, profile, firstSeason });
    const priorities = plannerPriorities(profile);
    const market = plannerMarket(county);
    const key = JSON.stringify([farm, priorities, market, seed]);
    if (cache.key === key) return cache.value;
    const reply = await ask({ type: 'plans', farm, priorities, market, demo: !!place?.demo, options: { seed } });
    lastWeather = reply.weather.fallback ? (reply.weather.source === 'none' ? 'none' : 'ames') : null;
    const value = { result: reply.result, weather: reply.weather, gaps: [...gaps, ...reply.weather.gaps], farm, priorities, market };
    // an answer on stand-in weather (NASA POWER unreachable) isn't kept, so the next ask tries again
    cache = reply.weather.fallback ? { key: null, value: null } : { key, value };
    return value;
  }

  /** Scores a plan the farmer put together (planner Plan shape: { sequences: { id: [{ main, cover? }] } }). */
  async function evaluate({ fields, place, profile, county, plan, firstSeason = null, seed = 1 }) {
    const { farm } = plannerFarm({ fields, place, profile, firstSeason });
    const reply = await ask({ type: 'evaluate', farm, plan, priorities: plannerPriorities(profile), market: plannerMarket(county), demo: !!place?.demo, weatherHint: lastWeather, options: { seed } });
    return reply.result;
  }

  function dispose() {
    worker?.terminate();
    worker = null;
    for (const w of waiting.values()) w.reject(new Error('Planner closed.'));
    waiting.clear();
  }

  return { plans, evaluate, dispose };
}
