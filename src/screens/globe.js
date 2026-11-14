// Step 1 · Find your farm.
// The Earth turns slowly in space; the farmer searches (or takes the demo farm), the globe stops and
// dives to the spot, and hands over to a flat satellite map close enough to see field boundaries.
// The dive and the climb back are the globe kit's journeys (from the asset pack's explore.html).
//
// If the globe can't run (no WebGL, load error, lost GPU context) or hasn't loaded by the time a place
// is picked, the flat map does the whole journey on its own, so the demo always works.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import GlobeEngine, { webglAvailable } from '../globe/GlobeEngine.js';
import { altitudeForZoom, clamp } from '../globe/flight.js';
import {
  HANDOFF_ZOOM, LAND_ZOOM, MIN_AREA_ZOOM, OPENING_VIEW, SPIN_DEG_PER_SEC, TILE_ATTRIBUTION, TILE_URL,
} from '../config.js';

const FADE_MS = 520;
const LOAD_TIMEOUT_MS = 12000;
const US_VIEW = { lat: 39.5, lon: -97, zoom: 4 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {object} o
 * @param {{map: HTMLElement, globe: HTMLElement, globeHost: HTMLElement, globeTags: HTMLElement, credit: HTMLElement}} o.els
 * @param {(event: object) => void} o.on  receives {type: 'flying'|'landed'|'returned'|'fallback', place?, message?}
 */
export function createGlobeScreen({ els, on }) {
  /** 'loading' → 'globe' → 'diving' → 'map' → 'rising' → 'globe' …  (or straight to 'map' without a globe) */
  let stage = 'loading';
  let engine = null;
  let journey = 0; // bumped whenever a journey is replaced or cut short; stale awaits check it and stop
  let flight = null; // {place, target} from the moment a place is picked until it has landed
  let current = null; // {place, target} once landed
  let pin = null;

  // ---------------------------------------------------------------- the map underneath
  const map = L.map(els.map, {
    zoomControl: false, attributionControl: true, worldCopyJump: true, zoomSnap: 0.25, fadeAnimation: true,
  }).setView([US_VIEW.lat, US_VIEW.lon], US_VIEW.zoom);
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION, crossOrigin: true }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix(false);

  const mapFly = (lat, lon, zoom, seconds) => new Promise((resolve) => {
    map.once('moveend', () => resolve());
    map.flyTo([lat, lon], zoom, { duration: seconds, easeLinearity: 0.2 });
  });

  // the hidden layer is also taken out of the Tab order and the accessibility tree
  function setGlobe(visible, { rise = false } = {}) {
    els.globe.classList.toggle('is-rising', rise);
    els.globe.classList.toggle('is-on', visible);
    els.globe.inert = !visible;
    els.credit.classList.toggle('is-hidden', !visible);
  }
  function setMap(visible) {
    els.map.classList.toggle('is-on', visible);
    els.map.inert = !visible;
    document.body.classList.toggle('on-map', visible);
    if (visible) map.invalidateSize();
  }
  setGlobe(false);
  setMap(false);

  // ---------------------------------------------------------------- where to land
  function targetFor(place) {
    const max = LAND_ZOOM[place.kind] ?? LAND_ZOOM.other;
    if (place.bounds && (place.kind === 'county' || place.kind === 'place')) {
      const b = L.latLngBounds(place.bounds);
      if (b.isValid()) {
        const c = b.getCenter();
        const fit = map.getBoundsZoom(b, false, L.point(40, 40));
        return { lat: c.lat, lon: c.lng, zoom: clamp(fit, MIN_AREA_ZOOM, max) };
      }
    }
    return { lat: place.lat, lon: place.lon, zoom: max };
  }

  // ---------------------------------------------------------------- boot
  const ready = (async () => {
    if (!webglAvailable()) return dropGlobe('This device can’t show the 3D globe, so here’s the map instead.');
    const mine = new GlobeEngine(els.globeHost, {
      labels: els.globeTags,
      reducedMotion: reducedMotion(),
      firstSpinAfterMs: 0,
      spinDegPerSec: SPIN_DEG_PER_SEC,
      onContextLost: () => dropGlobe('The view from space stopped, so here’s the map.'),
    });
    engine = mine;
    try {
      await Promise.race([
        mine.load(),
        wait(LOAD_TIMEOUT_MS).then(() => { throw new Error('globe load timed out'); }),
      ]);
    } catch {
      if (engine === mine) dropGlobe('The 3D globe couldn’t load, so here’s the map instead.');
      return false;
    }
    if (engine !== mine) return false; // given up on while loading (a place was picked first)
    engine.setPose({ ...OPENING_VIEW, alt: engine.orbitAlt() });
    engine.setInteractive(true);
    engine.start();
    stage = 'globe';
    setGlobe(true);
    requestAnimationFrame(frameLoop);
    return true;
  })();

  /**
   * Stop using the globe for the rest of the visit and carry on with the flat map. A journey in
   * progress is finished on the map: a dive lands on its spot, a climb ends back over the US.
   * @param {string|null} message  why, for Manami (null: quietly, e.g. a place was picked before it loaded)
   */
  function dropGlobe(message) {
    const wasRising = stage === 'rising';
    const dying = engine;
    engine = null;
    journey++;
    dying?.dispose();
    stage = 'map';
    setGlobe(false);
    setMap(true);
    if (message) on({ type: 'fallback', message });
    if (flight) {
      const { place, target } = flight;
      map.setView([target.lat, target.lon], target.zoom, { animate: false });
      landed(place, target);
    } else if (wasRising) {
      map.setView([US_VIEW.lat, US_VIEW.lon], US_VIEW.zoom, { animate: false });
      current = null;
      on({ type: 'returned' });
    }
    return false;
  }

  // keep the Earth a little below the middle on the globe, so the search bar has room above it;
  // during the dive it eases back to the exact middle so the hand-off to the map lines up
  const viewOff = { y: 0 };
  function frameLoop() {
    if (!engine) return;
    if (engine.camera && engine.width) {
      const want = stage === 'globe' ? -Math.min(56, innerHeight * 0.06) : 0;
      viewOff.y += (want - viewOff.y) * (stage === 'diving' ? 0.08 : 0.12);
      const w = engine.width, h = engine.height;
      if (Math.abs(viewOff.y) < 0.5 && want === 0) engine.camera.clearViewOffset();
      else engine.camera.setViewOffset(w, h, 0, viewOff.y, w, h);
    }
    requestAnimationFrame(frameLoop);
  }

  // ---------------------------------------------------------------- globe → map
  async function flyTo(place) {
    if (stage === 'diving' || stage === 'rising') return;
    // a place picked before the globe is ready: don't keep the farmer waiting on textures
    if (stage === 'loading') dropGlobe(null);
    const target = targetFor(place);
    const id = ++journey;
    clearPin();
    flight = { place, target };
    on({ type: 'flying', place });

    if (stage === 'map') { // no globe, or already on the map: the map flies there itself
      setMap(true);
      if (reducedMotion()) { landNow(); return; }
      const far = map.getZoom() < 8;
      await mapFly(target.lat, target.lon, target.zoom, far ? 2.5 : 2);
      if (journey === id) landed(place, target);
      return;
    }

    stage = 'diving';
    const alt = altitudeForZoom(HANDOFF_ZOOM, target.lat, innerHeight);
    // park the map underneath at the hand-off zoom, and paint its own tiles onto the globe
    map.setView([target.lat, target.lon], HANDOFF_ZOOM, { animate: false });
    engine.setHandoff(alt);
    engine.setPatch({ url: TILE_URL, lat: target.lat, lon: target.lon, zoom: HANDOFF_ZOOM });
    engine.setInteractive(false);
    engine.setPin(null);
    engine.start();
    if (reducedMotion()) { landNow(); return; }

    const arrived = await engine.flyTo({ lat: target.lat, lon: target.lon, alt });
    if (!arrived || journey !== id) return;
    // dissolve: the map is under the globe at the same scale; it flies on while the globe fades
    setMap(true);
    setGlobe(false);
    stage = 'map';
    const seconds = clamp(0.6 + 0.2 * (target.zoom - HANDOFF_ZOOM), 0.8, 2.4);
    mapFly(target.lat, target.lon, target.zoom, seconds).then(() => { if (journey === id) landed(place, target); });
    await wait(FADE_MS);
    if (journey === id) engine?.stop();
  }

  /** Skip, Esc or reduced motion: land on the spot at once, from any part of the journey. */
  function landNow() {
    if (!flight) return;
    const { place, target } = flight;
    journey++;
    engine?.cancelFlight();
    engine?.stop();
    // setView cancels a map flight in progress (map.stop() would queue an animated zoom back)
    map.setView([target.lat, target.lon], target.zoom, { animate: false });
    setMap(true);
    setGlobe(false);
    stage = 'map';
    landed(place, target);
  }

  function landed(place, target) {
    flight = null;
    current = { place, target };
    clearPin();
    if (place.kind === 'house' || place.kind === 'farm' || place.kind === 'street') {
      pin = L.marker([place.lat, place.lon], {
        icon: L.divIcon({ className: 'map-pin-wrap', html: '<div class="map-pin"></div>', iconSize: [0, 0] }),
        interactive: false, keyboard: false,
      }).addTo(map);
      pin.getElement().firstChild.textContent = place.label;
    }
    on({ type: 'landed', place, target });
  }

  function clearPin() {
    pin?.remove();
    pin = null;
  }

  // ---------------------------------------------------------------- map → globe
  async function backToGlobe() {
    if (stage !== 'map' || flight) return;
    clearPin();
    const id = ++journey;
    if (!engine) { // map only: zoom back out over the US
      current = null;
      on({ type: 'returned' });
      map.flyTo([US_VIEW.lat, US_VIEW.lon], US_VIEW.zoom, { duration: reducedMotion() ? 0.01 : 1.6 });
      return;
    }
    stage = 'rising';
    const { target } = current || { target: { lat: OPENING_VIEW.lat, lon: OPENING_VIEW.lon } };
    await mapFly(target.lat, target.lon, HANDOFF_ZOOM, reducedMotion() ? 0.01 : clamp(0.3 + 0.14 * (map.getZoom() - HANDOFF_ZOOM), 0.5, 1.5));
    if (journey !== id) return;
    const alt = altitudeForZoom(HANDOFF_ZOOM, target.lat, innerHeight);
    engine.setHandoff(alt);
    engine.setPatch({ url: TILE_URL, lat: target.lat, lon: target.lon, zoom: HANDOFF_ZOOM });
    engine.setPose({ lat: target.lat, lon: target.lon, alt });
    engine.setInteractive(false);
    engine.start();
    await engine.patchReady(400);
    if (journey !== id) return;
    setGlobe(true, { rise: true });
    await wait(380);
    if (journey !== id) return;
    setMap(false);
    await engine.flyTo({ lat: target.lat, lon: target.lon, alt: engine.orbitAlt() }, { duration: reducedMotion() ? 0 : 2200 });
    if (journey !== id) return;
    engine.setHandoff(null);
    engine.clearPatch();
    engine.setInteractive(true);
    stage = 'globe';
    current = null;
    on({ type: 'returned' });
  }

  return {
    /** Resolves true once the globe is showing, false if the app went with the flat map. */
    ready,
    flyTo,
    landNow,
    backToGlobe,
    get stage() { return stage; },
    get flying() { return !!flight; },
    map,
  };
}
