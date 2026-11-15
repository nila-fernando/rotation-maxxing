// Step 2 · Pick your fields.
//
// Tier 1, Select (default): ready-made outlines (USDA crop field boundaries, or AI-detected ones)
//   fade in over the satellite map. Hover shows the acreage, click adds a field, lasso adds every
//   field inside, clicking a chosen field takes it back out.
// Tier 2, Edit: drag corners, add a corner by dragging an edge's middle handle, merge two fields,
//   split one with a line, delete.
// Tier 3, Draw: CAD-style polygon (click corners, double-click or Enter to close) and circle (for
//   center pivots). Corners snap to outline edges and existing fields (hold Alt to place freely).
// Keys: Esc cancels, Ctrl+Z / Ctrl+Shift+Z undo and redo (while drawing, Ctrl+Z takes back the last
//   corner), Delete removes the selected corner (or the picked fields), Backspace takes back a corner.
//   With the map focused: arrow keys pan, Enter adds the field under the cross, Space places a corner.
// Touch: tap a second field in Edit to pick two for Merge; the toolbar's Delete removes a selected corner.
import L from 'leaflet';
import { booleanPointInPolygon, kinks } from '@turf/turf';
import { findFieldBySourceId } from '../data/farmData.js';
import { createFieldStore } from '../fields/store.js';
import { bboxAround, LIVE } from '../fields/liveOutlines.js';
import { latestCrop, loadSources, OUTLINE_LAYERS, outlinesFor } from '../fields/outlines.js';
import {
  acresOf, bboxOf, circleGeometry, createSnapIndex, formatAcres, idsInLasso, insertVertex, isSimplePolygon,
  labelPoint, mergeGeometries, midpointPaths, moveVertex, removeVertex, splitGeometry, vertexPaths,
} from '../fields/geometry.js';

const SNAP_PX = 12;
const FINISH_PX = 12; // clicking this close to the first corner closes the polygon
const DRAG_START_PX = 4; // a lasso starts once the pointer has moved this far (a plain click stays a click)
const compact = matchMedia('(max-width: 900px)'); // tools on top, the list as a bottom sheet
const coarse = matchMedia('(pointer: coarse)');
const DEFAULT_TOOLS = { select: 'click', draw: 'polygon', edit: 'corners' };
/** The most fields the app plans for at once (the island reveal is designed for 1–15). */
export const MAX_FIELDS = 15;
const SLOW_OUTLINES_MS = 10000; // after this, Manami suggests drawing while the outlines keep coming
/** Outlines only show this close in (individual fields readable); further out they're just clutter. */
const OUTLINE_MIN_ZOOM = 14;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const STYLE = {
  outline: { usda: '#fff4dc', ai: '#bfe9ff' },
  outlineHover: '#ffd866',
  field: { color: '#4f9d63', weight: 3, fillColor: '#8fd8a4', fillOpacity: 0.38, opacity: 1 },
  fieldHot: { color: '#24502f', weight: 4, fillColor: '#8fd8a4', fillOpacity: 0.55, opacity: 1 },
  fieldPicked: { color: '#b8665e', weight: 4, fillColor: '#f6c3bb', fillOpacity: 0.3, opacity: 1 },
  sketch: { color: '#ffd866', weight: 3, dashArray: '8 6', fillColor: '#ffd866', fillOpacity: 0.18 },
};

const metersPerPixel = (map, lat) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** (map.getZoom() + 8);
const toLngLat = (ll) => [ll.lng, ll.lat];
const toLatLng = ([lng, lat]) => L.latLng(lat, lng);
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const inBox = ([x, y], b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
const kinkCount = (g) => { try { return kinks(g).features.length; } catch { return Infinity; } };
/** Some source outlines already have rings touching at a point; an edit is fine if it adds no new crossings. */
const editKeepsShape = (before, after) => !!after && acresOf(after) > 0.01 && kinkCount(after) <= kinkCount(before);
const isTouch = (ev) => ev && (ev.pointerType === 'touch' || ev.pointerType === 'pen' || ev.sourceCapabilities?.firesTouchEvents);

/**
 * @param {object} o
 * @param {L.Map} o.map                  the satellite map from the globe screen
 * @param {{say: Function, collapse: Function}} o.manami
 * @param {(fields: object[]) => void} o.onContinue
 * @param {() => void} o.onChangeLocation
 */
export function createFieldsStep({ map, manami, onContinue, onChangeLocation }) {
  const $ = (id) => document.getElementById(id);
  const ui = $('fieldsUi');
  const toolbar = $('toolbar');
  const hintEl = $('toolHint');
  const listEl = $('fieldList');
  const container = map.getContainer();

  // ---------------------------------------------------------------- panes and layers
  const pane = (name, z) => { const p = map.getPane(name) || map.createPane(name); p.style.zIndex = z; return p; };
  const outlinePane = pane('outlines', 410);
  pane('fields', 420);
  pane('fieldLabels', 430);
  pane('sketch', 440);
  outlinePane.classList.add('outline-pane');
  const outlineRenderer = L.canvas({ pane: 'outlines', tolerance: 3, padding: 0.3 });
  const fieldRenderer = L.svg({ pane: 'fields' });
  const sketchRenderer = L.svg({ pane: 'sketch' });
  const fieldLayer = L.layerGroup();
  const labelLayer = L.layerGroup();
  const sketchLayer = L.layerGroup();
  const handleLayer = L.layerGroup();
  const snapMarker = L.circleMarker([0, 0], {
    renderer: sketchRenderer, radius: 7, color: '#24502f', weight: 3, fillColor: '#fff', fillOpacity: 1, interactive: false,
  });

  // ---------------------------------------------------------------- state
  let active = false;
  let held = false; // handed over to the next step, fields still drawn
  let store = null;
  let unsubscribe = null;
  let farm = null;
  let mode = 'select';
  let tools = { ...DEFAULT_TOOLS };
  let outlineKey = 'usda';
  let outlines = null; // the loaded layer that's showing, or null
  // one map layer per dataset (the bundled demo county and the live layer are both "usda", so the
  // dataset object itself is the key): data -> {layer: L.GeoJSON, byId: Map(id -> L.Path), color}
  const outlineLayers = new Map();
  const currentEntry = () => (outlines ? outlineLayers.get(outlines) : null);
  const isClose = () => map.getZoom() >= OUTLINE_MIN_ZOOM;
  /** Outlines are on and we're close enough to see (and click, lasso, snap to) them. */
  const showing = () => !!outlines && isClose();
  let picked = []; // field ids picked in Edit mode (up to 2)
  let activeVertex = null; // {fieldId, path, geometry} for Delete; geometry is the shape it was picked on
  let sketch = null; // {kind: 'polygon'|'split'|'circle'|'lasso', points: L.LatLng[], ...}
  let press = null; // a press-and-drag in progress (lasso or circle)
  let snapIndex = null;
  let hotFieldId = null;
  let saidFirst = false;
  let quietClicksUntil = 0; // the click that ends a lasso or circle drag must not also pick a field
  const clickIsQuiet = () => performance.now() < quietClicksUntil;
  let takenCache = { fields: null, data: null, version: -1, set: new Set() };
  let outlineVersion = 0; // bumped when live outlines arrive, so caches built on the old set are redone
  const liveSubs = new Map(); // live layer -> unsubscribe
  let viewTimer = 0;
  let waitingToZoomIn = false; // landed far out; Manami introduces the outlines once they first show
  let startRun = 0; // one per start(): async steps of an older visit stop when it changes
  let outlineGen = 0; // bumped by every setOutlines / start / detach, so a slow load from before can't land later
  let autoOff = false; // outlines were switched off by us (slow service), not by the farmer

  // ---------------------------------------------------------------- start / stop
  /** Starts fetching the outlines while the globe is still flying. */
  /** Starts fetching the farm's outlines while the globe is still flying. */
  function preload(place) {
    loadSources();
    if (!place) return;
    outlinesFor('usda', place).then((l) => l.live && l.ensure(bboxAround([place.lon, place.lat], 2))).catch(() => {});
  }

  async function start(place) {
    if (active || held) stop();
    const run = ++startRun;
    const alive = () => active && run === startRun; // the same visit (the demo farm is always the same object)
    active = true;
    farm = place;
    store = createFieldStore({ center: [place.lon, place.lat] });
    unsubscribe = store.subscribe(onFieldsChanged);
    tools = { ...DEFAULT_TOOLS };
    waitingToZoomIn = false;
    autoOff = false;
    outlineGen++;
    picked = [];
    activeVertex = null;
    saidFirst = false;
    ui.hidden = false;
    document.body.classList.add('fields-on');
    fieldLayer.addTo(map);
    labelLayer.addTo(map);
    sketchLayer.addTo(map);
    handleLayer.addTo(map);
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.on('click', onMapClick);
    map.on('mousemove', onMapMove);
    map.on('dblclick', onMapDblClick);
    map.on('moveend zoomend', onViewChanged);
    container.addEventListener('pointerdown', onPointerDown, true);
    container.addEventListener('focus', onMapFocus);
    addEventListener('keydown', onKey);
    setMode('select', { quiet: true });
    renderAll();

    const usda = await outlinesFor('usda', place);
    if (!alive()) return;
    if (!isClose()) { // e.g. a whole county: outlines come in once they zoom in on their farm
      await setOutlines('usda', { quiet: true });
      if (alive()) {
        waitingToZoomIn = true;
        manami.say('Zoom in on your farm and I’ll outline the fields for you to pick.');
      }
      return;
    }
    if (usda.live) {
      manami.say('I’m pulling up the USDA field outlines for this spot…');
      setHint('Fetching field outlines…');
    }
    // the tile under the middle of the view is enough to start; the rest stream in as they land
    const firstTile = usda.ensure(centerBbox(), { zoom: map.getZoom() }).then(() => 'ok', () => 'failed');
    usda.ensure(viewBbox(), { zoom: map.getZoom() }).catch(() => {});
    const first = await Promise.race([firstTile, wait(SLOW_OUTLINES_MS).then(() => 'slow')]);
    if (!alive()) return;
    if (first === 'ok') {
      await setOutlines('usda', { quiet: true });
      if (!alive()) return;
      if (hasOutlinesHere(usda)) manami.say(introLine(place, usda));
      else noOutlinesHere('none');
    } else if (first === 'slow') {
      await setOutlines('off', { quiet: true });
      autoOff = true;
      setMode('draw', { quiet: true });
      manami.say('The field outlines are taking a while. You can start drawing your fields, and I’ll bring the outlines in when they arrive.');
      const late = await firstTile;
      // only switch over if the farmer hasn't changed anything in the meantime
      if (!alive() || !autoOff || outlineKey !== 'off' || store.fields.length || sketch) return;
      if (late === 'failed') { manami.say('I couldn’t reach the field outline service after all, so drawing is the way to go here.'); return; }
      setMode('select', { quiet: true });
      await setOutlines('usda', { quiet: true });
      if (alive() && outlines) manami.say(hasOutlinesHere(usda) ? `The outlines are here! ${introLine(place, usda)}` : 'The outlines arrived, but there are none right here. Drawing is the way to go.');
    } else {
      noOutlinesHere('failed');
    }
  }

  async function noOutlinesHere(why) {
    const place = farm;
    await setOutlines('off', { quiet: true });
    if (!alive()) return;
    setMode('draw', { quiet: true });
    manami.say(why === 'failed'
      ? 'I can’t reach the field outline service right now, so let’s draw your fields. Click each corner, then double-click to finish.'
      : 'I couldn’t find any field outlines here, so let’s draw your fields. Click each corner, then double-click to finish.');
  }

  /** A tiny box at the middle of the view: loads just the tile the farm is in. */
  function centerBbox() {
    const c = map.getCenter();
    return [c.lng - 1e-4, c.lat - 1e-4, c.lng + 1e-4, c.lat + 1e-4];
  }

  function introLine(place, data) {
    if (place.demo) return 'Here’s the farm! I’ve outlined the fields from USDA crop maps. Click yours to pick them, or use the lasso to grab a whole block.';
    if (data.live) return 'I’ve outlined the fields around here from USDA crop maps, with what each grew in 2023. Click yours to pick them, or use the lasso to grab a whole block.';
    return 'I’ve outlined the fields around here from USDA crop maps. Click yours to pick them, or use the lasso to grab a whole block.';
  }

  /** The map view as [w, s, e, n], a little bigger so fields at the edges are whole. */
  function viewBbox() {
    const b = map.getBounds().pad(0.15);
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  /** Whether a layer has any outline near the middle of the view. */
  function hasOutlinesHere(data) {
    const b = map.getBounds().pad(0.5);
    return data.items.some((it) => b.contains(toLatLng(it.label)));
  }

  /** Leaves the step and clears everything off the map. */
  function stop() {
    if (active) detach();
    held = false;
    unsubscribe?.();
    unsubscribe = null;
    store = null;
    [fieldLayer, labelLayer].forEach((l) => { l.clearLayers(); l.remove(); });
  }

  /**
   * Hands over to the next step: the tools and list go away, but the chosen fields stay drawn
   * on the map (plain, numbered) underneath whatever comes next.
   */
  function hold() {
    if (!active) return;
    picked = [];
    activeVertex = null;
    detach();
    held = true;
    renderFields();
  }

  function detach() {
    outlineGen++;
    clearTimeout(viewTimer);
    liveSubs.forEach((unsub) => unsub());
    liveSubs.clear();
    cancelSketch();
    active = false;
    press = null;
    ui.hidden = true;
    document.body.classList.remove('fields-on', 'tool-crosshair', 'tool-lasso', 'tool-press', 'mode-select', 'mode-draw', 'mode-edit');
    [sketchLayer, handleLayer].forEach((l) => { l.clearLayers(); l.remove(); });
    outlineLayers.forEach(({ layer }) => layer.remove());
    outlines = null;
    snapMarker.remove();
    map.dragging.enable();
    map.doubleClickZoom.enable();
    map.boxZoom.enable();
    map.off('click', onMapClick);
    map.off('mousemove', onMapMove);
    map.off('dblclick', onMapDblClick);
    map.off('moveend zoomend', onViewChanged);
    container.removeEventListener('pointerdown', onPointerDown, true);
    container.removeEventListener('focus', onMapFocus);
    removeEventListener('keydown', onKey);
  }

  // ---------------------------------------------------------------- outline layers
  async function setOutlines(key, { quiet = false } = {}) {
    const gen = ++outlineGen;
    const stale = () => !active || gen !== outlineGen;
    outlineKey = key;
    document.querySelectorAll('[data-outlines]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.outlines === key)));
    outlineLayers.forEach(({ layer }) => layer.remove());
    outlines = null;
    snapIndex = null;
    if (key !== 'off') {
      const data = farm ? await outlinesFor(key, farm) : null;
      if (stale()) return;
      let failed = !data;
      if (data?.live && isClose()) {
        setHint('Fetching field outlines…');
        // the centre tile is enough to show them; the rest of the view streams in
        data.ensure(viewBbox(), { zoom: map.getZoom() }).catch(() => {});
        failed = await data.ensure(centerBbox(), { zoom: map.getZoom() }).then(() => false, () => true);
        if (stale()) return;
      }
      if (failed) {
        if (!quiet) manami.say(`I can’t get the ${OUTLINE_LAYERS[key].label} outlines right now.`);
        return setOutlines('off', { quiet: true });
      }
      outlines = data;
      const entry = outlineLayers.get(data) || buildOutlineLayer(data);
      outlineLayers.set(data, entry);
      outlineLayers.forEach((other) => { if (other !== entry) other.layer.remove(); }); // only ever one on the map
      if (data.live) {
        syncLiveEntry(entry, data); // tiles that arrived while we weren't listening (e.g. during the flight)
        if (!liveSubs.has(data)) liveSubs.set(data, data.subscribe((change) => onOutlinesGrew(data, change)));
      }
      restyleOutlines();
      applyOutlineVisibility();
      if (key === 'ai' && !quiet) {
        manami.say('These outlines come from an AI model reading Sentinel-2 satellite images. Handy as a second opinion where the USDA ones look off.');
      } else if (!quiet && isClose() && !hasOutlinesHere(data)) {
        manami.say(`The ${OUTLINE_LAYERS[key].label} outlines don’t cover this spot.`);
      }
    }
    updateCredit();
    updateCount();
    if (!sketch) setHint(defaultHint());
  }

  function buildOutlineLayer(data) {
    const byId = new Map();
    const color = STYLE.outline[data.key] || STYLE.outline.usda;
    const layer = L.geoJSON(
      { type: 'FeatureCollection', features: data.items.map((it) => ({ type: 'Feature', properties: { id: it.id }, geometry: it.geometry })) },
      {
        renderer: outlineRenderer,
        style: () => ({ color, weight: 1.8, opacity: 0.9, fillColor: color, fillOpacity: 0.05 }),
        onEachFeature: (feature, path) => {
          const item = data.byId.get(feature.properties.id);
          byId.set(item.id, path);
          path.on('mouseover', () => {
            if (mode !== 'select' || sketch) return;
            path.setStyle({ color: STYLE.outlineHover, weight: 3, fillColor: STYLE.outlineHover, fillOpacity: 0.2 });
            const crop = latestCrop(item.crops);
            path.bindTooltip(`<b>${formatAcres(item.acres ?? acresOf(item.geometry))}</b>${crop ? `<small>${crop}</small>` : ''}`, {
              sticky: true, direction: 'top', offset: [0, -14], className: 'acre-tip', opacity: 1,
            }).openTooltip();
          });
          path.on('mouseout', () => {
            path.closeTooltip();
            path.unbindTooltip();
            restyleOutline(item.id, path);
          });
          path.on('click', (e) => {
            if (mode !== 'select' || sketch || clickIsQuiet()) return;
            L.DomEvent.stop(e);
            pickOutline(item);
          });
        },
      },
    );
    return { layer, byId, color };
  }

  /** Live outlines arrived (new fields, or a field cut by a tile edge got its other piece). */
  function onOutlinesGrew(data, { added, replaced, before }) {
    outlineVersion++; // even while this layer isn't showing, so takenIds isn't stale when it comes back
    const entry = outlineLayers.get(data);
    // a field picked from half an outline (its other half was still on the next tile) grows with it
    if (store && before) {
      const grown = replaced.flatMap((item) => store.growFromSource(item.id, before.get(item.id)?.geometry, item.geometry));
      if (grown.length && active) flashHint(`${grown.map((f) => f.name).join(', ')} grew to the whole field (${grown.map((f) => formatAcres(f.acres)).join(', ')}).`);
    }
    if (!entry) return;
    for (const item of replaced) {
      const old = entry.byId.get(item.id);
      if (old) { entry.layer.removeLayer(old); entry.byId.delete(item.id); }
    }
    const fresh = [...added, ...replaced];
    entry.layer.addData({ type: 'FeatureCollection', features: fresh.map((it) => ({ type: 'Feature', properties: { id: it.id }, geometry: it.geometry })) });
    if (!active || outlines !== data) return;
    snapIndex = null;
    fresh.forEach((it) => { const path = entry.byId.get(it.id); if (path) restyleOutline(it.id, path); });
    updateCount();
  }

  /** Brings a live layer's map paths up to date with its items (new fields, and fields that grew). */
  function syncLiveEntry(entry, data) {
    const stale = data.items.filter((it) => entry.byId.get(it.id)?.feature?.geometry !== it.geometry);
    if (!stale.length) return;
    for (const it of stale) {
      const old = entry.byId.get(it.id);
      if (old) { entry.layer.removeLayer(old); entry.byId.delete(it.id); }
    }
    entry.layer.addData({ type: 'FeatureCollection', features: stale.map((it) => ({ type: 'Feature', properties: { id: it.id }, geometry: it.geometry })) });
    outlineVersion++;
  }

  /** Shows the outline layer only when zoomed in close; fades it in when it appears. */
  function applyOutlineVisibility() {
    const entry = currentEntry();
    if (!entry) return;
    const want = isClose();
    if (want !== map.hasLayer(entry.layer)) {
      snapIndex = null; // hidden outlines aren't snapped to
      if (want) {
        outlinePane.classList.remove('is-shown');
        entry.layer.addTo(map);
        requestAnimationFrame(() => requestAnimationFrame(() => outlinePane.classList.add('is-shown')));
      } else {
        entry.layer.remove();
      }
    }
    if (!sketch) setHint(defaultHint());
    if (want) maybeIntroduce();
  }

  /** After landing far out: once outlines first show around them, Manami explains them. */
  function maybeIntroduce() {
    if (!waitingToZoomIn || !showing() || !hasOutlinesHere(outlines)) return false;
    waitingToZoomIn = false;
    manami.say(introLine(farm, outlines));
    return true;
  }

  /** As the map moves: outlines show or hide with the zoom, and live layers fetch the new view. */
  function onViewChanged() {
    applyOutlineVisibility();
    updateCount();
    clearTimeout(viewTimer);
    if (!outlines?.live || map.getZoom() < OUTLINE_MIN_ZOOM - 1) return; // start fetching one level early
    viewTimer = setTimeout(async () => {
      if (!active || !outlines?.live) return;
      const data = outlines;
      await data.ensure(viewBbox(), { zoom: map.getZoom() }).catch(() => null);
      if (!active || sketch || outlines !== data || !isClose()) return;
      if (!maybeIntroduce() && mode === 'select' && !hasOutlinesHere(data)) {
        flashHint('No field outlines here. Use Draw to add your fields.');
      }
    }, 350);
  }

  /**
   * Outlines already under a chosen field, whatever layer they came from: the field's own source
   * outlines, plus any outline (USDA or AI) whose middle lies inside a chosen field. Cached per change.
   */
  function takenIds() {
    if (!store) return new Set();
    const fields = store.fields;
    if (takenCache.fields === fields && takenCache.data === outlines && takenCache.version === outlineVersion) return takenCache.set;
    const set = new Set();
    fields.forEach((f) => f.sourceIds.forEach((id) => set.add(id)));
    if (outlines && fields.length) {
      const boxes = fields.map((f) => ({ f, b: bboxOf(f.geometry) }));
      for (const it of outlines.items) {
        if (set.has(it.id)) continue;
        for (const { f, b } of boxes) {
          if (inBox(it.label, b) && booleanPointInPolygon(it.label, f.geometry)) { set.add(it.id); break; }
        }
      }
    }
    takenCache = { fields, data: outlines, version: outlineVersion, set };
    return set;
  }

  function restyleOutline(id, path) {
    const entry = currentEntry();
    if (!entry) return;
    const taken = takenIds().has(id);
    path.setStyle(taken
      ? { opacity: 0, fillOpacity: 0 }
      : { color: entry.color, weight: 1.8, opacity: 0.9, fillColor: entry.color, fillOpacity: 0.05 });
    path.options.interactive = !taken && mode === 'select';
  }

  function restyleOutlines() {
    const entry = currentEntry();
    if (!entry || !outlines) return;
    entry.byId.forEach((path, id) => restyleOutline(id, path));
  }


  /** Credits the outlines showing, plus the AI dataset (CC BY) while any field came from it. */
  async function updateCredit() {
    const sources = await loadSources();
    const lines = new Set();
    if (outlines) lines.add(outlines.attribution || sources?.layers?.[outlineKey]?.attribution);
    const aiIds = (store?.fields || []).flatMap((f) => f.sourceIds).filter((id) => id.startsWith('ai-'));
    if (aiIds.some((id) => /^ai-[A-Z]{2}-/.test(id))) lines.add(LIVE.ai.attribution);
    if (aiIds.some((id) => !/^ai-[A-Z]{2}-/.test(id))) lines.add(sources?.layers?.ai?.attribution);
    const text = [...lines].filter(Boolean).join(' · ');
    $('outlineCredit').textContent = text ? `Outlines: ${text}` : '';
  }

  // ---------------------------------------------------------------- picking outlines
  /** A field from an outline; the demo farm's own fields come with their farmer names ("Home place"). */
  function outlineInit(item) {
    return {
      geometry: item.geometry, source: outlines.key, sourceIds: [item.id], crops: item.crops,
      name: findFieldBySourceId(item.id)?.name ?? null,
    };
  }

  /** How many more fields fit; says so when there's no room. */
  function roomLeft() {
    const room = MAX_FIELDS - store.fields.length;
    if (room <= 0) manami.say(`That’s ${MAX_FIELDS} fields, the most I can plan at once. Take one out to add another.`);
    return room;
  }

  function pickOutline(item) {
    if (takenIds().has(item.id) || roomLeft() <= 0) return;
    const [f] = store.add(outlineInit(item), 'select');
    // the second click of a double-click would land on the new field and take it straight back out
    quietClicksUntil = performance.now() + 400;
    if (!saidFirst) {
      saidFirst = true;
      manami.say(`Got it: ${f.name}, ${formatAcres(f.acres)}. Keep clicking to add more. You can rename any field in the list.`);
    } else {
      flashHint(`Added ${f.name} · ${formatAcres(f.acres)}`);
    }
  }

  function lassoPick(ring) {
    if (!showing()) {
      if (outlines) flashHint('Zoom in closer so the field outlines show, then lasso them.');
      else manami.say('Turn the field outlines on to lasso them, or draw your fields.');
      return;
    }
    const taken = takenIds();
    // number them in reading order: north to south in ~500 m bands, then west to east
    const band = (it) => Math.round(-it.label[1] * 200);
    const items = idsInLasso(ring, outlines.items).filter((id) => !taken.has(id))
      .map((id) => outlines.byId.get(id))
      .sort((a, b) => band(a) - band(b) || a.label[0] - b.label[0]);
    if (!items.length) {
      flashHint('No new fields inside that loop.');
      return;
    }
    const room = roomLeft();
    if (room <= 0) return;
    const capped = items.length > room;
    const made = store.add(items.slice(0, room).map(outlineInit), 'lasso');
    if (capped) {
      manami.say(`I added ${made.length} of them: that makes ${MAX_FIELDS}, the most I can plan at once.`);
      saidFirst = true;
      return;
    }
    saidFirst = true;
    const acres = made.reduce((s, f) => s + f.acres, 0);
    manami.say(`Added ${plural(made.length, 'field')} (${formatAcres(acres)}). Click any of them to take it back out.`);
  }

  /** Keyboard route: the outline (or chosen field) under the middle of the map. */
  function pickAtCenter() {
    const c = toLngLat(map.getCenter());
    const mine = store.fields.find((f) => inBox(c, bboxOf(f.geometry)) && booleanPointInPolygon(c, f.geometry));
    if (mine) {
      store.remove(mine.id, 'deselect');
      flashHint(`Took out ${mine.name}. Ctrl+Z puts it back.`);
      return;
    }
    if (outlines && !isClose()) { flashHint('Zoom in closer (+) so the field outlines show.'); return; }
    const it = outlines?.items.find((x) => inBox(c, x.bbox) && booleanPointInPolygon(c, x.geometry));
    if (it && !takenIds().has(it.id)) pickOutline(it);
    else flashHint('No field outline under the cross. Use the arrow keys to move the map.');
  }

  // ---------------------------------------------------------------- modes and tools
  function setMode(next, { quiet = false } = {}) {
    cancelSketch();
    mode = next;
    if (mode !== 'edit') { picked = []; activeVertex = null; tools.edit = 'corners'; }
    toolbar.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    toolbar.querySelectorAll('.toolbar__sub').forEach((g) => { g.hidden = g.dataset.for !== mode; });
    restyleOutlines();
    applyTool();
    renderFields();
    renderHandles();
    updateButtons();
    if (!quiet && mode === 'edit' && store?.fields.length === 0) manami.say('Pick some fields first, then come back to fix their edges.');
  }

  function setTool(name) {
    cancelSketch();
    tools[mode] = name;
    applyTool();
  }

  function applyTool() {
    const tool = tools[mode];
    toolbar.querySelectorAll(`.toolbar__sub[data-for="${mode}"] [data-tool]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    const crosshair = mode === 'draw' || (mode === 'edit' && tool === 'split');
    const lasso = mode === 'select' && tool === 'lasso';
    const pressTool = lasso || (mode === 'draw' && tool === 'circle');
    const cls = document.body.classList;
    cls.toggle('tool-crosshair', crosshair);
    cls.toggle('tool-lasso', lasso);
    cls.toggle('tool-press', pressTool); // touch-action: none, so a finger draws instead of panning
    cls.toggle('mode-select', mode === 'select');
    cls.toggle('mode-draw', mode === 'draw');
    cls.toggle('mode-edit', mode === 'edit');
    // pressing and dragging means drawing for these tools, so the map can't pan with the mouse
    if (pressTool) map.dragging.disable();
    else if (!press) map.dragging.enable();
    setHint(defaultHint());
  }

  function defaultHint() {
    const tap = coarse.matches ? 'Tap' : 'Click';
    if (mode === 'select') {
      if (tools.select === 'lasso') return `Drag a loop around the fields you want. ${tap} a chosen field to take it out.`;
      if (outlines && !isClose()) return 'Zoom in closer to see the field outlines.';
      return outlines ? `${tap} fields to add them.${coarse.matches ? ' Use Lasso to grab a block.' : ' Hold Shift and drag to lasso.'}` : 'Outlines are off. Switch them on, or use Draw.';
    }
    if (mode === 'draw') {
      return tools.draw === 'circle'
        ? 'Press at the pivot’s center and drag out to its edge.'
        : `${tap} each corner. Double-${tap.toLowerCase()} or press Enter to finish. Esc cancels.`;
    }
    if (tools.edit === 'split') return `Draw a line across the field, then double-${tap.toLowerCase()} or press Enter to cut.`;
    if (picked.length === 0) return coarse.matches ? 'Tap a field to edit it. Tap a second one to merge them.' : 'Click a field to edit its corners. Shift-click a second field to merge.';
    if (picked.length === 2) return 'Two fields picked: press Merge to make them one.';
    return 'Drag a corner to move it, or drag a middle dot to add one. Select a corner, then Delete removes it.';
  }

  function setHint(text) {
    hintEl.textContent = text;
    hintEl.hidden = !text;
  }
  let hintTimer = 0;
  function flashHint(text) {
    setHint(text);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { if (!sketch && active) setHint(defaultHint()); }, 2600);
  }

  function onMapFocus() {
    if (!active || !document.body.classList.contains('kbd-nav')) return;
    if (mode === 'select') setHint('Arrow keys move the map. Enter adds the field under the cross.');
    else if (mode === 'draw' && tools.draw === 'polygon') setHint('Arrow keys move the map. Space places a corner at the cross, Enter finishes.');
  }

  // ---------------------------------------------------------------- snapping
  function getSnapIndex() {
    if (!snapIndex) {
      const items = (store?.fields || []).map((f) => ({ id: f.id, geometry: f.geometry }));
      // hidden (taken) outlines would pull a field's own corners back to where they were;
      // outlines off-screen because we're zoomed out aren't snapped to either
      if (showing()) {
        const taken = takenIds();
        items.push(...outlines.items.filter((it) => !taken.has(it.id)));
      }
      snapIndex = items.length ? createSnapIndex(items) : null;
    }
    return snapIndex;
  }

  /** Snaps a point to the nearest outline or field corner/edge within a few pixels. Alt turns it off. */
  function snap(latlng, { excludeId, free = false } = {}) {
    if (free) return { latlng, snapped: false };
    const index = getSnapIndex();
    if (!index) return { latlng, snapped: false };
    const tol = SNAP_PX * metersPerPixel(map, latlng.lat);
    const hit = index.query(toLngLat(latlng), tol, { excludeId });
    return hit ? { latlng: toLatLng(hit.point), snapped: true, kind: hit.kind } : { latlng, snapped: false };
  }

  function showSnap(s) {
    if (s.snapped) {
      snapMarker.setLatLng(s.latlng);
      if (!map.hasLayer(snapMarker)) snapMarker.addTo(map);
    } else {
      snapMarker.remove();
    }
  }

  // ---------------------------------------------------------------- sketches (polygon, split line, circle, lasso)
  /** Drops whatever is being drawn. Splitting is a one-off, so leaving it goes back to corner editing. */
  function cancelSketch() {
    const wasSplit = sketch?.kind === 'split' || tools.edit === 'split';
    sketch = null;
    sketchLayer.clearLayers();
    snapMarker.remove();
    if (wasSplit) {
      tools.edit = 'corners';
      if (active) { applyTool(); renderHandles(); updateButtons(); }
    } else if (active) {
      setHint(defaultHint());
    }
  }

  /** Takes back the last corner of a polygon or split line; an empty sketch is cancelled. */
  function popSketchPoint() {
    sketch.points.pop();
    if (!sketch.points.length) cancelSketch();
    else drawSketch();
  }

  function drawSketch(cursor) {
    sketchLayer.clearLayers();
    if (!sketch) return;
    const pts = cursor ? [...sketch.points, cursor] : sketch.points;
    if (sketch.kind === 'polygon') {
      if (pts.length >= 3) L.polygon(pts, { ...STYLE.sketch, renderer: sketchRenderer, interactive: false }).addTo(sketchLayer);
      else if (pts.length >= 2) L.polyline(pts, { ...STYLE.sketch, renderer: sketchRenderer, interactive: false }).addTo(sketchLayer);
      sketch.points.forEach((p, i) => L.circleMarker(p, {
        renderer: sketchRenderer, radius: i === 0 ? 7 : 5, color: '#5e4232', weight: 2, fillColor: '#ffd866', fillOpacity: 1, interactive: false,
      }).addTo(sketchLayer));
      if (pts.length >= 3) {
        const ring = [...pts.map(toLngLat), toLngLat(pts[0])];
        setHint(`${formatAcres(acresOf({ type: 'Polygon', coordinates: [ring] }))} · double-click or Enter to finish · Backspace takes back a corner`);
      }
    } else if (sketch.kind === 'split') {
      if (pts.length >= 2) L.polyline(pts, { color: '#fff', weight: 3, dashArray: '6 6', renderer: sketchRenderer, interactive: false }).addTo(sketchLayer);
      sketch.points.forEach((p) => L.circleMarker(p, { renderer: sketchRenderer, radius: 5, color: '#5e4232', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(sketchLayer));
    } else if (sketch.kind === 'circle' && sketch.radius > 0) {
      const g = circleGeometry(toLngLat(sketch.center), sketch.radius);
      L.geoJSON(g, { style: { ...STYLE.sketch }, renderer: sketchRenderer, interactive: false }).addTo(sketchLayer);
      L.circleMarker(sketch.center, { renderer: sketchRenderer, radius: 4, color: '#5e4232', fillColor: '#ffd866', fillOpacity: 1, interactive: false }).addTo(sketchLayer);
      const feet = Math.round(sketch.radius * 3.28084);
      setHint(`Radius ${feet.toLocaleString('en-US')} ft · ${formatAcres(acresOf(g))}`);
    } else if (sketch.kind === 'lasso' && pts.length >= 2) {
      L.polygon(pts, { color: '#ffd866', weight: 2, dashArray: '5 5', fillColor: '#ffd866', fillOpacity: 0.12, renderer: sketchRenderer, interactive: false }).addTo(sketchLayer);
    }
  }

  function addPolygonCorner(latlng) {
    if (!sketch) sketch = { kind: 'polygon', points: [] };
    const first = sketch.points[0];
    if (first && sketch.points.length >= 3
      && map.latLngToContainerPoint(first).distanceTo(map.latLngToContainerPoint(latlng)) <= FINISH_PX) {
      finishPolygon();
      quietClicksUntil = performance.now() + 400; // the rest of a double-click must not start a new shape
      return;
    }
    sketch.points.push(latlng);
    drawSketch();
  }

  function finishPolygon() {
    if (!sketch || sketch.kind !== 'polygon') return;
    const pts = dedupe(sketch.points);
    if (pts.length < 3) { flashHint('A field needs at least three corners.'); return; }
    const ring = [...pts.map(toLngLat), toLngLat(pts[0])];
    const geometry = { type: 'Polygon', coordinates: [ring] };
    if (!isSimplePolygon(geometry)) {
      flashHint('Those edges cross each other. Backspace to move the last corner.');
      return;
    }
    if (roomLeft() <= 0) return;
    cancelSketch();
    const [f] = store.add({ geometry, source: 'drawn' }, 'draw');
    saidFirst = true;
    manami.say(`Added ${f.name}, ${formatAcres(f.acres)}. Draw another, or press Continue when you’re done.`);
  }

  function finishSplit() {
    if (!sketch || sketch.kind !== 'split') return;
    const pts = dedupe(sketch.points);
    const field = store.get(sketch.fieldId);
    if (!field) { cancelSketch(); return; }
    if (pts.length < 2) { flashHint('Draw a line all the way across the field.'); return; }
    const res = splitGeometry(field.geometry, pts.map(toLngLat));
    if (res.error || !res.parts || res.parts.length < 2) {
      flashHint(res.error === 'multi' ? 'This field has separate parts. Draw the line across just one of them.' : 'The line has to cross the field from edge to edge.');
      return;
    }
    cancelSketch(); // back to corner editing
    const parts = [...res.parts].sort((a, b) => acresOf(b) - acresOf(a));
    const made = store.replace([field.id], parts.map((geometry, i) => ({
      geometry, source: 'split', sourceIds: field.sourceIds, crops: field.crops, name: i === 0 && !field.autoName ? field.name : null,
    })), 'split');
    picked = [made[0].id];
    renderAfterEdit();
    manami.say(`Split into ${plural(made.length, 'field')}: ${made.map((f) => `${f.name} (${formatAcres(f.acres)})`).join(', ')}.`);
  }

  function dedupe(points) {
    const out = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (!last || map.latLngToContainerPoint(p).distanceTo(map.latLngToContainerPoint(last)) > 2) out.push(p);
    }
    return out;
  }

  // ---------------------------------------------------------------- map input
  function onMapClick(e) {
    if (!active || clickIsQuiet()) return;
    const oe = e.originalEvent;
    const free = oe?.altKey;
    if (mode === 'draw' && tools.draw === 'polygon') {
      if (!sketch && oe?.detail > 1) return; // the tail of a double-click, not a new shape
      addPolygonCorner(snap(e.latlng, { free }).latlng);
    } else if (sketch?.kind === 'split') {
      sketch.points.push(snap(e.latlng, { free, excludeId: sketch.fieldId }).latlng);
      drawSketch();
    } else if (mode === 'edit' && tools.edit === 'corners') {
      // a click on empty map lets go of the picked fields
      if (picked.length || activeVertex) { picked = []; activeVertex = null; renderAfterEdit(); }
    }
  }

  function onMapDblClick(e) {
    if (!active) return;
    L.DomEvent.stop(e);
    if (sketch?.kind === 'polygon') finishPolygon();
    else if (sketch?.kind === 'split') finishSplit();
  }

  function onMapMove(e) {
    if (!active || press) return;
    const free = e.originalEvent?.altKey;
    if (mode === 'draw' && tools.draw === 'polygon') {
      const s = snap(e.latlng, { free });
      showSnap(s);
      if (sketch?.kind === 'polygon') drawSketch(s.latlng);
    } else if (sketch?.kind === 'split') {
      const s = snap(e.latlng, { free, excludeId: sketch.fieldId });
      showSnap(s);
      drawSketch(s.latlng);
    } else if (mode === 'draw' && tools.draw === 'circle') {
      showSnap(snap(e.latlng, { free }));
    } else {
      snapMarker.remove();
    }
  }

  /**
   * Press-and-drag tools: lasso (Lasso tool, or Shift in Select) and the circle tool. A lasso only
   * starts once the pointer moves, so a plain click still adds or takes out a field.
   */
  function onPointerDown(e) {
    if (!active) return;
    if (compact.matches) manami.collapse(); // on a small screen, give the map the room once they get to work
    if (e.button !== 0 || !e.isPrimary || press) return;
    if (e.target.closest('.leaflet-control, .leaflet-marker-icon')) return;
    const lasso = mode === 'select' && (tools.select === 'lasso' || e.shiftKey);
    const circle = mode === 'draw' && tools.draw === 'circle';
    if (!lasso && !circle) return;
    map.dragging.disable();
    const startPx = map.mouseEventToContainerPoint(e);
    press = { id: e.pointerId, kind: lasso ? 'lasso' : 'circle', started: false, startPx, lastPx: startPx, startLL: map.mouseEventToLatLng(e), alt: e.altKey };

    const begin = () => {
      press.started = true;
      try { container.setPointerCapture(press.id); } catch { /* not capturable; fine */ }
      sketch = press.kind === 'lasso'
        ? { kind: 'lasso', points: [press.startLL] }
        : { kind: 'circle', center: snap(press.startLL, { free: press.alt }).latlng, radius: 0 };
      snapMarker.remove();
    };
    const move = (ev) => {
      if (!press || ev.pointerId !== press.id) return;
      const px = map.mouseEventToContainerPoint(ev);
      const ll = map.mouseEventToLatLng(ev);
      if (!press.started) {
        if (px.distanceTo(press.startPx) < DRAG_START_PX) return;
        begin();
      }
      if (sketch?.kind === 'lasso') {
        if (px.distanceTo(press.lastPx) < DRAG_START_PX) return;
        press.lastPx = px;
        sketch.points.push(ll);
      } else if (sketch?.kind === 'circle') {
        sketch.radius = map.distance(sketch.center, snap(ll, { free: ev.altKey }).latlng);
      }
      drawSketch();
    };
    const end = (ev) => {
      if (!press || ev.pointerId !== press.id) return;
      container.removeEventListener('pointermove', move);
      container.removeEventListener('pointerup', end);
      container.removeEventListener('pointercancel', end);
      const { started } = press;
      press = null;
      const done = started ? sketch : null;
      if (started) {
        sketch = null;
        sketchLayer.clearLayers();
        quietClicksUntil = performance.now() + 350;
      }
      applyTool(); // restores map dragging for the click tool
      if (!active || !done || ev.type === 'pointercancel') return;
      if (done.kind === 'lasso' && done.points.length >= 3) {
        lassoPick(done.points.map(toLngLat));
      } else if (done.kind === 'circle') {
        if (done.radius < 10) { flashHint('Drag out from the center to size the circle.'); return; }
        if (roomLeft() <= 0) return;
        const [f] = store.add({ geometry: circleGeometry(toLngLat(done.center), done.radius), source: 'circle' }, 'circle');
        saidFirst = true;
        manami.say(`Added ${f.name}, a pivot of ${formatAcres(f.acres)}.`);
      }
    };
    if (circle) { // the circle starts on the press itself
      e.preventDefault();
      e.stopPropagation();
      begin();
    }
    container.addEventListener('pointermove', move);
    container.addEventListener('pointerup', end);
    container.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------- keys
  function onKey(e) {
    if (!active || isTyping(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const drawing = sketch?.kind === 'polygon' || sketch?.kind === 'split';
    if (mod && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (drawing) popSketchPoint(); // in a CAD sketch, undo takes back one corner
      else undo();
      return;
    }
    if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
    if (mod || e.altKey) return;

    // the map itself has focus: a keyboard route to picking and drawing
    if (e.target === container) {
      if (mode === 'select' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickAtCenter(); return; }
      if (mode === 'draw' && tools.draw === 'polygon' && e.key === ' ') {
        e.preventDefault();
        addPolygonCorner(snap(map.getCenter()).latlng);
        return;
      }
    }

    if (e.key === 'Escape') {
      if (sketch) { e.preventDefault(); cancelSketch(); return; }
      if (picked.length || activeVertex) { picked = []; activeVertex = null; renderAfterEdit(); }
      return;
    }
    if (e.key === 'Enter') {
      if (sketch?.kind === 'polygon') { e.preventDefault(); finishPolygon(); }
      else if (sketch?.kind === 'split') { e.preventDefault(); finishSplit(); }
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (drawing) { e.preventDefault(); popSketchPoint(); return; }
      if (sketch) return;
      if (activeVertex) { e.preventDefault(); deleteVertex(); return; }
      if (mode === 'edit' && picked.length) { e.preventDefault(); deletePicked(); }
      return;
    }
    if (e.target.closest?.('.field-panel')) return; // letters in the list shouldn't switch tools
    const shortcuts = {
      v: () => { setMode('select'); setTool('click'); },
      l: () => { setMode('select'); setTool('lasso'); },
      p: () => { setMode('draw'); setTool('polygon'); },
      c: () => { setMode('draw'); setTool('circle'); },
      e: () => setMode('edit'),
      m: () => mergePicked(),
      k: () => startSplit(),
    };
    if (shortcuts[key]) { e.preventDefault(); shortcuts[key](); }
  }

  // ---------------------------------------------------------------- edit actions
  function onFieldClick(id, e) {
    L.DomEvent.stop(e);
    if (clickIsQuiet()) return;
    const oe = e.originalEvent;
    if (mode === 'select') {
      if (sketch || oe?.detail > 1) return;
      const f = store.get(id);
      store.remove(id, 'deselect');
      flashHint(`Took out ${f.name}. Ctrl+Z puts it back.`);
    } else if (sketch?.kind === 'split' || (mode === 'draw' && tools.draw === 'polygon')) {
      // while drawing or cutting, a click on a field still places a point
      onMapClick({ latlng: e.latlng, originalEvent: oe });
    } else if (mode === 'edit' && tools.edit === 'corners') {
      const multi = oe?.shiftKey || isTouch(oe); // touch has no Shift: a second tap adds the second field
      if (picked.includes(id)) picked = multi || picked.length > 1 ? picked.filter((p) => p !== id) : picked;
      else if (multi && picked.length) picked = [picked[picked.length - 1], id];
      else picked = [id];
      activeVertex = null;
      renderAfterEdit();
    }
  }

  function mergePicked() {
    if (mode !== 'edit' || picked.length !== 2) {
      flashHint(coarse.matches ? 'Tap two touching fields first, then Merge.' : 'Shift-click two touching fields first, then Merge.');
      return;
    }
    const [a, b] = picked.map((id) => store.get(id));
    const res = mergeGeometries(a.geometry, b.geometry);
    if (res.error) {
      manami.say(res.error === 'not-touching'
        ? `${a.name} and ${b.name} don’t touch, so I can’t make them one field.`
        : 'Hmm, I couldn’t join those two. Try fixing their corners first.');
      return;
    }
    const big = a.acres >= b.acres ? a : b;
    const [f] = store.replace([a.id, b.id], [{
      geometry: res.geometry, source: 'merged', sourceIds: [...a.sourceIds, ...b.sourceIds], crops: big.crops,
      name: !a.autoName ? a.name : !b.autoName ? b.name : null,
    }], 'merge');
    picked = [f.id];
    renderAfterEdit();
    manami.say(`Merged into ${f.name}, ${formatAcres(f.acres)}.`);
  }

  function startSplit() {
    if (mode !== 'edit' || picked.length !== 1) { flashHint(`${coarse.matches ? 'Tap' : 'Click'} one field first, then Split.`); return; }
    const fieldId = picked[0];
    cancelSketch();
    tools.edit = 'split';
    sketch = { kind: 'split', fieldId, points: [] };
    activeVertex = null;
    renderHandles();
    applyTool();
    updateButtons();
  }

  function deletePicked() {
    if (!picked.length) return;
    const names = picked.map((id) => store.get(id)?.name).filter(Boolean);
    store.remove(picked, 'delete');
    picked = [];
    activeVertex = null;
    renderAfterEdit();
    flashHint(`Deleted ${names.join(' and ')}. Ctrl+Z brings ${names.length > 1 ? 'them' : 'it'} back.`);
  }

  function deleteVertex() {
    const f = store.get(activeVertex.fieldId);
    if (!f || f.geometry !== activeVertex.geometry) { activeVertex = null; renderHandles(); updateButtons(); return; }
    const g = removeVertex(f.geometry, activeVertex.path);
    if (!g) { flashHint('A field needs at least three corners.'); return; }
    if (!editKeepsShape(f.geometry, g)) { flashHint('Removing that corner would make the edges cross.'); return; }
    activeVertex = null;
    store.reshape(f.id, g);
  }

  function undo() {
    if (sketch) { cancelSketch(); return; }
    store?.undo();
  }
  function redo() { store?.redo(); }

  // ---------------------------------------------------------------- rendering
  function onFieldsChanged() {
    snapIndex = null;
    picked = picked.filter((id) => store.get(id));
    // a corner picked on an older shape (before an undo or another edit) no longer means anything
    if (activeVertex && store.get(activeVertex.fieldId)?.geometry !== activeVertex.geometry) activeVertex = null;
    if (sketch?.kind === 'split' && !store.get(sketch.fieldId)) cancelSketch();
    renderAll();
    updateCredit();
  }

  function renderAll() {
    renderFields();
    renderHandles();
    renderList();
    restyleOutlines();
    updateButtons();
    updateCount();
  }

  function renderAfterEdit() {
    renderFields();
    renderHandles();
    updateButtons();
    setHint(sketch ? hintEl.textContent : defaultHint());
  }

  function fieldStyle(id) {
    if (picked.includes(id)) return STYLE.fieldPicked;
    if (hotFieldId === id) return STYLE.fieldHot;
    return STYLE.field;
  }

  function renderFields() {
    fieldLayer.clearLayers();
    labelLayer.clearLayers();
    if (!store) return;
    store.fields.forEach((f, i) => {
      const shape = L.geoJSON(f.geometry, { renderer: fieldRenderer, style: () => fieldStyle(f.id), className: 'field-shape' });
      shape.on('click', (e) => onFieldClick(f.id, e));
      shape.on('mouseover', () => setHot(f.id));
      shape.on('mouseout', () => setHot(null));
      shape.addTo(fieldLayer);
      L.marker(toLatLng(labelPoint(f.geometry)), {
        pane: 'fieldLabels', interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'field-num-wrap', html: `<span class="field-num${picked.includes(f.id) ? ' is-picked' : ''}">${i + 1}</span>`, iconSize: [0, 0] }),
      }).addTo(labelLayer);
    });
  }

  function setHot(id) {
    if (hotFieldId === id) return;
    hotFieldId = id;
    const layers = fieldLayer.getLayers(); // same order as the list
    store?.fields.forEach((f, i) => layers[i]?.setStyle(fieldStyle(f.id)));
    listEl.querySelectorAll('.field-row').forEach((row) => row.classList.toggle('is-hot', row.dataset.id === id));
  }

  function renderHandles() {
    handleLayer.clearLayers();
    if (!store || mode !== 'edit' || tools.edit !== 'corners' || picked.length !== 1) return;
    const f = store.get(picked[0]);
    if (!f) return;
    const same = (a, b) => a && b && a.part === b.part && a.ring === b.ring && a.index === b.index;

    const corners = vertexPaths(f.geometry);
    corners.forEach(({ path, point }) => {
      const selected = activeVertex?.fieldId === f.id && same(activeVertex.path, path);
      const m = L.marker(toLatLng(point), {
        draggable: true, keyboard: false, autoPan: true,
        icon: L.divIcon({ className: `vertex-handle${selected ? ' is-selected' : ''}`, iconSize: [14, 14] }),
      });
      m.on('click', (e) => {
        L.DomEvent.stop(e);
        activeVertex = { fieldId: f.id, path, geometry: f.geometry };
        renderHandles();
        updateButtons();
        setHint(coarse.matches ? 'Corner selected: tap Delete to remove it, or drag to move it.' : 'Corner selected: press Delete to remove it, or drag to move it.');
      });
      m.on('drag', (e) => {
        const s = snap(e.latlng, { excludeId: f.id, free: e.originalEvent?.altKey });
        m.setLatLng(s.latlng);
        showSnap(s);
        previewReshape(f, moveVertex(f.geometry, path, toLngLat(s.latlng)));
      });
      m.on('dragend', () => commitReshape(f, moveVertex(f.geometry, path, toLngLat(m.getLatLng()))));
      m.addTo(handleLayer);
    });

    const cornerAt = new Map(corners.map(({ path, point }) => [`${path.part}/${path.ring}/${path.index}`, point]));
    midpointPaths(f.geometry).forEach(({ path, point }) => {
      // only on edges long enough to grab without hitting the corners
      const a = cornerAt.get(`${path.part}/${path.ring}/${path.index}`);
      if (a && map.latLngToContainerPoint(toLatLng(a)).distanceTo(map.latLngToContainerPoint(toLatLng(point))) < 16) return;
      const m = L.marker(toLatLng(point), {
        draggable: true, keyboard: false, autoPan: true,
        icon: L.divIcon({ className: 'mid-handle', iconSize: [10, 10] }),
      });
      m.on('drag', (e) => {
        const s = snap(e.latlng, { excludeId: f.id, free: e.originalEvent?.altKey });
        m.setLatLng(s.latlng);
        showSnap(s);
        previewReshape(f, insertVertex(f.geometry, path, toLngLat(s.latlng)));
      });
      m.on('dragend', () => commitReshape(f, insertVertex(f.geometry, path, toLngLat(m.getLatLng()))));
      m.addTo(handleLayer);
    });
  }

  function previewReshape(f, geometry) {
    const layer = fieldLayer.getLayers()[store.fields.indexOf(f)];
    if (!layer) return;
    layer.clearLayers();
    layer.addData(geometry);
    layer.setStyle(STYLE.fieldPicked);
  }

  function commitReshape(f, geometry) {
    snapMarker.remove();
    if (!editKeepsShape(f.geometry, geometry)) {
      flashHint('That would make the edges cross, so I put the corner back.');
      renderFields();
      renderHandles();
      return;
    }
    activeVertex = null;
    store.reshape(f.id, geometry);
  }

  // ---------------------------------------------------------------- the list
  function renderList() {
    if (!store) return;
    const fields = store.fields;
    const existing = new Map([...listEl.children].map((li) => [li.dataset.id, li]));
    fields.forEach((f, i) => {
      let li = existing.get(f.id);
      existing.delete(f.id);
      if (!li) li = makeRow(f);
      const n = i + 1;
      li.querySelector('.field-row__num').textContent = n;
      const input = li.querySelector('.field-row__name');
      if (document.activeElement !== input) input.value = f.name;
      input.setAttribute('aria-label', `Name of field ${n}`);
      // just the size here: crop history belongs to the simulation and crop-history screens
      li.querySelector('.field-row__meta').textContent = formatAcres(f.acres);
      li.querySelector('.field-row__zoom').setAttribute('aria-label', `Show ${f.name} on the map`);
      li.querySelector('.field-row__remove').setAttribute('aria-label', `Remove ${f.name}`);
      if (listEl.children[i] !== li) listEl.insertBefore(li, listEl.children[i] || null);
    });
    existing.forEach((li) => li.remove());
    $('fieldEmpty').hidden = fields.length > 0;
    $('fieldTotal').textContent = fields.length ? `${plural(fields.length, 'field')} · ${formatAcres(store.totalAcres)} in all` : '';
    $('continueBtn').disabled = fields.length === 0;
  }

  function makeRow(f) {
    const li = document.createElement('li');
    li.className = 'field-row';
    li.dataset.id = f.id;
    li.innerHTML = `
      <span class="field-row__num" aria-hidden="true"></span>
      <span class="field-row__main">
        <input class="field-row__name" type="text" maxlength="40" spellcheck="false" autocomplete="off">
        <small class="field-row__meta"></small>
      </span>
      <button class="field-row__zoom" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
      <button class="field-row__remove" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></button>`;
    const input = li.querySelector('.field-row__name');
    const save = () => store?.rename(f.id, input.value);
    input.addEventListener('change', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); input.value = store?.get(f.id)?.name || ''; input.blur(); }
    });
    li.querySelector('.field-row__zoom').addEventListener('click', () => zoomTo(f.id));
    li.querySelector('.field-row__remove').addEventListener('click', () => {
      // keep keyboard focus in the list: the next row, else the one before, else the heading
      const rows = [...listEl.children];
      const i = rows.indexOf(li);
      const next = rows[i + 1] || rows[i - 1];
      store?.remove(f.id, 'remove');
      (next?.querySelector('.field-row__remove') || $('fieldPanelTitle')).focus();
    });
    li.addEventListener('mouseenter', () => setHot(f.id));
    li.addEventListener('mouseleave', () => setHot(null));
    return li;
  }

  function zoomTo(id) {
    const f = store?.get(id);
    if (!f) return;
    const panel = $('fieldPanel').getBoundingClientRect();
    const wide = !compact.matches;
    map.flyToBounds(L.geoJSON(f.geometry).getBounds(), {
      paddingTopLeft: [wide ? 130 : 20, wide ? 90 : 130],
      paddingBottomRight: [wide ? panel.width + 40 : 20, wide ? 40 : panel.height + 20],
      maxZoom: 17, duration: 0.8,
    });
  }

  function updateButtons() {
    const get = (action) => toolbar.querySelector(`[data-action="${action}"]`);
    const set = (action, enabled) => { const b = get(action); if (b) b.disabled = !enabled; };
    set('undo', !!store?.canUndo);
    set('redo', !!store?.canRedo);
    set('merge', mode === 'edit' && picked.length === 2);
    set('split', mode === 'edit' && (picked.length === 1 || tools.edit === 'split'));
    set('delete', mode === 'edit' && (picked.length > 0 || !!activeVertex));
    get('split').setAttribute('aria-pressed', String(mode === 'edit' && tools.edit === 'split'));
    // with a corner selected, Delete removes the corner (the only way on a touch screen)
    const del = get('delete');
    del.querySelector('span').textContent = activeVertex ? 'Corner' : 'Delete';
    del.title = activeVertex ? 'Delete the selected corner (Delete)' : 'Delete field (Delete)';
    del.setAttribute('aria-label', activeVertex ? 'Delete the selected corner' : 'Delete the picked field');
  }

  /** "6 of 15": your fields in view, of all the fields (outlined or yours) in view. */
  function updateCount() {
    if (!active || !store) return;
    const b = map.getBounds();
    const inView = (pt) => b.contains(toLatLng(pt));
    const mine = store.fields.filter((f) => inView(labelPoint(f.geometry))).length;
    const el = $('fieldCount');
    if (showing()) {
      const taken = takenIds();
      const free = outlines.items.filter((it) => !taken.has(it.id) && inView(it.label)).length;
      el.innerHTML = `<b>${mine} of ${mine + free}</b> <span>fields in view picked</span>`;
    } else {
      el.innerHTML = `<b>${store.fields.length}</b> <span>${store.fields.length === 1 ? 'field' : 'fields'} picked</span>`;
    }
  }

  // the keyboard cross only shows for people moving around with Tab, not after a mouse click
  addEventListener('keydown', (e) => { if (e.key === 'Tab') document.body.classList.add('kbd-nav'); }, true);
  addEventListener('pointerdown', () => document.body.classList.remove('kbd-nav'), true);

  // ---------------------------------------------------------------- toolbar, switch, panel wiring
  toolbar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled || !active) return;
    if (b.dataset.mode) setMode(b.dataset.mode);
    else if (b.dataset.tool) setTool(b.dataset.tool);
    else if (b.dataset.action === 'undo') undo();
    else if (b.dataset.action === 'redo') redo();
    else if (b.dataset.action === 'merge') mergePicked();
    else if (b.dataset.action === 'split') { if (tools.edit === 'split') cancelSketch(); else startSplit(); }
    else if (b.dataset.action === 'delete') { if (activeVertex) deleteVertex(); else deletePicked(); }
    updateButtons();
    // a button that just switched itself off (Delete, Merge, Undo at the end) mustn't drop focus to <body>
    if (b.disabled || document.activeElement === document.body) toolbar.querySelector('[data-mode][aria-pressed="true"]')?.focus();
  });
  document.querySelectorAll('[data-outlines]').forEach((b) => b.addEventListener('click', () => {
    if (!active || b.disabled || b.dataset.outlines === outlineKey) return;
    autoOff = false;
    setOutlines(b.dataset.outlines);
  }));
  $('continueBtn').addEventListener('click', () => { if (store?.fields.length) onContinue(store.fields); });
  $('changeLocationBtn').addEventListener('click', () => onChangeLocation());
  // on small screens the list is a bottom sheet; Manami and the map controls sit just above it
  new ResizeObserver(() => document.body.style.setProperty('--sheet-h', `${$('fieldPanel').offsetHeight}px`)).observe($('fieldPanel'));

  return {
    preload,
    start,
    stop,
    hold,
    /** The bounds of all chosen fields (for framing them in later steps), or null. */
    bounds() {
      const layers = fieldLayer.getLayers();
      return layers.length ? L.featureGroup(layers).getBounds() : null;
    },
    get active() { return active; },
    get fields() { return store?.fields || []; },
    /** Renames a field in the step's own list (the hub's check-up panel saves names here too). */
    rename(id, name) { store?.rename(id, name); },
    /** For the console while developing. */
    get debug() { return { store, mode, tools, picked, outlineKey, activeVertex, outlines }; },
  };
}
