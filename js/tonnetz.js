// The Tonnetz torus, as pure math. No DOM, no audio: tests/tonnetz.test.mjs runs this under Node.
//
// Lattice coordinates (a, b): a walks the fifth-axis (0..11), b the major-third axis (0..2).
// Pitch class at (a, b) is 7a + 4b mod 12. That 12 × 3 grid is what gets drawn: each row is a
// whole circle of fifths, each row a major third above the last, so every pitch class appears
// three times. Glue the copies together and you get the 12-vertex torus the spec's census is about;
// `census()` checks both.

export const A = 12;
export const B = 3;
export const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export const mod = (x, n) => ((x % n) + n) % n;
export const gcd = (x, y) => {
  x = Math.abs(x);
  y = Math.abs(y);
  while (y) [x, y] = [y, x % y];
  return x;
};
export const lcm = (x, y) => (x && y ? (x / gcd(x, y)) * y : x || y);

export const pcAt = (a, b) => mod(7 * a + 4 * b, 12);
// Where a pitch class sits on row 0 (7 is its own inverse mod 12).
export const aOf = (pc) => mod(7 * pc, 12);
// Hue from position on the circle of fifths: Harmonia's hue-from-wheel-position.
export const hueOf = (pc) => mod(aOf(pc) * 30 + 12, 360);

// The six lattice neighbours of a vertex: ±fifth, ±major third, ±minor third.
export const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

export function edges() {
  const out = [];
  for (let a = 0; a < A; a++)
    for (let b = 0; b < B; b++)
      for (const [da, db] of [[1, 0], [0, 1], [1, -1]]) out.push([a, b, a + da, b + db]);
  return out; // endpoints unwrapped, so an edge can be drawn as a straight line in (a, b)
}

// Two triangles per cell: (a,b),(a+1,b),(a,b+1) is major with root at (a,b);
// (a+1,b),(a,b+1),(a+1,b+1) is minor with root at (a,b+1).
export function faces() {
  const out = [];
  for (let a = 0; a < A; a++)
    for (let b = 0; b < B; b++) {
      out.push({ minor: false, root: pcAt(a, b), v: [[a, b], [a + 1, b], [a, b + 1]] });
      out.push({ minor: true, root: pcAt(a, b + 1), v: [[a + 1, b], [a, b + 1], [a + 1, b + 1]] });
    }
  return out;
}

// Census of the 12-vertex quotient: vertices, distinct edges with interval classes, distinct triads.
export function census() {
  const E = new Map();
  for (const [a, b, c, d] of edges()) {
    const x = pcAt(a, b), y = pcAt(c, d);
    E.set([Math.min(x, y), Math.max(x, y)].join(','), Math.min(mod(x - y, 12), mod(y - x, 12)));
  }
  const F = new Set(faces().map((f) => f.v.map(([a, b]) => pcAt(a, b)).sort((x, y) => x - y).join(',')));
  const ic = {};
  for (const v of E.values()) ic[v] = (ic[v] || 0) + 1;
  return { V: 12, E: E.size, F: F.size, chi: 12 - E.size + F.size, intervalClasses: ic };
}

// ---------- triads and Neo-Riemannian moves ----------

export const triad = (root, minor) => [root, mod(root + (minor ? 3 : 4), 12), mod(root + 7, 12)];

export function plr(face, op) {
  const { root, minor } = face;
  if (op === 'P') return { root, minor: !minor };
  if (op === 'R') return minor ? { root: mod(root + 3, 12), minor: false } : { root: mod(root + 9, 12), minor: true };
  if (op === 'L') return minor ? { root: mod(root + 8, 12), minor: false } : { root: mod(root + 4, 12), minor: true };
  return face;
}

// Lattice positions of a triad's root, third and fifth, in that order (unwrapped, row 0 or 1).
export function faceVerts(face) {
  if (!face.minor) {
    const a = aOf(face.root);
    return [[a, 0], [a, 1], [a + 1, 0]];
  }
  const a = aOf(face.root - 4);
  return [[a, 1], [a + 1, 0], [a + 1, 1]];
}

// Face after `c` cycles of a walk such as "PL" or "RL": the word's moves are applied one per cycle.
export function faceAt(face, walk, c) {
  const ops = (walk || '').toUpperCase().replace(/[^PLR]/g, '');
  if (!ops.length || c <= 0) return face;
  // Any element of the PLR group has order dividing 24, so this is exact and bounded.
  const n = c % (ops.length * 24);
  let f = face;
  for (let j = 0; j < n; j++) f = plr(f, ops[j % ops.length]);
  return f;
}

// ---------- (p, q) torus knots ----------

// A (p, q) orbit is a single knot when gcd = 1 and a link of g = gcd loops otherwise.
export function components(p, q) {
  const g = gcd(p, q) || 1;
  return { g, p1: p / g, q1: q / g };
}

// Continuous lattice coordinates of loop k of a layer's orbit at cycle fraction t.
// `a0, b0` place the orbit's start vertex; `prec` is the precession along the fifth-axis.
export function orbitAt(L, t, k, prec = 0) {
  const { g, p1, q1 } = components(L.p, L.q);
  const a0 = aOf(L.root);
  // Shift each loop transversally so the g loops are parallel and distinct.
  const shA = p1 === 0 ? (A * k) / g : 0;
  const shB = p1 !== 0 ? (B * k) / (g * p1) : 0;
  return [a0 + A * p1 * t + shA + prec, B * q1 * t + shB];
}

// Lattice vertex (unwrapped integers) that step i of loop k sounds in cycle c.
export function stepVertex(L, i, k, c) {
  const n = L.len;
  if (L.mode === 'face') {
    const v = faceVerts(faceAt(L.face, L.walk, c))[i % 3];
    return [v[0] + (L.da[i] || 0), v[1] + (L.db[i] || 0)];
  }
  const [a, b] = orbitAt(L, i / n, k, precession(L, c));
  return [Math.round(a) + (L.da[i] || 0), Math.round(b) + (L.db[i] || 0)];
}

// Precession of the orbit after c cycles, in fifth-steps. Pitch reads the integer part, so drift is
// quantized at cycle boundaries; the renderer interpolates the same value continuously.
export const precession = (L, c) => L.drift * c;

export function loopCount(L) {
  return L.mode === 'face' ? 1 : Math.min(4, components(L.p, L.q).g);
}

// ---------- rhythm generators ----------

// Places k hits as evenly as n steps allow; (i·k) mod n < k puts a hit on step 0.
export function euclid(k, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push((i * k) % n < k ? 1 : 0);
  return out;
}

// The rhythm a (p, q) knot draws: one train of hits where it crosses the meridian (p per cycle) and
// one where it crosses the longitude (q per cycle). Coincidences are accented.
export function knotRhythm(p, q, n) {
  const P = p ? euclid(p, n) : [];
  const Q = q ? euclid(q, n) : [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = P[i] || 0, y = Q[i] || 0;
    out.push(x && y ? 1 : x ? 0.78 : y ? 0.58 : 0);
  }
  return out;
}
