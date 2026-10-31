// Layer 1 of 4: sequencer state. Plain data, no audio and no drawing.
//
// A layer's `vel[i] === 0` means step i is off; any positive value is both "on" and its velocity.
// `span` is the layer's cycle length in sixteenths of the master clock, so `len` steps over `span`
// sixteenths: len = span is a polymeter layer on the 16th grid, len 3 over span 16 is a triplet
// against the bar.

import { knotRhythm } from './tonnetz.js';

export const MAX_STEPS = 32;
export const CHARACTERS = ['skin', 'stick', 'glass', 'bell', 'mallet'];

const DEFS = [
  { name: 'Kick', kit: 'kick', char: 'skin', body: 0.04, reg: 2, p: 1, q: 0, root: 0, pan: 0, verb: 0.05 },
  { name: 'Snare', kit: 'snare', char: 'skin', body: 0.08, reg: 3, p: 1, q: 1, root: 7, pan: 0.05, verb: 0.18 },
  { name: 'Hat', kit: 'hat', char: 'glass', body: 0.03, reg: 6, p: 2, q: 1, root: 2, pan: -0.25, verb: 0.08 },
  { name: 'Perc', kit: 'perc', char: 'stick', body: 0.3, reg: 4, p: 3, q: 2, root: 9, pan: 0.3, verb: 0.2 },
  { name: 'Bell', kit: 'none', char: 'bell', body: 0.85, reg: 5, p: 3, q: 2, root: 0, pan: -0.15, verb: 0.35 },
];

export const zeros = () => new Array(MAX_STEPS).fill(0);
const ones = () => new Array(MAX_STEPS).fill(1);

export function newLayer(d) {
  return {
    name: d.name, kit: d.kit,
    len: 16, span: 16,
    vel: zeros(), prob: ones(), flam: zeros(), rat: ones(), da: zeros(), db: zeros(),
    mode: 'knot', p: d.p, q: d.q, root: d.root, reg: d.reg,
    face: { root: d.root, minor: false }, walk: '',
    drift: 0, vary: 0, seed: 1,
    char: d.char, body: d.body, ring: 0.5, fb: 0, attack: 0, sustain: 0,
    tape: 0, bright: 0.85, sweep: 0, sweepRate: 1, bits: 16, down: 1, choke: 0,
    level: 0.8, pan: d.pan, echo: 0, verb: d.verb, copies: 1, phase: 0.5,
    mute: false, solo: false, sample: null,
  };
}

export function newState() {
  return {
    v: 2,
    bpm: 112, swing: 0.5, humanize: 0, master: 0.8,
    verbSize: 2.6, verbLevel: 0.8, echoDiv: 0.75, echoFb: 0.38,
    drone: 0, droneChord: 'overtone', key: 0,
    flatten: 0, sel: 0, preset: 'Four on the floor',
    layers: DEFS.map(newLayer),
  };
}

// ---------- presets ----------
// Pattern letters: X accent 1.0, x 0.8, o 0.55, g ghost 0.3, . off.

const LETTER = { X: 1, x: 0.8, o: 0.55, g: 0.3, '.': 0 };
const KEYS = ['kick', 'snare', 'hat', 'perc', 'bell'];

// Each entry: global settings plus per-layer overrides. Layers not named are cleared.
export const PRESETS = {
  'Four on the floor': { bpm: 124, kick: 'X...X...X...X...', snare: '....x.......x...', hat: '..x...x...x...x.', perc: 'g.g.g.gg.g.g.g.g' },
  'Son clave 3-2': { bpm: 100, perc: { pat: 'X..X..X...X.X...', char: 'stick', body: 0.45, reg: 5 }, kick: 'x.......x.....o.', hat: 'o.g.o.g.o.g.o.g.' },
  'Son clave 2-3': { bpm: 100, perc: { pat: '..X.X...X..X..X.', char: 'stick', body: 0.45, reg: 5 }, kick: 'x.......x.....o.', hat: 'o.g.o.g.o.g.o.g.' },
  'Rumba clave 3-2': { bpm: 108, perc: { pat: 'X..X...X..X.X...', char: 'stick', body: 0.45, reg: 5 }, kick: 'x.....o.x.....o.', hat: 'o.g.o.g.o.g.o.g.' },
  'Rumba clave 2-3': { bpm: 108, perc: { pat: '..X.X...X..X...X', char: 'stick', body: 0.45, reg: 5 }, kick: 'x.....o.x.....o.', hat: 'o.g.o.g.o.g.o.g.' },
  'Bossa nova': { bpm: 132, kick: 'x..xx..xx..xx..x', snare: { pat: 'X..X..X...X..X..', char: 'stick', body: 0.25 }, hat: 'o.g.o.g.o.g.o.g.' },
  Songo: { bpm: 104, kick: '...x......x..x..', snare: 'g.g.X.gg.gg.X.g.', hat: 'X.xX.x.xX.xX.x.x', perc: { pat: '..X.X...X..X..X.', char: 'stick', body: 0.45, reg: 5 } },
  'Jazz swing ride': {
    bpm: 150,
    bell: { pat: 'X..x.xX..x.x', len: 12, char: 'glass', body: 0.4, reg: 6, ring: 0.7 },
    hat: { pat: '...x.....x..', len: 12 }, kick: { pat: 'g..g..g..g..', len: 12 }, snare: { pat: '.....g....g.', len: 12 },
  },
  Shuffle: { bpm: 96, hat: { pat: 'x.ox.ox.ox.o', len: 12 }, snare: { pat: '...X.....X..', len: 12 }, kick: { pat: 'X.....X.x...', len: 12 } },
  'Half-time shuffle': {
    bpm: 80, hat: { pat: 'xgxxgxxgxxgx', len: 12 }, snare: { pat: '.g..g.X...g.', len: 12 }, kick: { pat: 'X....x....x.', len: 12 },
  },
  'Afro 6/8 bell': {
    bpm: 96,
    bell: { pat: 'X.x.xx.x.x.x', len: 12, char: 'bell', body: 0.55, reg: 5 },
    kick: { pat: 'X..x..X..x..', len: 12 }, hat: { pat: 'oggoggoggogg', len: 12 }, perc: { pat: '.....x....x.', len: 12, body: 0.5 },
  },
  Tresillo: { bpm: 100, kick: 'X..x..x.X..x..x.', snare: '....x.......x...', hat: 'o.g.o.g.o.g.o.g.', perc: { pat: 'X..X..X.........', char: 'stick', body: 0.4 } },
  'Polyrhythm 3:2': { bpm: 90, kick: { pat: 'Xx', len: 2 }, perc: { pat: 'Xxx', len: 3, body: 0.5 } },
  'Polyrhythm 3:4': { bpm: 90, kick: { pat: 'Xxxx', len: 4 }, perc: { pat: 'Xxx', len: 3, body: 0.5 } },
  'Polyrhythm 5:4': { bpm: 80, kick: { pat: 'Xxxx', len: 4 }, bell: { pat: 'Xxxxx', len: 5, body: 0.7 } },
  'Polyrhythm 7:8': { bpm: 72, hat: { pat: 'Xxxxxxxx', len: 8 }, bell: { pat: 'Xxxxxxx', len: 7, body: 0.7 } },
  'Polymeter 16 / 7 / 5': {
    bpm: 112, kick: 'X...x...X...x...', hat: { pat: 'Xox.oxo', len: 7, span: 7 }, perc: { pat: 'X.xo.', len: 5, span: 5, body: 0.5 },
  },
  'Phase study': { bpm: 160, bell: { pat: 'XXX.XX.X.XX.', len: 12, span: 12, char: 'stick', body: 0.55, reg: 5, copies: 2, phase: 0.8 } },
  'Trefoil (3,2) knot': { bpm: 100, kick: 'X.......X.......', bell: { knot: true, p: 3, q: 2, len: 12, body: 0.9, verb: 0.45 } },
  'PLR walk': {
    bpm: 92, kick: 'X.......X.......',
    bell: { pat: 'XxoXxoXxoXxoXxoX', mode: 'face', face: { root: 0, minor: false }, walk: 'LR', body: 0.9, char: 'mallet', verb: 0.4 },
  },
};

export function applyPreset(S, name) {
  const P = PRESETS[name];
  if (!P) return;
  const fresh = newState();
  S.bpm = P.bpm || 112;
  S.swing = P.swing || 0.5;
  S.preset = name;
  S.layers.forEach((L, li) => {
    // Pattern data resets; mix and voice settings the player tuned are left alone, except where the
    // preset sets them.
    const base = fresh.layers[li];
    for (const k of ['len', 'span', 'vel', 'prob', 'flam', 'rat', 'da', 'db', 'mode', 'p', 'q', 'root', 'face', 'walk', 'drift', 'vary', 'copies', 'phase', 'char', 'body', 'reg', 'ring'])
      L[k] = structuredClone(base[k]);
    L.mute = false;
    L.solo = false;
    let o = P[KEYS[li]];
    if (!o) return;
    if (typeof o === 'string') o = { pat: o };
    for (const [k, v] of Object.entries(o)) if (!['pat', 'knot'].includes(k)) L[k] = structuredClone(v);
    if (o.pat) {
      L.len = o.len || o.pat.length;
      [...o.pat].forEach((ch, i) => (L.vel[i] = LETTER[ch] ?? 0));
    }
    if (o.knot) knotRhythm(L.p, L.q, L.len).forEach((v, i) => (L.vel[i] = v));
    // Bar-length cycles unless the preset says otherwise: len 16 is the 16th grid, len 3 a triplet.
    if (!('span' in o)) L.span = L.len === 12 || L.len <= 8 ? 16 : L.len;
  });
}

// ---------- persistence ----------

const LS = 'geometric-jelly.v2';

export function save(S) {
  try {
    localStorage.setItem(LS, JSON.stringify(S));
  } catch (e) {
    /* storage unavailable */
  }
}

export function load() {
  let raw = null;
  try {
    if (location.hash.startsWith('#s=')) raw = decodeURIComponent(escape(atob(location.hash.slice(3))));
  } catch (e) {
    raw = null;
  }
  try {
    raw = raw || localStorage.getItem(LS);
  } catch (e) {
    /* storage unavailable */
  }
  const S = newState();
  if (!raw) {
    applyPreset(S, S.preset);
    return S;
  }
  try {
    const o = JSON.parse(raw);
    if (o.v !== 2) throw 0;
    const { layers, ...g } = o;
    Object.assign(S, g);
    S.layers.forEach((L, i) => Object.assign(L, (layers || [])[i] || {}));
    return S;
  } catch (e) {
    applyPreset(S, S.preset);
    return S;
  }
}

export function shareURL(S) {
  const json = JSON.stringify({ ...S, layers: S.layers.map((L) => ({ ...L, sample: null })) });
  return location.origin + location.pathname + '#s=' + btoa(unescape(encodeURIComponent(json)));
}
