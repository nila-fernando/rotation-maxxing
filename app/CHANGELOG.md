# Changelog

## v0.11.0 (2026-11-15)

### What's new

- **Ask Manami.** Tap "Ask me" by Manami (or "Ask about this field" in a check-up) and ask anything
  about your farm, your fields or the plans. She looks at your real field data before she answers.
  It runs on Anthropic's Claude (Sonnet 5.5), through a small server, so no key is ever in the website.
- **The jar test reads your photo with AI.** Pick a photo of your settled jar and Manami reads the
  layers with Claude's vision. If she can't read it, or AI is off, the app reads it on your device
  as before. The app tells you before a photo leaves your device, and photos are never stored.
- **Plans, rotation first.** "Plan my next seasons" now leads with the rotation, why it's good for
  the soil, then the money. Each field shows its next three seasons as a simple strip, and every
  crop icon shows its name when you point at it or tap it.
- **When to sow.** A new tab gives the best sowing and harvest windows for each crop, from USDA's
  usual planting and harvest dates and its crop progress reports, with each source named.
- **The real weather on your farm.** The island now shows the weather at your farm right now:
  rain, snow, fog, storms, clouds and wind, on top of the season and the time of day. It checks
  again every 20 minutes, and when you're offline the farm just has a fair day. The time-of-day
  popover has a Weather row if you want to try another look.
- **Sea life round the island.** An orca, a pod of dolphins and little schools of fish swim round
  the island, out of the way of the sheep when they go for a swim. Now and then, and sooner
  on World Whale Day, a whale comes up for a moment. It's rare, so keep an eye on the sea.
- **A lighthouse.** A striped lighthouse stands on the island's highest point, and at night its
  lamp glows and a soft beam sweeps slowly round. The windmill moves to other high ground nearby,
  and every festival dresses the lighthouse too.
- **More crops.** Cotton, sunflowers, canola, rye, dry beans, spring wheat, potatoes, sugar beets,
  peanuts, rice, vegetables, strawberries, berries, grapes, orchards, sugarcane and tobacco now
  grow on the island as themselves, with their own icons and names. Cotton bursts white and rice
  paddies drain as they ripen.

## v0.10.0 (2026-11-15)

The first release on the web: https://nila-fernando.github.io/rotation-maxxing/

### What's in it

- **Your farm as an island.** Find your farm on the globe, pick your fields from USDA outlines (or
  AI-detected ones, or draw your own), answer three quick questions, and the farm rises out of the
  sea with your real field shapes. The island follows the real time and season: day and night,
  snow in winter, and a festival look on the right days.
- **The plan walkthrough.** "Plan my next seasons" gives three plans for the next three seasons,
  and "See them on the farm" plays them out on the island, with Manami walking you through what
  changes and why.
- **Spring freeze and water lines.** Manami says how often a late spring freeze could hurt a
  field's winter wheat, and how dry or wet years change each plan. Freezes show on the farm too.
- **The soil jar test.** Shake some soil in a jar of water, take a photo when it settles, and the
  app reads the layers to tell your soil texture. The planner can use it for that field, and the
  jar sits by the field's gate on the island.
- **Real data for every field (thanks to Nila).** Crop history from USDA Crop Sequence Boundaries
  and CropScape, soil from the SSURGO soil survey, slope from USGS elevation, rain from NASA POWER
  and greenness from NASA satellite images. Nothing in the check-up is a stand-in.
- **Nila's newest planner.** Wheat wakes up in spring from the warmth instead of a fixed date, and
  spring freezes are drawn on their own, year by year.
- **Farm sounds.** The sea, a breeze, birds by day, crickets at night, the sheep and the windmill,
  all quiet and easy to turn off.
- **A camera that stays out of buildings.** Moving around the island never puts the camera inside
  the windmill, barn or silo.
- **A new name.** Team Sheeeep's app is now Rotation-Maxxing.

### Known limits

- **CropScape history is off on GitHub Pages.** CropScape doesn't take requests from other sites,
  so the live site can't look up crop years beyond what a field's outline already has. Fields in
  the demo county have all 8 years; elsewhere the check-up says which years are missing and why.
  It comes back once a small proxy is set up (see `VITE_CDL_PROXY` in [README.md](README.md)).
- **Screen readers haven't been tried with a real one yet.** The app has labels and spoken
  updates, but nobody has gone through it with a real screen reader.
