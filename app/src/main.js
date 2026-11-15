// Team Sheeeep: the app shell. Screens so far:
//   1. Find your farm (globe → satellite map)        src/screens/globe.js
//   2. Pick your fields (outlines, lasso, draw, edit)  src/screens/fields.js
//   3. Manami's check-in while the data loads         src/screens/checkin.js
//   4. Island reveal                                  src/screens/reveal.js
//   5. The island hub, home from here on              src/screens/hub.js
//      with each field's check-up panel               src/screens/fieldPanel.js
//      and the plans on the island ("See them on the farm", loaded when first opened)
//                                                     src/screens/planFutures.js
import './styles.css';
import { INTRO, LANDING_URL } from './config.js';
import { DEMO_FARM } from './data/demoFarm.js';
import * as farmData from './data/farmData.js';
import { fillCropHistory, withCdlYears } from './data/cdlHistory.js';
import { fillSoil, withSoil } from './data/soilSurvey.js';
import { demoRecordFor, fieldReportFor, HISTORY_YEARS } from './data/fieldReport.js';
import { createPlanner } from './plan/planner.js';
import { createCheckIn } from './screens/checkin.js';
import { createFieldPanel } from './screens/fieldPanel.js';
import { createPlansPanel, firstSeason, money } from './screens/plansPanel.js';
import { createIslandPlanner } from './screens/islandPlanner.js';
import { createFieldsStep } from './screens/fields.js';
import { createGlobeScreen } from './screens/globe.js';
import { createHub } from './screens/hub.js';
import { createReveal } from './screens/reveal.js';
import { createTimeTravel } from './screens/timeTravel.js';
import { createManami } from './ui/manami.js';
import { createSearchBox } from './ui/searchBox.js';
import { warmUpLiveOutlines } from './fields/liveOutlines.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const params = new URLSearchParams(location.search);

/** What the app knows so far; later steps add fields, answers and satellite data. */
const app = { farm: null, fields: [], farmProfile: null };

$('logo').href = LANDING_URL;
// the full placeholder doesn't fit a phone-width search bar
const narrow = matchMedia('(max-width: 640px)');
const fitPlaceholder = () => { $('q').placeholder = narrow.matches ? 'Farm address or county' : 'Search your farm address or county'; };
narrow.addEventListener('change', fitPlaceholder);
fitPlaceholder();
const manami = createManami($('manami'));

const HELLO = 'Hi, I’m Manami! Let’s find your farm.';
let introDone = false;
let journeyStarted = false;
let fallbackNote = '';

const globe = createGlobeScreen({
  els: { map: $('map'), globe: $('globe'), globeHost: $('globeHost'), globeTags: $('globeTags'), credit: $('credit') },
  on: handle,
});

const fieldsStep = createFieldsStep({
  map: globe.map,
  manami,
  onContinue: (fields) => {
    app.fields = fields;
    fieldsStep.hold(); // the chosen fields stay drawn on the (dimmed) map
    const b = fieldsStep.bounds();
    const wide = innerWidth > 900;
    if (b) {
      globe.map.flyToBounds(b, {
        paddingTopLeft: [wide ? 40 : 20, wide ? 40 : 240],
        paddingBottomRight: [wide ? 420 : 20, wide ? 40 : 280],
        maxZoom: 16, duration: 0.9,
      });
    }
    startFieldFill(fields);
    checkIn.start({ fields });
  },
  onChangeLocation: () => {
    fieldsStep.stop();
    globe.backToGlobe();
  },
});

// What the outlines don't carry, fetched while the check-in runs (the reveal waits a little for it):
//   crop history  USDA Cropland Data Layer (live USDA outlines have 2023 only; AI and drawn: none)
//   soil          USDA NRCS SSURGO at a point in each field
const FIELD_FILL_GRACE_MS = 8000;
let fieldFill = null;
function startFieldFill(fields) {
  const known = (f) => Object.fromEntries((demoRecordFor(f)?.cropHistory || []).map((c) => [c.year, c.crop]));
  const apply = (merge) => (filled) => {
    if (fieldFill !== job || !Object.keys(filled).length) return; // a newer pick replaced this one
    app.fields = merge(app.fields, filled);
    if (app.island) paintStatuses(); // landed after the reveal: the flags can use it
  };
  const job = Promise.all([
    fillCropHistory(fields, { years: HISTORY_YEARS, known }).then(apply(withCdlYears)).catch((err) => console.warn('CDL crop history', err)),
    fillSoil(fields).then(apply(withSoil)).catch((err) => console.warn('SSURGO soil', err)),
  ]);
  fieldFill = job;
}

// the rotation planner (src/vendor/rotation-maxxing), in a Web Worker
const planner = createPlanner();
/** Three plans for the next 3 seasons for the farm as it stands (see src/plan/planner.js). */
const planSeasons = () => planner.plans({ fields: app.fields, place: app.farm, profile: app.farmProfile, county: farmData.getCounty(), firstSeason: firstSeason(today()) });
/** Scores a plan picked field by field (or built by hand) on the farm as it stands. */
const evaluateMix = (plan) => planner.evaluate({ fields: app.fields, place: app.farm, profile: app.farmProfile, county: farmData.getCounty(), plan, firstSeason: firstSeason(today()) });

/** Manami steps aside (out of sight and the tab order) while the check-up or the plans are open. */
function syncManami() {
  const away = document.body.classList.contains('checkup-open') || document.body.classList.contains('plans-open');
  document.getElementById('manami').inert = away;
}

/** A field's check-up (flags, soil, slope, rain, greenness) from what the app knows now. */
function reportFor(id) {
  const f = app.fields.find((x) => x.id === id);
  return f ? fieldReportFor(f, { profile: app.farmProfile, farmIsDemo: !!app.farm?.demo }) : null;
}
/** Colours every status dot in the hub's list from Manami's flags. */
function paintStatuses() {
  for (const f of app.fields) hub.setStatus(f.id, reportFor(f.id)?.status || 'unknown');
}

const fieldPanel = createFieldPanel({
  onRename: (id, name) => {
    const f = app.fields.find((x) => x.id === id);
    if (!f) return name;
    // the same tidy-up as the field list's rename; a blank name keeps the old one
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!clean || clean === f.name) return f.name;
    fieldsStep.rename(id, clean); // the field step's own list, if it holds this field
    app.fields = app.fields.map((x) => (x.id === id ? { ...x, name: clean } : x));
    if (app.island) app.island.fields = app.island.fields.map((x) => (x.id === id ? { ...x, name: clean } : x));
    hub.renameField(id, clean); // the sidebar row and the island tooltip
    fieldPanel.rename(id, clean); // no redraw: the click that ended the edit must still land
    return clean;
  },
  onIrrigated: (id, on) => {
    const p = app.farmProfile || (app.farmProfile = { priorities: ['profit'], irrigatedFieldIds: [], excludedCrops: [] });
    const ids = new Set(p.irrigatedFieldIds || []);
    if (on) ids.add(id); else ids.delete(id);
    app.farmProfile = { ...p, irrigatedFieldIds: [...ids] };
    fieldPanel.update(reportFor(id));
    paintStatuses();
  },
  onClose: () => hub.overview(),
});

const hub = createHub({
  onOpenFieldPanel: (id) => {
    app.openFieldId = id;
    const r = reportFor(id);
    if (r) fieldPanel.open(r);
  },
  onCloseFieldPanel: () => {
    app.openFieldId = null;
    fieldPanel.close();
  },
  getPanelInsets: () => (planFutures?.active ? planFutures.insets() : fieldPanel.insets()),
  panelEl: fieldPanel.el,
  onPlan: () => plansPanel.open(),
});

// "Plan my next seasons": the planner's three plans, a pick per field, and a preview on the island
const plansPanel = createPlansPanel({
  planSeasons,
  today: () => today(),
  getSaved: () => app.plan?.plan || null, // "Build your own" starts from the plan saved last
  evaluateMix,
  onOpen: () => {
    openSeq++; // a "See them on the farm" still loading stays shut
    planFutures?.stop(); // back from the plans on the island
    islandPlanner.stop(); // back from planning on the island, or opened over it
    hub.overview(); // the whole farm behind it, any field check-up closed
    document.getElementById('hubPanel').inert = true; // the field list waits while the plans are open
    queueMicrotask(syncManami);
  },
  onClose: () => {
    document.getElementById('hubPanel').inert = false;
    syncManami();
  },
  onPreview: (info) => showPlanOnIsland(info, 0),
  onFutures: (kind, opts) => openFutures(kind, opts),
  onIsland: (builder, { startYear }) => {
    if (!app.island?.view) return;
    islandPlanner.start(builder, { startYear, view: app.island.view });
  },
  onSave: (plan, info) => {
    app.plan = { plan, ...info }; // the season loop (Phase 5) builds on this
    // a plan picked plan by plan can be seen on the farm again (a hand-built one is "Plan on the island")
    const actions = info.choice ? [{ label: 'See it on the farm', onClick: () => openFutures('mix', { reel: false }) }] : [];
    manami.say(`Saved. That’s your plan for ${info.startYear} to ${info.startYear + 2}. You can change it any time from “Plan my next seasons”.`, { actions, focus: true });
  },
});

// "See them on the farm": the plans on the island itself, flipped season by season (its own chunk,
// loaded the first time it opens)
let futuresMod = null;
let planFutures = null;
let openSeq = 0; // a newer open (or the plans panel, or leaving the farm) makes an older one moot
async function openFutures(kind, opts = {}) {
  const seq = ++openSeq;
  try {
    futuresMod ??= await import('./screens/planFutures.js');
  } catch (e) {
    // the chunk didn't load (the connection dropped, or the app was updated): say so, rather than nothing
    console.error('planFutures: could not load', e);
    if (seq !== openSeq || plansPanel.isOpen) return;
    manami.say('I couldn’t open the plans on the farm just now. They’re all in “Plan my next seasons”.', {
      actions: [{ label: 'Back to the plans', primary: true, onClick: () => plansPanel.open() }],
      focus: true,
    });
    return;
  }
  // the farmer moved on while it loaded (the plans panel opened again, say): don't start under it
  if (seq !== openSeq || plansPanel.isOpen) return;
  planFutures ??= futuresMod.createPlanFutures({
    hub,
    timeTravel,
    manami,
    getData: () => plansPanel.ensureData(),
    getCurrentData: () => plansPanel.data,
    getChoice: () => plansPanel.getChoice(),
    setChoice: (c) => plansPanel.setChoice(c),
    evaluateMix,
    onStart: () => {
      islandPlanner.stop();
      if (app.openFieldId) hub.overview(); // any field check-up closes (the plan view's camera takes over)
      document.getElementById('hubPanel').inert = true; // the field list waits while the plans are on the island
      syncManami(); // she's back in reach for the walk
    },
    onStop: () => {
      document.getElementById('hubPanel').inert = false;
      syncManami();
    },
    onSave: (plan, info) => plansPanel.saveChosen(plan, info),
    onBack: () => plansPanel.open(),
    onBuild: () => plansPanel.openBuild(),
  });
  if (!app.island?.view) return;
  return planFutures.start(kind, { ...opts, view: app.island.view, startYear: firstSeason(today()) });
}

// "Plan on the island": the "Build your own" plan, edited by dragging crops onto the fields
const islandPlanner = createIslandPlanner({
  hub,
  timeTravel: { preview: (info, i) => timeTravel.preview(info, i), prebuild: (maps) => timeTravel.prebuild(maps) }, // created below
  manami,
  money,
  onStart: () => { document.getElementById('hubPanel').inert = true; },
  onStop: () => { document.getElementById('hubPanel').inert = false; },
  onBack: () => plansPanel.openBuild(),
  onSave: (plan) => plansPanel.saveBuilt(plan),
});

/** A plan's crops on the island for one of its 3 seasons, with Manami offering the others. */
function showPlanOnIsland(info, i) {
  timeTravel.preview(info, i);
  const years = [0, 1, 2].map((k) => info.startYear + k);
  const phrase = { 'Manami’s pick': 'my pick', 'Most profit': 'the most-profit plan', 'Keep going': 'your rotation, kept going', 'Your plan': 'your plan' }[info.label] || info.label;
  manami.say(`Here’s ${phrase} for ${years[i]}. Have a look round.`, {
    actions: [
      ...years.map((y, k) => ({ label: String(y), primary: k === i, onClick: () => showPlanOnIsland(info, k) })),
      { label: 'Back to the plans', onClick: () => plansPanel.open() },
    ],
    focus: true,
  });
}

// the year selector and play-through along the top of the hub
const timeTravel = createTimeTravel({
  hub,
  onYear: ({ year }) => fieldPanel.markYear(year),
});

/** Each field's crops by year (2018–2025, CSB), for the year selector. */
function cropHistories() {
  return new Map(app.fields.map((f) => {
    const r = reportFor(f.id);
    return [f.id, (r?.history || []).filter((h) => h.crop != null).map((h) => ({ year: h.year, key: h.key, label: h.label }))];
  }));
}

/** ?hour=21.5 starts the island at that time of day (dev and demos); otherwise the clock's. */
function hourParam() {
  const h = Number(params.get('hour'));
  return params.has('hour') && Number.isFinite(h) ? ((h % 24) + 24) % 24 : null;
}

/** Today, or ?today=2026-12-24 to preview a season or holiday (dev and demos). */
function today() {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.get('today') || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : new Date();
}

const reveal = createReveal({
  map: globe.map,
  manami,
  onDone: (island) => {
    document.body.classList.add('reveal-done');
    app.island = island;
    hub.show(island); // the farm's home screen from here on
    paintStatuses();
    timeTravel.show(island, { history: cropHistories(), today: today(), hour: hourParam(), liveDate: !params.has('today') });
    // dev shortcut: ?hub=5&futures=1 opens the plans on the island with Manami's walk, &futures=explore without
    if (import.meta.env.DEV && params.has('futures') && !app.futuresShown) {
      app.futuresShown = true;
      plansPanel.ensureData().then(() => openFutures('priority', { reel: params.get('futures') !== 'explore' }));
    }
  },
});

function startReveal({ instant = false } = {}) {
  document.body.classList.remove('reveal-done');
  fieldPanel.close();
  openSeq++;
  planFutures?.stop();
  islandPlanner.stop();
  timeTravel.hide();
  hub.hide();
  reveal.start({ fields: app.fields, farm: app.farm, instant });
  setTimeout(() => checkIn.stop(), 400); // once the island view has faded in over it
}

const checkIn = createCheckIn({
  manami,
  onDone: async (profile) => {
    app.farmProfile = profile;
    console.log('farmProfile', profile);
    // the island shows each field's newest crop and how many years we checked: give CDL a moment
    if (fieldFill) await Promise.race([fieldFill, new Promise((r) => setTimeout(r, FIELD_FILL_GRACE_MS))]);
    startReveal();
  },
});

const search = createSearchBox({
  form: $('searchForm'),
  input: $('q'),
  list: $('suggestions'),
  status: $('searchStatus'),
  onPick: (place) => globe.flyTo(place),
  onOffline: () => {
    $('demoBtn').classList.add('is-nudged');
    manami.say('I can’t reach the address search right now. Want to visit our demo farm instead?', {
      actions: [{ label: 'Try the demo farm', primary: true, onClick: () => globe.flyTo(DEMO_FARM) }],
    });
  },
});
$('demoBtn').addEventListener('click', () => globe.flyTo(DEMO_FARM));
$('againBtn').addEventListener('click', () => globe.backToGlobe());
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && globe.flying) globe.landNow();
});

function setFinder(visible) {
  $('finder').classList.toggle('is-shown', visible);
  $('finder').inert = !visible;
}
function setAgain(visible) {
  $('againBtn').hidden = !visible;
}

function handle(event) {
  switch (event.type) {
    case 'flying': {
      journeyStarted = true;
      const focusWasInFinder = $('finder').contains(document.activeElement);
      manami.say(`Flying to ${event.place.label}…`, {
        actions: [{ label: 'Skip', onClick: () => globe.landNow() }],
        focus: focusWasInFinder, // the finder is about to go inert; don't drop focus to <body>
      });
      search.close();
      setFinder(false);
      setAgain(false);
      fieldsStep.preload(event.place); // fetch the farm's field outlines while we fly
      break;
    }
    case 'landed':
      // landing flows straight into picking fields; the field step does the talking
      app.farm = event.place;
      setAgain(false);
      fieldsStep.start(event.place);
      break;
    case 'returned':
      app.farm = null;
      app.fields = [];
      app.farmProfile = null;
      fieldPanel.close();
      openSeq++;
      planFutures?.stop();
      islandPlanner.stop();
      timeTravel.hide();
      hub.hide();
      reveal.stop();
      document.body.classList.remove('reveal-done');
      checkIn.stop();
      fieldsStep.stop();
      setAgain(false);
      search.clear();
      setFinder(true);
      search.focus();
      manami.say('Let’s look somewhere else. Type an address or a county.');
      break;
    case 'fallback':
      fallbackNote = event.message;
      if (introDone && !journeyStarted) manami.say(`${HELLO} ${fallbackNote}`);
      break;
    default:
  }
}

/**
 * Dev only: n fields for testing the reveal: the 5 demo fields, cut to 1, or copied with offsets of
 * about 3 km to make up to 15 (as the spec suggests).
 */
function testFields(n) {
  const base = farmData.getFields().map((f) => ({
    id: f.id, demoId: f.id, name: f.name, geometry: f.geometry, acres: f.acres, sourceIds: [f.sourceId],
    crops: Object.fromEntries(f.cropHistory.map((c) => [c.year, c.crop])), source: 'usda',
  }));
  const shift = (g, dx, dy) => ({ ...g, coordinates: g.coordinates.map((ring) => ring.map(([x, y]) => [x + dx, y + dy])) });
  const offsets = [[0, 0], [0.04, 0.027], [-0.04, -0.027]];
  const out = [];
  for (const [k, [dx, dy]] of offsets.entries()) {
    for (const f of base) {
      if (out.length >= n) return out;
      out.push(k === 0 ? f : { ...f, id: `${f.id}-copy${k}`, name: `${f.name} ${k + 1}`, sourceIds: [`${f.sourceIds[0]}-copy${k}`], geometry: shift(f.geometry, dx, dy) });
    }
  }
  return out;
}

if (import.meta.env.DEV) window.__sheep = { app, globe, manami, search, fieldsStep, checkIn, farmData, reveal, hub, fieldPanel, timeTravel, planner, planSeasons, plansPanel, islandPlanner, testFields, futures: () => planFutures }; // for poking at in the console

// ---------------------------------------------------------------- the first five seconds
(async function intro() {
  // the globe fades in already turning; if it's slow to load, don't keep the farmer waiting
  await Promise.race([globe.ready, wait(2500)]);
  warmUpLiveOutlines(); // open the live outline files while the globe spins, so the first farm is quicker
  if (params.has('reveal') || params.has('hub')) {
    // dev shortcuts: ?reveal=1|5|15 jumps to the island reveal with demo fields, ?hub=1|5|15 straight to the hub
    const key = params.has('hub') ? 'hub' : 'reveal';
    globe.flyTo(DEMO_FARM);
    globe.landNow();
    introDone = true;
    await wait(600);
    app.fields = testFields(Number(params.get(key)) || 5);
    app.farmProfile = { priorities: ['profit'], irrigatedFieldIds: [], excludedCrops: [] };
    fieldsStep.hold();
    startReveal({ instant: key === 'hub' });
    return;
  }
  if (params.has('demo')) { // dev shortcut: ?demo flies to the demo farm, ?demo=land lands at once
    globe.flyTo(DEMO_FARM);
    if (params.get('demo') === 'land') globe.landNow();
    introDone = true;
    return;
  }
  await wait(INTRO.searchAfterMs);
  if (!journeyStarted) {
    setFinder(true);
    search.focus();
  }
  await wait(INTRO.manamiAfterMs - INTRO.searchAfterMs);
  introDone = true;
  if (!journeyStarted) manami.say(fallbackNote ? `${HELLO} ${fallbackNote}` : HELLO);
})();
