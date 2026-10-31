// Layer 4 of 4: transport. The only thing that touches time.
//
// One master clock counts sixteenths on the audio clock: m16(t) = anchor16 + (t − anchorT)·bpm/15.
// Every layer's position is derived from it, never accumulated: copy k of layer L is at cycle
// position m16 / span (plus a drift term for phasing copies). So changing a layer's length or cycle
// takes effect on the grid at once, nothing can creep, and the scheduler can be stateless — each tick
// schedules every step whose master time falls in [until, now + LOOKAHEAD), then moves `until` on.
// Shape after Harmonia's tick(): a short interval scheduling onto ctx.currentTime, never a timer
// firing notes.

import { stepVertex, pcAt, loopCount, lcm } from './tonnetz.js';
import { mulberry32 } from './lull.js';

const LOOKAHEAD = 0.12;
const INTERVAL = 25;

// Reproducible randomness per (seed, cycle, step, purpose), so a pattern with probability or
// variation plays the same way every time from the top.
const rnd = (seed, c, i, salt) => mulberry32((seed * 73856093) ^ (c * 19349663) ^ (i * 83492791) ^ (salt * 2654435761))();

export class Transport {
  constructor(engine, S, onHit) {
    this.E = engine;
    this.S = S;
    this.onHit = onHit;
    this.playing = false;
    this.anchor16 = 0;
    this.anchorT = 0;
    this.r16 = S.bpm / 15;
    this.until = 0;
    this.copyAnchor = S.layers.map(() => 0);
  }

  m16At(t) {
    return this.playing ? this.anchor16 + (t - this.anchorT) * this.r16 : 0;
  }
  tAt16(m) {
    return this.anchorT + (m - this.anchor16) / this.r16;
  }
  now16() {
    return this.E.ctx ? this.m16At(this.E.ctx.currentTime) : 0;
  }

  period(L, k) {
    return L.span * (1 + (k * L.phase) / 100);
  }
  // Cycle position (cycles, fractional) of copy k of layer li at master time m.
  pos(li, k, m) {
    const L = this.S.layers[li];
    if (!k) return m / L.span;
    const a = this.copyAnchor[li];
    return a / L.span + (m - a) / this.period(L, k);
  }

  start() {
    const ctx = this.E.ctx;
    this.anchorT = ctx.currentTime + 0.06;
    this.anchor16 = 0;
    this.r16 = this.S.bpm / 15;
    this.until = this.anchorT;
    this.copyAnchor = this.S.layers.map(() => 0);
    this.playing = true;
    this.E.startLFOs(this.anchorT);
    this.timer = setInterval(() => this.tick(), INTERVAL);
    this.tick();
  }

  stop() {
    clearInterval(this.timer);
    this.playing = false;
    if (this.E.ctx) this.E.stopLFOs(this.E.ctx.currentTime);
  }

  // Re-anchor at the edge of what is already scheduled, so nothing doubles or drops.
  setTempo(bpm) {
    if (this.playing) {
      this.anchor16 = this.m16At(this.until);
      this.anchorT = this.until;
    }
    this.r16 = bpm / 15;
  }

  // Phasing copies keep their current drift when their rate or the cycle changes.
  rephase(li) {
    if (!this.playing) return;
    const m = this.m16At(this.until);
    const L = this.S.layers[li];
    // Restart the drift from unison at the current cycle's start: what a player expects from the knob.
    this.copyAnchor[li] = m - (m % L.span);
  }

  tick() {
    if (!this.playing) return;
    const now = this.E.ctx.currentTime;
    const horizon = now + LOOKAHEAD;
    if (horizon <= this.until) return;
    const mA = this.m16At(this.until), mB = this.m16At(horizon);
    this.S.layers.forEach((L, li) => {
      if (!this.E.audible(li)) return;
      for (let k = 0; k < L.copies; k++) this.scheduleLayer(li, k, mA, mB, now);
    });
    this.until = horizon;
  }

  scheduleLayer(li, k, mA, mB, now) {
    const S = this.S, L = S.layers[li], n = L.len;
    const P = this.period(L, k);
    const c0 = k ? this.copyAnchor[li] / L.span - this.copyAnchor[li] / P : 0;
    const first = Math.ceil((c0 + mA / P) * n - 1e-9);
    for (let s = first; ; s++) {
      const m = (s / n - c0) * P;
      if (m >= mB) break;
      const c = Math.floor(s / n), i = s - c * n;
      let vel = L.vel[i];
      if (!vel) continue;
      if (L.prob[i] < 1 && rnd(L.seed, c, i, 1) >= L.prob[i]) continue;
      if (L.vary > 0) {
        const cv = c % 4;
        if (i > 0 && rnd(L.seed, cv, i, 7) < L.vary * 0.45) continue;
        vel *= 1 - L.vary * 0.35 * rnd(L.seed, cv, i, 9);
      }
      let t = this.tAt16(m);
      // Swing delays the off-sixteenths of the master grid: 50% straight, 66% triplet, 75% dotted.
      const mr = Math.round(m);
      if (S.swing > 0.5 && Math.abs(m - mr) < 1e-6 && mr % 2) t += (S.swing - 0.5) * 2 / this.r16;
      if (S.humanize > 0) {
        t += (rnd(L.seed, c, i, 11) - 0.5) * 2 * S.humanize * 0.018;
        vel *= 1 + (rnd(L.seed, c, i, 13) - 0.5) * S.humanize * 0.35;
      }
      t = Math.max(t, now + 0.003);
      const verts = [];
      for (let kk = 0; kk < loopCount(L); kk++) verts.push(stepVertex(L, i, kk, c));
      const pcs = verts.map(([a, b]) => pcAt(a, b));

      if (L.flam[i] && t - 0.024 > now) this.E.strike(li, k, t - 0.024, vel * 0.45, pcs);
      const r = Math.max(1, L.rat[i] | 0);
      const stepSec = P / n / this.r16;
      for (let j = 0; j < r; j++) this.E.strike(li, k, t + (j * stepSec) / r, vel * (1 - (0.18 * j) / r), pcs);
      this.onHit({ li, k, i, c, t, vel, verts });
    }
  }

  // Sixteenths until every sounding layer starts a cycle together, and the full period.
  realign() {
    const act = this.S.layers.filter((L, i) => this.E.audible(i) && L.vel.slice(0, L.len).some((v) => v > 0));
    const P = act.reduce((m, L) => lcm(m, L.span), 1);
    const m = this.now16();
    return { period: P, left: P - (m % P), m };
  }
}
