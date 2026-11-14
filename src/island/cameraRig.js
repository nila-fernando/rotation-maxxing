// The hub's camera: orbit round the island (drag to turn, scroll or pinch to zoom), eased flights to
// a field and back to the whole farm, and limits so the island can never be lost off screen.
//
// - The island is centred in the part of the screen the UI leaves free (the sidebar covers the
//   left edge on a laptop, the field sheet covers the bottom on a phone): the camera's view offset
//   moves the picture's centre without changing what the camera looks at.
// - Zoom is clamped between a close look at a field and a little past the whole island.
// - The look-at point never leaves the island, and when you zoom right out it drifts back to the
//   middle, so turning round a field near the edge can't swing the island away.
// - Extra limits (the plan tour, src/screens/planFutures.js) keep the camera above a floor over
//   everything solid: no lower than maxPolar, and far enough back for the floor (cameraSafety.js
//   has the maths and why a shot between two safe poses stays safe all the way).
//
//   const rig = createCameraRig({ camera, controls, center, radius, getInsets })
//   rig.layout()               after a resize or when the UI around the island changes
//   rig.overview()             ease back to the whole farm
//   rig.focus({ center, radius, y })   ease to a field
//   rig.shot({ target, dist, polar, azimuth })   ease to a pose, turning round the island too
//   rig.setExtraLimits({ maxPolar, floor })      keep the camera above the floor (null: back to normal)
//   rig.update(dt)             every frame, before controls.update()
import * as THREE from 'three';
import { clampToDisc, easeInOut, safeMinDistance, wrapAngle } from './cameraSafety.js';

export { clampToDisc };

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const MAX_POLAR = 1.25; // never down to the horizon

/**
 * How far back the camera sits so a circle of `radius` fits the free part of the screen.
 * @param {object} o
 * @param {number} o.radius      the island's radius
 * @param {number} o.fovDeg      the camera's vertical field of view
 * @param {number} o.height      full canvas height (px)
 * @param {number} o.freeWidth   width left free by the UI (px)
 * @param {number} o.freeHeight  height left free by the UI (px)
 * @param {number} [o.margin=0.8] below 1 lets the island's far side run a little behind the UI
 *   (the view is tilted, so a circle looks shorter than it is wide)
 */
export function fitDistance({ radius, fovDeg, height, freeWidth, freeHeight, margin = 0.8 }) {
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const halfV = Math.atan((tanV * Math.max(1, freeHeight)) / Math.max(1, height));
  const halfH = Math.atan((tanV * Math.max(1, freeWidth)) / Math.max(1, height));
  return ((radius * 1.02) / Math.sin(Math.min(halfV, halfH))) * margin;
}

/**
 * The top (y) of everything solid under some roots, by a box round each mesh (its geometry's box,
 * not every vertex, so a little generous): the floor input for the tour (cameraSafety.floorY).
 * Points, sprites (lamp halos), lines, hidden things, anything marked userData.noBox and anything
 * in `skip` (the coin stacks) are left out. Returns -Infinity when there is nothing.
 * @param {THREE.Object3D[]|{island: THREE.Object3D, fields?: {holder: THREE.Object3D}[]}} roots
 *   the objects, or the island's view (its island group and the field holders)
 */
export function solidTop(roots, { skip = [] } = {}) {
  const list = Array.isArray(roots) ? roots : [roots.island, ...(roots.fields || []).map((f) => f.holder)];
  const skipped = new Set(skip.filter(Boolean));
  const box = new THREE.Box3(), part = new THREE.Box3();
  const visit = (o) => {
    if (!o || skipped.has(o) || o.visible === false || o.userData?.noBox || o.isPoints || o.isSprite || o.isLine) return;
    if (o.isMesh && o.geometry) {
      let bb;
      if (o.isInstancedMesh) { o.computeBoundingBox(); bb = o.boundingBox; } // (its copies may have moved since last time)
      else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bb = o.geometry.boundingBox; }
      if (bb && !bb.isEmpty()) box.union(part.copy(bb).applyMatrix4(o.matrixWorld));
    }
    for (const c of o.children) visit(c);
  };
  for (const r of list) {
    if (!r) continue;
    r.updateMatrixWorld(true);
    visit(r);
  }
  return box.isEmpty() ? -Infinity : box.max.y;
}

/**
 * @param {object} o
 * @param {THREE.PerspectiveCamera} o.camera
 * @param {import('three/examples/jsm/controls/OrbitControls.js').OrbitControls} o.controls
 * @param {THREE.Vector3} o.center       the middle of the island (the overview's look-at point)
 * @param {number} o.radius              the island's radius
 * @param {() => {left: number, right: number, top: number, bottom: number}} o.getInsets
 *   how much of each canvas edge the UI covers (px)
 * @param {() => boolean} [o.reducedMotion]  jump instead of easing
 */
export function createCameraRig({ camera, controls, center, radius, getInsets, reducedMotion = () => false }) {
  const size = { w: 1, h: 1 };
  const offset = { x: 0, y: 0 }; // the view offset in use (px)
  let offsetGoal = { x: 0, y: 0 };
  let overviewDist = 1;
  let baseMin = 0; // the zoom limit layout() works out (the extra limits may ask for more)
  let limits = null; // { maxPolar, floor } while the tour keeps the camera above the farm
  let homeAzimuth = null; // which way round the camera looked at the first layout()
  let anim = null;
  const tmp = new THREE.Vector3();
  const dir = new THREE.Vector3();

  controls.enablePan = false;
  controls.minPolarAngle = 0.3;
  controls.maxPolarAngle = MAX_POLAR;
  // a grab or a scroll takes over from an eased flight
  const onStart = () => { if (anim) { finishOffset(); endAnim(true); } };
  controls.addEventListener('start', onStart);

  /** Stops the flight; a shot's onDone hears whether it was cut short. */
  function endAnim(cancelled) {
    const done = anim?.onDone;
    anim = null;
    done?.(cancelled);
  }

  function finishOffset() {
    offset.x = offsetGoal.x;
    offset.y = offsetGoal.y;
    applyOffset();
  }

  function applyOffset() {
    camera.setViewOffset(size.w, size.h, -offset.x, -offset.y, size.w, size.h);
  }

  function currentDistance() {
    return camera.position.distanceTo(controls.target);
  }

  /** The camera's pose now, the way OrbitControls measures it (polar from straight up, θ = atan2(dx, dz)). */
  function spherical() {
    dir.subVectors(camera.position, controls.target);
    const d = dir.length();
    return { d, polar: d > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, dir.y / d))) : 0, azimuth: Math.atan2(dir.x, dir.z) };
  }

  /** Puts the camera `dist` from `target`, keeping the direction it looks from. */
  function place(target, dist) {
    dir.subVectors(camera.position, controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(0, 1, 1);
    dir.normalize();
    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(dir, dist);
  }

  /** Puts the camera `dist` from `target`, `polar` down from straight up and `azimuth` round. */
  function placeAt(target, dist, polar, azimuth) {
    controls.target.copy(target);
    const s = Math.sin(polar);
    camera.position.set(target.x + dist * s * Math.sin(azimuth), target.y + dist * Math.cos(polar), target.z + dist * s * Math.cos(azimuth));
  }

  /** The closest the camera may come to a look-at point at height ty (more with the extra limits on). */
  function minDistanceAt(ty) {
    if (!limits) return controls.minDistance;
    return Math.max(baseMin, safeMinDistance(ty, limits.maxPolar, limits.floor));
  }

  /** A flight's distance, kept to the zoom limits; with the extra limits on, the floor always wins. */
  function clampDist(dist, ty) {
    if (!limits) return Math.min(controls.maxDistance, Math.max(controls.minDistance, dist));
    return Math.max(minDistanceAt(ty), Math.min(controls.maxDistance, dist));
  }

  /**
   * Keeps the camera to the extra limits (nothing to do without them): sets OrbitControls' own polar
   * and zoom limits to match (so the farmer's drag and zoom can't break them either), and if the
   * camera is lower or closer than they allow, puts it back on them, turned the same way round.
   */
  function enforce() {
    if (!limits) return;
    controls.maxPolarAngle = limits.maxPolar;
    controls.minDistance = minDistanceAt(controls.target.y);
    const { d, polar, azimuth } = spherical();
    if (polar > limits.maxPolar + 1e-9 || d < controls.minDistance - 1e-9) {
      placeAt(controls.target, Math.max(d, controls.minDistance), Math.min(polar, limits.maxPolar), azimuth);
    }
  }

  /**
   * Extra limits on top of the normal ones: { maxPolar, floor } keeps the camera above the floor
   * (cameraSafety.js); null goes back to the normal polar limit and zoom.
   */
  function setExtraLimits(l) {
    if (l && !Number.isFinite(l.floor)) {
      // (a floor that isn't a number would put the camera nowhere: keep only the polar limit)
      console.warn('cameraRig: the extra limits need a floor height; got', l.floor);
      l = { ...l, floor: -Infinity };
    }
    limits = l ? { maxPolar: Number.isFinite(l.maxPolar) ? l.maxPolar : MAX_POLAR, floor: l.floor } : null;
    if (limits) { enforce(); return; }
    controls.maxPolarAngle = MAX_POLAR;
    controls.minDistance = baseMin;
  }

  /**
   * Measures the free area again. animate: ease the island to its new spot (when the UI slides in);
   * otherwise it moves at once (a window resize).
   */
  function layout({ animate = false } = {}) {
    const canvas = controls.domElement;
    size.w = canvas.clientWidth || innerWidth;
    size.h = canvas.clientHeight || innerHeight;
    const ins = getInsets();
    const freeW = Math.max(1, size.w - ins.left - ins.right);
    const freeH = Math.max(1, size.h - ins.top - ins.bottom);
    offsetGoal = { x: (ins.left - ins.right) / 2, y: (ins.top - ins.bottom) / 2 };
    const before = overviewDist;
    overviewDist = fitDistance({ radius, fovDeg: camera.fov, height: size.h, freeWidth: freeW, freeHeight: freeH, margin: freeW < 700 ? 0.95 : 0.82 });
    baseMin = Math.max(radius * 0.3, overviewDist * 0.22);
    controls.minDistance = baseMin;
    controls.maxDistance = overviewDist * 1.3;
    if (homeAzimuth === null) homeAzimuth = spherical().azimuth;
    if (!animate || reducedMotion()) {
      finishOffset();
      // keep the same framing relative to the whole farm
      const d = currentDistance();
      if (before > 1 && d > 0) place(controls.target.clone(), Math.min(controls.maxDistance, Math.max(controls.minDistance, d * (overviewDist / before))));
    }
    enforce(); // the zoom limit just changed: the extra limits go back on top
    camera.updateProjectionMatrix();
    return overviewDist;
  }

  function flyTo(target, dist, duration = 0.75) {
    dist = clampDist(dist, target.y);
    if (anim) endAnim(true);
    if (reducedMotion() || duration <= 0) {
      finishOffset();
      place(target, dist);
      return;
    }
    anim = {
      t: 0,
      dur: duration,
      fromTarget: controls.target.clone(),
      toTarget: target.clone(),
      fromDist: currentDistance(),
      toDist: dist,
      fromOffset: { ...offset },
    };
  }

  /**
   * Eases to a pose: the look-at point, the distance and the polar angle in a straight line and the
   * turn round the island the short way, all on one eased k (with the view offset), so a shot
   * between two poses inside the extra limits stays inside them all the way (cameraSafety.js).
   * Anything left out stays as it is. onDone(cancelled) hears when it lands or is cut short (by a
   * grab, or by another flight).
   * @param {{target?: number[]|THREE.Vector3, dist?: number, polar?: number, azimuth?: number}} pose
   */
  function shot({ target, dist, polar, azimuth } = {}, duration = 0.8, { onDone } = {}) {
    const now = spherical();
    const to = target ? (Array.isArray(target) ? new THREE.Vector3(target[0], target[1], target[2]) : target.clone()) : controls.target.clone();
    const toPolar = Math.min(controls.maxPolarAngle, Math.max(controls.minPolarAngle, polar ?? now.polar));
    const toAz = azimuth ?? now.azimuth;
    const toDist = clampDist(dist ?? now.d, to.y);
    if (anim) endAnim(true);
    if (reducedMotion() || duration <= 0) {
      finishOffset();
      placeAt(to, toDist, toPolar, toAz);
      onDone?.(false);
      return;
    }
    anim = {
      t: 0,
      dur: duration,
      fromTarget: controls.target.clone(),
      toTarget: to,
      fromDist: now.d,
      toDist,
      fromPolar: now.polar,
      toPolar,
      fromAz: now.azimuth,
      turn: wrapAngle(toAz - now.azimuth), // the short way round
      fromOffset: { ...offset },
      onDone,
    };
  }

  function overview(duration = 0.8) {
    flyTo(center, overviewDist, duration);
  }

  /** How far back focus() sits for a field of radius r: it fills a good part of the free height. */
  function focusDistance(r) {
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const ins = getInsets();
    const freeFrac = Math.max(0.3, (size.h - ins.top - ins.bottom) / size.h);
    return Math.min(overviewDist * 0.75, (r * 3.2) / (tanV * freeFrac * 2));
  }

  /** Eases to a field: its middle, close enough that it fills a good part of the free height. */
  function focus({ center: [x, z], radius: r, y }, duration = 0.75) {
    const dist = focusDistance(r);
    const [cx, cz] = clampToDisc(x, z, center.x, center.z, radius * 0.85);
    flyTo(new THREE.Vector3(cx, y, cz), dist, duration);
  }

  /** One step of the flight in progress. */
  function step(dt) {
    anim.t = Math.min(1, anim.t + dt / anim.dur);
    const k = easeInOut(anim.t);
    tmp.copy(anim.fromTarget).lerp(anim.toTarget, k);
    const dist = anim.fromDist + (anim.toDist - anim.fromDist) * k;
    if (anim.toPolar === undefined) place(tmp, dist); // flyTo: keeps the direction
    else placeAt(tmp, dist, anim.fromPolar + (anim.toPolar - anim.fromPolar) * k, anim.fromAz + anim.turn * k);
    offset.x = anim.fromOffset.x + (offsetGoal.x - anim.fromOffset.x) * k;
    offset.y = anim.fromOffset.y + (offsetGoal.y - anim.fromOffset.y) * k;
    applyOffset();
    if (anim.t >= 1) endAnim(false);
  }

  function update(dt) {
    if (anim) step(dt);
    else {
      // zoomed right out: the look-at point drifts back to the middle of the island
      const d = currentDistance();
      const pull = smoothstep(overviewDist * 0.9, overviewDist * 1.15, d) * Math.min(1, dt * 3);
      let tx = controls.target.x, tz = controls.target.z, ty = controls.target.y;
      if (pull > 0) {
        tx += (center.x - tx) * pull;
        ty += (center.y - ty) * pull;
        tz += (center.z - tz) * pull;
      }
      // and never leaves the island
      [tx, tz] = clampToDisc(tx, tz, center.x, center.z, radius * 0.85);
      if (tx !== controls.target.x || ty !== controls.target.y || tz !== controls.target.z) {
        const dx = tx - controls.target.x, dy = ty - controls.target.y, dz = tz - controls.target.z;
        controls.target.set(tx, ty, tz);
        camera.position.x += dx;
        camera.position.y += dy;
        camera.position.z += dz;
      }
    }
    // then the extra limits, if any (this runs before controls.update(), which clamps the same way)
    enforce();
  }

  function dispose() {
    controls.removeEventListener('start', onStart);
    camera.clearViewOffset();
  }

  return {
    layout,
    overview,
    focus,
    flyTo,
    shot,
    setExtraLimits,
    enforce,
    focusDistance,
    minDistanceAt,
    update,
    dispose,
    get overviewDist() { return overviewDist; },
    get animating() { return !!anim; },
    /** Whether the camera is looking at something other than the whole farm. */
    get focused() { return controls.target.distanceTo(center) > radius * 0.05 || currentDistance() < overviewDist * 0.8; },
    /** The camera's angle down from straight up, and its turn round the island (θ = atan2(dx, dz)). */
    get polar() { return spherical().polar; },
    get azimuth() { return spherical().azimuth; },
    /** The camera's pose now: { target: [x, y, z], dist, polar, azimuth } (cameraSafety.js poses). */
    get pose() { const s = spherical(); return { target: controls.target.toArray(), dist: s.d, polar: s.polar, azimuth: s.azimuth }; },
    /** Which way round the camera looked at the first layout() (the hub's home view). */
    get homeAzimuth() { return homeAzimuth; },
    /** The zoom limit layout() worked out, before any extra limits. */
    get baseMinDistance() { return baseMin; },
    /** The extra limits in force, or null. */
    get extraLimits() { return limits ? { ...limits } : null; },
  };
}
