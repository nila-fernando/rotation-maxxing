# rotation-maxxing (vendored)

Code copied from https://github.com/nila-fernando/rotation-maxxing (by a Team Sheeeep team member).
Two parts, each pinned to its own commit: the planner, and the soil jar test.

Its own Vitest tests stay in that repo. Don't edit these files here: change them upstream and copy
them again (see the "Updating" notes below), so the two never drift apart. Every guard the app needs
on top of them lives in our own wrappers (src/plan/), never in these files.

## The planner

At commit `7f805d215ad7aa1bc3357cfe634967dc7a1b1c3b` on the `algorithm` branch (PR #3, not merged
into `main` yet). It adds the spring freeze model for winter wheat (`algorithm/frost.ts`, K-State
C646 thresholds) and the farm's weather risk (`weatherRisk`, from the aridity index).

- `algorithm/`: the planner (`src/algorithm` in that repo, top level only), unchanged
- `data/`: its NASA POWER / SSURGO / CropScape adapters (`src/data`), unchanged
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

### Known issues at this commit

- **Green-up on 1 March everywhere.** The freeze count starts on 1 March wherever the farm is (the
  date comes from Kansas), so at Ames it counts cold nights while the wheat is still dormant and
  flags 13 of 24 years at tillering. Manami says so outside Kansas (src/plan/weatherWords.js
  `frostCaveat`) instead of passing the count off as local fact.
- **`freezeU` shares the random stream.** The extra freeze draw in the Monte Carlo uses the same
  seeded stream as everything else, so the totals of plans without any wheat moved too (the demo's
  pick: $407k to $408k). Only the farm totals moved; the crops and every per-field number stayed.
- **Stage ties in the risk sentence.** "fell below the jointing threshold" names the stage seen
  first when two stages tie, not the worst one (and the check is `<=` while the words say "below").

## The soil jar test

At commit `20d9f140e06b70fb1a5c104d218504e64fc15cb5` on `main`: `src/jar-test/jar_test.ts`, copied to `jar-test/jar_test.ts`,
unchanged. It reads a photo of a settled jar of soil and water into layers and a texture class.
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
