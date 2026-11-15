# Rotation-Maxxing

A cozy 3D farm-island app (made by Team Sheeeep) for US farmers. Find your farm on the globe, pick your fields from USDA
outlines, answer three quick questions, and your farm appears as an island. "Plan my next seasons"
runs the crop-rotation planner (`src/vendor/rotation-maxxing`), and "See them on the farm" plays
the plans out on the island.

## Run it on your computer

You need [Node.js](https://nodejs.org) **22.18 or newer** (24 is what we use) and git. No API keys or
`.env` file are needed.

```sh
git clone https://github.com/nila-fernando/rotation-maxxing.git
cd rotation-maxxing
git checkout app-into-main   # until PR #4 is merged; after that, main
cd app
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
| `&hour=21.5` | a time of day (21.5 is 9:30 pm) |
| `&today=2026-12-24` | a date, for the season and festival on the island |
| `?demo=land` | lands on the demo farm at once, to pick fields yourself |

In the browser console, `window.__sheep` has handles to poke at (dev only).

## Tests and build

```sh
npm test        # node:test, about 4 s
npm run build   # into dist/
```

## Troubleshooting

- **"Port 5173 is already in use":** another dev server is running. Close it, or run
  `npx vite --port 5174`.
- **Errors about TypeScript in the tests:** your Node is too old. Check with `node --version` and
  install 22.18 or newer.
- **The globe or island is blank:** the browser needs WebGL. Try Chrome or Edge, and turn on hardware
  acceleration.
