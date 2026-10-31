// DOM controls. Edits go into state and then out through `changed(kind)` to whichever of the
// engine, transport and renderer cares. Only the layer chips change the selected layer.

import { NAMES, euclid, knotRhythm, plr, mod, lcm } from './tonnetz.js';
import { PRESETS, CHARACTERS, MAX_STEPS, applyPreset, save, shareURL } from './state.js';
import { ECHO_DIVS } from './audio.js';
import { CHORDS } from './lull.js';
import { LAYER_HUES, clearStep } from './render.js';

const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'style') el.style.cssText = v;
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c);
  return el;
};
const pct = (v) => Math.round(v * 100) + '%';
const sgn = (v) => (v > 0 ? '+' : '') + Math.round(v * 100);
const SWEEP_RATES = [0.25, 0.5, 1, 2, 4, 8];

function spanText(L) {
  const s = L.span;
  const bars = s / 16;
  const head = bars === Math.round(bars) ? `${bars} bar${bars === 1 ? '' : 's'}` : `${s}/16`;
  return head;
}

export class UI {
  constructor(S, engine, transport, renderer, hooks) {
    this.S = S;
    this.E = engine;
    this.T = transport;
    this.R = renderer;
    this.hooks = hooks;
    this.stepMode = 'vel';
    this.buildTransport();
    this.buildRail();
    this.buildBench();
    this.buildBus();
    this.keys();
    this.refresh();
    setInterval(() => this.hud(), 100);
    requestAnimationFrame(() => this.loop());
  }

  note(t) {
    $('note').textContent = t || '';
  }

  // kind: 'pattern' | 'voice' | 'mix' | 'rhythm' | 'phase' | 'bus' | 'tempo' | 'all'
  changed(kind, li = this.S.sel) {
    const S = this.S;
    if (kind === 'tempo') {
      this.T.setTempo(S.bpm);
      this.E.applyBus(S);
      this.E.applyLayer(li);
    } else if (kind === 'bus') this.E.applyBus(S);
    else if (kind === 'view') {
      /* nothing to hear */
    }
    else if (kind === 'all') {
      S.layers.forEach((_, i) => this.E.applyLayer(i));
      this.E.applyBus(S);
      this.T.setTempo(S.bpm);
    } else {
      this.E.applyLayer(li);
      if (kind === 'phase' || kind === 'rhythm') this.T.rephase(li);
      if (kind === 'rhythm' || kind === 'pattern' || kind === 'mix') this.E.applyDrone(S);
    }
    clearTimeout(this._save);
    this._save = setTimeout(() => save(S), 300);
    this.refreshRail();
  }

  // ---------- transport ----------

  buildTransport() {
    const S = this.S;
    $('play').addEventListener('click', () => this.hooks.toggle());
    const bind = (id, key, fmt, kind) => {
      const el = $(id);
      el.addEventListener('input', () => {
        S[key] = +el.value;
        $(id + 'Val').textContent = fmt(S[key]);
        this.changed(kind);
      });
    };
    bind('bpm', 'bpm', (v) => v, 'tempo');
    bind('swing', 'swing', (v) => (v <= 0.5 ? 'off' : Math.round(v * 100) + '%'), 'tempo');
    bind('humanize', 'humanize', pct, 'tempo');
    const sel = $('preset');
    sel.append(h('option', { value: '' }, '— choose —'), ...Object.keys(PRESETS).map((n) => h('option', { value: n }, n)));
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      applyPreset(S, sel.value);
      this.changed('all');
      S.layers.forEach((_, i) => this.T.rephase(i));
      this.refresh();
    });
    $('flatten').addEventListener('input', (e) => {
      this.R.setFlatten(+e.target.value);
      this.changed('view');
    });
    $('visual').addEventListener('click', () => this.hooks.visual(true));
    $('exitVisual').addEventListener('click', () => this.hooks.visual(false));
  }

  setPlaying(on) {
    $('play').classList.toggle('on', on);
    $('play').setAttribute('aria-label', on ? 'Stop' : 'Play');
    $('playIcon').setAttribute('d', on ? 'M5 4h4v12H5zM11 4h4v12h-4z' : 'M5 3l12 7-12 7z');
  }

  // ---------- rail ----------

  buildRail() {
    const rail = $('rail');
    this.chips = this.S.layers.map((L, li) => {
      const m = h('span', { class: 'm', title: 'Mute' }, 'M');
      const s = h('span', { title: 'Solo' }, 'S');
      const b = h('button', { class: 'chip', style: `--hue:${LAYER_HUES[li]}` }, h('span', { class: 'nm' }, h('span', { class: 'name' }), h('span', { class: 'ms' }, m, s)), h('span', { class: 'meta' }));
      b.addEventListener('click', (ev) => {
        if (ev.target === m) this.toggle(li, 'mute');
        else if (ev.target === s) this.toggle(li, 'solo');
        else this.select(li);
      });
      rail.append(b);
      return { b, m, s };
    });
  }

  toggle(li, key) {
    this.S.layers[li][key] = !this.S.layers[li][key];
    this.S.layers.forEach((_, i) => this.E.applyLayer(i));
    this.changed('mix', li);
  }

  select(li) {
    this.S.sel = li;
    this.buildBench();
    this.refreshRail();
    save(this.S);
  }

  refreshRail() {
    const S = this.S;
    this.chips.forEach(({ b, m, s }, li) => {
      const L = S.layers[li];
      b.setAttribute('aria-pressed', S.sel === li);
      b.classList.toggle('muted', !this.audible(li));
      b.querySelector('.name').textContent = L.name;
      m.classList.toggle('on', L.mute);
      s.classList.toggle('on', L.solo);
      const shape = L.mode === 'face' ? NAMES[L.face.root] + (L.face.minor ? 'm' : '') + (L.walk ? ' ' + L.walk : '') : `(${L.p},${L.q})`;
      b.querySelector('.meta').textContent = `${L.len} / ${spanText(L)} · ${shape}`;
    });
  }

  audible(li) {
    const L = this.S.layers;
    return !L[li].mute && (!L.some((x) => x.solo) || L[li].solo);
  }

  // ---------- bench (selected layer) ----------

  slider(L, key, label, min, max, step, fmt, kind, after) {
    const val = h('span', { class: 'val' });
    const id = 'c-' + key;
    const inp = h('input', { type: 'range', id, min, max, step });
    inp.value = L[key];
    val.textContent = fmt(L[key], L);
    inp.addEventListener('input', () => {
      L[key] = +inp.value;
      val.textContent = fmt(L[key], L);
      if (after) after();
      this.changed(kind);
    });
    return h('div', { class: 'ctl' }, h('label', { for: id }, label), inp, val);
  }

  buildBench() {
    const S = this.S, li = S.sel, L = S.layers[li];
    const bench = $('bench');
    this._len = L.len;
    bench.style.setProperty('--hue', LAYER_HUES[li]);
    bench.replaceChildren();
    const sl = (...a) => this.slider(L, ...a);
    const btn = (label, fn, attrs = {}) => h('button', { class: 'tool', ...attrs, on: { click: fn } }, label);
    const redraw = () => {
      this.buildBench();
      this.changed('pattern');
    };

    bench.append(
      h('div', { class: 'bench-head' }, h('h2', {}, L.name), h('p', { class: 'hint' }, 'Tap a node on the shape to toggle it. Drag along to move it, outward for velocity, onto a neighbouring vertex to re-pitch, off the ring to delete.')),
    );

    // Step strip
    const modes = [['vel', 'Velocity'], ['prob', 'Probability'], ['flam', 'Flam'], ['rat', 'Ratchet'], ['pitch', 'Pitch']];
    bench.append(h('div', { class: 'tabs', role: 'tablist' }, modes.map(([k, n]) => btn(n, () => {
      this.stepMode = k;
      this.buildBench();
    }, { 'aria-pressed': this.stepMode === k, role: 'tab' }))));
    this.strip = h('div', { class: 'steps', style: `grid-template-columns: repeat(${L.len}, 1fr)` });
    this.cells = [];
    for (let i = 0; i < L.len; i++) {
      const bar = h('div', { class: 'bar' });
      const tx = h('div', { class: 'tx' });
      const c = h('div', { class: 'cell' + ((L.span === L.len ? i % 4 === 0 : i === 0) ? ' beat' : ''), 'data-i': i }, bar, tx);
      this.cells.push({ c, bar, tx });
      this.strip.append(c);
    }
    this.bindStrip(L);
    bench.append(this.strip);
    this.paintStrip();

    // Rhythm
    const groups = h('div', { class: 'groups' });
    const kSel = h('input', { type: 'range', min: 0, max: L.len, step: 1, value: Math.max(1, L.vel.slice(0, L.len).filter((v) => v > 0).length) });
    const kVal = h('span', { class: 'val' }, kSel.value);
    kSel.addEventListener('input', () => (kVal.textContent = kSel.value));
    groups.append(
      h('div', { class: 'group' }, h('h3', {}, 'Rhythm'),
        sl('len', 'Steps', 2, MAX_STEPS, 1, (v) => v, 'rhythm', () => this.lenChanged(L)),
        sl('span', 'Cycle', 1, 64, 1, (v, L) => spanText(L), 'rhythm', () => this.refreshRail()),
        h('div', { class: 'row' },
          btn('Steps = 16ths', () => { L.span = L.len; redraw(); this.changed('rhythm'); }),
          btn('= 1 bar', () => { L.span = 16; redraw(); this.changed('rhythm'); }),
          btn('= 2 bars', () => { L.span = 32; redraw(); this.changed('rhythm'); })),
        h('div', { class: 'ctl' }, h('label', {}, 'Euclid k'), kSel, kVal),
        h('div', { class: 'row' },
          btn('Euclid', () => { euclid(+kSel.value, L.len).forEach((v, i) => (L.vel[i] = v ? 0.8 : 0)); redraw(); }),
          btn('Knot rhythm', () => { knotRhythm(L.p, L.q, L.len).forEach((v, i) => (L.vel[i] = v)); redraw(); }, { title: 'Hits where the (p, q) knot crosses its meridian (p per cycle) and longitude (q per cycle)' }),
          btn('◀', () => { rotate(L, -1); redraw(); }, { title: 'Rotate left ([)' }),
          btn('▶', () => { rotate(L, 1); redraw(); }, { title: 'Rotate right (])' }),
          btn('Mirror', () => { mirror(L); redraw(); }),
          btn('Clear', () => { for (let i = 0; i < MAX_STEPS; i++) clearStep(L, i); redraw(); })),
        sl('vary', 'Vary', 0, 1, 0.01, (v) => (v ? pct(v) : 'off'), 'pattern'),
        h('div', { class: 'ctl' }, h('label', {}, 'Seed'), h('span', { class: 'val', style: 'text-align:left' }, String(L.seed)), btn('Reroll', () => { L.seed = 1 + Math.floor(Math.random() * 9999); redraw(); })),
      ),
    );

    // Orbit
    const orbit = h('div', { class: 'group' }, h('h3', {}, 'Orbit'));
    orbit.append(h('div', { class: 'row' },
      btn('Knot', () => { L.mode = 'knot'; redraw(); }, { 'aria-pressed': L.mode === 'knot' }),
      btn('Face', () => { L.mode = 'face'; redraw(); }, { 'aria-pressed': L.mode === 'face' })));
    if (L.mode === 'knot') {
      const fixPQ = () => {
        if (!L.p && !L.q) L.p = 1;
        this.refreshRail();
      };
      orbit.append(
        sl('p', 'p · fifths', 0, 8, 1, (v) => v, 'pattern', fixPQ),
        sl('q', 'q · thirds', 0, 8, 1, (v) => v, 'pattern', fixPQ),
        h('p', { class: 'hint' }),
      );
      const g = gcdSmall(L.p, L.q);
      orbit.lastChild.textContent = g > 1 ? `gcd ${g}: a link of ${Math.min(g, 4)} loops, each one a voice.` : L.p && L.q ? `A single knot. p against q is a ${L.p}:${L.q} polyrhythm.` : L.q ? 'Circles the major-third axis only.' : 'Walks the circle of fifths.';
      orbit.append(sl('drift', 'Drift', 0, 1, 0.01, (v) => (v ? (v * 100).toFixed(0) + '%/cyc' : 'locked'), 'pattern'));
    } else {
      const root = h('select', { 'aria-label': 'Triad root' }, NAMES.map((n, i) => h('option', { value: i }, n)));
      root.value = L.face.root;
      root.addEventListener('change', () => { L.face.root = +root.value; this.changed('pattern'); });
      const walk = h('input', { type: 'text', value: L.walk, placeholder: 'e.g. LR', size: 6, 'aria-label': 'PLR walk, one move per cycle' });
      walk.addEventListener('input', () => { L.walk = walk.value.toUpperCase().replace(/[^PLR]/g, ''); this.changed('pattern'); });
      orbit.append(
        h('div', { class: 'row' }, root,
          btn('Major', () => { L.face.minor = false; redraw(); }, { 'aria-pressed': !L.face.minor }),
          btn('Minor', () => { L.face.minor = true; redraw(); }, { 'aria-pressed': L.face.minor })),
        h('div', { class: 'row' }, ...['P', 'L', 'R'].map((op) => btn(op, () => { L.face = plr(L.face, op); redraw(); }, { title: { P: 'Parallel: C ↔ Cm', L: 'Leading-tone: C ↔ Em', R: 'Relative: C ↔ Am' }[op] }))),
        h('div', { class: 'ctl' }, h('label', {}, 'Walk'), walk, h('span', { class: 'val' }, '/cycle')),
      );
    }
    const rootK = h('select', { 'aria-label': 'Orbit start' }, NAMES.map((n, i) => h('option', { value: i }, n)));
    rootK.value = L.root;
    rootK.addEventListener('change', () => { L.root = +rootK.value; this.changed('pattern'); });
    if (L.mode === 'knot') orbit.append(h('div', { class: 'ctl' }, h('label', {}, 'Start'), rootK, h('span', { class: 'val' }, 'vertex')));
    orbit.append(sl('reg', 'Register', 1, 7, 1, (v) => 'oct ' + v, 'voice'));
    groups.append(orbit);

    // Voice
    const chars = h('div', { class: 'row' }, CHARACTERS.map((c) => btn(c, () => { L.char = c; redraw(); }, { 'aria-pressed': L.char === c })));
    const choke = h('select', { 'aria-label': 'Choke group' }, ['none', 'A', 'B'].map((n, i) => h('option', { value: i }, n)));
    choke.value = L.choke;
    choke.addEventListener('change', () => { L.choke = +choke.value; this.changed('voice'); });
    groups.append(
      h('div', { class: 'group' }, h('h3', {}, 'Voice'), chars,
        sl('body', 'Body', 0, 1, 0.01, (v) => (v < 0.2 ? 'kit ' : v < 0.6 ? 'tuned ' : 'bell ') + pct(v), 'voice'),
        sl('ring', 'Ring', 0, 1, 0.01, pct, 'voice'),
        sl('fb', 'Feedback', 0, 0.95, 0.01, pct, 'voice'),
        sl('attack', 'Attack', -1, 1, 0.01, sgn, 'voice'),
        sl('sustain', 'Sustain', -1, 1, 0.01, sgn, 'voice'),
        sl('tape', 'Tape', -12, 12, 1, (v) => (v > 0 ? '+' : '') + v + ' st', 'voice'),
        h('div', { class: 'ctl' }, h('label', {}, 'Choke'), choke, h('span', { class: 'val' }, '')),
      ),
      h('div', { class: 'group' }, h('h3', {}, 'Colour'),
        sl('bright', 'Bright', 0, 1, 0.01, (v) => (900 * Math.pow(20000 / 900, v) / 1000).toFixed(1) + 'k', 'voice'),
        sl('sweep', 'Sweep', 0, 1, 0.01, (v) => (v ? pct(v) : 'off'), 'voice'),
        this.discrete(L, 'sweepRate', 'Sweep rate', SWEEP_RATES, (v) => (v < 1 ? '1/' + 1 / v : v) + ' bar', 'voice'),
        sl('bits', 'Bits', 2, 16, 1, (v) => (v >= 16 ? 'clean' : v + '-bit'), 'voice'),
        sl('down', 'Rate ÷', 1, 32, 1, (v) => (v <= 1 ? 'clean' : '÷' + v), 'voice'),
      ),
      h('div', { class: 'group' }, h('h3', {}, 'Mix'),
        sl('level', 'Level', 0, 1, 0.01, pct, 'mix'),
        sl('pan', 'Pan', -1, 1, 0.01, (v) => (Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100)), 'mix'),
        sl('echo', 'Echo', 0, 1, 0.01, pct, 'mix'),
        sl('verb', 'Reverb', 0, 1, 0.01, pct, 'mix'),
        sl('copies', 'Phasing', 1, 4, 1, (v) => (v === 1 ? 'off' : v + ' copies'), 'phase'),
        sl('phase', 'Drift apart', 0, 3, 0.05, (v) => v.toFixed(2) + '%', 'phase'),
      ),
    );
    groups.append(this.sourceGroup(L, li));
    bench.append(groups);
  }

  discrete(L, key, label, values, fmt, kind) {
    const val = h('span', { class: 'val' }, fmt(L[key]));
    const inp = h('input', { type: 'range', min: 0, max: values.length - 1, step: 1, 'aria-label': label });
    inp.value = Math.max(0, values.indexOf(L[key]));
    inp.addEventListener('input', () => {
      L[key] = values[+inp.value];
      val.textContent = fmt(L[key]);
      this.changed(kind);
    });
    return h('div', { class: 'ctl' }, h('label', {}, label), inp, val);
  }

  sourceGroup(L, li) {
    const g = h('div', { class: 'group' }, h('h3', {}, 'Source'));
    const pick = h('select', { 'aria-label': 'Excitation source' }, h('option', { value: '' }, 'Synth: ' + (L.kit === 'none' ? L.char + ' burst' : L.kit)));
    this.hooks.samples().then((rows) => {
      rows.forEach((r) => pick.append(h('option', { value: r.id }, r.name)));
      pick.value = L.sample || '';
    });
    pick.addEventListener('change', () => this.hooks.useSample(li, pick.value || null));
    const file = h('input', { type: 'file', accept: 'audio/*', style: 'display:none' });
    file.addEventListener('change', () => file.files[0] && this.hooks.importFile(li, file.files[0]));
    const rec = h('button', { class: 'tool', id: 'recBtn' }, 'Record');
    rec.addEventListener('click', () => this.hooks.record(li, rec));
    g.append(
      pick,
      h('div', { class: 'row' }, rec, h('button', { class: 'tool', on: { click: () => file.click() } }, 'Import'), file,
        L.sample ? h('button', { class: 'tool', on: { click: () => this.hooks.deleteSample(li) } }, 'Delete') : null),
      h('p', { class: 'hint' }, 'A recording becomes the excitation: it plays dry at low Body and rings the tuned resonator as Body rises.'),
    );
    return g;
  }

  lenChanged(L) {
    // A layer on the 16th grid stays on it: its cycle follows its length. A layer spread over a bar
    // keeps the bar, so 3 steps over 16 stays a triplet.
    if (L.span === this._len) L.span = L.len;
    this._len = L.len;
    this.buildBenchSoon();
  }

  buildBenchSoon() {
    clearTimeout(this._bb);
    this._bb = setTimeout(() => this.buildBench(), 250);
  }

  // ---------- step strip ----------

  bindStrip(L) {
    let painting = null;
    const valueAt = (ev, c) => {
      const b = c.getBoundingClientRect();
      return Math.min(1, Math.max(0, 1 - (ev.clientY - b.top) / b.height));
    };
    const cellAt = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const c = el && el.closest('.cell');
      return c && this.strip.contains(c) ? c : null;
    };
    const apply = (c, ev, first) => {
      const i = +c.dataset.i, y = valueAt(ev, c), m = this.stepMode;
      if (m === 'vel') {
        if (first && L.vel[i] > 0 && painting.tap) painting.erase = true;
        L.vel[i] = painting.erase ? 0 : Math.max(0.06, y);
      } else if (m === 'prob') L.prob[i] = Math.round(y * 20) / 20;
      else if (m === 'flam') {
        if (first) painting.set = L.flam[i] ? 0 : 1;
        L.flam[i] = painting.set;
      } else if (m === 'rat') L.rat[i] = 1 + Math.min(3, Math.floor(y * 4));
      else if (m === 'pitch' && first) {
        L.da[i] = 0;
        L.db[i] = 0;
      }
      this.paintStrip();
      this.changed('pattern');
    };
    this.strip.addEventListener('pointerdown', (ev) => {
      const c = cellAt(ev);
      if (!c) return;
      this.strip.setPointerCapture(ev.pointerId);
      painting = { tap: true, erase: false, set: 1 };
      apply(c, ev, true);
    });
    this.strip.addEventListener('pointermove', (ev) => {
      if (!painting) return;
      const c = cellAt(ev);
      if (c) apply(c, ev, false);
    });
    const end = () => (painting = null);
    this.strip.addEventListener('pointerup', end);
    this.strip.addEventListener('pointercancel', end);
  }

  paintStrip() {
    const L = this.S.layers[this.S.sel], m = this.stepMode;
    if (!this.cells) return;
    this.cells.forEach(({ c, bar, tx }, i) => {
      let v = 0, t = '';
      if (m === 'vel') v = L.vel[i];
      else if (m === 'prob') { v = L.vel[i] ? L.prob[i] : 0; t = L.vel[i] && L.prob[i] < 1 ? pct(L.prob[i]) : ''; }
      else if (m === 'flam') { v = L.flam[i] ? 1 : 0; t = L.flam[i] ? 'flam' : ''; }
      else if (m === 'rat') { v = L.vel[i] ? L.rat[i] / 4 : 0; t = L.vel[i] && L.rat[i] > 1 ? '×' + L.rat[i] : ''; }
      else if (m === 'pitch') {
        v = L.vel[i] ? 0.25 : 0;
        t = L.vel[i] ? this.hooks.stepName(L, i) + (L.da[i] || L.db[i] ? '*' : '') : '';
      }
      bar.style.height = pct(v);
      tx.textContent = t;
      c.classList.toggle('out', m !== 'vel' && m !== 'flam' && !L.vel[i]);
    });
  }

  // Playhead on the strip, from the audio clock.
  loop() {
    requestAnimationFrame(() => this.loop());
    if (!this.cells) return;
    const li = this.S.sel, L = this.S.layers[li];
    const cur = this.T.playing ? Math.floor(mod(this.T.pos(li, 0, this.T.now16()), 1) * L.len) : -1;
    if (cur !== this._cur) {
      this.cells.forEach(({ c }, i) => c.classList.toggle('now', i === cur));
      this._cur = cur;
      if (this.stepMode === 'pitch') this.paintStrip();
    }
  }

  // ---------- bus ----------

  buildBus() {
    const S = this.S, bus = $('bus');
    const sl = (key, label, min, max, step, fmt, kind = 'bus') => this.slider(S, key, label, min, max, step, fmt, kind);
    const div = h('select', { 'aria-label': 'Echo time' }, ECHO_DIVS.map(([v, n]) => h('option', { value: v }, n)));
    div.value = ECHO_DIVS.find(([v]) => Math.abs(v - S.echoDiv) < 1e-6)?.[0] ?? 0.75;
    div.addEventListener('change', () => { S.echoDiv = +div.value; this.changed('bus'); });
    const chord = h('select', { 'aria-label': 'Drone chord' }, Object.entries(CHORDS).map(([k, c]) => h('option', { value: k }, c.name)));
    chord.value = S.droneChord;
    chord.addEventListener('change', () => { S.droneChord = chord.value; this.changed('bus'); });
    const key = h('select', { 'aria-label': 'Drone key' }, NAMES.map((n, i) => h('option', { value: i }, n)));
    key.value = S.key;
    key.addEventListener('change', () => { S.key = +key.value; this.changed('bus'); });
    bus.replaceChildren(
      h('div', { class: 'bench-head' }, h('h2', { style: 'color:var(--ink-dim)' }, 'Bus'),
        h('p', { class: 'hint' }, 'Shared reverb from a generated impulse, tempo-synced ping-pong echo, and a just-intonation drone whose partials swell at the rates of the polyrhythm.')),
      h('div', { class: 'groups' },
        h('div', { class: 'group' }, h('h3', {}, 'Space'),
          sl('verbSize', 'Reverb size', 0.6, 6, 0.1, (v) => v.toFixed(1) + ' s'),
          sl('verbLevel', 'Reverb', 0, 1.5, 0.01, pct),
          h('div', { class: 'ctl' }, h('label', {}, 'Echo time'), div, h('span', { class: 'val' }, 'synced')),
          sl('echoFb', 'Echo fb', 0, 0.9, 0.01, pct)),
        h('div', { class: 'group' }, h('h3', {}, 'Drone bed'),
          sl('drone', 'Drone', 0, 1, 0.01, (v) => (v ? pct(v) : 'off')),
          h('div', { class: 'ctl' }, h('label', {}, 'Chord'), chord, h('span', { class: 'val' }, '')),
          h('div', { class: 'ctl' }, h('label', {}, 'Key'), key, h('span', { class: 'val' }, ''))),
        h('div', { class: 'group' }, h('h3', {}, 'Out'),
          sl('master', 'Master', 0, 1, 0.01, pct),
          h('div', { class: 'row' },
            h('button', { class: 'tool', on: { click: () => this.share() } }, 'Copy share link'),
            h('button', { class: 'tool', on: { click: () => this.hooks.reset() } }, 'Reset all'))),
      ),
    );
  }

  async share() {
    const url = shareURL(this.S);
    try {
      await navigator.clipboard.writeText(url);
      this.note('Share link copied. Recordings stay on this device and are not included.');
    } catch (e) {
      this.note('Copy this link: ' + url);
    }
  }

  // ---------- readouts ----------

  hud() {
    const S = this.S;
    const { period, left } = this.T.realign();
    const fmt16 = (n) => {
      n = Math.max(0, n);
      const bars = Math.floor(n / 16), six = Math.round(n - bars * 16);
      return bars ? `${bars} bar${bars > 1 ? 's' : ''}${six ? ' ' + six + '/16' : ''}` : `${six}/16`;
    };
    $('realign').textContent = this.T.playing ? `in ${fmt16(left)} · every ${fmt16(period)}` : `every ${fmt16(period)}`;
    const L = S.layers[S.sel];
    const c = this.T.playing ? Math.floor(this.T.pos(S.sel, 0, this.T.now16())) + 1 : 0;
    const spans = [...new Set(S.layers.filter((_, i) => this.audible(i)).map((x) => x.span))];
    const lines = [`<b>${L.name}</b> · ${L.len} steps over ${spanText(L)} · cycle ${c}`];
    if (L.mode === 'knot') lines.push(`(${L.p}, ${L.q}) ${gcdSmall(L.p, L.q) > 1 ? 'link' : 'knot'} from ${NAMES[L.root]}${L.drift ? ' · drifting' : ''}`);
    else lines.push(`face ${NAMES[L.face.root]}${L.face.minor ? 'm' : ''}${L.walk ? ' · walk ' + L.walk : ''}`);
    if (spans.length > 1) lines.push(`cycles ${spans.join(' : ')} sixteenths → lcm ${spans.reduce(lcm, 1)}`);
    $('hud').innerHTML = lines.join('<br>');
  }

  refresh() {
    const S = this.S;
    $('bpm').value = S.bpm;
    $('bpmVal').textContent = S.bpm;
    $('swing').value = S.swing;
    $('swingVal').textContent = S.swing <= 0.5 ? 'off' : Math.round(S.swing * 100) + '%';
    $('humanize').value = S.humanize;
    $('humanizeVal').textContent = pct(S.humanize);
    $('preset').value = PRESETS[S.preset] ? S.preset : '';
    $('flatten').value = S.flatten;
    this.buildBench();
    this.buildBus();
    this.refreshRail();
  }

  // ---------- keys ----------

  keys() {
    document.addEventListener('keydown', (ev) => {
      if (ev.target.closest('input[type=text], select') || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const S = this.S, L = S.layers[S.sel];
      const k = ev.key;
      if (k === ' ') {
        ev.preventDefault();
        this.hooks.toggle();
      } else if (k >= '1' && k <= String(S.layers.length)) this.select(+k - 1);
      else if (k === 'm' || k === 'M') this.toggle(S.sel, 'mute');
      else if (k === 's' || k === 'S') this.toggle(S.sel, 'solo');
      else if (k === '[' || k === ']') {
        rotate(L, k === ']' ? 1 : -1);
        this.buildBench();
        this.changed('pattern');
      } else if (k === 'f' || k === 'F') {
        const v = S.flatten > 0.5 ? 0 : 1;
        $('flatten').value = v;
        this.R.setFlatten(v);
        this.changed('view');
      } else if (k === 'v' || k === 'V') this.hooks.visual(!document.body.classList.contains('visual'));
      else if (k === 'Escape') this.hooks.visual(false);
    });
  }
}

const STEP_ARRAYS = ['vel', 'prob', 'flam', 'rat', 'da', 'db'];
function rotate(L, d) {
  for (const k of STEP_ARRAYS) {
    const a = L[k].slice(0, L.len);
    for (let i = 0; i < L.len; i++) L[k][mod(i + d, L.len)] = a[i];
  }
}
function mirror(L) {
  // Retrograde about step 0, so the downbeat stays put.
  for (const k of STEP_ARRAYS) {
    const a = L[k].slice(0, L.len);
    for (let i = 0; i < L.len; i++) L[k][i] = a[mod(-i, L.len)];
  }
}
function gcdSmall(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}
