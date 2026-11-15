// The 3D globe: Earth with a live day and night side, clouds and air, in a sky of stars with the
// Sun, the Moon, the planets and the satellites this app reads. Plain Three.js, driven from
// src/screens/globe.js the way Leaflet is.
// Team Sheeeep changes to the kit: opts.firstSpinAfterMs / opts.spinDegPerSec (spin from the start),
// and webglAvailable() releases its test context.
//
// World space is the Earth-fixed frame of astro.js, so the Earth mesh never turns: the sky does.
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  LineBasicMaterial,
  LineLoop,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import * as glsl from './shaders.js';
import { gmstDeg, latLonToVec3, moonPosition, planetPositions, sunDirection, vec3ToLatLon } from './astro.js';
import { clamp, diveAmount, FOV_DEG, lonDelta, planFlight, tileBlock } from './flight.js';
// No bundler here: the pictures are plain files next to this module.
const dayUrl = new URL('./assets/earth-day.jpg', import.meta.url).href;
const nightUrl = new URL('./assets/earth-night.jpg', import.meta.url).href;
const packUrl = new URL('./assets/earth-bump-roughness-clouds.jpg', import.meta.url).href;
const moonUrl = new URL('./assets/moon.jpg', import.meta.url).href;

const RAD = Math.PI / 180;
const MIN_ALT = 0.5; // closest the farmer can zoom by hand, in Earth radii above the ground
const MAX_ALT = 9;
const SKY_R = 1500;
const PLANET_R = 900; // planets are drawn on a shell this far out, much bigger than life so they can be seen
const MOON_DIST = 11; // the Moon is really 60 Earth radii away; brought closer so it reads as a moon
const SAT_SPEEDUP = 30; // satellites circle 30× faster than life, or they would look parked
const IDLE_SPIN_AFTER_MS = 9000;

// name, radius on the planet shell, shader kind (0 rocky, 1 banded, 2 ice giant, 3 clouded), three colours
const PLANETS = {
  mercury: { size: 5.5, kind: 0, colors: ['#8c8580', '#5e5852', '#a39b93'], fact: 'the smallest planet, closest to the Sun' },
  venus: { size: 9, kind: 3, colors: ['#e9d9ae', '#c9a567', '#f2e8c8'], fact: 'wrapped in bright cloud' },
  mars: { size: 8, kind: 0, colors: ['#c2623a', '#7d3a22', '#f0e6dc'], fact: 'the red planet' },
  jupiter: { size: 21, kind: 1, colors: ['#d9c3a0', '#a9744d', '#efe3cf'], fact: 'the largest planet' },
  saturn: { size: 17, kind: 1, colors: ['#e3d2a4', '#c4a56d', '#f1e6c5'], fact: 'the ringed planet', ring: true },
  uranus: { size: 11, kind: 2, colors: ['#a6dfe3', '#7cc3cf', '#c9eef0'], fact: 'an ice giant tipped on its side' },
  neptune: { size: 11, kind: 2, colors: ['#4d6fe0', '#2f48b0', '#7f9cf0'], fact: 'the farthest planet' },
};

// The satellites behind this app's paddock history (NASA's HLS product joins Landsat and Sentinel-2).
// Orbits are illustrative: the right height and tilt, not live tracking.
const SATELLITES = [
  { name: 'Landsat 9', node: 20, phase: 0, fact: 'NASA and USGS · images every paddock each 16 days' },
  { name: 'Landsat 8', node: 20, phase: 180, fact: 'NASA and USGS · eight days behind Landsat 9' },
  { name: 'Sentinel-2', node: 95, phase: 70, fact: 'ESA · joined with Landsat in NASA’s HLS record' },
];
const SAT_ALT = 705 / 6371; // km above the ground, in Earth radii
const SAT_INCLINATION = 98.2;
const SAT_PERIOD_S = 99 * 60;

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();
const tmpD = new Vector3();
const tmpM = new Matrix4();
const tmpQ = new Quaternion();

const vec = (a, target = new Vector3()) => target.set(a[0], a[1], a[2]);

/** Deterministic random numbers, so the sky looks the same on every visit. */
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Unit vector for a sky position (right ascension and declination in degrees), in the sky group's own frame. */
const skyVec = (raDeg, decDeg) => latLonToVec3(decDeg, raDeg);

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

export default class GlobeEngine {
  /**
   * @param {HTMLElement} host    element the canvas fills
   * @param {object} opts
   * @param {HTMLElement} opts.labels          element that holds the name tags of the Sun, Moon, planets…
   * @param {boolean} [opts.reducedMotion]
   * @param {(place: {lat: number, lon: number}) => void} [opts.onPick]   the farmer clicked a place on Earth
   * @param {() => void} [opts.onInteract]     first drag, scroll or key press
   * @param {() => void} [opts.onContextLost]
   * @param {() => Date} [opts.now]
   * @param {number} [opts.firstSpinAfterMs]  idle time before the first slow spin (default 9 s; 0 spins at once)
   * @param {number} [opts.spinDegPerSec]     speed of the idle spin (default 1.4)
   */
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = opts;
    this.now = opts.now || (() => new Date());
    this.pose = { lat: 0, lon: 0, alt: 3.4 };
    this.velocity = { lat: 0, lon: 0 };
    this.flight = null;
    this.handoffAlt = null;
    this.interactive = true;
    this.running = false;
    this.disposed = false;
    this.lastInput = performance.now();
    this.lastAstro = 0;
    this.time = 0;
    this.labels = [];
    this.pointers = new Map();
    this.patch = null;
    this.patchToken = 0;
    this.disposables = [];
    this.listeners = [];
    this.frame = this.frame.bind(this);
  }

  // ------------------------------------------------------------------ set-up
  async load() {
    const canvas = document.createElement('canvas');
    canvas.className = 'globe__canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', 'Globe of the Earth. Arrow keys turn it, plus and minus zoom.');
    this.canvas = canvas;
    this.host.appendChild(canvas);

    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!this.opts.preserveDrawingBuffer }); // the flag is only for screenshots
    this.renderer = renderer;
    renderer.setClearColor(0x02030a, 1);
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    // software rendering (headless tests, blocked GPUs) gets a lighter scene
    this.low = /swiftshader|llvmpipe|software|basic render/i.test(gpu) || renderer.capabilities.maxTextureSize < 4096;
    this.pixelRatio = this.low ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(this.pixelRatio);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(FOV_DEG, 1, 0.01, 4000);
    this.sunDir = new Vector3(1, 0, 0);

    const loader = new TextureLoader();
    const [day, night, pack, moon] = await Promise.all([dayUrl, nightUrl, packUrl, moonUrl].map((u) => loader.loadAsync(u)));
    if (this.disposed) return;
    const aniso = this.low ? 1 : Math.min(8, renderer.capabilities.getMaxAnisotropy());
    for (const t of [day, night, pack, moon]) {
      t.wrapS = RepeatWrapping;
      t.anisotropy = aniso;
      t.minFilter = LinearMipmapLinearFilter;
      t.magFilter = LinearFilter;
      t.colorSpace = t === pack ? NoColorSpace : SRGBColorSpace;
      this.disposables.push(t);
    }
    this.textures = { day, night, pack, moon };

    this.buildEarth();
    this.buildSky();
    this.buildSun();
    this.buildMoon();
    this.buildPlanets();
    this.buildSatellites();
    this.buildPin();
    this.updateAstro(true);
    this.resize();
    this.bindInput();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.listen(canvas, 'webglcontextlost', (e) => {
      e.preventDefault();
      this.stop();
      this.opts.onContextLost?.();
    });
    this.listen(document, 'visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(this.raf);
      else if (this.running) this.raf = requestAnimationFrame(this.frame);
    });

    this.applyPose();
    try {
      await renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* compiled on first draw instead */
    }
    if (this.disposed) return;
    this.render();
  }

  listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    this.listeners.push(() => target.removeEventListener(type, fn, options));
  }

  track(...things) {
    this.disposables.push(...things);
    return things[0];
  }

  buildEarth() {
    const { day, night, pack } = this.textures;
    const blank = this.track(new CanvasTexture(document.createElement('canvas')));
    this.earthUniforms = {
      uDay: { value: day },
      uNight: { value: night },
      uPack: { value: pack },
      uPatch: { value: blank },
      uSunDir: { value: this.sunDir },
      uTexel: { value: new Vector2(1.6 / 4096, 1.6 / 2048) },
      uRelief: { value: 0.02 },
      uReliefShade: { value: 9 },
      uDive: { value: 0 },
      uCloudShift: { value: 0 },
      uCloudAmount: { value: 1 },
      uPatchOpacity: { value: 0 },
      uPatchRect: { value: new Vector4(0, 0, 1, 1) },
      uToon: { value: this.opts.toon === false ? 0 : 1 },
    };
    const seg = this.low ? 128 : 320;
    const earth = new Mesh(
      this.track(new SphereGeometry(1, seg, seg / 2)),
      this.track(new ShaderMaterial({ uniforms: this.earthUniforms, vertexShader: glsl.earthVertex, fragmentShader: glsl.earthFragment })),
    );
    this.scene.add(earth);

    this.cloudUniforms = {
      uPack: { value: pack },
      uSunDir: { value: this.sunDir },
      uCloudShift: this.earthUniforms.uCloudShift,
      uCloudAmount: this.earthUniforms.uCloudAmount,
      uToon: this.earthUniforms.uToon,
    };
    this.clouds = new Mesh(
      this.track(new SphereGeometry(1.016, 96, 48)),
      this.track(new ShaderMaterial({ uniforms: this.cloudUniforms, vertexShader: glsl.cloudVertex, fragmentShader: glsl.cloudFragment, transparent: true, depthWrite: false })),
    );
    this.clouds.renderOrder = 2;
    this.scene.add(this.clouds);

    this.airUniforms = { uSunDir: { value: this.sunDir }, uStrength: { value: 1 }, uToon: this.earthUniforms.uToon };
    const air = new Mesh(
      this.track(new SphereGeometry(1.3, 96, 48)),
      this.track(new ShaderMaterial({ uniforms: this.airUniforms, vertexShader: glsl.airVertex, fragmentShader: glsl.airFragment, side: BackSide, transparent: true, depthWrite: false, blending: AdditiveBlending })),
    );
    air.renderOrder = 3;
    this.scene.add(air);
  }

  buildSky() {
    const sky = new Group();
    this.sky = sky;
    this.scene.add(sky);

    // the Milky Way, painted once into a texture
    if (!this.low) {
      const target = this.track(new WebGLRenderTarget(2048, 1024, { depthBuffer: false }));
      target.texture.wrapS = RepeatWrapping;
      target.texture.minFilter = LinearFilter;
      const bake = new ShaderMaterial({
        uniforms: { uGalNorth: { value: vec(skyVec(192.859, 27.128)) }, uGalCentre: { value: vec(skyVec(266.405, -28.936)) } },
        vertexShader: glsl.skyBakeVertex,
        fragmentShader: glsl.skyBakeFragment,
        depthTest: false,
      });
      const quad = new Mesh(new PlaneGeometry(2, 2), bake);
      this.renderer.setRenderTarget(target);
      this.renderer.render(quad, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
      this.renderer.setRenderTarget(null);
      quad.geometry.dispose();
      bake.dispose();
      const dome = new Mesh(
        this.track(new SphereGeometry(SKY_R, 48, 24)),
        this.track(new ShaderMaterial({ uniforms: { uSky: { value: target.texture }, uGain: { value: 1 } }, vertexShader: glsl.skyVertex, fragmentShader: glsl.skyFragment, side: BackSide, depthWrite: false })),
      );
      dome.renderOrder = -3;
      sky.add(dome);
    }

    // stars: mostly even, with more along the Milky Way
    const rnd = mulberry32(20261111);
    const count = this.low ? 2500 : 8000;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const galNorth = vec(skyVec(192.859, 27.128));
    const galA = new Vector3(1, 0, 0).cross(galNorth).normalize();
    const galB = new Vector3().crossVectors(galNorth, galA);
    const tints = [new Color('#9db4ff'), new Color('#cad8ff'), new Color('#fff4ea'), new Color('#ffd9a0'), new Color('#ffb070')];
    for (let i = 0; i < count; i++) {
      const v = tmpA;
      if (rnd() < 0.4) {
        // near the galactic plane
        const a = rnd() * Math.PI * 2;
        const off = (rnd() + rnd() + rnd() - 1.5) * 0.22;
        v.copy(galA).multiplyScalar(Math.cos(a)).addScaledVector(galB, Math.sin(a)).addScaledVector(galNorth, off).normalize();
      } else {
        const y = rnd() * 2 - 1;
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(1 - y * y);
        v.set(r * Math.cos(a), y, r * Math.sin(a));
      }
      v.multiplyScalar(SKY_R * 0.96);
      pos.set([v.x, v.y, v.z], i * 3);
      const bright = rnd() ** 7; // a few bright stars, many faint ones
      size[i] = 1.1 + bright * 4.2 + rnd() * 0.5;
      const tint = tints[Math.min(tints.length - 1, Math.floor(rnd() ** 1.3 * tints.length))];
      const gain = 0.35 + bright * 0.9 + rnd() * 0.3;
      col.set([tint.r * gain, tint.g * gain, tint.b * gain], i * 3);
      phase[i] = rnd();
    }
    const geo = this.track(new BufferGeometry());
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new Float32BufferAttribute(col, 3));
    geo.setAttribute('aSize', new Float32BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new Float32BufferAttribute(phase, 1));
    this.starUniforms = { uPixelRatio: { value: this.pixelRatio }, uTime: { value: 0 }, uTwinkle: { value: this.opts.reducedMotion ? 0 : 1 } };
    const stars = new Points(
      geo,
      this.track(new ShaderMaterial({ uniforms: this.starUniforms, vertexShader: glsl.starVertex, fragmentShader: glsl.starFragment, transparent: true, depthWrite: false, blending: AdditiveBlending })),
    );
    stars.renderOrder = -2;
    sky.add(stars);

    // a comet, its tail blown away from the Sun
    this.comet = new Mesh(
      this.track(new PlaneGeometry(1, 0.32)),
      this.track(new ShaderMaterial({ vertexShader: glsl.cardVertex, fragmentShader: glsl.cometFragment, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide })),
    );
    this.comet.geometry.translate(0.42, 0, 0); // the head sits at the card's origin
    this.comet.scale.setScalar(150);
    this.comet.position.copy(vec(skyVec(118, 34))).multiplyScalar(SKY_R * 0.9);
    this.comet.renderOrder = -1;
    sky.add(this.comet);
    this.addLabel({ name: 'Comet', detail: 'its tail always points away from the Sun', object: this.comet, radius: 6, quiet: true });
  }

  buildSun() {
    this.sunUniforms = { uTime: { value: 0 } };
    this.sun = new Mesh(
      this.track(new PlaneGeometry(1, 1)),
      this.track(new ShaderMaterial({ uniforms: this.sunUniforms, vertexShader: glsl.cardVertex, fragmentShader: glsl.sunFragment, transparent: true, depthWrite: false, blending: AdditiveBlending })),
    );
    this.sun.scale.setScalar(1000);
    this.sun.renderOrder = -1;
    this.scene.add(this.sun);
    this.addLabel({ name: 'Sun', detail: 'where it stands over the Earth right now', object: this.sun, radius: 24 });
  }

  buildMoon() {
    this.moonUniforms = { uMap: { value: this.textures.moon }, uLightDir: { value: this.sunDir } };
    this.moon = new Mesh(
      this.track(new SphereGeometry(0.2727, 48, 24)),
      this.track(new ShaderMaterial({ uniforms: this.moonUniforms, vertexShader: glsl.bodyVertex, fragmentShader: glsl.moonFragment })),
    );
    this.scene.add(this.moon);
    this.moonLabel = this.addLabel({ name: 'Moon', detail: '', object: this.moon, radius: 0.2727 });
  }

  buildPlanets() {
    this.planets = {};
    const sphere = this.track(new SphereGeometry(1, 48, 24));
    let seed = 1;
    for (const [id, p] of Object.entries(PLANETS)) {
      const uniforms = {
        uLightDir: { value: new Vector3(1, 0, 0) },
        uColorA: { value: new Color(p.colors[0]) },
        uColorB: { value: new Color(p.colors[1]) },
        uColorC: { value: new Color(p.colors[2]) },
        uKind: { value: p.kind },
        uSeed: { value: seed++ * 3.7 },
      };
      const mesh = new Mesh(sphere, this.track(new ShaderMaterial({ uniforms, vertexShader: glsl.bodyVertex, fragmentShader: glsl.planetFragment })));
      mesh.scale.setScalar(p.size);
      if (p.ring) {
        const ringUniforms = { uColorA: { value: new Color('#cdb98a') }, uColorB: { value: new Color('#efe2bd') }, uInner: { value: 1.28 }, uOuter: { value: 2.3 }, uLight: { value: 1 } };
        const ring = new Mesh(
          this.track(new RingGeometry(1.28, 2.3, 96, 1)),
          this.track(new ShaderMaterial({ uniforms: ringUniforms, vertexShader: glsl.ringVertex, fragmentShader: glsl.ringFragment, transparent: true, depthWrite: false, side: DoubleSide })),
        );
        ring.rotation.x = -Math.PI / 2; // Saturn's pole points almost at the Earth's north, so the rings lie near our equator's plane
        mesh.add(ring);
      }
      this.scene.add(mesh);
      this.planets[id] = { mesh, uniforms, label: this.addLabel({ name: id[0].toUpperCase() + id.slice(1), detail: p.fact, object: mesh, radius: p.size * (p.ring ? 2.3 : 1) }), fact: p.fact };
    }
  }

  buildSatellites() {
    this.satGroup = new Group(); // orbits hold still against the stars while the Earth turns under them
    this.sky.add(this.satGroup);
    const r = 1 + SAT_ALT;
    const dot = this.track(new SphereGeometry(0.0075, 10, 8));
    const body = this.track(new MeshBasicMaterial({ color: 0xfff1cf }));
    const line = this.track(new LineBasicMaterial({ color: 0xcfb173, transparent: true, opacity: 0.2, depthWrite: false }));
    const nodes = new Map();
    this.sats = SATELLITES.map((s) => {
      // orbit plane: tilted by the inclination, then swung round to its node
      const plane = new Group();
      plane.rotation.order = 'YXZ';
      plane.rotation.y = s.node * RAD;
      plane.rotation.x = (SAT_INCLINATION - 90) * RAD;
      if (!nodes.has(s.node)) {
        const pts = [];
        for (let i = 0; i < 180; i++) pts.push(Math.cos((i / 180) * 2 * Math.PI) * r, Math.sin((i / 180) * 2 * Math.PI) * r, 0);
        const geo = this.track(new BufferGeometry());
        geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
        plane.add(new LineLoop(geo, line));
        nodes.set(s.node, true);
      }
      const mesh = new Mesh(dot, body);
      plane.add(mesh);
      this.satGroup.add(plane);
      this.addLabel({ name: s.name, detail: s.fact, object: mesh, radius: 0.0075, quiet: true, near: true });
      return { ...s, mesh, r };
    });
  }

  buildPin() {
    this.pinUniforms = { uTime: { value: 0 }, uColor: { value: new Color('#f3d27a') } };
    this.pin = new Mesh(
      this.track(new PlaneGeometry(1, 1)),
      this.track(new ShaderMaterial({ uniforms: this.pinUniforms, vertexShader: glsl.cardVertex, fragmentShader: glsl.pinFragment, transparent: true, depthWrite: false, side: DoubleSide })),
    );
    this.pin.visible = false;
    this.pin.renderOrder = 4;
    this.scene.add(this.pin);
    this.pinLabel = this.addLabel({ name: '', detail: '', object: this.pin, radius: 0, near: true, strong: true });
    this.pinLabel.el.hidden = true;
  }

  // ------------------------------------------------------------------ name tags
  addLabel({ name, detail, object, radius, quiet = false, near = false, strong = false }) {
    const el = document.createElement('div');
    el.className = `globe-tag${quiet ? ' globe-tag--quiet' : ''}${strong ? ' globe-tag--strong' : ''}`;
    const title = document.createElement('strong');
    const sub = document.createElement('span');
    title.textContent = name;
    sub.textContent = detail;
    el.append(title, sub);
    this.opts.labels?.appendChild(el);
    const label = { el, title, sub, object, radius, near, shown: false, x: 0, y: 0, reach: 0 };
    this.labels.push(label);
    return label;
  }

  /** Puts each name tag next to its body, and hides the ones behind the Earth or off screen. */
  placeLabels() {
    const w = this.width;
    const h = this.height;
    const cam = this.camera;
    const camPos = cam.position;
    const hidden = this.earthUniforms.uDive.value > 0.6;
    for (const l of this.labels) {
      let show = !hidden && l.object.visible !== false && l.title.textContent !== '';
      if (show) {
        const p = l.object.getWorldPosition(tmpA);
        // behind the Earth?
        const dir = tmpB.copy(p).sub(camPos);
        const dist = dir.length();
        dir.divideScalar(dist);
        const t = -camPos.dot(dir);
        if (t > 0 && t < dist) {
          const closest = tmpC.copy(camPos).addScaledVector(dir, t).length();
          if (closest < (l.near ? 0.995 : 1.02)) show = false;
        }
        if (show) {
          const sizePx = (l.radius / dist) * (h / (2 * Math.tan((FOV_DEG * RAD) / 2))); // l.radius is in world units
          const ndc = p.project(cam);
          if (ndc.z > 1 || Math.abs(ndc.x) > 1.05 || Math.abs(ndc.y) > 1.05) show = false;
          else {
            l.x = (ndc.x * 0.5 + 0.5) * w;
            l.y = (-ndc.y * 0.5 + 0.5) * h;
            l.reach = Math.max(10, sizePx);
            l.el.style.transform = `translate(${Math.round(l.x + Math.min(l.reach, 60) * 0.72 + 6)}px, ${Math.round(l.y + Math.min(l.reach, 60) * 0.72 + 4)}px)`;
          }
        }
      }
      if (show !== l.shown) {
        l.shown = show;
        l.el.classList.toggle('is-shown', show);
      }
    }
  }

  // ------------------------------------------------------------------ sky positions
  updateAstro(force = false) {
    const nowMs = performance.now();
    if (!force && nowMs - this.lastAstro < 1000) return;
    this.lastAstro = nowMs;
    const date = this.now();
    vec(sunDirection(date), this.sunDir);
    this.sun.position.copy(this.sunDir).multiplyScalar(1250);
    this.sky.rotation.y = -gmstDeg(date) * RAD;

    const moon = moonPosition(date);
    vec(moon.dir, this.moon.position).multiplyScalar(MOON_DIST);
    this.moon.lookAt(0, 0, 0);
    this.moon.rotateY(-Math.PI / 2); // the texture's near side faces the Earth
    this.moonLabel.sub.textContent = `${Math.round(moon.illuminated * 100)}% lit · ${(Math.round(moon.distanceKm / 1000) * 1000).toLocaleString('en-AU')} km away`;

    const sunPos = tmpA.copy(this.sunDir); // 1 au, near enough
    for (const p of planetPositions(date)) {
      const body = this.planets[p.id];
      if (!body) continue;
      vec(p.dir, body.mesh.position).multiplyScalar(PLANET_R);
      const geo = tmpB.set(p.dir[0], p.dir[1], p.dir[2]).multiplyScalar(p.distanceAu);
      body.uniforms.uLightDir.value.copy(sunPos).sub(geo).normalize();
      body.label.sub.textContent = `${body.fact} · ${p.distanceAu.toFixed(p.distanceAu < 10 ? 2 : 1)} au away now`;
    }
  }

  /** Uses another clock (a fixed moment for screenshots and tests). */
  setClock(now) {
    this.now = now;
    this.updateAstro(true);
    if (!this.running) this.render();
  }

  // ------------------------------------------------------------------ camera
  /** Height at which the whole Earth sits comfortably in the view. */
  orbitAlt() {
    const half = (FOV_DEG * RAD) / 2;
    const halfH = Math.atan(Math.tan(half) * (this.camera?.aspect || 1.6));
    const fit = Math.min(half, halfH) * 0.8;
    return clamp(1 / Math.sin(fit) - 1, 2.6, 8);
  }

  getPose() {
    return { ...this.pose };
  }

  setPose(pose) {
    Object.assign(this.pose, pose);
    this.pose.lat = clamp(this.pose.lat, -85, 85);
    this.velocity.lat = this.velocity.lon = 0;
    this.applyPose();
    if (!this.running) this.render();
  }

  applyPose() {
    const { lat, lon, alt } = this.pose;
    const d = 1 + alt;
    vec(latLonToVec3(lat, lon), this.camera.position).multiplyScalar(d);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = clamp(alt * 0.2, 0.002, 0.5);
    this.camera.updateProjectionMatrix();
  }

  /**
   * The height at which the globe has fully become the flat, daylight map (the hand-off to Leaflet),
   * or null for the plain view from orbit.
   */
  setHandoff(alt) {
    this.handoffAlt = alt;
  }

  /** Flies the camera to a pose. Resolves true when it arrives, false if another flight replaced it. */
  flyTo(to, options = {}) {
    this.cancelFlight();
    const from = this.getPose();
    const target = { lat: clamp(to.lat ?? from.lat, -85, 85), lon: to.lon ?? from.lon, alt: to.alt ?? from.alt };
    if (this.opts.reducedMotion || options.duration === 0) {
      this.setPose(target);
      return Promise.resolve(true);
    }
    const plan = planFlight(from, target, options);
    this.velocity.lat = this.velocity.lon = 0;
    return new Promise((resolve) => {
      this.flight = { plan, start: performance.now(), resolve, target, onProgress: options.onProgress, interruptible: !!options.interruptible };
      if (!this.running) this.start();
    });
  }

  cancelFlight() {
    const f = this.flight;
    if (!f) return;
    this.flight = null;
    f.resolve(false);
  }

  /** Jumps to the end of the current flight. */
  finishFlight() {
    const f = this.flight;
    if (!f) return;
    this.flight = null;
    Object.assign(this.pose, f.target);
    this.applyPose();
    f.resolve(true);
  }

  // ------------------------------------------------------------------ the map's own tiles, painted on the globe
  /**
   * Paints a block of the Leaflet basemap's tiles onto the ground around a place, so the last
   * stretch of the dive shows the very imagery the map will show.
   * @param {{ url: string, lat: number, lon: number, zoom: number }} p  url is a {z}/{y}/{x} template
   */
  setPatch({ url, lat, lon, zoom }) {
    const token = ++this.patchToken;
    const z = clamp(Math.floor(zoom), 2, 14);
    const size = this.low ? 4 : 6;
    const block = tileBlock(lat, lon, z, size);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = block.size * 256;
    const ctx = canvas.getContext('2d');
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = this.low ? 1 : 4;
    this.patch?.texture.dispose();
    let settle;
    const settled = new Promise((resolve) => (settle = resolve));
    this.patch = { texture, ready: false, settled };
    let sharp = 0;
    this.earthUniforms.uPatch.value = texture;
    this.earthUniforms.uPatchRect.value.set(...block.rect);

    const fine = new Map(); // "x,y" -> image, so a late coarse tile never paints over sharp ones
    const tileUrl = (tz, tx, ty) => url.replace('{z}', tz).replace('{x}', ((tx % 2 ** tz) + 2 ** tz) % 2 ** tz).replace('{y}', ty);
    const loadTile = (tz, tx, ty, done) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (token !== this.patchToken || this.disposed) return;
        try {
          done(img);
          texture.needsUpdate = true;
          this.patch.ready = true;
          if (!this.running) this.render();
        } catch {
          /* a tile we may not read: leave the world texture showing */
        }
      };
      img.src = tileUrl(tz, tx, ty);
    };

    // a coarse layer first (two zooms out), so something sharp-ish covers the block quickly
    const step = z >= 2 ? 4 : 1;
    if (step > 1) {
      const cz = z - 2;
      for (let cy = Math.floor(block.y0 / step); cy <= Math.floor((block.y0 + block.size - 1) / step); cy++) {
        for (let cx = Math.floor(block.x0 / step); cx <= Math.floor((block.x0 + block.size - 1) / step); cx++) {
          loadTile(cz, cx, cy, (img) => {
            ctx.drawImage(img, (cx * step - block.x0) * 256, (cy * step - block.y0) * 256, 256 * step, 256 * step);
            for (const [key, f] of fine) {
              const [fx, fy] = key.split(',').map(Number);
              if (Math.floor(fx / step) === cx && Math.floor(fy / step) === cy) ctx.drawImage(f, (fx - block.x0) * 256, (fy - block.y0) * 256);
            }
          });
        }
      }
    }
    // then the map's own tiles, the middle ones first
    const cells = [];
    for (let y = 0; y < block.size; y++) for (let x = 0; x < block.size; x++) cells.push([x, y]);
    const mid = (block.size - 1) / 2;
    cells.sort((a, b) => Math.hypot(a[0] - mid, a[1] - mid) - Math.hypot(b[0] - mid, b[1] - mid));
    for (const [x, y] of cells) {
      loadTile(z, block.x0 + x, block.y0 + y, (img) => {
        fine.set(`${block.x0 + x},${block.y0 + y}`, img);
        ctx.drawImage(img, x * 256, y * 256);
        if (++sharp >= Math.min(cells.length, 12)) settle(); // the middle of the view is sharp
      });
    }
  }

  /** Resolves once the middle of the patch is sharp, or after `timeoutMs`, whichever is first. */
  patchReady(timeoutMs = 400) {
    if (!this.patch) return Promise.resolve();
    return Promise.race([this.patch.settled, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  }

  clearPatch() {
    this.patchToken++;
    this.patch?.texture.dispose();
    this.patch = null;
    this.earthUniforms.uPatchOpacity.value = 0;
  }

  // ------------------------------------------------------------------ a pin for the farm
  setPin(place) {
    if (!place) {
      this.pin.visible = false;
      this.pinLabel.title.textContent = '';
      this.pinLabel.el.hidden = true;
    } else {
      const dir = vec(latLonToVec3(place.lat, place.lon), tmpA);
      this.pin.position.copy(dir).multiplyScalar(1.03);
      this.pin.lookAt(dir.multiplyScalar(3));
      this.pin.visible = true;
      this.pinLabel.title.textContent = place.label || '';
      this.pinLabel.sub.textContent = place.detail || '';
      this.pinLabel.el.hidden = false;
    }
    if (!this.running && this.scene) this.render();
  }

  // ------------------------------------------------------------------ input
  setInteractive(on) {
    this.interactive = on;
    if (!on) {
      this.pointers.clear();
      this.velocity.lat = this.velocity.lon = 0;
    }
  }

  touched() {
    this.lastInput = performance.now();
    if (!this.hasInteracted) {
      this.hasInteracted = true;
      this.opts.onInteract?.();
    }
  }

  /** Radians of ground per screen pixel at the middle of the view. */
  groundPerPixel() {
    return (2 * Math.tan((FOV_DEG * RAD) / 2) * this.pose.alt) / this.height;
  }

  rotateBy(dxPx, dyPx) {
    const k = this.groundPerPixel() / RAD;
    const cosLat = Math.max(0.3, Math.cos(this.pose.lat * RAD));
    this.pose.lon = this.pose.lon - (dxPx * k) / cosLat;
    this.pose.lat = clamp(this.pose.lat + dyPx * k, -85, 85);
  }

  zoomBy(factor) {
    this.pose.alt = clamp(this.pose.alt * factor, MIN_ALT, MAX_ALT);
  }

  /** The place on the ground under a point of the canvas, or null where the sky shows. */
  placeAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = tmpA.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1, 0.5);
    const origin = this.camera.position;
    const dir = ndc.unproject(this.camera).sub(origin).normalize();
    const b = origin.dot(dir);
    const c = origin.lengthSq() - 1;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    const hit = tmpB.copy(origin).addScaledVector(dir, t);
    return vec3ToLatLon([hit.x, hit.y, hit.z]);
  }

  bindInput() {
    const c = this.canvas;
    let down = null;
    let pinch = 0;
    const busy = () => !this.interactive || !!this.flight;

    this.listen(c, 'pointerdown', (e) => {
      if (this.flight?.interruptible && this.interactive) this.cancelFlight(); // grabbing the globe ends its opening turn
      if (busy()) return;
      c.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      else {
        down = null;
        const [a, b] = [...this.pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
      this.velocity.lat = this.velocity.lon = 0;
      this.touched();
      c.classList.add('is-grabbing');
    });
    this.listen(c, 'pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return this.hover(e);
      if (busy()) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 1) {
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) down.moved = true;
        if (!down || down.moved) {
          const before = { lat: this.pose.lat, lon: this.pose.lon };
          this.rotateBy(dx, dy);
          // remember the speed, for a little glide after the finger lifts
          this.velocity.lon = this.pose.lon - before.lon;
          this.velocity.lat = this.pose.lat - before.lat;
        }
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && dist > 0) this.zoomBy(pinch / dist);
        pinch = dist;
      }
      this.touched();
    });
    const up = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      c.classList.toggle('is-grabbing', this.pointers.size > 0);
      if (down && !down.moved && performance.now() - down.t < 450 && e.type === 'pointerup' && !busy()) {
        const place = this.placeAt(e.clientX, e.clientY);
        if (place) this.opts.onPick?.(place);
      }
      if (this.opts.reducedMotion) this.velocity.lat = this.velocity.lon = 0;
      down = null;
    };
    this.listen(c, 'pointerup', up);
    this.listen(c, 'pointercancel', up);
    this.listen(c, 'pointerleave', () => this.hover(null));
    this.listen(
      c,
      'wheel',
      (e) => {
        e.preventDefault();
        if (busy()) return;
        const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 400 : 1;
        this.zoomBy(Math.exp(clamp(e.deltaY * unit, -240, 240) * 0.0014));
        this.touched();
      },
      { passive: false },
    );
    this.listen(c, 'keydown', (e) => {
      if (busy()) return;
      const step = 40;
      if (e.key === 'ArrowLeft') this.rotateBy(step, 0);
      else if (e.key === 'ArrowRight') this.rotateBy(-step, 0);
      else if (e.key === 'ArrowUp') this.rotateBy(0, step);
      else if (e.key === 'ArrowDown') this.rotateBy(0, -step);
      else if (e.key === '+' || e.key === '=') this.zoomBy(0.8);
      else if (e.key === '-' || e.key === '_') this.zoomBy(1.25);
      else if (e.key === 'Enter') this.opts.onPick?.({ lat: this.pose.lat, lon: this.pose.lon });
      else return;
      e.preventDefault();
      this.touched();
    });
  }

  /** Highlights the name tag of the body under the pointer. */
  hover(e) {
    let best = null;
    if (e && this.interactive && !this.flight) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let bestD = Infinity;
      for (const l of this.labels) {
        if (!l.shown) continue;
        const d = Math.hypot(l.x - x, l.y - y);
        if (d < Math.max(18, Math.min(l.reach, 70) + 8) && d < bestD) {
          best = l;
          bestD = d;
        }
      }
    }
    if (best === this.hovered) return;
    this.hovered?.el.classList.remove('is-hover');
    best?.el.classList.add('is-hover');
    this.hovered = best;
  }

  // ------------------------------------------------------------------ drawing
  resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.running) this.render();
  }

  /** Before the farmer has touched the globe it may spin at once; after a drag it waits the usual 9 s. */
  spinAfter() {
    return this.hasInteracted ? IDLE_SPIN_AFTER_MS : (this.opts.firstSpinAfterMs ?? IDLE_SPIN_AFTER_MS);
  }

  start() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  frame(nowMs) {
    if (!this.running || this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;
    this.time += dt;

    const f = this.flight;
    if (f) {
      const t = (performance.now() - f.start) / f.plan.duration;
      const p = f.plan.at(t);
      this.pose.lat = p.lat;
      this.pose.lon = p.lon;
      this.pose.alt = p.alt;
      f.onProgress?.(Math.min(1, t), p);
      if (t >= 1) {
        this.flight = null;
        Object.assign(this.pose, f.target);
        f.resolve(true);
      }
    } else if (this.pointers.size === 0) {
      // glide to a stop after a drag, then turn slowly once left alone
      const v = this.velocity;
      if (Math.abs(v.lon) + Math.abs(v.lat) > 0.0005) {
        this.pose.lon += v.lon;
        this.pose.lat = clamp(this.pose.lat + v.lat, -85, 85);
        const keep = Math.exp(-dt * 4.5);
        v.lon *= keep;
        v.lat *= keep;
      } else if (this.interactive && !this.opts.reducedMotion && !this.handoffAlt && performance.now() - this.lastInput > this.spinAfter()) {
        this.pose.lon -= dt * (this.opts.spinDegPerSec ?? 1.4);
      }
    }
    this.pose.lon = lonDelta(0, this.pose.lon);
    this.applyPose();
    this.updateAstro();
    this.render();
  }

  render() {
    if (!this.renderer || this.disposed) return;
    const u = this.earthUniforms;
    // the change from "planet" to "map" is spread over the last stretch of the descent; a high
    // hand-off (a whole country in view) leaves less room for it
    const room = this.handoffAlt ? (0.8 * this.orbitAlt()) / this.handoffAlt : 0;
    const dive = this.handoffAlt ? diveAmount(this.pose.alt, this.handoffAlt, clamp(room, 1.3, 4.5)) : 0;
    u.uDive.value = dive;
    u.uCloudAmount.value = 1 - dive;
    u.uRelief.value = 0.02 * (1 - dive);
    u.uReliefShade.value = 9 * (1 - dive);
    u.uPatchOpacity.value = this.patch?.ready && this.handoffAlt ? diveAmount(this.pose.alt, this.handoffAlt, clamp(room, 1.3, 12)) : 0;
    this.airUniforms.uStrength.value = 1 - dive;
    this.clouds.visible = dive < 0.995;
    if (!this.opts.reducedMotion) u.uCloudShift.value = (this.time * 0.00035) % 1;
    this.starUniforms.uTime.value = this.time;
    this.sunUniforms.uTime.value = this.time;
    this.pinUniforms.uTime.value = this.opts.reducedMotion ? 0.45 : this.time;

    // cards that face the camera
    this.sun.quaternion.copy(this.camera.quaternion);
    if (this.pin.visible) this.pin.scale.setScalar(clamp(this.pose.alt * 0.11, 0.02, 0.5));

    // the comet's tail streams away from the Sun
    const cometPos = this.comet.getWorldPosition(tmpA);
    const toCam = tmpB.copy(this.camera.position).sub(cometPos).normalize();
    const away = tmpC.copy(cometPos).sub(this.sun.position);
    away.addScaledVector(toCam, -away.dot(toCam)).normalize();
    tmpM.makeBasis(away, tmpD.crossVectors(toCam, away), toCam);
    this.comet.quaternion.setFromRotationMatrix(tmpM).premultiply(tmpQ.copy(this.sky.quaternion).invert());

    // satellites
    const seconds = this.now().getTime() / 1000;
    for (const s of this.sats) {
      const a = ((seconds * SAT_SPEEDUP) / SAT_PERIOD_S) * 2 * Math.PI + s.phase * RAD;
      s.mesh.position.set(Math.cos(a) * s.r, Math.sin(a) * s.r, 0);
    }
    this.satGroup.visible = dive < 0.5;

    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.cancelFlight();
    this.patchToken++;
    this.resizeObserver?.disconnect();
    for (const off of this.listeners) off();
    for (const d of this.disposables) d.dispose?.();
    this.patch?.texture.dispose();
    for (const l of this.labels) l.el.remove();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    this.canvas?.remove();
  }
}
