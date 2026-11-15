// The island's ambient sound: the sea lapping, a breeze, birds by day, crickets and the odd owl
// at night, a sheep now and then, the windmill's creak, and faint bells at Christmas. All made
// with the Web Audio API (src/audio/voices.js); how loud each is comes from src/audio/mix.js.
//
//   const amb = createAmbience()
//   amb.attach({ getScene, hasWindmill })   the hub is showing: getScene() -> { hour, night, golden,
//                                           morning, season, occasion } (or null while there's none)
//   amb.detach()                            the hub's gone (fades out)
//   amb.toggle() / amb.setOn(bool)          the farmer's switch (remembered)
//   amb.onChange(fn)                        fn({ on, available }) when the switch changes
//
// It stays quiet:
//   - until the first tap, click or key press on the island (browsers only start sound after one;
//     no AudioContext exists before it, so nothing can play)
//   - with the tab hidden (and the AudioContext suspended, so it costs nothing)
//   - while "Plan my next seasons" is open (body.plans-open), and when switched off
// Changes of hour, season and festival crossfade over a few seconds; the switch fades too.
import { masterFor, mixAt, nextGap, readSoundPref, writeSoundPref } from './mix.js';
import { baa, bells, bird, creak, noiseBuffer, owl, panTo } from './voices.js';

// how loud each bed sits in the mix at level 1 (the master is on top: mix.js MASTER)
const BED = { sea: 0.6, breeze: 0.42, crickets: 0.05 };
const CROSSFADE = 2.4; // s: the time constant beds and the master ease with
const TICK_MS = 200;
const LOOKAHEAD = 0.6; // s of calls scheduled ahead of the clock

const safeStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function createAmbience({ storage = safeStorage(), rnd = Math.random } = {}) {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  const available = typeof AC === 'function';
  let on = readSoundPref(storage);
  let unlocked = false; // a gesture on the island has happened
  let scene = null; // { getScene, hasWindmill } while the hub shows
  let ctx = null;
  let g = null; // the graph, once built
  let timer = 0;
  let levels = null; // the last mix
  let target = 0; // the master's last target
  let quietSince = 0;
  let suspending = false;
  let lastError = null;
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => { try { fn({ on, available }); } catch (e) { console.error('ambience: listener', e); } });

  // ---------------------------------------------------------------- the graph (built on the first gesture)
  function build() {
    if (ctx || !available) return;
    try {
      ctx = new AC({ latencyHint: 'playback' });
    } catch {
      try { ctx = new AC(); } catch (e) { lastError = e; ctx = null; return; }
    }
    const gain = (v = 0, to) => { const n = ctx.createGain(); n.gain.value = v; if (to) n.connect(to); return n; };
    const filter = (type, f, q, to) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q != null) n.Q.value = q; if (to) n.connect(to); return n; };
    const loop = (buf, to, offset = 0) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(to); s.start(ctx.currentTime, offset); return s; };

    const master = gain(0);
    const soften = filter('lowpass', 9000, 0.5, ctx.destination); // nothing sharp gets through
    master.connect(soften);
    const brown = noiseBuffer(ctx, 'brown');
    const pink = noiseBuffer(ctx, 'pink');
    const white = noiseBuffer(ctx, 'white', 4);

    // the sea: a low roar, and waves washing in and out over it
    const sea = gain(0, master);
    const roarLp = filter('lowpass', 380, 0.4, gain(0.55, sea));
    loop(brown, roarLp);
    const waveEnv = gain(0.1, sea);
    const waveLp = filter('lowpass', 420, 0.6, waveEnv);
    loop(pink, filter('highpass', 120, 0.5, waveLp), 1.7);

    // the breeze: pink noise through a soft band that drifts, in gusts
    const breeze = gain(0, master);
    const gustPan = panTo(ctx, breeze, 0);
    const gust = gain(0.4, gustPan);
    const breezeBp = filter('bandpass', 520, 0.55, gust);
    loop(pink, breezeBp, 3.9);

    // crickets: a few, each a high note chirping in little pulses
    const crickets = gain(0, master);
    const bugs = [4300, 4750, 5200].map((f, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f * (0.98 + rnd() * 0.04);
      const env = gain(0, panTo(ctx, crickets, [-0.6, 0.15, 0.7][i]));
      o.connect(env);
      o.start();
      return { env, period: 0.42 + rnd() * 0.25, pulses: 2 + Math.floor(rnd() * 3), next: 0 };
    });

    // the calls (birds, owl, sheep, windmill, bells) go straight to the master
    const calls = gain(1, master);
    g = { master, sea, waveEnv, waveLp, breeze, gust, gustPan, breezeBp, crickets, bugs, calls, white, next: { wave: 0, gust: 0 }, due: {}, set: new Map() };

    // (iOS may refuse the first gesture's resume: the gesture listeners stay until it's running)
    ctx.onstatechange = () => { if (ctx.state === 'running') { removeGestures(); tick(); } };
  }

  /** Eases an AudioParam to v (only when its target actually moves: no pile of automation). */
  function ease(param, v, tc = CROSSFADE) {
    const last = g.set.get(param);
    if (last !== undefined && Math.abs(last - v) < 0.002) return;
    g.set.set(param, v);
    param.setTargetAtTime(v, ctx.currentTime, tc);
  }

  // ---------------------------------------------------------------- every few frames
  function tick() {
    if (!scene && (!ctx || ctx.state !== 'running')) { stopTimer(); return; } // detached, and quiet
    if (!ctx || !g) return;
    const s = scene?.getScene?.() ?? null;
    const away = !scene || !s || document.body.classList.contains('plans-open');
    const want = masterFor({ on, unlocked, hidden: document.hidden, away });
    const now = ctx.currentTime;

    if (want > 0 && ctx.state === 'suspended') { ctx.resume().catch(() => {}); return; }
    if (ctx.state !== 'running') return;

    if (want !== target) {
      // in gently (and from silence, a slower start); out quicker, but never a cut
      ease(g.master.gain, want, want > target ? (target === 0 ? 1.4 : CROSSFADE) : document.hidden ? 0.12 : 0.5);
      target = want;
      if (want === 0) quietSince = performance.now();
    }
    if (want === 0) {
      // once it has faded, stop the clock: no CPU while nobody's listening
      if (!suspending && performance.now() - quietSince > (document.hidden ? 600 : 3000)) {
        suspending = true;
        g.master.gain.cancelScheduledValues(now);
        g.master.gain.setValueAtTime(0, now);
        g.set.set(g.master.gain, 0);
        ctx.suspend().catch(() => {}).finally(() => { suspending = false; });
      }
      // calls don't pile up for when it comes back
      for (const k of Object.keys(g.due)) g.due[k] = 0;
      return;
    }
    if (!s) return;

    levels = mixAt(s);
    ease(g.sea.gain, levels.sea * BED.sea);
    ease(g.breeze.gain, levels.breeze * BED.breeze);
    ease(g.crickets.gain, levels.crickets * BED.crickets);

    // waves: in over a second or two, and back out
    const horizon = now + LOOKAHEAD;
    if (g.next.wave < now) g.next.wave = now + 0.2;
    while (g.next.wave < horizon) {
      const t = g.next.wave;
      const rise = 1.3 + rnd() * 0.9;
      const big = 0.45 + rnd() * 0.55;
      g.waveEnv.gain.setTargetAtTime(big, t, rise / 3);
      g.waveEnv.gain.setTargetAtTime(0.08, t + rise, 1 + rnd() * 0.7);
      g.waveLp.frequency.setTargetAtTime(800 + rnd() * 700, t, rise / 3);
      g.waveLp.frequency.setTargetAtTime(360, t + rise, 1.2);
      g.next.wave = t + rise + 2.6 + rnd() * 4;
    }
    // gusts: the breeze rises and falls, and drifts from side to side
    if (g.next.gust < now) g.next.gust = now + 0.2;
    while (g.next.gust < horizon) {
      const t = g.next.gust;
      g.gust.gain.setTargetAtTime(0.25 + rnd() * 0.75, t, 1.2 + rnd());
      g.breezeBp.frequency.setTargetAtTime(340 + rnd() * 520, t, 1.5);
      if (g.gustPan.pan) g.gustPan.pan.setTargetAtTime((rnd() * 2 - 1) * 0.6, t, 2.5);
      g.next.gust = t + 2.5 + rnd() * 4.5;
    }
    // crickets: chirp-chirp-chirp, each to its own beat, with a rest now and then
    if (levels.crickets > 0.02) {
      for (const b of g.bugs) {
        if (b.next < now) b.next = now + rnd() * b.period;
        while (b.next < horizon) {
          const t = b.next;
          for (let i = 0; i < b.pulses; i++) {
            const p = t + i * 0.034;
            b.env.gain.setValueAtTime(0, p);
            b.env.gain.linearRampToValueAtTime(1, p + 0.005);
            b.env.gain.linearRampToValueAtTime(0, p + 0.021);
          }
          b.next = t + b.period * (0.93 + rnd() * 0.14) + (rnd() < 0.07 ? 1.5 + rnd() * 3 : 0);
        }
      }
    }
    // the calls, each at random, as often as the mix says
    const r = levels.rates;
    const calls = [
      ['birds', r.birds, (t) => bird(ctx, g.calls, t, { rnd, level: levels.birds })],
      ['owl', r.owl, (t) => owl(ctx, g.calls, t, { rnd })],
      ['baa', r.baa, (t) => baa(ctx, g.calls, t, { rnd })],
      ['creak', scene.hasWindmill?.() === false ? 0 : r.creak, (t) => creak(ctx, g.calls, t, { rnd, level: levels.creak })],
      ['bells', r.bells, (t) => bells(ctx, g.calls, t, { rnd, level: levels.bells, noise: g.white, jingle: s.occasion === 'christmas' })],
    ];
    for (const [k, perMinute, play] of calls) {
      if (!(perMinute > 0)) { g.due[k] = 0; continue; }
      if (!g.due[k]) g.due[k] = now + nextGap(perMinute, rnd, 2) * (k === 'birds' ? 0.3 : 1); // (birds soon after the fade-in)
      if (g.due[k] < horizon) {
        const t = Math.max(now + 0.05, g.due[k]);
        try { play(t); } catch (e) { lastError = e; }
        g.due[k] = t + nextGap(perMinute, rnd, 2);
      }
    }
  }

  function startTimer() { if (!timer) timer = setInterval(tick, TICK_MS); }
  function stopTimer() { clearInterval(timer); timer = 0; }

  // ---------------------------------------------------------------- the first gesture on the island
  const GESTURES = ['pointerdown', 'keydown', 'touchend'];
  function onGesture(e) {
    if (e.type === 'keydown' && (e.key === 'Escape' || e.repeat)) return; // (Esc doesn't count as a gesture in browsers)
    unlocked = true;
    if (ctx?.state === 'running') removeGestures();
    else wake();
  }
  function addGestures() { for (const t of GESTURES) addEventListener(t, onGesture, { capture: true, passive: true }); }
  function removeGestures() { for (const t of GESTURES) removeEventListener(t, onGesture, { capture: true }); }

  /** Inside a gesture (or after one): build the sound if it's wanted, and let it play. */
  function wake() {
    if (!on || !scene || !unlocked) return tick();
    build();
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
    tick();
  }

  const onVisibility = () => tick();
  document.addEventListener('visibilitychange', onVisibility);

  function setOn(v) {
    on = !!v;
    writeSoundPref(storage, on);
    unlocked = true; // the switch was pressed: that's a gesture
    wake();
    notify();
  }

  return {
    attach({ getScene, hasWindmill } = {}) {
      scene = { getScene, hasWindmill };
      if (!unlocked) addGestures();
      startTimer();
      wake();
    },
    detach() {
      scene = null;
      removeGestures();
      tick(); // fades out, suspends, and then the timer stops itself
    },
    toggle() { setOn(!on); },
    setOn,
    onChange(fn) { listeners.add(fn); fn({ on, available }); return () => listeners.delete(fn); },
    get on() { return on; },
    get available() { return available; },
    /** For testing in the console: what it's doing now. */
    get debug() {
      return {
        on, unlocked, attached: !!scene, context: ctx ? ctx.state : 'none', master: g ? +g.master.gain.value.toFixed(4) : 0, target,
        levels, beds: g ? { sea: +g.sea.gain.value.toFixed(4), breeze: +g.breeze.gain.value.toFixed(4), crickets: +g.crickets.gain.value.toFixed(4) } : null,
        error: lastError ? String(lastError) : null,
      };
    },
  };
}
