// The farm's one-off sounds, made with the Web Audio API (no recordings): a bird's call, an owl,
// a sheep's baa, the windmill's creak and a far-off bell. Each one builds its few nodes, plays
// once at time t into `out`, and lets go of them when it's done.
//
//   bird(ctx, out, t, { rnd, level })    owl(...)    baa(...)    creak(...)    bells(ctx, out, t, { rnd, level, noise, jingle })
//
// Also the noise the beds are made of: noiseBuffer(ctx, 'pink' | 'brown' | 'white').

/** A few seconds of stereo noise, to loop (pink: the breeze; brown: the sea's low roar). */
export function noiseBuffer(ctx, kind = 'white', seconds = 6) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'pink') { // Paul Kellet's filter
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    // ease the loop's seam so it never clicks
    const fade = Math.min(2048, n >> 3);
    for (let i = 0; i < fade; i++) { const k = i / fade; d[i] *= k; d[n - 1 - i] *= k; }
  }
  return buf;
}

/** A stereo panner into `out` (or `out` itself where there's no panner). */
export function panTo(ctx, out, p) {
  if (!ctx.createStereoPanner) return out;
  const n = ctx.createStereoPanner();
  n.pan.value = Math.max(-1, Math.min(1, p));
  n.connect(out);
  return n;
}

// lets go of a sound's nodes once its source has stopped
const release = (src, nodes) => { src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch { /* gone */ } } }; };

const spread = (rnd, w = 0.8) => (rnd() * 2 - 1) * w;

/** A small bird: a few quick tweets, a two-note whistle, or a trill. */
export function bird(ctx, out, t, { rnd = Math.random, level = 1 } = {}) {
  const dest = panTo(ctx, out, spread(rnd));
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = 'sine';
  amp.gain.setValueAtTime(0, t);
  osc.connect(amp).connect(dest);
  const peak = 0.07 * (0.6 + 0.4 * level) * (0.6 + 0.4 * rnd());
  const f = osc.frequency;
  const kind = rnd();
  let end = t;
  if (kind < 0.5) { // tweets
    const notes = 2 + Math.floor(rnd() * 4);
    const base = 2800 + rnd() * 1400;
    let at = t;
    for (let i = 0; i < notes; i++) {
      const d = 0.06 + rnd() * 0.06;
      const f0 = base * (0.9 + rnd() * 0.25);
      f.setValueAtTime(f0, at);
      f.exponentialRampToValueAtTime(f0 * (rnd() < 0.6 ? 1.3 : 0.75), at + d);
      amp.gain.setValueAtTime(0, at);
      amp.gain.linearRampToValueAtTime(peak, at + 0.012);
      amp.gain.linearRampToValueAtTime(0, at + d);
      at += d + 0.04 + rnd() * 0.07;
    }
    end = at;
  } else if (kind < 0.8) { // "fee-bee", high then lower
    const hi = 3000 + rnd() * 600;
    const parts = [[hi, 0.28], [hi * 0.82, 0.32]];
    let at = t;
    for (const [f0, d] of parts) {
      f.setValueAtTime(f0 * 1.02, at);
      f.linearRampToValueAtTime(f0 * 0.98, at + d);
      amp.gain.setValueAtTime(0, at);
      amp.gain.linearRampToValueAtTime(peak * 0.8, at + 0.04);
      amp.gain.setValueAtTime(peak * 0.8, at + d - 0.06);
      amp.gain.linearRampToValueAtTime(0, at + d);
      at += d + 0.08;
    }
    end = at;
  } else { // a trill: one note, shaken fast
    const d = 0.35 + rnd() * 0.35;
    const f0 = 3300 + rnd() * 900;
    f.setValueAtTime(f0, t);
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 22 + rnd() * 10;
    depth.gain.value = 260;
    lfo.connect(depth).connect(f);
    amp.gain.linearRampToValueAtTime(peak * 0.7, t + 0.05);
    amp.gain.setValueAtTime(peak * 0.7, t + d - 0.08);
    amp.gain.linearRampToValueAtTime(0, t + d);
    lfo.start(t);
    lfo.stop(t + d + 0.05);
    release(lfo, [lfo, depth]);
    end = t + d;
  }
  osc.start(t);
  osc.stop(end + 0.05);
  release(osc, [osc, amp, dest === out ? null : dest].filter(Boolean));
  return end;
}

/** An owl a long way off: hoo, hoo-hoo, hoo. */
export function owl(ctx, out, t, { rnd = Math.random, level = 1 } = {}) {
  const dest = panTo(ctx, out, spread(rnd, 0.9));
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  lp.connect(dest);
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = 'triangle';
  amp.gain.setValueAtTime(0, t);
  osc.connect(amp).connect(lp);
  const f0 = 300 + rnd() * 70;
  const peak = 0.16 * (0.6 + 0.4 * level);
  const notes = rnd() < 0.5 ? [[0, 0.38], [0.62, 0.16], [0.84, 0.36], [1.42, 0.4]] : [[0, 0.42], [0.7, 0.42]];
  for (const [at, d] of notes) {
    const s = t + at;
    osc.frequency.setValueAtTime(f0 * 1.05, s);
    osc.frequency.linearRampToValueAtTime(f0 * 0.96, s + d);
    amp.gain.setValueAtTime(0, s);
    amp.gain.linearRampToValueAtTime(peak, s + 0.07);
    amp.gain.setTargetAtTime(0, s + d * 0.6, d * 0.18);
  }
  const end = t + notes[notes.length - 1][0] + notes[notes.length - 1][1] + 0.3;
  osc.start(t);
  osc.stop(end);
  release(osc, [osc, amp, lp, dest === out ? null : dest].filter(Boolean));
  return end;
}

/** A sheep's baa (now and then a lamb's, higher). */
export function baa(ctx, out, t, { rnd = Math.random, level = 1 } = {}) {
  const dest = panTo(ctx, out, spread(rnd, 0.7));
  const lamb = rnd() < 0.25;
  const f0 = lamb ? 360 + rnd() * 90 : 190 + rnd() * 90;
  const d = (lamb ? 0.45 : 0.6) + rnd() * 0.35;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f0 * 0.94, t);
  osc.frequency.linearRampToValueAtTime(f0 * 1.06, t + 0.14);
  osc.frequency.linearRampToValueAtTime(f0 * 0.9, t + d);
  // the bleat's wobble: a little in the pitch, more in the loudness
  const vib = ctx.createOscillator();
  const vibDepth = ctx.createGain();
  vib.frequency.value = 5.5 + rnd() * 2;
  vibDepth.gain.value = f0 * 0.025;
  vib.connect(vibDepth).connect(osc.frequency);
  const trem = ctx.createOscillator();
  const tremDepth = ctx.createGain();
  trem.frequency.value = 7 + rnd() * 3;
  tremDepth.gain.value = 0.3;
  const wobble = ctx.createGain();
  wobble.gain.value = 0.7;
  trem.connect(tremDepth).connect(wobble.gain);
  // the mouth: two vowel bands ("aah")
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass'; f1.frequency.value = lamb ? 950 : 760; f1.Q.value = 5;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass'; f2.frequency.value = lamb ? 1600 : 1250; f2.Q.value = 6;
  const f2g = ctx.createGain();
  f2g.gain.value = 0.6;
  const amp = ctx.createGain();
  const peak = 0.5 * (0.6 + 0.4 * level) * (0.7 + 0.3 * rnd());
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.06);
  amp.gain.setValueAtTime(peak, t + d - 0.2);
  amp.gain.linearRampToValueAtTime(0, t + d);
  osc.connect(wobble);
  wobble.connect(f1).connect(amp);
  wobble.connect(f2).connect(f2g).connect(amp);
  amp.connect(dest);
  for (const o of [osc, vib, trem]) { o.start(t); o.stop(t + d + 0.05); }
  release(vib, [vib, vibDepth]);
  release(trem, [trem, tremDepth]);
  release(osc, [osc, wobble, f1, f2, f2g, amp, dest === out ? null : dest].filter(Boolean));
  return t + d;
}

/** The windmill: a slow wooden creak as the sails come round. */
export function creak(ctx, out, t, { rnd = Math.random, level = 1 } = {}) {
  const dest = panTo(ctx, out, 0.25 + spread(rnd, 0.15));
  const d = 0.7 + rnd() * 0.6;
  const osc = ctx.createOscillator(); // the stick-slip: a slow buzz of little clicks
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(16 + rnd() * 6, t);
  osc.frequency.linearRampToValueAtTime(38 + rnd() * 14, t + d * 0.55);
  osc.frequency.linearRampToValueAtTime(22, t + d);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 9;
  bp.frequency.setValueAtTime(560 + rnd() * 120, t);
  bp.frequency.linearRampToValueAtTime(820 + rnd() * 160, t + d);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 280;
  const amp = ctx.createGain();
  const peak = 0.32 * (0.5 + 0.5 * level);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + d * 0.3);
  amp.gain.linearRampToValueAtTime(peak * 0.7, t + d * 0.7);
  amp.gain.linearRampToValueAtTime(0, t + d);
  osc.connect(bp).connect(hp).connect(amp).connect(dest);
  osc.start(t);
  osc.stop(t + d + 0.05);
  release(osc, [osc, bp, hp, amp, dest === out ? null : dest].filter(Boolean));
  return t + d;
}

// a far-off peal: notes of a major pentatonic, soft and high
const PEAL = [784, 880, 988, 1175, 1319, 1568];
const PARTIALS = [[1, 1], [2, 0.32], [2.76, 0.22], [4.07, 0.1]];

/** Bells a long way off (and at Christmas, now and then a little sleigh-bell jingle). */
export function bells(ctx, out, t, { rnd = Math.random, level = 1, noise = null, jingle = false } = {}) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4200;
  const dest = panTo(ctx, out, spread(rnd, 0.6));
  lp.connect(dest);
  const nodes = [lp, dest === out ? null : dest].filter(Boolean);
  const peak = 0.05 * (0.5 + 0.5 * level);
  let end = t;
  if (jingle && noise && rnd() < 0.45) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 6500; bp.Q.value = 4;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    const shakes = 6 + Math.floor(rnd() * 5);
    for (let i = 0; i < shakes; i++) {
      const s = t + i * (0.1 + rnd() * 0.03);
      amp.gain.setValueAtTime(0, s);
      amp.gain.linearRampToValueAtTime(peak * 1.4, s + 0.008);
      amp.gain.setTargetAtTime(0, s + 0.01, 0.035);
    }
    end = t + shakes * 0.13 + 0.3;
    src.connect(bp).connect(amp).connect(lp);
    src.start(t, rnd() * 4);
    src.stop(end);
    release(src, [src, bp, amp, ...nodes]);
    return end;
  }
  const count = 3 + Math.floor(rnd() * 3);
  let note = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < count; i++) {
    const s = t + i * (0.42 + rnd() * 0.08);
    const f0 = PEAL[Math.max(0, Math.min(PEAL.length - 1, note))];
    note += rnd() < 0.7 ? -1 : 1; // mostly falling
    for (const [ratio, g] of PARTIALS) {
      const o = ctx.createOscillator();
      const a = ctx.createGain();
      o.frequency.value = f0 * ratio;
      a.gain.setValueAtTime(0, s);
      a.gain.linearRampToValueAtTime(peak * g, s + 0.005);
      a.gain.exponentialRampToValueAtTime(0.0001, s + 2.4 / ratio ** 0.5);
      o.connect(a).connect(lp);
      o.start(s);
      o.stop(s + 2.5);
      release(o, [o, a]);
    }
    end = s + 2.5;
  }
  setTimeout(() => { for (const n of nodes) { try { n.disconnect(); } catch { /* gone */ } } }, Math.max(0, (end - ctx.currentTime) * 1000 + 500));
  return end;
}
