# Rotation-Maxxing

A cozy 3D farm-island app (made by Team Sheeeep) for US farmers. Find your farm on the globe, pick your fields from USDA
outlines, answer three quick questions, and your farm appears as an island. "Plan my next seasons"
runs the crop-rotation planner (`src/vendor/rotation-maxxing`), and "See them on the farm" plays
the plans out on the island.

**Try it:** https://nila-fernando.github.io/rotation-maxxing/ (version 0.10.0; what's new is in
[CHANGELOG.md](CHANGELOG.md)).

## Run it on your computer

You need [Node.js](https://nodejs.org) **22.18 or newer** (24 is what we use) and git. No API keys or
`.env` file are needed.

```sh
git clone https://github.com/nila-fernando/rotation-maxxing.git
cd rotation-maxxing/app
npm install
npm run dev
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

To try the soil jar test, open a field on `?hub=5` (West 140, say), then "Try a jar test" in its
check-up (or "Test your soil" under the field list), and "Try a sample jar". "Use for West 140"
puts the jar by the field's gate on the island; tap it to see the jar again.

In the browser console, `window.__sheep` has handles to poke at (dev only), among them
`__sheep.jarPanel.open({ fieldId: 'f2' })` and `__sheep.jars()` for the jars on the island.

## Tests and build

```sh
npm test              # node:test, about 4 s
npm run build         # into dist/, for this computer (npm run preview serves it)
npm run build:pages   # into dist/, the GitHub Pages build (under /rotation-maxxing/, CropScape off)
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

To turn it on for the live site, run a tiny proxy that forwards `/axis2/...` to
`https://nassgeodata.gmu.edu/axis2/...` and adds an `Access-Control-Allow-Origin` header (a few
lines on Cloudflare Workers, say), then set a repository variable (Settings > Secrets and variables >
Actions > Variables) named `VITE_CDL_PROXY` to its address, for example
`https://cropscape-proxy.example.workers.dev`, and run the workflow again. Locally, the same
variable in `app/.env.local` (or the environment) overrides the default; set it empty to turn the
lookups off.

## Troubleshooting

- **"Port 5173 is already in use":** another dev server is running. Close it, or run
  `npx vite --port 5174`.
- **Errors about TypeScript in the tests:** your Node is too old. Check with `node --version` and
  install 22.18 or newer.
- **The globe or island is blank:** the browser needs WebGL. Try Chrome or Edge, and turn on hardware
  acceleration.
