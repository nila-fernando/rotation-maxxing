// The hub's camera rig, headless: a real camera and a stand-in for OrbitControls (the rig only reads
// its target and canvas size and sets its limits). The shots turn the short way round, jump when
// motion is reduced, follow the same path the no-clip tests fly (cameraSafety.flightSamples), keep to
// the tour's extra limits, and leave focus and overview just as they were without them.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { createCameraRig, fitDistance, clampToDisc, solidTop } from './cameraRig.js';
import { easeInOut, lerpPose, poseToPos, safeMinDistance } from './cameraSafety.js';

const RADIUS = 10.33; // the demo island
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/** A rig on a 1440×900 canvas, the camera where the reveal leaves it (the demo farm's overview). */
function makeRig({ reduced = false, insets = { left: 0, right: 0, top: 0, bottom: 0 } } = {}) {
  const listeners = {};
  const controls = {
    target: new THREE.Vector3(0, 0.33, 0),
    domElement: { clientWidth: 1440, clientHeight: 900 },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type) => { delete listeners[type]; },
  };
  const camera = new THREE.PerspectiveCamera(30, 1440 / 900, 0.05, 5000);
  camera.position.set(-5.35, 24.57, 26.39);
  const center = new THREE.Vector3(0, 0.33, 0);
  const rig = createCameraRig({ camera, controls, center, radius: RADIUS, getInsets: () => insets, reducedMotion: () => reduced });
  rig.layout();
  return { rig, camera, controls, center, listeners };
}

/** Puts the camera at a pose by hand (as a drag would leave it). */
function putAt(camera, controls, pose) {
  controls.target.set(...pose.target);
  camera.position.set(...poseToPos(pose));
}

const LIMITS = { maxPolar: 0.95, floor: 6.0 };

describe('camera shots', () => {
  it('remembers the home view and measures polar and azimuth like OrbitControls', () => {
    const { rig } = makeRig();
    assert.ok(near(rig.homeAzimuth, Math.atan2(-5.35, 26.39)), `home ${rig.homeAzimuth}`);
    assert.ok(near(rig.homeAzimuth, -0.2, 0.01));
    const v = new THREE.Vector3(-5.35, 24.57 - 0.33, 26.39);
    const s = new THREE.Spherical().setFromVector3(v);
    assert.ok(near(rig.polar, s.phi) && near(rig.azimuth, s.theta));
    assert.ok(near(rig.pose.dist, v.length()));
    assert.ok(rig.baseMinDistance > 0 && near(rig.baseMinDistance, Math.max(RADIUS * 0.3, rig.overviewDist * 0.22)));
  });

  it('takes the short way round (θ 3.0 to −3.0 passes through ±π)', () => {
    const { rig } = makeRig();
    rig.shot({ target: [0, 0.33, 0], dist: 20, polar: 0.84, azimuth: 3.0 }, 0);
    assert.ok(near(rig.azimuth, 3.0) && near(rig.polar, 0.84) && near(rig.pose.dist, 20));
    let done = null;
    rig.shot({ target: [1, 0.5, -1], dist: 18, polar: 0.8, azimuth: -3.0 }, 1, { onDone: (c) => { done = c; } });
    const seen = [];
    for (let i = 0; i < 30; i++) { rig.update(1 / 30); seen.push(rig.azimuth); }
    rig.update(0.1);
    for (const a of seen) assert.ok(Math.abs(a) >= 3.0 - 1e-6, `never the long way: ${a}`);
    assert.ok(seen.some((a) => Math.abs(a) > Math.PI - 0.05), 'through the back');
    assert.ok(near(rig.azimuth, -3.0) && near(rig.polar, 0.8) && near(rig.pose.dist, 18));
    assert.deepEqual(rig.pose.target.map((v) => +v.toFixed(9)), [1, 0.5, -1]);
    assert.equal(done, false, 'onDone(false) when it lands');
    assert.equal(rig.animating, false);
  });

  it('follows the same path the no-clip tests fly', () => {
    const { rig } = makeRig();
    const from = { target: [0, 0.33, 0], dist: 30, polar: 0.84, azimuth: -0.2 };
    const to = { target: [2, 1.6, 1], dist: 12, polar: 0.84, azimuth: 0.6 };
    rig.shot(from, 0);
    rig.shot(to, 0.9);
    for (let i = 1; i <= 27; i++) {
      rig.update(0.9 / 27);
      const want = lerpPose(from, to, easeInOut(i / 27));
      const got = rig.pose;
      assert.ok(near(got.dist, want.dist, 1e-6) && near(got.polar, want.polar, 1e-6) && near(got.azimuth, want.azimuth, 1e-6), `step ${i}`);
      got.target.forEach((v, k) => assert.ok(near(v, want.target[k], 1e-6)));
    }
  });

  it('a grab cuts a shot short, and says so', () => {
    const { rig, listeners } = makeRig();
    let done = null;
    rig.shot({ azimuth: 1 }, 1, { onDone: (c) => { done = c; } });
    rig.update(0.2);
    listeners.start();
    assert.equal(done, true);
    assert.equal(rig.animating, false);
    // a new flight cuts the old one short too
    let first = null, second = null;
    rig.shot({ azimuth: 0 }, 1, { onDone: (c) => { first = c; } });
    rig.shot({ azimuth: 0.5 }, 1, { onDone: (c) => { second = c; } });
    assert.equal(first, true);
    assert.equal(second, null);
  });

  it('jumps when motion is reduced', () => {
    const { rig } = makeRig({ reduced: true });
    let done = null;
    rig.shot({ target: [2, 1, 2], dist: 15, polar: 0.7, azimuth: 1.2 }, 0.8, { onDone: (c) => { done = c; } });
    assert.equal(rig.animating, false);
    assert.equal(done, false);
    assert.ok(near(rig.azimuth, 1.2) && near(rig.polar, 0.7) && near(rig.pose.dist, 15));
  });
});

describe('the tour limits', () => {
  it('lift a camera that is too low and too close back above the floor', () => {
    const { rig, camera, controls } = makeRig();
    rig.setExtraLimits(LIMITS);
    putAt(camera, controls, { target: [1, 0.73, 1], dist: 8, polar: 1.2, azimuth: 2.5 });
    rig.update(1 / 60);
    assert.ok(rig.polar <= 0.95 + 1e-9, `polar ${rig.polar}`);
    assert.ok(camera.position.y >= LIMITS.floor - 1e-9, `camera y ${camera.position.y}`);
    assert.ok(near(rig.azimuth, 2.5), 'turned the same way round');
    assert.equal(controls.maxPolarAngle, 0.95);
    assert.ok(near(controls.minDistance, Math.max(rig.baseMinDistance, safeMinDistance(0.73, 0.95, LIMITS.floor))));
    // a camera inside the limits is left alone
    putAt(camera, controls, { target: [1, 0.73, 1], dist: 20, polar: 0.5, azimuth: 1 });
    const before = camera.position.clone();
    rig.update(1 / 60);
    assert.ok(camera.position.distanceTo(before) < 1e-9);
  });

  it('keep every frame of a shot above the floor, even one that asks for less', () => {
    const { rig, camera } = makeRig();
    rig.setExtraLimits(LIMITS);
    rig.shot({ target: [0, 0.33, 0], dist: 30, polar: 0.84, azimuth: -0.2 }, 0);
    rig.shot({ target: [3, 1.6, 2], dist: 2, polar: 1.2, azimuth: 0.9 }, 0.9); // too close, too low
    for (let i = 0; i < 40; i++) {
      rig.update(1 / 40);
      assert.ok(camera.position.y >= LIMITS.floor - 1e-6, `frame ${i}: camera y ${camera.position.y}`);
      assert.ok(rig.polar <= 0.95 + 1e-9);
    }
    assert.ok(near(rig.pose.dist, Math.max(rig.baseMinDistance, safeMinDistance(1.6, 0.95, LIMITS.floor))));
    // flyTo keeps to them too
    rig.flyTo(new THREE.Vector3(0, 0.33, 0), 1, 0);
    assert.ok(near(rig.pose.dist, safeMinDistance(0.33, 0.95, LIMITS.floor)));
    assert.ok(camera.position.y >= LIMITS.floor - 1e-9);
  });

  it('come back on after layout()', () => {
    const { rig, controls } = makeRig();
    rig.setExtraLimits(LIMITS);
    controls.maxPolarAngle = 1.25;
    controls.minDistance = 1;
    rig.layout();
    assert.equal(controls.maxPolarAngle, 0.95);
    assert.ok(near(controls.minDistance, Math.max(rig.baseMinDistance, safeMinDistance(controls.target.y, 0.95, LIMITS.floor))));
    rig.layout({ animate: true });
    assert.equal(controls.maxPolarAngle, 0.95);
  });

  it('null puts back the normal polar limit and zoom', () => {
    const { rig, controls } = makeRig();
    const base = controls.minDistance;
    rig.setExtraLimits(LIMITS);
    assert.ok(controls.minDistance > base);
    assert.deepEqual(rig.extraLimits, LIMITS);
    rig.setExtraLimits(null);
    assert.equal(controls.maxPolarAngle, 1.25);
    assert.equal(controls.minDistance, base);
    assert.equal(rig.extraLimits, null);
  });

  it('a floor that is not a number keeps only the polar limit (the camera never goes to NaN)', () => {
    const { rig, camera, controls } = makeRig();
    const warn = console.warn;
    console.warn = () => {};
    try { rig.setExtraLimits({ maxPolar: 0.95, floor: undefined }); } finally { console.warn = warn; }
    rig.update(1 / 60);
    assert.equal(controls.maxPolarAngle, 0.95);
    assert.equal(controls.minDistance, rig.baseMinDistance);
    assert.ok(Number.isFinite(camera.position.x) && Number.isFinite(camera.position.y) && Number.isFinite(camera.position.z));
  });
});

describe('without extra limits', () => {
  it('focus and overview work just as before', () => {
    const { rig, camera, controls, center } = makeRig();
    const dir0 = camera.position.clone().sub(controls.target).normalize();
    const f = { center: [1.44, 0.41], radius: 1.78, y: 1.43 };
    rig.focus(f, 0);
    const tanV = Math.tan((30 * Math.PI) / 360);
    const want = Math.min(rig.overviewDist * 0.75, (1.78 * 3.2) / (tanV * 1 * 2));
    assert.ok(near(rig.focusDistance(1.78), want));
    assert.ok(near(rig.pose.dist, Math.min(controls.maxDistance, Math.max(controls.minDistance, want))));
    assert.deepEqual(rig.pose.target.map((v) => +v.toFixed(9)), [1.44, 1.43, 0.41]);
    const dir1 = camera.position.clone().sub(controls.target).normalize();
    assert.ok(dir1.distanceTo(dir0) < 1e-9, 'keeps the direction it looks from');
    // eased back to the whole farm
    rig.overview(0.8);
    for (let i = 0; i < 30; i++) rig.update(1 / 30);
    assert.ok(controls.target.distanceTo(center) < 1e-9);
    assert.ok(near(rig.pose.dist, rig.overviewDist));
    assert.ok(camera.position.clone().sub(controls.target).normalize().distanceTo(dir0) < 1e-9);
    // a target off the island is pulled back onto it
    rig.focus({ center: [40, 0], radius: 1, y: 1 }, 0);
    const [cx, cz] = clampToDisc(40, 0, 0, 0, RADIUS * 0.85);
    assert.ok(near(controls.target.x, cx) && near(controls.target.z, cz));
  });

  it('leaves a low camera alone (the hub has only its own limits)', () => {
    const { rig, camera, controls } = makeRig();
    putAt(camera, controls, { target: [1, 0.73, 1], dist: 8, polar: 1.2, azimuth: 2.5 });
    const before = camera.position.clone();
    rig.update(1 / 60);
    assert.ok(camera.position.distanceTo(before) < 1e-9);
    assert.equal(controls.maxPolarAngle, 1.25);
  });

  it('keeps the zoom limits layout() works out', () => {
    const { rig, controls } = makeRig();
    const ov = fitDistance({ radius: RADIUS, fovDeg: 30, height: 900, freeWidth: 1440, freeHeight: 900, margin: 0.82 });
    assert.ok(near(rig.overviewDist, ov));
    assert.ok(near(controls.minDistance, Math.max(RADIUS * 0.3, ov * 0.22)));
    assert.ok(near(controls.maxDistance, ov * 1.3));
  });
});

describe('a relayout with no flight after it', () => {
  it('eases the island to its new spot without moving the camera', () => {
    const insets = { left: 0, right: 380, top: 0, bottom: 0 };
    const { rig, camera, controls } = makeRig({ insets });
    assert.ok(near(camera.view.offsetX, 190), 'framed left of the card');
    const pos = camera.position.clone(), target = controls.target.clone();
    insets.right = 0; // the card closes
    rig.layout({ animate: true });
    assert.ok(near(camera.view.offsetX, 190), 'not in one jump');
    const seen = [];
    for (let i = 0; i < 60; i++) { rig.update(1 / 60); seen.push(camera.view.offsetX); }
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i] <= seen[i - 1] + 1e-9, 'heads one way only');
    assert.ok(seen[0] < 190 && seen[0] > 100, `small steps: ${seen[0]}`);
    assert.ok(near(camera.view.offsetX, 0), 'lands on the centre');
    assert.ok(camera.position.distanceTo(pos) < 1e-9 && controls.target.distanceTo(target) < 1e-9, 'the camera stays put');
  });

  it('brings a camera past the new zoom-out limit in smoothly, along the same line', () => {
    const insets = { left: 0, right: 0, top: 0, bottom: 500 };
    const { rig, camera, controls } = makeRig({ insets });
    rig.shot({ dist: controls.maxDistance }, 0); // zoomed right out
    const far = rig.pose.dist;
    const dir0 = camera.position.clone().sub(controls.target).normalize();
    insets.bottom = 0; // the dock shrinks: the island fits closer
    rig.layout({ animate: true });
    const max = rig.overviewDist * 1.3;
    assert.ok(far > max + 1, 'starts past the new limit');
    assert.ok(near(rig.pose.dist, far) && controls.maxDistance >= far - 1e-9, 'no snap (OrbitControls clamps to maxDistance)');
    let last = far;
    for (let i = 0; i < 90; i++) {
      rig.update(1 / 60);
      const d = rig.pose.dist;
      assert.ok(d <= last + 1e-9 && last - d < (far - max) * 0.2, `small steps in: ${last} to ${d}`);
      assert.ok(controls.maxDistance >= d - 1e-9);
      last = d;
    }
    assert.ok(near(rig.pose.dist, max, 1e-2) && near(controls.maxDistance, max), `ends at the limit (${rig.pose.dist} vs ${max})`);
    assert.ok(camera.position.clone().sub(controls.target).normalize().distanceTo(dir0) < 1e-9, 'same direction');
  });

  it('keeps the tour limits all the way', () => {
    const insets = { left: 0, right: 0, top: 0, bottom: 500 };
    const { rig, camera, controls } = makeRig({ insets });
    rig.setExtraLimits(LIMITS);
    rig.shot({ dist: controls.maxDistance }, 0);
    insets.bottom = 0;
    rig.layout({ animate: true });
    for (let i = 0; i < 90; i++) {
      rig.update(1 / 60);
      assert.ok(camera.position.y >= LIMITS.floor - 1e-9 && rig.polar <= LIMITS.maxPolar + 1e-9);
      assert.ok(rig.pose.dist >= controls.minDistance - 1e-9);
    }
  });
});

describe('solidTop', () => {
  it('measures the meshes and leaves out sprites, points, hidden and skipped things', () => {
    const root = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
    box.position.set(0, 1, 0); // top at 2
    root.add(box);
    const halo = new THREE.Sprite();
    halo.position.y = 9;
    root.add(halo);
    const pts = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 20, 0)]));
    root.add(pts);
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    hidden.position.y = 30;
    hidden.visible = false;
    root.add(hidden);
    const coins = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    coins.position.y = 40;
    root.add(coins);
    const marked = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    marked.position.y = 50;
    marked.userData.noBox = true;
    root.add(marked);
    assert.ok(near(solidTop([root], { skip: [coins] }), 2));
    assert.ok(near(solidTop([root]), 40.5));
    // or the island's view: its island group and the field holders
    const holder = new THREE.Group();
    const crop = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    crop.position.y = 2.7;
    holder.add(crop);
    assert.ok(near(solidTop({ island: root, fields: [{ holder }] }, { skip: [coins] }), 3.2));
    assert.equal(solidTop([new THREE.Group()]), -Infinity);
  });

  it('measures instanced copies where they are now, not where they were last time', () => {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), undefined, 2);
    const m = new THREE.Matrix4();
    inst.setMatrixAt(0, m.makeTranslation(0, 1, 0));
    inst.setMatrixAt(1, m.makeTranslation(2, 0, 0));
    assert.ok(near(solidTop([inst]), 1.5));
    inst.setMatrixAt(1, m.makeTranslation(2, 6, 0));
    assert.ok(near(solidTop([inst]), 6.5));
  });
});
