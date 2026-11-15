// Timing checks that hold on a busy or slow machine. node:test runs the test files in parallel, and
// CI runners are slower and shared, so a single run against a tight limit fails now and then for no
// reason in the code (a deploy once failed on 356 ms against a 250 ms limit).
//
//   medianMs(fn, runs)   the middle time of several runs (one slow run from a busy CPU doesn't count)
//   budget(ms)           the limit, scaled by SLACK: 4x on CI, 1.5x locally; TIMING_SLACK overrides
//
// A real slowdown (an accidental O(n^2), say) is still many times over and still fails.

export const SLACK = Number(process.env.TIMING_SLACK) || (process.env.CI ? 4 : 1.5);

/** The median time of `runs` calls of fn(i), in ms. */
export function medianMs(fn, runs = 5) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn(i);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

/** A time limit in ms, scaled for the machine the tests run on. */
export const budget = (ms) => ms * SLACK;
