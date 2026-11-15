// Team Sheeeep: the app shell. Screens so far:
//   1. Find your farm (globe → satellite map)        src/screens/globe.js
//   2. Pick your fields (outlines, lasso, draw, edit)  src/screens/fields.js
//   3. Manami's check-in while the data loads         src/screens/checkin.js
//   4. Island reveal                                  src/screens/reveal.js
//   5. The island hub, home from here on              src/screens/hub.js
//      with each field's check-up panel               src/screens/fieldPanel.js
//      and the plans on the island ("See them on the farm", loaded when first opened)
//                                                     src/screens/planFutures.js
//      and the soil jar test (a dialog; the jar then stands by the field's gate)
//                                                     src/screens/jarPanel.js, src/island/jarProps.js
// The farm is kept on this device as it changes (a reload brings it back: "Welcome back!"), and in
// the farmer's account once they sign in                src/save/, src/screens/accountPanel.js
import './styles.css';
import { INTRO, LANDING_URL, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { DEMO_FARM } from './data/demoFarm.js';
import * as farmData from './data/farmData.js';
import { withCdlYears } from './data/cdlHistory.js';
import { withSoil } from './data/soilSurvey.js';
import { withSlope } from './data/terrain.js';
import { withRain } from './data/rain.js';
import { withNdvi } from './data/greenness.js';
import { createMarkets, standInMarket } from './data/market.js';
import { startFarmLoad } from './data/farmLoad.js';
import { farmRunners } from './data/farmSources.js';
import { centroid, featureCollection, feature as turfFeature } from '@turf/turf';
import { demoRecordFor, fieldReportFor, HISTORY_YEARS, SOURCES } from './data/fieldReport.js';
import { createPlanner } from './plan/planner.js';
import { JAR_LINES } from './plan/jarTest.js';
import { fieldWeatherNote, weatherKey } from './plan/weatherWords.js';
import { farmIrrigation, plannerFarm } from './plan/farmInput.js';
import { createJars, jarKeepOuts } from './island/jarProps.js';
import { createSeaLife } from './island/seaLife.js';
import { createCheckIn, CROPS } from './screens/checkin.js';
import { CROP_KEYS } from './island/crops.js';
import { applyCropEdits, restoreCrops } from './fields/cropEdits.js';
import { createFieldPanel } from './screens/fieldPanel.js';
import { createJarPanel } from './screens/jarPanel.js';
import { createPlansPanel, firstSeason, money } from './screens/plansPanel.js';
import { createIslandPlanner } from './screens/islandPlanner.js';
import { createFieldsStep } from './screens/fields.js';
import { createGlobeScreen } from './screens/globe.js';
import { createHub } from './screens/hub.js';
import { createReveal } from './screens/reveal.js';
import { createTimeTravel } from './screens/timeTravel.js';
import { createManami } from './ui/manami.js';
import { createWalkthrough } from './ui/walkthrough.js';
import { createAskManami } from './screens/askManami.js';
import { aiEndpoint } from './ai/runner.js';
import { adviceFailLine, adviceRoutes, askAdvice, fieldBody, planBody } from './ai/advice.js';
import { fieldDetail } from './ai/context.js';
import { createPlanTake } from './screens/planTake.js';
import { createConversationStore } from './save/conversations.js';
import { createFarmSpins } from './ui/rotateManami.js';
import { createSearchBox } from './ui/searchBox.js';
import { installCropTips } from './ui/cropTip.js';
import { warmUpLiveOutlines } from './fields/liveOutlines.js';
import { createAmbience } from './audio/ambience.js';
import { sceneOf } from './audio/mix.js';
import { bindSoundToggle } from './audio/soundToggle.js';
import { makeSnapshot, farmName } from './save/snapshot.js';
import { createLocalStore } from './save/localStore.js';
import { createScheduler } from './save/scheduler.js';
import { createCloud, createSync } from './save/cloudSync.js';
import { createAuth } from './save/auth.js';
import { newId } from './save/rows.js';
import { createAccountPanel } from './screens/accountPanel.js';
import { weatherLine, weatherParam } from './island/weather.js';
import { farmWeather } from './island/weatherState.js';
import { startWeatherFeed } from './services/weatherFeed.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const params = new URLSearchParams(location.search);

// The one crop-name tooltip for every crop icon (hover, focus, touch). It goes in first, so its
// window-capture Esc runs before the panels' own Esc handlers: the first Esc closes only the tip.
installCropTips();

/** What the app knows so far; later steps add fields, answers and satellite data. */
const app = { farm: null, fields: [], farmProfile: null };

// ---------------------------------------------------------------- saving the farm
// On this device for everyone (src/save/localStore.js), as it changes: the fields once picked, the
// data as it lands, the check-in's answers, renames, the irrigated switch, jar tests and plans. A
// reload then offers "Welcome back!". Signed in, the same farm goes to the account too
// (src/save/cloudSync.js, the team's Supabase schema). The dev shortcuts (?hub, ?reveal) save nothing.
const local = createLocalStore();
/** The dev shortcuts that start somewhere other than the globe. */
const devStart = params.has('reveal') || params.has('hub');
/** The farm on screen that is being saved ({ id }: its id on this device), or null. */
let saveCtx = null;
let restoring = false; // opening a saved farm: landing doesn't start the field step
let restoredLine = null; // what Manami says once a saved farm's island is up
const auth = createAuth({
  url: SUPABASE_URL,
  key: SUPABASE_ANON_KEY,
  // back to the app itself (its base path on GitHub Pages), without any dev shortcut in the address
  redirectTo: () => new URL(import.meta.env.BASE_URL || '/', location.origin).href,
});
let cloudP = null;
const getCloud = () => (cloudP ??= auth.client().then(createCloud));
const lazyCloud = {
  probe: (...a) => getCloud().then((c) => c.probe(...a)),
  exists: (...a) => getCloud().then((c) => c.exists(...a)),
  push: (...a) => getCloud().then((c) => c.push(...a)),
};
let account = null; // the panel (made below, once the screens exist)
const sync = createSync({ cloud: lazyCloud, local, onStatus: () => account?.refresh() });

function writeLocal() {
  if (!saveCtx || !app.farm || !app.fields.length) return;
  const id = saveCtx.id;
  const snap = makeSnapshot({
    id, farm: app.farm, fields: app.fields, profile: app.farmProfile, plan: app.plan,
    picks: plansPanel.getChoice(), cloud: local.get(id)?.cloud || {}, // (where it lives in the cloud is the store's to keep)
  });
  if (local.put(snap)) sync.request(id);
}
const localSaver = createScheduler(writeLocal, { delay: 400, retryBase: 5000 });
/** Something about the farm changed: keep it (after a quiet moment). */
const persist = () => { if (saveCtx) localSaver.schedule(); };
// the page going away (a reload, a closed tab, the phone locking): save what's waiting now
addEventListener('pagehide', () => localSaver.flush());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') localSaver.flush(); });
addEventListener('online', () => sync.flush());

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
    if (!saveCtx && !devStart) saveCtx = { id: newId() }; // a new farm on this device (the others stay)
    persist();
    localSaver.flush();
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
    checkIn.start({ fields, load: startFieldFill(fields) });
  },
  onChangeLocation: () => {
    fieldsStep.stop();
    globe.backToGlobe();
  },
});

// The farm's own data, fetched while the check-in runs, each source within its own time limit and
// with a live status the checklist and the check-up show (src/data/farmLoad.js, farmSources.js).
// Nothing here is a stand-in: what doesn't arrive stays missing and the check-up says so.
//   crops      USDA Cropland Data Layer (live USDA outlines have 2023 only; AI and drawn: none)
//   soil       USDA NRCS SSURGO at a point in each field
//   slope      elevation tiles (USGS 3DEP in the US)
//   rain       NASA POWER at the middle of the farm
//   greenness  NASA HLS via Planetary Computer (one request per field per pass)
//   market     the county's crops, yields and prices from USDA NASS (src/data/market.js)
const MERGE = { crops: withCdlYears, soil: withSoil, slope: withSlope, rain: withRain, greenness: withNdvi };
let farmLoad = null;
function startFieldFill(fields) {
  farmLoad?.cancel(); // a newer pick replaces the last one's late answers
  const known = (f) => Object.fromEntries((demoRecordFor(f)?.cropHistory || []).map((c) => [c.year, c.crop]));
  const runners = farmRunners({ markets, known });
  // a saved farm: only what's missing is fetched (the other sources skip fields that already have theirs)
  if (fields.length > 0 && fields.every((f) => f.rain)) runners.rain = async ({ settle }) => settle('done');
  const load = startFarmLoad({
    fields,
    point: farmPoint(fields),
    runners,
    current: () => app.fields,
    onData: (key, filled) => {
      if (farmLoad !== load || !MERGE[key] || !filled) return;
      app.fields = MERGE[key](app.fields, filled);
      persist();
      if (app.island) paintStatuses(); // landed after the reveal: the flags can use it
    },
  });
  // the check-up's "Still checking…", "Couldn't reach…" and the data itself, as each source settles
  load.tracker.subscribe(() => { if (farmLoad === load && fieldPanel.openId) fieldPanel.update(reportFor(fieldPanel.openId)); });
  farmLoad = load;
  return load;
}

/** The middle of the farm ([lng, lat]), or null with no fields. */
function farmPoint(fields) {
  return fields?.length ? centroid(featureCollection(fields.map((f) => turfFeature(f.geometry)))).geometry.coordinates : null;
}

// the farm's market data: its county (FCC), the crops grown there and their USDA NASS yields and
// prices, fetched for where the farm really is (src/data/market.js). When NASS or the county lookup
// can't be reached (or this site has no NASS connection), the bundled late-2025 Iowa price levels
// stand in, and every gap line says so; when NASS answers that it has nothing here, no plans.
const markets = createMarkets({ thisYear: () => today().getFullYear() });
async function farmMarket() {
  const point = farmPoint(app.fields);
  const practice = farmIrrigation(app.fields, app.farmProfile) === 'irrigated' ? 'irrigated' : 'non-irrigated';
  // the load already found NASS out of reach: don't keep the plans waiting on it again
  const known = farmLoad?.tracker.get('market');
  if (known?.state === 'failed' && String(farmLoad.point) === String(point)) return standInMarket(known.reason, { practice });
  const m = await markets.forFarm(point, { practice });
  return !m.ok && m.failed ? standInMarket(m.reason, { practice }) : m;
}

// the rotation planner (src/vendor/rotation-maxxing), in a Web Worker
const planner = createPlanner();
/** Three plans for the next 3 seasons for the farm as it stands (see src/plan/planner.js). */
const planSeasons = async () => planner.plans({ fields: app.fields, place: app.farm, profile: app.farmProfile, market: await farmMarket(), firstSeason: firstSeason(today()) });
/** Scores a plan picked field by field (or built by hand) on the farm as it stands. */
const evaluateMix = async (plan) => planner.evaluate({ fields: app.fields, place: app.farm, profile: app.farmProfile, market: await farmMarket(), plan, firstSeason: firstSeason(today()) });

/** Manami steps aside (out of sight and the tab order) while the check-up, the plans or the jar test are open. */
function syncManami() {
  const cl = document.body.classList;
  const away = cl.contains('checkup-open') || cl.contains('plans-open') || cl.contains('jar-open') || cl.contains('ask-open');
  document.getElementById('manami').inert = away;
}

/**
 * The plans the check-up's weather words may come from: the plans panel's, while they were made
 * for the farm as it is now (no field switched to irrigated or back, no jar test come or gone
 * since); null otherwise, until there are new plans. (Worked out again only when the farm or the
 * plans change.)
 */
let weatherMemo = null;
function weatherPlans() {
  const data = plansPanel.data;
  if (!data) return null;
  const m = weatherMemo;
  if (!m || m.data !== data || m.fields !== app.fields || m.profile !== app.farmProfile || m.place !== app.farm) {
    let ok = false;
    try {
      const now = plannerFarm({ fields: app.fields, place: app.farm, profile: app.farmProfile, firstSeason: firstSeason(today()), market: data.marketData }).farm;
      ok = weatherKey(now) === weatherKey(data.farm);
    } catch (e) { console.error('weather plans', e); }
    weatherMemo = { data, fields: app.fields, profile: app.farmProfile, place: app.farm, ok };
  }
  return weatherMemo.ok ? data : null;
}

/**
 * A field's check-up (flags, soil, slope, rain, greenness, its jar test) from what the app knows
 * now; once there are plans for the farm as it stands, Manami's weather words for it too.
 */
function reportFor(id) {
  const f = app.fields.find((x) => x.id === id);
  if (!f) return null;
  let planWeather = null;
  try {
    const data = weatherPlans();
    const irrigated = !!app.farmProfile?.irrigatedFieldIds?.includes(f.id);
    planWeather = data ? fieldWeatherNote(data, f.id, { startYear: firstSeason(today()), irrigated }) : null;
  } catch (e) { console.error('weather note', e); }
  const status = farmLoad ? Object.fromEntries(['crops', 'soil', 'slope', 'rain', 'greenness'].map((k) => [k, farmLoad.tracker.fieldState(k, id)])) : {};
  return fieldReportFor(f, { profile: app.farmProfile, planWeather, status });
}
/** Colours every status dot in the hub's list from Manami's flags. */
function paintStatuses() {
  for (const f of app.fields) hub.setStatus(f.id, reportFor(f.id)?.status || 'unknown');
}

// Manami's AI helpers (server/ai): Ask Manami, her take on the plans and her read on a field. They
// all read the farm through this one host. Without an AI server (GitHub Pages, no key) they hide.
const AI_ENDPOINT = aiEndpoint(import.meta.env.VITE_AI_ENDPOINT, import.meta.env.BASE_URL);
const aiHost = {
  fields: () => app.fields,
  report: (id) => reportFor(id),
  profile: () => app.farmProfile,
  place: () => app.farm,
  plansData: () => plansPanel.data,
  savedPlan: () => (app.plan ? { source: app.plan.source === 'ai' ? 'ai' : app.plan.choice ? 'pick' : 'built', startYear: app.plan.startYear } : null),
  today: () => today(),
};
const fieldRead = {
  available: () => adviceRoutes(AI_ENDPOINT).then((r) => r.has('field')),
  sig: (r) => JSON.stringify(fieldDetail(r)),
  ask: async (r) => {
    const res = await askAdvice(AI_ENDPOINT, 'field', fieldBody(aiHost, r));
    return res.read ? res : { line: adviceFailLine(res.error) };
  },
};

const fieldPanel = createFieldPanel({
  fieldRead,
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
    persist();
    return clean;
  },
  onIrrigated: (id, on) => {
    const p = app.farmProfile || (app.farmProfile = { priorities: ['profit'], irrigatedFieldIds: [], excludedCrops: [] });
    const ids = new Set(p.irrigatedFieldIds || []);
    if (on) ids.add(id); else ids.delete(id);
    app.farmProfile = { ...p, irrigatedFieldIds: [...ids] };
    persist();
    fieldPanel.update(reportFor(id));
    paintStatuses();
  },
  onAsk: (id, opener) => askManami.open({ focus: { kind: 'field', field_id: id, name: nameOf(id) }, opener }),
  onCrops: (id, edits) => setCrops(id, edits),
  // "Try again" on a source that couldn't be reached: ask it again for whatever failed
  onRetry: (id, source) => { farmLoad?.retry(source).then(() => { if (fieldPanel.openId) fieldPanel.update(reportFor(fieldPanel.openId)); }); },
  onJar: (id, mode) => {
    if (mode === 'remove') removeJar(id, { from: 'checkup' });
    else jarPanel.open({ fieldId: id, step: mode === 'open' ? 'result' : 'howto', from: 'checkup' });
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
  // (not over the plans: on a wide screen the island shows beside them, but they keep the keys)
  onJarTap: (id) => { if (!plansPanel.isOpen) jarPanel.open({ fieldId: id, step: 'result', from: 'island' }); },
  // the camera's floor is measured over the festival's things at full size (they pop in)
  atFullTheme: (fn) => { const tt = timeTravel.session; return tt?.atFullTheme ? tt.atFullTheme(fn) : fn(); },
});

// "Plan my next seasons": the planner's three plans, a pick per field, and a preview on the island
const plansPanel = createPlansPanel({
  planSeasons,
  today: () => today(),
  getSaved: () => app.plan?.plan || null, // "Build your own" starts from the plan saved last
  evaluateMix,
  aiTake: createPlanTake({ endpoint: AI_ENDPOINT, buildBody: () => planBody(aiHost), evaluate: evaluateMix }),
  onOpen: () => {
    jarPanel.close({ restore: false }); // (the jar test, if it was open over the farm)
    openSeq++; // a "See them on the farm" still loading stays shut
    planFutures?.stop(); // back from the plans on the island
    islandPlanner.stop(); // back from planning on the island, or opened over it
    hub.overview(); // the whole farm behind it, any field check-up closed
    queueMicrotask(syncManami);
  },
  onClose: () => {
    syncManami();
  },
  onPreview: (info) => showPlanOnIsland(info, 0),
  onFutures: (kind, opts) => openFutures(kind, opts),
  onIsland: (builder, { startYear }) => {
    if (!app.island?.view) return;
    islandPlanner.start(builder, { startYear, view: app.island.view });
  },
  onSave: (plan, info) => {
    const saved = app.plan = { plan, ...info }; // the season loop (Phase 5) builds on this
    persist();
    // the planner's numbers for it go with it (cash, a bad year, soil, how often it beats keeping going)
    evaluateMix(plan).then((r) => {
      if (app.plan !== saved || !r) return;
      const scores = Object.fromEntries(['expectedGM', 'p10GM', 'soilHealth', 'endSoilHealth', 'probBeatsCurrent'].filter((k) => Number.isFinite(r[k])).map((k) => [k, r[k]]));
      if (Object.keys(scores).length) { saved.scores = scores; persist(); }
    }).catch(() => { /* saved without them */ });
    // a plan picked plan by plan can be seen on the farm again (a hand-built one is "Plan on the island")
    const actions = info.choice ? [{ label: 'See it on the farm', onClick: () => openFutures('mix', { reel: false }) }] : [];
    manami.say(`Saved. That’s your plan for ${info.startYear} to ${info.startYear + 2}. You can change it any time from “Plan my next seasons”.`, { actions, focus: true });
  },
});

// a plan picked for a field in the table is kept with the farm
$('plansBody').addEventListener('click', (e) => { if (e.target.closest('.plan-cell')) persist(); });

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
    setChoice: (c) => { plansPanel.setChoice(c); persist(); },
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
    onJar: (id) => jarPanel.open({ fieldId: id, step: 'howto', from: 'futures' }),
    hasJar: (id) => !!app.fields.find((f) => f.id === id)?.jar,
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

// ---------------------------------------------------------------- the soil jar test
// The dialog (src/screens/jarPanel.js) turns a photo of a settled jar into a field's sand, silt
// and clay. "Use" saves it on the field (field.jar, src/plan/jarTest.js toRecord): the planner
// plans with that texture, the check-up shows it, and the jar stands by the field's gate
// (src/island/jarProps.js), where a tap opens it again.
const jarSession = new Map(); // fieldId -> this session's photo and layers (never saved)
let jars = null;
let jarFrameOff = null;
let jarOccasion; // the festival the jars were last placed for
const jarInert = new Map(); // what the dialog made inert -> whether it was before
/** Each field's jar test in use (one whose record is for that field). */
const jarRecords = () => app.fields.filter((f) => f.jar && f.jar.fieldId === f.id).map((f) => f.jar);
const nameOf = (id) => app.fields.find((f) => f.id === id)?.name || 'this field';

const jarPanel = createJarPanel({
  getFields: () => app.fields,
  isDemoFarm: () => !!app.farm?.demo,
  getMapTexture: (id) => reportFor(id)?.soil?.texture ?? null,
  session: jarSession,
  onOpen: () => {
    // the field list, and the plan view's dock and card, wait while it's open
    for (const id of ['hubPanel', 'futDock', 'futCard', 'futNotes']) {
      const el = $(id);
      if (el && !jarInert.has(el)) { jarInert.set(el, el.inert); el.inert = true; }
    }
    hub.session?.clearHover();
    syncManami();
  },
  onClose: () => {
    for (const [el, was] of jarInert) el.inert = was;
    jarInert.clear();
    // the field list from how things are now, not as they were at open (the plans may have shut since)
    const list = $('hubPanel');
    if (list) list.inert = !!planFutures?.active || islandPlanner.active;
    syncManami();
  },
  onUse: (record, { from }) => useJar(record, from),
  onRemove: (id, { from }) => removeJar(id, { from }),
});
$('hubJar').addEventListener('click', () => jarPanel.open({ fieldId: app.openFieldId, from: 'farm' }));

/** Puts a jar test on a field (or takes it off, with null): the app, the island, the check-up. */
function setJar(id, record) {
  const prev = app.fields.find((f) => f.id === id)?.jar ?? null;
  const put = (list) => list.map((f) => (f.id === id ? { ...f, jar: record || null } : f));
  app.fields = put(app.fields);
  if (app.island) app.island.fields = put(app.island.fields);
  const spots = jars?.set(jarRecords()) ?? new Map();
  persist();
  hub.session?.repick();
  paintStatuses();
  if (fieldPanel.openId === id) fieldPanel.update(reportFor(id));
  return { prev, spots };
}

/**
 * The farmer's own crop history for a field ({ year: cropKey | null }, or 'restore' for USDA's
 * record): the app, the island's crops (now and each year on record), the field list, the check-up.
 * The plans and Ask Manami read app.fields, so they use it from the next time they look.
 */
function setCrops(id, edits) {
  const f = app.fields.find((x) => x.id === id);
  if (!f) return;
  const next = edits === 'restore' ? restoreCrops(f) : applyCropEdits(f, edits);
  if (next === f) return;
  app.fields = app.fields.map((x) => (x.id === id ? next : x));
  persist(); // on this device, and in the account when signed in
  // "now" on the island: the field's latest year on record
  const last = [...(reportFor(id)?.history || [])].reverse().find((h) => h.crop != null) || null;
  const key = last?.key || 'other';
  if (app.island) app.island.fields = app.island.fields.map((x) => (x.id === id ? { ...x, crop: last?.crop ?? null, cropKey: key } : x));
  hub.setLastCrop(id, key, last?.label || 'No crop on record');
  if (timeTravel.session) timeTravel.session.setHistory(cropHistories(), new Map([[id, key]]));
  else hub.setRowCrop(id, null);
  paintStatuses();
  if (fieldPanel.openId === id) fieldPanel.update(reportFor(id));
}

/** After a jar test came or went from the plan view: the plans again, on that field's card. */
function replanFutures() {
  const s = planFutures.state;
  planFutures.stop();
  // (with a card open, she says it in the card)
  return openFutures(s.view, { reel: false, card: s.cardId, said: JAR_LINES.replanned }).then(() => {
    if (planFutures?.active && !planFutures.state.cardId) manami.say(JAR_LINES.replanned);
  });
}

/** "Use for West 140": the jar test goes on the field, the camera flies to the jar, Manami says so. */
function useJar(record, from) {
  const id = record.fieldId;
  const name = nameOf(id);
  const { prev, spots } = setJar(id, record);
  if (from === 'futures' && planFutures?.active) { replanFutures(); return; }
  if (app.openFieldId) hub.overview(); // the check-up steps aside, so she can say it (it shows the jar when opened again)
  const focus = jars?.focusFor(id);
  if (focus) hub.focusOn(focus, 0.75);
  const rj = reportFor(id)?.jar;
  const line = rj?.noSurvey ? JAR_LINES.noSurvey(name, record.textureClass) : rj?.sameAsMap ? JAR_LINES.same(name) : JAR_LINES.used(name, record.textureClass, jars ? spots.get(id)?.by ?? 'none' : null); // ('none': the island is full there just now, at a festival say)
  manami.say(line, {
    actions: [
      { label: 'See the new plans', primary: true, onClick: () => plansPanel.open() },
      {
        label: 'Undo',
        onClick: () => {
          setJar(id, prev);
          manami.say(prev ? `Okay, ${name} is back on your earlier jar test.` : JAR_LINES.undone(name), { focus: true });
        },
      },
    ],
    focus: true,
  });
}

/** "Stop using it": the field goes back on the soil map. */
function removeJar(id, { from } = {}) {
  if (!app.fields.find((f) => f.id === id)?.jar) return;
  const name = nameOf(id);
  setJar(id, null);
  const line = JAR_LINES.undone(name);
  if (from === 'futures' && planFutures?.active) { replanFutures(); return; }
  if (fieldPanel.openId === id) {
    // said in the check-up (she's tucked away while it's open)
    fieldPanel.jarNote(id, line);
    if (!fieldPanel.el.contains(document.activeElement)) fieldPanel.el.querySelector('[data-jar]')?.focus({ preventScroll: true });
    return;
  }
  manami.say(line, { actions: [{ label: 'See the new plans', primary: true, onClick: () => plansPanel.open() }], focus: true });
}

/** The jars on a new island: built once their materials are compiled, tapped through the hub. */
function startJars(island) {
  stopJars();
  const mine = createJars(island.view, {
    getName: (id) => app.fields.find((f) => f.id === id)?.name ?? null,
    // the festival's things measured at the size they'll pop in to (so a jar moves before they reach it)
    getKeepOuts: () => {
      const measure = () => jarKeepOuts(island.view.island);
      const tt = timeTravel.session;
      return tt?.atFullTheme ? tt.atFullTheme(measure) : measure();
    },
    onChange: () => hub.session?.repick(), // a jar moved or went: the tooltip and cursor look again
  });
  jars = mine;
  jarOccasion = timeTravel.session?.state?.occasion ?? null;
  jarFrameOff = island.view.onFrame((dt) => {
    // a festival came or went (by date, or picked in the day panel; a new crop year doesn't say so):
    // the jars check their spots at once, against its things at full size, and once more after
    // they've all grown in (JAR_SETTLE)
    const occasion = timeTravel.session?.state?.occasion ?? null;
    if (occasion !== jarOccasion) {
      jarOccasion = occasion;
      mine.refresh();
    }
    mine.step(dt);
  });
  hub.setPropPicker((origin, dir) => mine.pick(origin, dir));
  mine.prewarm(island.view.camera).then(() => {
    if (jars === mine) { mine.set(jarRecords()); hub.session?.repick(); }
  });
}
function stopJars() {
  jarFrameOff?.();
  jarFrameOff = null;
  jars?.dispose();
  jars = null;
  hub.setPropPicker(null);
}

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

/**
 * ?nocrops=soybeans,oats: the crops the farm can't grow, as if picked in the check-in (dev and demos;
 * only the check-in's own crop keys count). With soybeans out, Manami's pick sows winter wheat, so
 * the plan views show its spring freezes.
 */
function noCropsParam() {
  const keys = new Set(CROPS.map((c) => c.key));
  return [...new Set((params.get('nocrops') || '').split(',').map((k) => k.trim().toLowerCase()))].filter((k) => keys.has(k));
}

/**
 * ?crops=cotton,rice,orchard (or ?crops=new for every crop added after the first eleven): the demo
 * fields grow these this year, one after another (dev and demos, with ?hub= or ?reveal=; use
 * ?hub=15 to see more of them at once).
 */
function cropsParam() {
  const raw = (params.get('crops') || '').split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (raw.includes('new')) return CROP_KEYS.slice(CROP_KEYS.indexOf('other') + 1);
  return raw.filter((k) => CROP_KEYS.includes(k));
}

// ---------------------------------------------------------------- the farm's weather
// The real weather at the farm (src/services/weatherFeed.js, every 20 minutes) shows on the island
// (through farmWeather, src/island/weatherState.js, which the island and anything else can follow).
// ?weather=rain|snow|storm|fog|clear|cloudy|wind previews a look instead (the popover's Weather row
// can go back to Live). Offline, the farm just has fair weather.
let weatherFeed = null;
let weatherSaid = false; // Manami mentions the live weather once
let weatherSayAt = 0;
let weatherRetry = 0;
if (weatherParam(params.get('weather'))) farmWeather.pick(weatherParam(params.get('weather')));

/** Where the farm is: the place it was found at, or the middle of its fields. */
function farmPlace() {
  if (Number.isFinite(app.farm?.lat) && Number.isFinite(app.farm?.lon)) return { lat: app.farm.lat, lon: app.farm.lon };
  const ring = (g) => (g?.type === 'MultiPolygon' ? g.coordinates?.[0]?.[0] : g?.coordinates?.[0]) || [];
  const pts = app.fields.flatMap((f) => ring(f.geometry)).filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]));
  if (!pts.length) return null;
  return { lat: pts.reduce((a, p) => a + p[1], 0) / pts.length, lon: pts.reduce((a, p) => a + p[0], 0) / pts.length };
}

function startWeather() {
  stopWeather();
  weatherSayAt = Date.now() + 9000; // (after her hello on the island has been read)
  weatherFeed = startWeatherFeed({ place: farmPlace, onReading: (r) => farmWeather.setLive(r) });
}
function stopWeather() {
  weatherFeed?.stop();
  weatherFeed = null;
  farmWeather.setLive(null);
  clearTimeout(weatherRetry);
}

/** "It's raining at your farm right now, so it's raining here too." Once, when she's free to say it. */
function sayWeather() {
  clearTimeout(weatherRetry);
  const s = farmWeather.state;
  const line = s.source === 'live' ? weatherLine(s.look) : null;
  if (weatherSaid || !line || !app.island || !weatherFeed) return;
  const busy = Date.now() < weatherSayAt || document.hidden
    || !manami.el.querySelector('.manami__actions')?.hidden // she's asking something
    || document.body.classList.contains('plans-open') || document.body.classList.contains('checkup-open')
    || jarInert.size > 0 || planFutures?.active || islandPlanner.active || timeTravel.session?.mode === 'playing';
  if (busy) { weatherRetry = setTimeout(sayWeather, 8000); return; }
  weatherSaid = true;
  manami.say(line);
}
farmWeather.subscribe(sayWeather);

/** Today, or ?today=2026-12-24 to preview a season or holiday (dev and demos). */
function today() {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.get('today') || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : new Date();
}

// ---------------------------------------------------------------- the guided walkthrough
// Manami shows the farmer round the hub the first time it appears (src/ui/walkthrough.js); the "?"
// on Your fields plays it again. It opens a field's check-up and the plans to show them, and closes
// what it opened.
const tour = createWalkthrough({
  sources: SOURCES,
  say: (line) => { if (app.island) manami.say(line); },
  ctx: {
    isOpen: (need) => (need === 'checkup' ? !!app.openFieldId : need === 'plans' ? plansPanel.isOpen : false),
    openField: () => {
      const id = document.querySelector('#hubList .hub-field')?.dataset.id || app.fields[0]?.id;
      if (id) hub.select(id);
    },
    closeField: () => hub.overview(),
    openPlans: () => plansPanel.open(),
    closePlans: () => plansPanel.close(),
  },
});
$('hubHelp').addEventListener('click', () => tour.start());
const TOUR_AFTER_MS = 1400; // Manami's hello on the island first

const reveal = createReveal({
  map: globe.map,
  manami,
  onDone: (island) => {
    document.body.classList.add('reveal-done');
    app.island = island;
    hub.show(island); // the farm's home screen from here on
    paintStatuses();
    startJars(island); // each field's soil jar test, by its gate
    startWeather();
    timeTravel.show(island, { history: cropHistories(), today: today(), hour: hourParam(), liveDate: !params.has('today'), weather: farmWeather });
    // the farm's sounds follow the time of day, the season and the festival (after the first tap)
    ambience.attach({ getScene: () => sceneOf(timeTravel.session), hasWindmill: () => !!island.view.spinners?.length });
    farmSpins?.dispose();
    farmSpins = createFarmSpins(island.view); // now and then Manami turns on the spot: "When they see me rotate…"
    if (restoredLine) { manami.say(restoredLine); restoredLine = null; } // a saved farm, opened again
    seaLife?.dispose();
    // an orca, dolphins and fish round the island, and now and then a whale (dev: ?whale=1 brings it)
    seaLife = createSeaLife(island.view, { manami, date: today(), whaleNow: import.meta.env.DEV && params.has('whale') });
    // the first time the hub appears, Manami shows the farmer round (not over a dialog, nor a dev shortcut's plans)
    setTimeout(() => {
      const busy = plansPanel.isOpen || planFutures?.active || islandPlanner.active || document.body.classList.contains('jar-open');
      if (app.island === island && !busy) tour.maybeAutoStart();
    }, TOUR_AFTER_MS);
    // dev shortcut: ?hub=5&futures=1 opens the plans on the island with Manami's walk, &futures=explore without
    if (import.meta.env.DEV && params.has('futures') && !app.futuresShown) {
      app.futuresShown = true;
      plansPanel.ensureData().then(() => openFutures('priority', { reel: params.get('futures') !== 'explore' }));
    }
  },
});

let farmSpins = null;
let seaLife = null;
// the island's ambient sound, and its switch on the top bar (src/audio/)
// "Ask Manami": questions about the farm, answered by Claude through the app's own server (server/ai).
// Her tools read the farm here; without the server (GitHub Pages, or no key) she says so plainly.
// signed in, her conversations are kept in the account (one thread per farm, reopened next time)
const conversations = createConversationStore({
  getClient: () => auth.client(),
  getUser: () => auth.user,
  getFarmId: () => (saveCtx && auth.user ? local.get(saveCtx.id)?.cloud?.[auth.user.id]?.id ?? null : null),
});
const askManami = createAskManami({
  endpoint: AI_ENDPOINT,
  host: aiHost,
  conversations: { latest: () => conversations.latest(), save: (m, o) => conversations.save(m, o), startNew: () => conversations.startNew(), forget: () => conversations.forget() },
  onOpen: () => syncManami(),
  onClose: () => syncManami(),
});
// the "Ask me" button beside her face (shown on the farm hub only)
{
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'manami__ask';
  b.id = 'askOpen';
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h16v10H10l-4.5 3.5V15.5H4z" fill="currentColor" fill-opacity=".2"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/></svg><span>Ask me</span>';
  b.addEventListener('click', () => askManami.open({ focus: null, opener: b }));
  $('manami').appendChild(b);
}

const ambience = createAmbience();
bindSoundToggle($('hubSound'), ambience);

function startReveal({ instant = false } = {}) {
  tour.stop();
  farmSpins?.dispose();
  farmSpins = null;
  seaLife?.dispose();
  seaLife = null;
  jarPanel.close({ restore: false });
  stopJars();
  jarSession.clear();
  document.body.classList.remove('reveal-done');
  fieldPanel.close();
  openSeq++;
  planFutures?.stop();
  islandPlanner.stop();
  timeTravel.hide();
  ambience.detach();
  hub.hide();
  reveal.start({ fields: app.fields, farm: app.farm, instant });
  setTimeout(() => checkIn.stop(), 400); // once the island view has faded in over it
}

const checkIn = createCheckIn({
  manami,
  onDone: async (profile) => {
    app.farmProfile = profile;
    persist();
    console.log('farmProfile', profile);
    // (the check-in only ends once every data source has settled, so the island has the crop years)
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
  document.body.classList.toggle('finder-on', visible); // (the account button shows with it)
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
      if (!restoring) fieldsStep.start(event.place); // (a saved farm goes straight to its island)
      break;
    case 'returned':
      tour.stop();
      farmSpins?.dispose();
      farmSpins = null;
      seaLife?.dispose();
      seaLife = null;
      jarPanel.close({ restore: false });
      stopJars();
      jarSession.clear();
      stopWeather();
      app.farm = null;
      app.fields = [];
      app.farmProfile = null;
      app.plan = null;
      saveCtx = null;
      fieldPanel.close();
      openSeq++;
      planFutures?.stop();
      islandPlanner.stop();
      timeTravel.hide();
      ambience.detach();
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
  copies: for (const [k, [dx, dy]] of offsets.entries()) {
    for (const f of base) {
      if (out.length >= n) break copies;
      out.push(k === 0 ? f : { ...f, id: `${f.id}-copy${k}`, name: `${f.name} ${k + 1}`, sourceIds: [`${f.sourceIds[0]}-copy${k}`], geometry: shift(f.geometry, dx, dy) });
    }
  }
  // ?crops=: this year's crop on each field in turn (the island shows a field's latest year)
  const grow = cropsParam();
  if (grow.length) {
    return out.map((f, i) => {
      const year = Object.keys(f.crops || {}).sort().pop() || String(HISTORY_YEARS[HISTORY_YEARS.length - 1]);
      return { ...f, crops: { ...f.crops, [year]: grow[i % grow.length] } };
    });
  }
  return out;
}

// ---------------------------------------------------------------- saved farms: opening one again
/**
 * Opens a saved farm: straight to its island with everything as it was (the time slider, the
 * check-ups, the jars, the plan and picks); only data that never arrived is asked for again. A farm
 * saved before the check-in was finished picks up at the check-in.
 */
function openSaved(snap) {
  journeyStarted = true;
  introDone = true;
  saveCtx = { id: snap.id };
  askManami.resetSaved(); // her last conversation about this farm, not the one on screen before
  local.setCurrent(snap.id);
  app.plan = snap.plan || null;
  restoring = true;
  try {
    globe.flyTo(snap.farm); // ('flying' then 'landed', at once)
    globe.landNow();
  } finally {
    restoring = false;
  }
  app.farm = snap.farm;
  app.fields = snap.fields;
  app.farmProfile = snap.profile;
  if (snap.picks) plansPanel.setChoice(snap.picks);
  const load = startFieldFill(app.fields);
  if (!snap.profile) {
    checkIn.start({ fields: app.fields, load });
    return;
  }
  restoredLine = `Welcome back to ${farmName(snap.farm)}! Everything’s just as you left it.`;
  startReveal({ instant: true });
}

/** Reloads the app on its own address (no dev shortcut), after leaving a note for the next load. */
function reloadWith(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* then it simply starts at the globe */ }
  const u = new URL(location.href);
  for (const k of ['hub', 'reveal', 'demo', 'futures', 'tour']) u.searchParams.delete(k);
  u.hash = '';
  location.assign(u.toString());
}
/** A note left by reloadWith, read once. */
function takeNote(key) {
  try {
    const v = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return v;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- how the panels share the screen
// The layers are listed at the top of styles.css. The rules, kept here in one place:
//   1. One workspace at a time: the plans, the jar test, the plans on the farm, planning on the island
//      (each one closes the others when it opens).
//   2. A workspace covers the farm, so the farm's own controls under it wait (the year bar, inert and
//      dimmed). The header (the logo, "Plan my next seasons", your farms) stays live.
//   3. Popovers (the time of day, your farms) close as soon as anything else opens.
//   4. Ask Manami is a side panel: a workspace opening closes it (Ask me / Ask about this field bring
//      it back, on top of the check-up if one is open).
const WORKSPACES = ['plans-open', 'jar-open', 'plan-futures', 'isle-planning'];
const SHEETS = ['checkup-open', 'ask-open'];
let surfacesWere = new Set();
function syncSurfaces() {
  const cl = document.body.classList;
  const now = new Set([...WORKSPACES, ...SHEETS, 'acct-open'].filter((c) => cl.contains(c)));
  const opened = [...now].filter((c) => !surfacesWere.has(c));
  surfacesWere = now;
  if (opened.length) timeTravel.closeDay();
  if (opened.some((c) => c !== 'acct-open') && account?.isOpen) account.close({ restoreFocus: false });
  if (opened.some((c) => WORKSPACES.includes(c)) && askManami.isOpen) askManami.close();
  const busy = cl.contains('plans-open') || cl.contains('jar-open');
  const bar = $('timebar');
  if (bar && bar.inert !== busy) bar.inert = busy;
}
new MutationObserver(syncSurfaces).observe(document.body, { attributes: true, attributeFilter: ['class'] });
// While the plans are open the field list stays live beside them: a field picked there shows its row
// in the plans (instead of opening its check-up under them). "Test your soil" switches to the jar test.
for (const type of ['click', 'keydown']) {
  $('hubList').addEventListener(type, (e) => {
    if (!plansPanel.isOpen || (type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
    const row = e.target.closest?.('[data-id]');
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    plansPanel.showField(row.dataset.id);
  }, true);
}
// the time-of-day popover has no class on <body>: watch it, so the two popovers never show together
new MutationObserver(() => { if (!$('dayPop').hidden && account?.isOpen) account.close({ restoreFocus: false }); })
  .observe($('dayPop'), { attributes: true, attributeFilter: ['hidden'] });

account = createAccountPanel({
  auth,
  sync,
  getCloud,
  local,
  getOpen: () => ({ localId: saveCtx?.id ?? null, demo: !!app.farm?.demo, busy: journeyStarted }),
  onOpenFarm: (localId) => {
    if (saveCtx?.id === localId && journeyStarted) return;
    if (journeyStarted) { localSaver.flush(); reloadWith('rm.open', localId); return; } // a clean start for the other farm
    const snap = local.get(localId);
    if (snap) openSaved(snap);
  },
  onNewFarm: () => { localSaver.flush(); reloadWith('rm.fresh', '1'); },
  onDeletedOpen: (localId) => {
    if (saveCtx?.id !== localId) return;
    saveCtx = null; // it stays on screen, unsaved
    localSaver.cancel();
  },
});

// a session from before, or coming back from a sign-in link (supabase-js loads only then)
const authReady = auth.pending ? auth.init() : Promise.resolve({ user: null, linkError: null });
authReady.then(({ user, linkError }) => {
  sync.setUser(user);
  account.refresh();
  if (linkError) {
    account.notice(linkError.expired
      ? 'That sign-in link has expired or was already used. Pop your email in again and I’ll send a new one.'
      : 'That sign-in link didn’t work. Pop your email in again and I’ll send a new one.');
  }
});
auth.onChange((user) => { sync.setUser(user); account.refresh(); askManami.resetSaved(); });

/** "Welcome back! Open West Farm?" for the farm saved last (or, signed in, the newest in the account). */
function offerSaved(snapOrRow, { signedIn = false } = {}) {
  const name = snapOrRow.snap ? farmName(snapOrRow.snap.farm) : snapOrRow.name;
  const hello = signedIn ? 'You’re signed in! ' : '';
  manami.say(`${hello}Welcome back! Open ${name}?`, {
    actions: [
      {
        label: 'Open',
        primary: true,
        onClick: async () => {
          if (journeyStarted) return;
          if (snapOrRow.snap) { openSaved(snapOrRow.snap); return; }
          manami.say(`Opening ${name}…`);
          try {
            const snap = await (await getCloud()).loadFarm(snapOrRow.id, auth.user.id);
            if (!snap?.fields.length || !local.put(snap)) throw new Error('nothing to open');
            if (!journeyStarted) openSaved(snap);
          } catch (e) {
            console.warn('Open farm', e);
            if (!journeyStarted) manami.say('I couldn’t open it just now. Let’s find a farm: type an address or a county.');
          }
        },
      },
      {
        label: 'Start a new farm',
        onClick: () => {
          if (journeyStarted) return;
          manami.say(HELLO);
          search.focus();
        },
      },
    ],
    focus: true,
  });
}

if (import.meta.env.DEV) window.__sheep = { app, globe, manami, search, fieldsStep, checkIn, farmData, reveal, hub, fieldPanel, timeTravel, planner, planSeasons, plansPanel, islandPlanner, testFields, futures: () => planFutures, markets, farmMarket, jarPanel, tour, jars: () => jars, jarSession, rotateManami: () => farmSpins?.now(), ambience, weather: farmWeather, whale: () => seaLife?.whale(), seaLife: () => seaLife, local, sync, auth, account }; // for poking at in the console

// ---------------------------------------------------------------- the first five seconds
(async function intro() {
  // the globe fades in already turning; if it's slow to load, don't keep the farmer waiting
  await Promise.race([globe.ready, wait(2500)]);
  warmUpLiveOutlines(); // open the live outline files while the globe spins, so the first farm is quicker
  if (params.has('reveal') || params.has('hub')) {
    // dev shortcuts: ?reveal=1|5|15 jumps to the island reveal with demo fields, ?hub=1|5|15 straight to the hub
    // (&nocrops=soybeans: the farm can't grow those)
    const key = params.has('hub') ? 'hub' : 'reveal';
    globe.flyTo(DEMO_FARM);
    globe.landNow();
    introDone = true;
    await wait(600);
    app.fields = testFields(Number(params.get(key)) || 5);
    const load = startFieldFill(app.fields);
    app.farmProfile = { priorities: ['profit'], irrigatedFieldIds: [], excludedCrops: noCropsParam() };
    fieldsStep.hold();
    // ?hub goes straight in (the data fills in behind); ?reveal shows the checklist until it's all in
    if (key === 'hub') startReveal({ instant: true });
    else if (await checkIn.wait({ load })) startReveal();
    return;
  }
  if (params.has('demo')) { // dev shortcut: ?demo flies to the demo farm, ?demo=land lands at once
    globe.flyTo(DEMO_FARM);
    if (params.get('demo') === 'land') globe.landNow();
    introDone = true;
    return;
  }
  // a farm picked in "Your farms" (the page reloaded for it), or "Start a new farm"
  const asked = takeNote('rm.open');
  const fresh = takeNote('rm.fresh');
  const askedSnap = asked ? local.get(asked) : null;
  if (askedSnap) { openSaved(askedSnap); return; }
  const saved = fresh ? null : local.current();
  await wait(INTRO.searchAfterMs);
  if (!journeyStarted) {
    setFinder(true);
    if (!saved) search.focus();
  }
  await wait(INTRO.manamiAfterMs - INTRO.searchAfterMs);
  introDone = true;
  if (journeyStarted) return;
  // signed in on a new device: the newest farm in the account (a quick look; never holds the page up)
  const a = await Promise.race([authReady, wait(2500).then(() => ({}))]);
  if (journeyStarted) return;
  let row = null;
  if (!saved && !fresh && a.user) {
    try {
      const farms = await Promise.race([getCloud().then((c) => c.listFarms(a.user.id)), wait(4000).then(() => [])]);
      row = farms.find((f) => f.fields > 0) || null;
    } catch { /* tables not there yet, or offline: start as usual */ }
    if (journeyStarted) return;
  }
  if (saved) offerSaved({ snap: saved }, { signedIn: !!a.justSignedIn });
  else if (row) offerSaved(row, { signedIn: !!a.justSignedIn });
  else if (a.justSignedIn) manami.say('You’re signed in, so I’ll keep your farms in your account. Let’s find your farm!');
  else manami.say(fallbackNote ? `${HELLO} ${fallbackNote}` : HELLO);
})();
