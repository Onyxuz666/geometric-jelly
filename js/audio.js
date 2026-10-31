// Layer 2 of 4: audio engine. Knows how to make a sound at time t; knows nothing about patterns.
//
//   excitation  ->  resonator bank  ->  per-layer FX lane  ->  bus FX  ->  out
//
// Every strike is a short excitation (a synthesised drum, a character burst, or a recorded sample)
// plus a bank of band-pass resonators tuned to the struck pitch class and the character's partials.
// One Body control moves the voice from dry kit (resonator barely present) to struck bell.

import { TONES, CHORDS, PANS, mulberry32, makeIRData, makeNoiseData, warmthHz, fieldRates, droneAmps } from './lull.js';

// Resonator partials: [frequency multiple, relative amplitude, decay multiple]. Glass, bell and the
// mallet's first two partials are Lull's TONES tables. Skin uses the circular-membrane mode ratios,
// stick the free-bar ratios that Lull's bell already contains.
export const CHAR = {
  skin: [[1, 1, 1], [1.594, 0.5, 0.7], [2.136, 0.35, 0.55], [2.296, 0.25, 0.5], [2.653, 0.15, 0.4]],
  stick: [[1, 1, 1], [2.756, 0.4, 0.35], [5.404, 0.15, 0.18]],
  glass: TONES.glass.partials,
  bell: TONES.bell.partials,
  mallet: [...TONES.soft.partials, [3.99, 0.22, 0.3]],
};

export const ECHO_DIVS = [
  [0.25, '1/16'], [1 / 3, '1/8T'], [0.5, '1/8'], [0.75, '3/16'], [1, '1/4'], [1.5, '3/8'],
];

const IS_TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
export const MAX_VOICES = IS_TOUCH ? 20 : 48;
const MAX_PARTIALS = IS_TOUCH ? 3 : 5;
const RING_TARGET = 0.32; // resonator amplitude for a full-velocity strike at Body 1

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Bit and sample-rate reduction. Bypassed (a plain copy) at 16 bits and no downsampling.
const CRUSH_SRC = `
class Crush extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'bits', defaultValue: 16, minValue: 1, maxValue: 16 },
            { name: 'down', defaultValue: 1, minValue: 1, maxValue: 64 }];
  }
  constructor() { super(); this.h = [0, 0]; this.c = 0; }
  process(ins, outs, p) {
    const i = ins[0], o = outs[0];
    if (!i || !i.length) return true;
    const bits = p.bits[0], down = Math.round(p.down[0]);
    if (bits >= 16 && down <= 1) { for (let ch = 0; ch < o.length; ch++) o[ch].set(i[ch] || i[0]); return true; }
    const q = Math.pow(2, bits - 1);
    for (let n = 0; n < o[0].length; n++) {
      if (++this.c >= down) {
        this.c = 0;
        for (let ch = 0; ch < o.length; ch++) {
          const x = (i[ch] || i[0])[n];
          this.h[ch] = bits >= 16 ? x : Math.round(x * q) / q;
        }
      }
      for (let ch = 0; ch < o.length; ch++) o[ch][n] = this.h[ch];
    }
    return true;
  }
}
registerProcessor('gj-crush', Crush);
`;

function makeBursts(sr) {
  const rand = mulberry32(11);
  const mk = (ms, fn) => {
    const n = Math.max(3, Math.round((sr * ms) / 1000));
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = fn(i / sr, i, n);
    return d;
  };
  const lp = (d, k) => {
    let y = 0;
    for (let i = 0; i < d.length; i++) d[i] = y += (d[i] - y) * k;
    return d;
  };
  const noise = (tau) => (t) => (rand() * 2 - 1) * Math.exp(-t / tau);
  return {
    skin: lp(mk(7, noise(0.0014)), 0.45),
    stick: mk(2.5, noise(0.0004)),
    glass: mk(0.8, noise(0.00012)),
    bell: lp(mk(1.6, noise(0.0003)), 0.7),
    mallet: mk(4, (t, i, n) => Math.sin((Math.PI * i) / n)),
  };
}

// |X(w)| of the first N samples, by a rotating phasor (no trig in the loop).
function dtftMag(x, w, N) {
  const c = Math.cos(w), s = Math.sin(w);
  let pr = 1, pi = 0, re = 0, im = 0;
  for (let n = 0; n < N; n++) {
    re += x[n] * pr;
    im -= x[n] * pi;
    const t = pr * c - pi * s;
    pi = pr * s + pi * c;
    pr = t;
  }
  return Math.hypot(re, im);
}

export class Engine {
  constructor(S) {
    this.S = S;
    this.ctx = null;
    this.voices = [];
    this.lanes = [];
    this.samples = []; // per layer: {buf, head, rms} or null
  }

  // Must be called from a user gesture. Resolves once the graph is built.
  async init(S) {
    if (this.ctx) return;
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) {
      /* not supported */
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    ctx.resume();
    const sr = ctx.sampleRate;
    this.bursts = makeBursts(sr);
    this.burstBufs = {};
    for (const [k, d] of Object.entries(this.bursts)) {
      this.burstBufs[k] = ctx.createBuffer(1, d.length, sr);
      this.burstBufs[k].getChannelData(0).set(d);
    }
    const nd = makeNoiseData('white', sr, 2, 5);
    this.noise = ctx.createBuffer(1, nd[0].length, sr);
    this.noise.getChannelData(0).set(nd[0]);

    let worklet = false;
    try {
      const url = URL.createObjectURL(new Blob([CRUSH_SRC], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      worklet = true;
    } catch (e) {
      /* no AudioWorklet: crush is bypassed */
    }

    const G = (v = 1) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    this.G = G;

    // ---- bus ----
    this.master = G(0);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.verbIn = G(1);
    this.verb = ctx.createConvolver();
    this.verbOut = G(0);
    this.verbIn.connect(this.verb);
    this.verb.connect(this.verbOut);
    this.verbOut.connect(this.master);
    this._irSize = 0;

    // Ping-pong echo with darkening feedback, as in Lull's voice layer, tempo-synced here.
    const e = (this.echo = { in: G(1), dl: ctx.createDelay(3), dr: ctx.createDelay(3), lp: ctx.createBiquadFilter(), fb: G(0), merge: ctx.createChannelMerger(2), out: G(0.85) });
    e.lp.type = 'lowpass';
    e.lp.frequency.value = 2800;
    e.in.connect(e.dl);
    e.dl.connect(e.lp);
    e.lp.connect(e.merge, 0, 0);
    e.lp.connect(e.dr);
    e.dr.connect(e.merge, 0, 1);
    e.dr.connect(e.fb);
    e.fb.connect(e.dl);
    e.merge.connect(e.out);
    e.out.connect(this.master);
    e.out.connect(this.verbIn);

    // Just-intonation drone bed: partials of the key, each swelling at a rate from the polyrhythm.
    this.drone = { out: G(0), lp: ctx.createBiquadFilter(), parts: [] };
    this.drone.lp.type = 'lowpass';
    this.drone.lp.frequency.value = 1600;
    this.drone.out.connect(this.drone.lp);
    this.drone.lp.connect(this.master);
    this.drone.lp.connect(this.verbIn);

    // ---- lanes: one FX chain per layer ----
    this.lanes = S.layers.map(() => {
      const ln = { pans: [], in: G(1), lp: ctx.createBiquadFilter(), level: G(0), echo: G(0), verb: G(0), sweep: G(0), lfo: null };
      ln.crush = worklet ? new AudioWorkletNode(ctx, 'gj-crush', { outputChannelCount: [2] }) : G(1);
      ln.lp.type = 'lowpass';
      ln.lp.Q.value = 0.9;
      for (let k = 0; k < 4; k++) {
        const p = ctx.createStereoPanner();
        p.connect(ln.in);
        ln.pans.push(p);
      }
      ln.in.connect(ln.crush);
      ln.crush.connect(ln.lp);
      ln.lp.connect(ln.level);
      ln.sweep.connect(ln.lp.detune);
      ln.level.connect(this.master);
      ln.level.connect(ln.echo);
      ln.level.connect(ln.verb);
      ln.echo.connect(this.echo.in);
      ln.verb.connect(this.verbIn);
      return ln;
    });
    this.samples = S.layers.map(() => null);
    this.S = S;
    this.applyBus(S, true);
    S.layers.forEach((_, i) => this.applyLayer(i, true));
  }

  smooth(param, v, tc = 0.04) {
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(v, now, tc);
  }

  audible(li) {
    const L = this.S.layers;
    const solo = L.some((x) => x.solo);
    return !L[li].mute && (!solo || L[li].solo);
  }

  applyLayer(li, initial) {
    if (!this.ctx) return;
    const L = this.S.layers[li], ln = this.lanes[li];
    const tc = initial ? 0.005 : 0.04;
    this.smooth(ln.level.gain, this.audible(li) ? L.level * L.level * 1.1 : 0, tc);
    this.smooth(ln.echo.gain, L.echo, tc);
    this.smooth(ln.verb.gain, L.verb * 1.4, tc);
    this.smooth(ln.lp.frequency, warmthHz(L.bright), tc);
    this.smooth(ln.sweep.gain, L.sweep * 2400, tc);
    const spread = PANS[L.copies] || [0];
    ln.pans.forEach((p, k) => this.smooth(p.pan, clamp(L.pan + (spread[k] || 0) * 0.6, -1, 1), tc));
    if (ln.crush.parameters) {
      this.smooth(ln.crush.parameters.get('bits'), L.bits, 0.01);
      ln.crush.parameters.get('down').setValueAtTime(L.down, this.ctx.currentTime);
    }
    if (ln.lfo) this.smooth(ln.lfo.frequency, this.lfoHz(L), 0.01);
  }

  // Every layer change that could alter the drone rhythm calls this too.
  applyBus(S, initial) {
    if (!this.ctx) return;
    const tc = initial ? 0.005 : 0.05;
    this.smooth(this.master.gain, S.master * S.master, tc);
    this.smooth(this.verbOut.gain, S.verbLevel, tc);
    this.smooth(this.echo.fb.gain, S.echoFb, tc);
    const d = clamp((60 / S.bpm) * S.echoDiv, 0.02, 2.9);
    this.smooth(this.echo.dl.delayTime, d, 0.08);
    this.smooth(this.echo.dr.delayTime, d, 0.08);
    if (Math.abs(this._irSize - S.verbSize) > 0.05) {
      this._irSize = S.verbSize;
      const ch = makeIRData(this.ctx.sampleRate, S.verbSize);
      const b = this.ctx.createBuffer(2, ch[0].length, this.ctx.sampleRate);
      b.getChannelData(0).set(ch[0]);
      b.getChannelData(1).set(ch[1]);
      this.verb.buffer = b;
    }
    this.applyDrone(S);
  }

  lfoHz(L) {
    return 1 / (L.sweepRate * (240 / this.S.bpm));
  }

  // Tempo-synced LFOs restart with the transport so a sweep's phase lines up with bar 1.
  startLFOs(t0) {
    this.lanes.forEach((ln, li) => {
      if (ln.lfo) ln.lfo.stop();
      const o = this.ctx.createOscillator();
      o.frequency.value = this.lfoHz(this.S.layers[li]);
      o.connect(ln.sweep);
      o.start(t0);
      ln.lfo = o;
    });
  }

  stopLFOs(t) {
    this.lanes.forEach((ln) => {
      if (ln.lfo) ln.lfo.stop(t);
      ln.lfo = null;
    });
  }

  // ---------- drone ----------

  droneRhythm(S) {
    // Pulses per realignment period, reduced; if every layer pulses alike, cycles per period instead.
    // Anything with a term above 9 is too busy to breathe with, so it falls back to Lull's 3:4:5.
    const act = S.layers.filter((L, i) => this.audible(i) && L.vel.slice(0, L.len).some((v) => v > 0));
    if (!act.length) return { r: [3, 4, 5], bars: 4 };
    let P = act.reduce((m, L) => lcmInt(m, L.span), 1);
    const reduce = (xs) => {
      const g = xs.reduce((a, b) => gcdInt(a, b));
      return [...new Set(xs.map((x) => x / g))].sort((a, b) => a - b);
    };
    let r = reduce(act.map((L) => (L.len * P) / L.span));
    if (r.length < 2) r = reduce(act.map((L) => P / L.span));
    if (r.length < 2 || r[r.length - 1] > 9) r = [3, 4, 5];
    let bars = P / 16;
    while (bars < 4) bars *= 2;
    return { r, bars: Math.min(bars, 16) };
  }

  applyDrone(S) {
    if (!this.ctx) return;
    const ctx = this.ctx, D = this.drone;
    const field = (CHORDS[S.droneChord] || CHORDS.overtone).field;
    const amps = droneAmps(S.droneChord);
    const { r, bars } = this.droneRhythm(S);
    const rates = fieldRates(r, field.length);
    const cycle = bars * (240 / S.bpm);
    const root = 65.406 * Math.pow(2, S.key / 12);
    this.smooth(D.out.gain, S.drone * S.drone * 0.5, 0.3);
    if (S.drone <= 0 && !D.parts.length) return;
    while (D.parts.length < field.length) {
      const o = ctx.createOscillator(), g = this.G(0), l = ctx.createOscillator(), lg = this.G(0);
      l.connect(lg);
      lg.connect(g.gain);
      o.connect(g);
      g.connect(D.out);
      o.start();
      l.start();
      D.parts.push({ o, g, l, lg });
    }
    D.parts.forEach((p, j) => {
      const on = j < field.length;
      this.smooth(p.o.frequency, root * (field[j] || 1), 0.2);
      this.smooth(p.g.gain, on ? amps[j] * 0.6 : 0, 0.3);
      this.smooth(p.lg.gain, on ? amps[j] * 0.4 : 0, 0.3);
      this.smooth(p.l.frequency, rates[j] / cycle, 0.2);
    });
  }

  // ---------- samples ----------

  setSample(li, pcm, sr) {
    if (!pcm) {
      this.samples[li] = null;
      return;
    }
    const b = this.ctx.createBuffer(1, pcm.length, sr);
    b.getChannelData(0).set(pcm);
    const head = pcm.subarray(0, Math.min(pcm.length, 2048));
    this.samples[li] = { buf: b, head };
  }

  // ---------- strikes ----------

  reap(now) {
    this.voices = this.voices.filter((v) => v.end > now);
  }

  release(v, at) {
    const g = v.out.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(0, at, 0.008);
    v.end = Math.min(v.end, at + 0.08);
  }

  // `pcs` is one pitch class per loop of the layer's orbit (several for a link).
  strike(li, k, t, vel, pcs) {
    const ctx = this.ctx;
    if (!ctx || vel <= 0.001) return;
    const L = this.S.layers[li];
    const now = ctx.currentTime;
    this.reap(now);
    if (L.choke) for (const v of this.voices) if (v.choke === L.choke && v.start <= t + 1e-4) this.release(v, Math.max(now, t));
    while (this.voices.length >= MAX_VOICES) this.release(this.voices.shift(), Math.max(now, t));

    const tape = Math.pow(2, L.tape / 12);
    const decMul = Math.pow(2, 1.6 * L.sustain);
    const B = L.body;
    const out = this.G(1);
    out.connect(this.lanes[li].pans[k] || this.lanes[li].pans[0]);

    // Transient shaping on the whole strike: attack > 0 punches the first few ms, < 0 softens them.
    const a = L.attack;
    if (a > 0) {
      out.gain.setValueAtTime(1 + 2.2 * a, t);
      out.gain.setTargetAtTime(1, t + 0.004, 0.018);
    } else if (a < 0) {
      out.gain.setValueAtTime(Math.max(0.05, 1 + a * 0.95), t);
      out.gain.linearRampToValueAtTime(1, t + 0.012 - a * 0.05);
    }

    let dur = 0.1;
    const smp = this.samples[li];
    const dryLvl = vel * Math.pow(1 - B, 1.3);
    if (dryLvl > 0.003) {
      if (smp) {
        const s = ctx.createBufferSource(), g = this.G(dryLvl * 0.9);
        s.buffer = smp.buf;
        s.playbackRate.value = tape;
        s.connect(g);
        g.connect(out);
        s.start(t);
        dur = Math.max(dur, smp.buf.duration / tape);
      } else dur = Math.max(dur, this.kit(L.kit === 'none' ? L.char : L.kit, t, dryLvl, tape, decMul, out));
    }

    // Resonator bank, one set per loop of the orbit.
    if (B > 0.015) {
      const exc = smp ? smp.head : this.bursts[L.char] || this.bursts.skin;
      const T60 = (0.06 + 3.4 * B * B) * (0.35 + 1.3 * L.ring) * decMul;
      const fb = L.fb;
      const loopGain = 1 / Math.sqrt(pcs.length);
      for (const pc of pcs) {
        const f0 = midiHz(12 * (L.reg + 1) + pc) * tape;
        dur = Math.max(dur, this.resonate(t, exc, smp, L.char, f0, T60, fb, vel * Math.pow(B, 0.8) * loopGain, out));
      }
    }

    dur = Math.min(dur, 9);
    const v = { out, start: t, end: t + dur, choke: L.choke };
    this.voices.push(v);
    setTimeout(() => {
      try {
        out.disconnect();
      } catch (e) {
        /* already gone */
      }
    }, (t + dur - now + 0.3) * 1000);
  }

  resonate(t, exc, smp, char, f0, T60, fb, amp, out) {
    const ctx = this.ctx, sr = ctx.sampleRate;
    const src = ctx.createBufferSource();
    src.buffer = smp ? smp.buf : this.burstBufs[char] || this.burstBufs.skin;
    const bus = this.G(1);
    src.connect(bus);
    src.start(t);
    const N = exc.length;
    let rms = 0;
    for (let n = 0; n < N; n++) rms += exc[n] * exc[n];
    rms = Math.sqrt(rms);
    // Normalise to the excitation's strength at the fundamental, so loudness doesn't swing with pitch;
    // other partials then follow the excitation's own spectrum (a mallet is dark, glass is bright).
    const xref = Math.max(dtftMag(exc, (2 * Math.PI * f0) / sr, N), 0.5 * rms, 1e-6);
    const raw = fb > 0.01 ? this.G(1) : null;
    let longest = 0;
    const parts = CHAR[char] || CHAR.skin;
    for (let j = 0; j < Math.min(parts.length, MAX_PARTIALS); j++) {
      const [ratio, pa, pd] = parts[j];
      const f = f0 * ratio;
      if (f > sr * 0.45 || f < 20) continue;
      const w = (2 * Math.PI * f) / sr;
      const tl = T60 * pd * (f > 3000 ? 3000 / f : 1);
      const Q = clamp((Math.PI * f * tl) / 6.9, 0.7, 1500);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = Q;
      // The fundamental always speaks: a soft mallet has little energy high up, but it still sounds a note.
      const xk = Math.max(dtftMag(exc, w, N), 0.02 * rms, 1e-6);
      const spec = Math.min(2, Math.max(j === 0 ? 0.4 : 0, xk / xref));
      // A constant-peak band-pass rings at about sin(w)/Q times the excitation's |X(w)|, so dividing
      // by that leaves a ring of RING_TARGET · amp · partial amplitude · spec.
      const g = this.G((RING_TARGET * amp * pa * spec * Q) / (Math.sin(w) * xk));
      bus.connect(bp);
      bp.connect(g);
      g.connect(out);
      if (raw) bp.connect(raw);
      longest = Math.max(longest, tl);
    }
    // Resonator feedback: the unity-gain band-pass outputs go round a comb tuned to the fundamental,
    // so the shell rings into itself. Loop gain stays below 1, and tanh catches anything that doesn't.
    if (raw) {
      const d = ctx.createDelay(0.1);
      d.delayTime.value = Math.ceil(0.0032 * f0) / f0;
      const sh = ctx.createWaveShaper();
      sh.curve = TANH;
      const g = this.G(fb * 0.93);
      raw.connect(d);
      d.connect(sh);
      sh.connect(g);
      g.connect(bus);
      longest *= 1 + 3 * fb * fb;
    }
    return Math.max(0.1, longest * 1.1 + (smp ? smp.buf.duration : 0.02));
  }

  // The dry kit: synthesised at play time, scaled by tape speed (pitch and time) and decay.
  kit(kind, t, v, tr, dm, out) {
    const ctx = this.ctx;
    const env = (g, peak, att, dec) => {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), t + att);
      g.gain.exponentialRampToValueAtTime(0.0001, t + att + dec);
    };
    const osc = (type, f, peak, att, dec, f2, glide) => {
      const o = ctx.createOscillator(), g = this.G(0);
      o.type = type;
      o.frequency.setValueAtTime(f * tr, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2 * tr, t + glide / tr);
      env(g, peak, att, dec);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + att + dec + 0.02);
      return att + dec;
    };
    const noise = (type, f, q, peak, att, dec) => {
      const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = this.G(0);
      s.buffer = this.noise;
      s.loop = true;
      fl.type = type;
      fl.frequency.value = Math.min(f * tr, 18000);
      if (q) fl.Q.value = q;
      env(g, peak, att, dec);
      s.connect(fl);
      fl.connect(g);
      g.connect(out);
      s.start(t, Math.random() * 1.5);
      s.stop(t + att + dec + 0.02);
      return att + dec;
    };
    const d = dm / tr;
    switch (kind) {
      case 'kick':
        osc('triangle', 900, 0.2 * v, 0.001, 0.016);
        return osc('sine', 148, 0.95 * v, 0.003, 0.42 * d, 47, 0.085);
      case 'snare':
        osc('triangle', 186, 0.26 * v, 0.002, 0.085 * d);
        osc('triangle', 331, 0.16 * v, 0.002, 0.085 * d);
        return noise('bandpass', 1750, 0.8, 0.55 * v, 0.002, 0.17 * d);
      case 'hat':
        return noise('highpass', 7200, 0, 0.34 * v, 0.001, (0.034 + (1 - v) * 0.012) * d);
      case 'perc':
        noise('bandpass', 2600, 1.4, 0.16 * v, 0.001, 0.028 * d);
        return osc('triangle', 430, 0.42 * v, 0.002, 0.14 * d, 306, 0.05);
      default: {
        // A layer with no drum voice hears its own character burst, a click under the resonator.
        const s = ctx.createBufferSource(), g = this.G(v * 0.6);
        s.buffer = this.burstBufs[kind] || this.burstBufs.stick;
        s.playbackRate.value = tr;
        s.connect(g);
        g.connect(out);
        s.start(t);
        return 0.05;
      }
    }
  }
}

const TANH = (() => {
  const c = new Float32Array(1024);
  for (let i = 0; i < c.length; i++) c[i] = Math.tanh((i / (c.length - 1)) * 2 - 1); // unity slope at 0, so loop gain is unchanged
  return c;
})();

function gcdInt(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}
function lcmInt(a, b) {
  return (a / gcdInt(a, b)) * b;
}
