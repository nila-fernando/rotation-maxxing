# Rotation-Maxxing

A cozy 3D farm-island app (made by Team Sheeeep) for US farmers. Find your farm on the globe, pick your fields from USDA
outlines, answer three quick questions, and your farm appears as an island. "Plan my next seasons"
runs the crop-rotation planner (`src/vendor/rotation-maxxing`), and "See them on the farm" plays
the plans out on the island.

**Try it:** https://nila-fernando.github.io/rotation-maxxing/ (version 0.10.0; what's new is in
[CHANGELOG.md](CHANGELOG.md)).

## Run it on your computer

You need [Node.js](https://nodejs.org) **22.18 or newer** (24 is what we use) and git. Everything
runs without keys except "Plan my next seasons", which needs a free USDA NASS Quick Stats key for
local crops, yields and prices (see [Prices, yields and local crops](#prices-yields-and-local-crops-from-usda-nass-vite_nass_proxy)):

```sh
git clone https://github.com/nila-fernando/rotation-maxxing.git
cd rotation-maxxing/app
npm install
NASS_API_KEY=your-key npm run dev   # or put NASS_API_KEY=your-key in app/.env.local (git-ignored)
```

Then open http://localhost:5173. To pick up later changes, run `git pull` and then `npm install`
again in `app/`.

The app needs the internet for the satellite map, address search, field outlines and the font. The
demo farm's weather and planner run offline, from data in the repo.

## Shortcuts for trying things out

| URL | What it does |
|---|---|
| `http://localhost:5173/` | the full flow: globe, then "Try a demo farm" |
| `?hub=5` | straight to the demo farm's island (5 fields; `?hub=1` or `?hub=15` for 1 or 15) |
| `?hub=5&futures=1` | straight into "See them on the farm", with Manami's walk |
| `?hub=5&futures=explore` | the same, without the walk |
| `?hub=5&futures=1&nocrops=soybeans` | the same on a farm that can't grow soybeans: Manami's pick sows winter wheat, so you see spring freeze risk on the farm |
| `&hour=21.5` | a time of day (21.5 is 9:30 pm) |
| `&today=2026-12-24` | a date, for the season and festival on the island |
| `?demo=land` | lands on the demo farm at once, to pick fields yourself |
| `&tour=1` / `&tour=0` | always / never start Manami's tour of the hub (it starts by itself only the first time; the ? on Your fields plays it again) |

To try the soil jar test, open a field on `?hub=5` (West 140, say), then "Try a jar test" in its
check-up (or "Test your soil" under the field list), and "Try a sample jar". "Use for West 140"
puts the jar by the field's gate on the island; tap it to see the jar again.

In the browser console, `window.__sheep` has handles to poke at (dev only), among them
`__sheep.jarPanel.open({ fieldId: 'f2' })` and `__sheep.jars()` for the jars on the island.

## Tests and build

```sh
npm test              # node:test, about 4 s
npm run build         # into dist/, for this computer (npm run preview serves it)
npm run build:pages   # into dist/, the GitHub Pages build (under /rotation-maxxing/, CropScape and NASS off unless set)
node --test ../proxy/cropscape/worker.test.mjs   # the Cloudflare Worker (CropScape and NASS routes)
```

## Releases and the live site

Every push to `main` deploys the app to GitHub Pages, at
https://nila-fernando.github.io/rotation-maxxing/. The workflow is
[`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml): in `app/` it runs
`npm ci`, `npm test` and `npm run build:pages`, then publishes `app/dist`. If the tests fail, nothing
is deployed. You can also run it by hand from the repo's Actions tab ("Run workflow").

One-time setup in the repo: Settings > Pages > Build and deployment > Source: **GitHub Actions**.

To make a release: bump `"version"` in `app/package.json` (and `app/package-lock.json`), add an
entry to [CHANGELOG.md](CHANGELOG.md), merge into `main`, and tag it (`git tag v0.10.0`).

The site is a project site, so everything lives under `/rotation-maxxing/`. Files in `public/`
(Manami's picture, her 3D model, the demo county's outlines) go through `asset()` in
`src/ui/asset.js`, which adds that base; don't write `'/manami.svg'` straight into the code.

## Crop history from CropScape (`VITE_CDL_PROXY`)

Outside the demo county, crop history beyond a field outline's own years comes from USDA CropScape
(`src/data/cdlHistory.js`). CropScape doesn't allow browser requests from other sites (no CORS
header), so the app asks through a proxy:

- `npm run dev` and `npm run preview` have one built in, at `/cropscape` (`vite.config.js`).
- The GitHub Pages build has none, so it doesn't ask. The check-up says the rest of the years come
  from CropScape and can't be reached from the site yet.

To turn it on for the live site, deploy the Worker in `proxy/cropscape/` (see its README; it's ready to go), or run any tiny proxy that forwards `/axis2/...` to
`https://nassgeodata.gmu.edu/axis2/...` and adds an `Access-Control-Allow-Origin` header (a few
lines on Cloudflare Workers, say), then set a repository variable (Settings > Secrets and variables >
Actions > Variables) named `VITE_CDL_PROXY` to its address, for example
`https://cropscape-proxy.example.workers.dev`, and run the workflow again. Locally, the same
variable in `app/.env.local` (or the environment) overrides the default; set it empty to turn the
lookups off.

## Prices, yields and local crops from USDA NASS (`VITE_NASS_PROXY`)

The planner uses the farm's own market data, never stand-in numbers (`src/data/market.js`):

- **County:** the middle of the fields, looked up with the FCC Census Block API (keyless).
- **Crops to choose from:** the planner's crops harvested in that county in the latest USDA Census of
  Agriculture (2022), or with a NASS county yield in the last 5 years, plus fallow and a cereal-rye
  cover crop.
- **Yields:** NASS county yields (last 5 years), else state, else US, turned into non-irrigated or
  irrigated yields with NASS's own practice split where it publishes one.
- **Prices:** each crop's latest NASS marketing-year price received in the farm's state (the US one if
  the state has none that recent), converted to the planner's unit ($/cwt to $/bu or $/lb, and so on).
  A crop NASS has no price for is left out.
- **Costs:** per-acre operating costs are the planner's sourced US figures (USDA ERS 2026F-2027F
  forecast; Iowa State for alfalfa; NDSU for canola, sunflower and dry beans), not local; the plans
  say so.

Every source shows in the plans' "Good to know". If the county or NASS can't be reached, the plans
say there is no price or yield data for the farm, and why, instead of planning.

Quick Stats needs an API key and doesn't allow browser requests, so the app asks through a proxy
that adds the key on the server; the key is never in the browser or the built files:

- `npm run dev` and `npm run preview` answer `/nass/api_GET/` themselves (`vite.config.js`), with the
  key from `NASS_API_KEY` in the environment or `app/.env.local`. Get a free key at
  https://quickstats.nass.usda.gov/api. Without one, the plans say NASS isn't set up.
- The GitHub Pages build has no proxy unless `VITE_NASS_PROXY` is set, so its plans say there's no
  price or yield data. To turn it on, deploy the Worker in `proxy/cropscape/` with the secret
  `NASS_API_KEY` (see its README), then set the repository variable `VITE_NASS_PROXY` to the Worker's
  address plus `/nass`, for example `https://cropscape-proxy.example.workers.dev/nass`, and run the
  workflow again. Never put the key itself in a `VITE_` variable: those end up in the browser.

## Troubleshooting

- **"Port 5173 is already in use":** another dev server is running. Close it, or run
  `npx vite --port 5174`.
- **Errors about TypeScript in the tests:** your Node is too old. Check with `node --version` and
  install 22.18 or newer.
- **The globe or island is blank:** the browser needs WebGL. Try Chrome or Edge, and turn on hardware
  acceleration.
