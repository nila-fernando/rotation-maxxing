# rotation-maxxing (vendored)

The crop-rotation planner, copied from https://github.com/nila-fernando/rotation-maxxing
(by a Team Sheeeep team member) at commit `d0f67dffb5ad5e4dea83028dba415c76c69ab882`.

- `algorithm/`: the planner (`src/algorithm` in that repo), unchanged
- `data/`: its NASA POWER / SSURGO / CropScape adapters (`src/data`), unchanged
- `docs/`: its README, ALGORITHM.md and API.md
- `fixtures/`: its Ames, Iowa test data (NASA POWER daily weather 2000-2024, SSURGO, CDL),
  used here to build the demo farm's weather pool offline (Ames is in Story County, like the demo farm)

Its own Vitest tests stay in that repo. Don't edit these files here: change them upstream and copy
them again (see the "Updating" note below), so the two never drift apart.

## Updating

```sh
gh repo clone nila-fernando/rotation-maxxing /tmp/rm -- --depth 1
cp /tmp/rm/src/algorithm/*.ts src/vendor/rotation-maxxing/algorithm/
cp /tmp/rm/src/data/*.ts src/vendor/rotation-maxxing/data/
```
