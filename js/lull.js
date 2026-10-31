// Lifted from Lull v2 (Onyxuz666/Lull-v2, engine.js and store.js), kept as close to the
// original as possible so fixes can travel between the two apps. Changes are marked.

// Pulse timbres: [frequency multiple, relative amplitude, decay multiple]
export const TONES = {
  soft: { attack: 0.025, partials: [[1, 1, 1], [2, 0.12, 0.45]] },
  glass: { attack: 0.012, partials: [[1, 1, 1], [2, 0.3, 0.8], [3, 0.12, 0.6]] },
  bell: { attack: 0.004, partials: [[1, 1, 1], [2.756, 0.32, 0.45], [5.404, 0.12, 0.22], [0.5, 0.15, 1.2]] },
};

// Harmony sets. `field` = drone partials (ratios of the key).
export const CHORDS = {
  overtone: { name: 'Overtone', field: [1, 2, 3, 4, 5, 6, 7] },
  fifths: { name: 'Open fifths', field: [1, 1.5, 2, 3, 4, 6] },
  minor: { name: 'Minor', field: [1, 1.5, 2, 2.4, 3, 3.6] },
  penta: { name: 'Pentatonic', field: [1, 1.5, 2, 2.25, 3, 10 / 3] },
};

export const PANS = { 1: [0], 2: [-0.7, 0.7], 3: [-0.8, 0, 0.8], 4: [-0.9, -0.3, 0.3, 0.9] };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Swell rate of each drone partial, in cycles per rhythm cycle.
// Changed: takes the ratio array directly rather than a key into Lull's RHYTHMS table.
export function fieldRates(r, n) {
  const out = [1];
  for (let j = 1; j < n; j++) {
    const base = r[(j - 1) % r.length];
    out.push(j - 1 >= r.length ? base / 2 : base);
  }
  return out;
}

export function droneAmps(chord) {
  const f = (CHORDS[chord] || CHORDS.overtone).field;
  const a = f.map((_, j) => 1 / (1 + 0.55 * j));
  const s = a.reduce((x, y) => x + y, 0);
  return a.map((x) => x / s);
}

function noiseChannel(color, n, rand) {
  const out = new Float32Array(n);
  if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = rand() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  } else if (color === 'white') {
    // Added: the drum voices want flat noise.
    for (let i = 0; i < n; i++) out[i] = rand() * 2 - 1;
  } else {
    let b = 0;
    for (let i = 0; i < n; i++) {
      const w = rand() * 2 - 1;
      b = (b + 0.02 * w) / 1.02;
      out[i] = b;
    }
  }
  let ss = 0;
  for (let i = 0; i < n; i++) ss += out[i] * out[i];
  const g = 0.12 / Math.sqrt(ss / n || 1);
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

export function makeNoiseData(color, sr, seconds = 12, seed = 7) {
  const L = Math.round(sr * seconds);
  const F = Math.round(sr * 1);
  const rand = mulberry32(seed);
  const chans = [];
  for (let ch = 0; ch < 2; ch++) {
    const raw = noiseChannel(color, L + F, rand);
    const out = new Float32Array(L);
    for (let i = 0; i < L; i++) {
      if (i < F) {
        const x = i / F;
        out[i] = raw[i] * Math.sqrt(x) + raw[L + i] * Math.sqrt(1 - x);
      } else out[i] = raw[i];
    }
    chans.push(out);
  }
  return chans;
}

export function makeIRData(sr, seconds, seed = 3) {
  const pre = Math.round(sr * 0.02);
  const L = Math.round(sr * seconds);
  const rand = mulberry32(seed);
  const chans = [];
  for (let ch = 0; ch < 2; ch++) {
    const d = new Float32Array(pre + L);
    let lp = 0;
    const fadeIn = Math.round(sr * 0.004);
    for (let i = 0; i < L; i++) {
      const t = i / sr;
      const env = Math.exp((-6.9 * t) / seconds);
      const coeff = 0.08 + 0.85 * Math.min(1, t / seconds); // tail gets darker
      const w = rand() * 2 - 1;
      lp += (w - lp) * (1 - coeff);
      const fi = i < fadeIn ? i / fadeIn : 1;
      d[pre + i] = lp * env * fi;
    }
    chans.push(d);
  }
  return chans;
}

export function warmthHz(w) {
  // 0..1 → 900 Hz .. 20 kHz (log)
  return 900 * Math.pow(20000 / 900, w);
}

// Trim silence at both ends, remove DC, normalize, and add short fades.
// Changed: `sr` has no default, since this app records at the context rate.
export function cleanUp(pcm, sr) {
  let mean = 0;
  for (let i = 0; i < pcm.length; i++) mean += pcm[i];
  mean /= pcm.length || 1;
  const x = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) x[i] = pcm[i] - mean;

  const win = Math.round(sr * 0.02);
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak < 1e-4) return null;
  // threshold relative to the loudest part: -36 dB below peak window RMS
  const rms = [];
  for (let i = 0; i < x.length; i += win) {
    let s = 0;
    const e = Math.min(x.length, i + win);
    for (let j = i; j < e; j++) s += x[j] * x[j];
    rms.push(Math.sqrt(s / (e - i)));
  }
  const maxR = Math.max(...rms);
  const thr = maxR * 0.0158;
  let a = rms.findIndex((r) => r > thr);
  let b = rms.length - 1 - [...rms].reverse().findIndex((r) => r > thr);
  if (a < 0) return null;
  const margin = Math.round((0.12 * sr) / win);
  a = Math.max(0, a - margin);
  b = Math.min(rms.length - 1, b + margin);
  const start = a * win;
  const end = Math.min(x.length, (b + 1) * win);
  const y = x.slice(start, end);

  let pk = 0;
  for (let i = 0; i < y.length; i++) pk = Math.max(pk, Math.abs(y[i]));
  const g = 0.89 / (pk || 1);
  const fade = Math.round(sr * 0.015);
  for (let i = 0; i < y.length; i++) {
    let f = 1;
    if (i < fade) f = i / fade;
    else if (i > y.length - fade) f = (y.length - i) / fade;
    y[i] *= g * f;
  }
  return y;
}
