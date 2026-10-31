// node tests/tonnetz.test.mjs — checks the torus claims the design rests on.
import assert from 'node:assert/strict';
import * as T from '../js/tonnetz.js';

const c = T.census();
assert.equal(c.E, 36, 'edges');
assert.equal(c.F, 24, 'faces');
assert.equal(c.chi, 0, 'Euler characteristic of a torus');
assert.deepEqual(c.intervalClasses, { 3: 12, 4: 12, 5: 12 }, 'only minor thirds, major thirds, fifths');

// Every face is a major or minor triad, and all 24 occur.
const seen = new Set();
for (const f of T.faces()) {
  const pcs = f.v.map(([a, b]) => T.pcAt(a, b));
  assert.deepEqual([...pcs].sort((x, y) => x - y), [...T.triad(f.root, f.minor)].sort((x, y) => x - y));
  seen.add(f.root + (f.minor ? 'm' : ''));
}
assert.equal(seen.size, 24);

// faceVerts returns root, third, fifth.
for (let r = 0; r < 12; r++)
  for (const minor of [false, true])
    assert.deepEqual(T.faceVerts({ root: r, minor }).map(([a, b]) => T.pcAt(a, b)), T.triad(r, minor));

// P, L and R are involutions; C major goes to C minor, E minor and A minor.
const C = { root: 0, minor: false };
for (const op of 'PLR') assert.deepEqual(T.plr(T.plr(C, op), op), C);
assert.deepEqual(T.plr(C, 'P'), { root: 0, minor: true });
assert.deepEqual(T.plr(C, 'L'), { root: 4, minor: true });
assert.deepEqual(T.plr(C, 'R'), { root: 9, minor: true });
// faceAt is consistent with stepwise application.
let f = C;
for (let j = 0; j < 100; j++) {
  assert.deepEqual(T.faceAt(C, 'RLP', j), f);
  f = T.plr(f, 'RLP'[j % 3]);
}

// Edge steps along an orbit are consonant: consecutive vertices of a (1,0) orbit are a fifth apart.
const L = { p: 1, q: 0, root: 0, len: 12, mode: 'knot', drift: 0, da: [], db: [] };
for (let i = 0; i < 12; i++) {
  const [a, b] = T.stepVertex(L, i, 0, 0), [a2, b2] = T.stepVertex(L, (i + 1) % 12, 0, 0);
  assert.equal(T.mod(T.pcAt(a2, b2) - T.pcAt(a, b), 12), 7);
}

// Links: (2,2) has two distinct loops; (4,2) too (the shift must not land on the same loop).
for (const [p, q] of [[2, 2], [4, 2], [3, 0], [0, 2], [6, 3]]) {
  const { g } = T.components(p, q);
  const Lk = { p, q, root: 0 };
  const pts = (k) => Array.from({ length: 240 }, (_, i) => T.orbitAt(Lk, i / 240, k).map((x, j) => T.mod(x, j ? 3 : 12)));
  for (let k = 1; k < g; k++) {
    const A0 = pts(0), Ak = pts(k);
    const minD = Math.min(...Ak.map(([x, y]) => Math.min(...A0.map(([u, v]) => Math.hypot(Math.min(T.mod(x - u, 12), T.mod(u - x, 12)) / 12, Math.min(T.mod(y - v, 3), T.mod(v - y, 3)) / 3)))));
    assert.ok(minD > 0.02, `(${p},${q}) loop ${k} is distinct from loop 0`);
  }
}

// Euclid and knot rhythms.
assert.deepEqual(T.euclid(3, 8), [1, 0, 0, 1, 0, 0, 1, 0]);
assert.deepEqual(T.knotRhythm(3, 2, 6).map((x) => (x ? 1 : 0)), [1, 0, 1, 1, 1, 0]);

console.log('tonnetz: all checks pass', c);
