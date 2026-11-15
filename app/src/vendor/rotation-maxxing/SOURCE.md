# rotation-maxxing (vendored)

Code copied from https://github.com/nila-fernando/rotation-maxxing (by a Team Sheeeep team member).
Two parts, each pinned to its own commit: the planner, and the soil jar test.

Its own Vitest tests stay in that repo. Don't edit these files here: change them upstream and copy
them again (see the "Updating" notes below), so the two never drift apart. Every guard the app needs
on top of them lives in our own wrappers (src/plan/), never in these files.

## The planner

At commit `3b036362be7d78c1794e24eacffb9f3463fc0fdd` on the `algorithm` branch (PR #3). It has the
spring freeze model for winter wheat (`algorithm/frost.ts`, K-State C646 thresholds), now counted
from green-up (a run of warm days, not before 1 March), and the farm's weather risk (`weatherRisk`,
from the aridity index). It also brings NEX-GDDP-CMIP6 climate trends (`algorithm/climateAdjust.ts`,
`data/cmip6.ts`) and NASS county base yields (`data/nassYields.ts`, used by `buildFarm`); the app
uses neither yet (it passes a plain weather pool, and `generatePlans` still takes one).

- `algorithm/`: the planner (`src/algorithm` in that repo, top level only), unchanged
- `data/`: its NASA POWER / SSURGO / CropScape / CMIP6 / NASS adapters (`src/data/*.ts`), unchanged;
  the precomputed site files (`src/data/baseYields/`, `src/data/cmip6/`) are not vendored
- `docs/`: its README, ALGORITHM.md and API.md
- `fixtures/`: its Ames, Iowa test data (NASA POWER daily weather 2000-2024, SSURGO, CDL),
  used here to build the demo farm's weather pool offline (Ames is in Story County, like the demo farm)

### Updating

Pin the commit: a `--depth 1` clone gets `main`, which may not have what the app was built against.

```sh
git clone https://github.com/nila-fernando/rotation-maxxing /tmp/rm && git -C /tmp/rm checkout <sha>
cp /tmp/rm/src/algorithm/*.ts src/vendor/rotation-maxxing/algorithm/
cp /tmp/rm/src/data/*.ts src/vendor/rotation-maxxing/data/
cp /tmp/rm/ALGORITHM.md /tmp/rm/API.md /tmp/rm/README.md src/vendor/rotation-maxxing/docs/
```

Then change the commit above, run `npm test`, and re-pin the Monte Carlo numbers in
src/plan/compareFutures.test.js (the block named "re-pin on re-vendor"). These steps never touch
`jar-test/`.

### Fixed at this commit

The three issues from our review of `7f805d2` are fixed upstream (commit `9065065`, "Fix freeze
review"):

- **Green-up from warmth, not 1 March everywhere.** The freeze count now starts after the first run
  of 5 days with a mean of 41 F or more (a design value), and not before 1 March. At Ames it no
  longer counts nights while the wheat is dormant: the demo's wheat had a freeze in 13 of 24 springs
  at tillering, and now has none. Manami's Kansas caveat (src/plan/weatherWords.js `frostCaveat`)
  no longer says the count may be dormant nights; outside Kansas she still says the rule comes from
  Kansas and to check it locally. The frost tests use a colder copy of the Ames springs
  (test/futuresDemo.mjs `wheatData`) to have a freeze to say.
- **A separate freeze stream.** The Monte Carlo's freeze draws come from their own seeded stream
  (`freezeRngFor`), one per horizon year, so plans without wheat no longer move when the freeze
  model changes. The demo's totals moved once more at this re-vendor (the main stream no longer
  carries a freeze draw) and are re-pinned (current $346k, Manami's pick $407k).
- **Stage ties in the risk sentence.** The typical stage breaks ties by the more severe C646 effect,
  the words say "fell to or below" to match the `<=` check, and the worst freeze's stage is added
  when it differs: "... the tillering threshold (worst: heading)". src/plan/weatherWords.js
  `FREEZE_TERM` reads both the new and the old wording.

## The soil jar test

At commit `20d9f140e06b70fb1a5c104d218504e64fc15cb5` on `main`: `src/jar-test/jar_test.ts`, copied to `jar-test/jar_test.ts`,
unchanged (the file is the same at the planner's `3b03636`). It reads a photo of a settled jar of
soil and water into layers and a texture class.
src/plan/jarTest.js is the only file that imports it.

- `jar_test.html` is not vendored: it drifted from the .ts and uses emoji; the sample painter is
  ported in src/plan/jarSample.js.
- Only its texture (sand and clay %) reaches the planner, through src/plan/farmInput.js. Its
  `toPlannerPayload` is not used: its organic matter is by volume, not the survey's mass %.

### Updating

```sh
git clone https://github.com/nila-fernando/rotation-maxxing /tmp/rm
git -C /tmp/rm show <sha>:src/jar-test/jar_test.ts > src/vendor/rotation-maxxing/jar-test/jar_test.ts
```

Then change the commit above and run `npm test`. The planner copy steps never touch `jar-test/`.
