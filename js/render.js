// Layer 3 of 4: geometry renderer. Reads state and the audio clock; writes nothing to audio.
//
// Every position on screen is a blend of two readings of the same data:
//   torus — step i of a layer sits on its (p, q) knot at cycle fraction i/len;
//   ring  — step i sits on the layer's lane at angle 2π·i/len, the drum-machine view.
// The flatten control blends between them. Angle 0 is twelve o'clock in both, and a (1, 0) orbit
// on the torus lands exactly on its ring: the fifth-axis is what unrolls.
// Playheads and flashes are computed from ctx.currentTime every frame, so the picture cannot drift
// from the sound.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { A, B, NAMES, STEPS, mod, pcAt, hueOf, edges, faces, orbitAt, faceVerts, faceAt, loopCount, stepVertex } from './tonnetz.js';
import { MAX_STEPS } from './state.js';

const R = 3, r = 1.25;
const TAU = Math.PI * 2;
export const LAYER_HUES = [14, 151, 289, 66, 204];
const laneR = (li) => 1.55 + li * 0.62;
const ease = (x) => x * x * (3 - 2 * x);
const CURVE_PTS = 240;
const HOME = [0, 8.4, 10.6];

function torusXYZ(a, b, lift = 0) {
  const th = (TAU * a) / A, ph = (TAU * b) / B;
  const rho = R + (r + lift) * Math.cos(ph);
  return [rho * Math.sin(th), (r + lift) * Math.sin(ph), -rho * Math.cos(th)];
}
function torusNormal(a, b) {
  const th = (TAU * a) / A, ph = (TAU * b) / B;
  return [Math.cos(ph) * Math.sin(th), Math.sin(ph), -Math.cos(ph) * Math.cos(th)];
}
function ringXYZ(li, u) {
  const p = laneR(li);
  return [p * Math.sin(TAU * u), 0, -p * Math.cos(TAU * u)];
}
const mix = (x, y, e) => [x[0] + (y[0] - x[0]) * e, x[1] + (y[1] - x[1]) * e, x[2] + (y[2] - x[2]) * e];

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function labelTexture(text) {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = '500 34px "IBM Plex Mono", Menlo, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.fillText(text, 48, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const hsl = (h, s, l) => new THREE.Color().setHSL(h / 360, s, l);

export class Renderer {
  constructor(host, S, transport, engine, onEdit) {
    this.host = host;
    this.S = S;
    this.T = transport;
    this.E = engine;
    this.onEdit = onEdit;
    this.flash = new Float32Array(A * B);
    this.nodeFlash = S.layers.map(() => new Float32Array(MAX_STEPS * 4));
    this.hits = [];
    this.sig = S.layers.map(() => '');
    this.stepPos = S.layers.map(() => []);
    this.stepNorm = S.layers.map(() => []);
    this.drag = null;
    this.lastT = performance.now();

    const gl = (this.gl = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    gl.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    host.appendChild(gl.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(...HOME);
    this.controls = new OrbitControls(this.camera, gl.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, minDistance: 5, maxDistance: 24, rotateSpeed: 0.7 });
    this.glow = glowTexture();
    this.build();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    this.bindPointer();
    if (S.flatten > 0.5) this.camera.position.set(0, this.topDistance(), 0.001);
    gl.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.res = new THREE.Vector2(w, h);
    for (const m of this.lineMats) m.resolution.copy(this.res);
  }

  topDistance() {
    const half = laneR(this.S.layers.length - 1) + 0.6;
    return half / Math.tan((this.camera.fov * Math.PI) / 360) / Math.min(1, this.camera.aspect || 1);
  }

  sprite(color, size, opacity = 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
    s.scale.setScalar(size);
    this.scene.add(s);
    return s;
  }

  line(color, width, opacity) {
    // Normal blending: additive doubles up at Line2's segment joints and beads the curve.
    const mat = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthWrite: false });
    this.lineMats.push(mat);
    const geo = new LineGeometry();
    geo.setPositions([0, 0, 0, 0, 0, 0]);
    const l = new Line2(geo, mat);
    l.frustumCulled = false;
    this.scene.add(l);
    return l;
  }

  build() {
    const S = this.S, scene = this.scene;
    this.lineMats = [];

    // ---- lattice: 36 vertices, 108 edges drawn as curves on the surface, 72 faces ----
    this.lattice = new THREE.Group();
    scene.add(this.lattice);
    this.vtx = [];
    for (let a = 0; a < A; a++)
      for (let b = 0; b < B; b++) {
        const pc = pcAt(a, b);
        const col = hsl(hueOf(pc), 0.7, 0.62);
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true }));
        dot.position.set(...torusXYZ(a, b));
        this.lattice.add(dot);
        const g = this.sprite(col, 0.9, 0);
        g.position.copy(dot.position);
        const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.labelTex(pc), color: col, transparent: true, depthWrite: false, opacity: 0.75 }));
        lab.position.set(...torusXYZ(a, b, 0.3));
        lab.scale.set(0.42, 0.28, 1);
        this.lattice.add(lab);
        this.vtx.push({ a, b, pc, dot, glow: g, lab, col });
      }

    const E = edges(), SEG = 10;
    const ep = new Float32Array(E.length * SEG * 6);
    this.edgeCol = new Float32Array(E.length * SEG * 6);
    this.edgeEnds = E.map(([a, b, c, d]) => [mod(a, A) * B + mod(b, B), mod(c, A) * B + mod(d, B)]);
    E.forEach(([a, b, c, d], e) => {
      for (let s = 0; s < SEG; s++) {
        const p0 = torusXYZ(a + ((c - a) * s) / SEG, b + ((d - b) * s) / SEG);
        const p1 = torusXYZ(a + ((c - a) * (s + 1)) / SEG, b + ((d - b) * (s + 1)) / SEG);
        ep.set([...p0, ...p1], (e * SEG + s) * 6);
      }
    });
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    eg.setAttribute('color', new THREE.BufferAttribute(this.edgeCol, 3));
    this.edgeMesh = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.edgeSeg = SEG;
    this.lattice.add(this.edgeMesh);

    const F = (this.faces = faces()), SUB = 3;
    const tri = [];
    for (const f of F) {
      const [[a0, b0], [a1, b1], [a2, b2]] = f.v;
      const P = (u, v) => torusXYZ(a0 + (a1 - a0) * u + (a2 - a0) * v, b0 + (b1 - b0) * u + (b2 - b0) * v, -0.01);
      for (let i = 0; i < SUB; i++)
        for (let j = 0; j < SUB - i; j++) {
          tri.push(...P(i / SUB, j / SUB), ...P((i + 1) / SUB, j / SUB), ...P(i / SUB, (j + 1) / SUB));
          if (j < SUB - i - 1) tri.push(...P((i + 1) / SUB, j / SUB), ...P((i + 1) / SUB, (j + 1) / SUB), ...P(i / SUB, (j + 1) / SUB));
        }
    }
    this.faceTris = tri.length / 9 / F.length;
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tri), 3));
    this.faceCol = new Float32Array(tri.length);
    fg.setAttribute('color', new THREE.BufferAttribute(this.faceCol, 3));
    this.faceMesh = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.lattice.add(this.faceMesh);
    this.faceKey = new Map(F.map((f, i) => [f.root + (f.minor ? 'm' : 'M'), i]));

    // ---- layers ----
    const sphere = new THREE.SphereGeometry(0.12, 14, 10);
    this.layers = S.layers.map((L, li) => {
      const hue = LAYER_HUES[li];
      const col = hsl(hue, 0.75, 0.6);
      const nodes = new THREE.InstancedMesh(sphere, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_STEPS * 4);
      nodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      nodes.setColorAt(0, col);
      nodes.frustumCulled = false;
      scene.add(nodes);
      const curves = [0, 1, 2, 3].map(() => this.line(col, 2, 0.4));
      const poly = this.line(col, 1.2, 0.35);
      const lane = this.line(col, 1, 0);
      const heads = [0, 1, 2, 3].map(() => {
        const h = this.sprite(hsl(hue, 0.9, 0.75), 0.75);
        const trail = Array.from({ length: 9 }, (_, j) => this.sprite(col, 0.5 - j * 0.04, 0.5 - j * 0.05));
        return { h, trail };
      });
      return { hue, col, nodes, curves, poly, lane, heads };
    });
    const dummy = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    dummy.visible = false;
    this.marker = dummy;
    scene.add(dummy);
    this.tmpM = new THREE.Matrix4();
    this.tmpC = new THREE.Color();
  }

  labelTex(pc) {
    this._labels = this._labels || [];
    return (this._labels[pc] = this._labels[pc] || labelTexture(NAMES[pc]));
  }

  addHit(h) {
    this.hits.push(h);
  }

  setFlatten(v) {
    const was = this.S.flatten > 0.5;
    this.S.flatten = v;
    if (was !== v > 0.5) {
      const to = v > 0.5 ? new THREE.Vector3(0, this.topDistance(), 0.001) : new THREE.Vector3(...HOME);
      this.camTween = { from: this.camera.position.clone(), to, t0: performance.now() };
    }
  }

  // ---------- geometry of a layer at its current cycle ----------

  // Cycle and continuous cycle position of copy 0 of a layer now.
  layerTime(li, k = 0) {
    const m = this.T.now16();
    const pos = this.T.pos(li, k, m);
    return { pos, c: Math.floor(pos), u: pos - Math.floor(pos) };
  }

  // Lattice coordinates (continuous) for step i, loop k: the knot point, nudged.
  stepAB(L, i, k, c, prec) {
    if (L.mode === 'face') {
      const v = faceVerts(faceAt(L.face, L.walk, c))[i % 3];
      return [v[0] + L.da[i], v[1] + L.db[i]];
    }
    const [a, b] = orbitAt(L, i / L.len, k, prec);
    return [a + L.da[i], b + L.db[i]];
  }

  frame() {
    const S = this.S, now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    const e = ease(Math.min(1, Math.max(0, S.flatten)));
    this.controls.enableRotate = e < 0.98;
    if (this.camTween) {
      const k = Math.min(1, (now - this.camTween.t0) / 700);
      this.camera.position.lerpVectors(this.camTween.from, this.camTween.to, ease(k));
      if (k >= 1) this.camTween = null;
    }
    this.controls.update();

    // Consume strikes whose time has come.
    const ctx = this.E.ctx, at = ctx ? ctx.currentTime : 0;
    const decay = Math.exp(-dt / 0.2);
    for (let i = 0; i < this.flash.length; i++) this.flash[i] *= decay;
    this.nodeFlash.forEach((f) => f.forEach((_, i) => (f[i] *= decay)));
    if (!this.T.playing) this.hits.length = 0;
    this.hits.sort((x, y) => x.t - y.t);
    while (this.hits.length && this.hits[0].t <= at) {
      const h = this.hits.shift();
      h.verts.forEach(([a, b], k) => {
        this.flash[mod(a, A) * B + mod(b, B)] = Math.max(this.flash[mod(a, A) * B + mod(b, B)], h.vel);
        this.nodeFlash[h.li][k * MAX_STEPS + h.i] = 1;
      });
    }

    // ---- lattice ----
    const lat = 1 - e;
    this.lattice.visible = lat > 0.01;
    const selVerts = new Set();
    const Ls = S.layers[S.sel];
    if (Ls) {
      const { c } = this.layerTime(S.sel);
      for (let i = 0; i < Ls.len; i++)
        if (Ls.vel[i] > 0) {
          const [a, b] = stepVertex(Ls, i, 0, c);
          selVerts.add(mod(a, A) * B + mod(b, B));
        }
    }
    this.vtx.forEach((v, idx) => {
      const f = this.flash[idx];
      v.dot.material.opacity = lat * (0.45 + 0.55 * Math.min(1, f + (selVerts.has(idx) ? 0.4 : 0)));
      v.dot.scale.setScalar(1 + f * 0.8);
      v.glow.material.opacity = lat * f * 0.9;
      v.glow.scale.setScalar(0.5 + f * 0.9);
      v.glow.visible = lat > 0.01;
      v.lab.material.opacity = lat * (selVerts.has(idx) || f > 0.2 ? 0.95 : 0.22);
    });
    const SEG = this.edgeSeg;
    this.edgeEnds.forEach(([p, q], ei) => {
      const lit = Math.max(this.flash[p], this.flash[q]);
      const near = selVerts.has(p) && selVerts.has(q) ? 0.3 : selVerts.has(p) || selVerts.has(q) ? 0.1 : 0;
      const k = lat * (0.035 + near + 0.55 * lit);
      const cp = this.vtx[p].col, cq = this.vtx[q].col;
      for (let s = 0; s < SEG; s++) {
        const o = (ei * SEG + s) * 6, u0 = s / SEG, u1 = (s + 1) / SEG;
        this.edgeCol[o] = k * (cp.r + (cq.r - cp.r) * u0);
        this.edgeCol[o + 1] = k * (cp.g + (cq.g - cp.g) * u0);
        this.edgeCol[o + 2] = k * (cp.b + (cq.b - cp.b) * u0);
        this.edgeCol[o + 3] = k * (cp.r + (cq.r - cp.r) * u1);
        this.edgeCol[o + 4] = k * (cp.g + (cq.g - cp.g) * u1);
        this.edgeCol[o + 5] = k * (cp.b + (cq.b - cp.b) * u1);
      }
    });
    this.edgeMesh.geometry.attributes.color.needsUpdate = true;
    // Faces: a triad lights when all three of its vertices are sounding, or when a layer is locked to it.
    const locked = new Map();
    S.layers.forEach((L, li) => {
      if (L.mode !== 'face') return;
      const f = faceAt(L.face, L.walk, this.layerTime(li).c);
      locked.set(this.faceKey.get(f.root + (f.minor ? 'm' : 'M')), this.layers[li].col);
    });
    const per = this.faceTris * 9;
    this.faces.forEach((f, fi) => {
      const ids = f.v.map(([a, b]) => mod(a, A) * B + mod(b, B));
      const chord = Math.min(...ids.map((i) => this.flash[i]));
      const lc = locked.get(fi);
      const col = lc || this.vtx[ids[0]].col;
      const k = lat * ((lc ? 0.12 : 0) + chord * 0.45);
      for (let j = 0; j < per; j += 3) {
        this.faceCol[fi * per + j] = col.r * k;
        this.faceCol[fi * per + j + 1] = col.g * k;
        this.faceCol[fi * per + j + 2] = col.b * k;
      }
    });
    this.faceMesh.geometry.attributes.color.needsUpdate = true;

    // ---- layers ----
    S.layers.forEach((L, li) => this.drawLayer(L, li, e));
    this.drawDrag();
    this.gl.render(this.scene, this.camera);
  }

  drawLayer(L, li, e) {
    const V = this.layers[li], S = this.S;
    const sel = S.sel === li;
    const on = this.E.ctx ? this.E.audible(li) : !L.mute;
    const { pos, c } = this.layerTime(li);
    const prec = L.drift * pos;
    const loops = loopCount(L);
    const dim = on ? 1 : 0.25;

    // Curves and lane only rebuild when something that shapes them changed.
    const sig = [e.toFixed(3), L.mode, L.p, L.q, L.root, L.len, prec.toFixed(3), L.face.root, L.face.minor, L.walk, c * (L.mode === 'face' && L.walk ? 1 : 0), L.vel.join(), L.da.join(), L.db.join()].join('|');
    const rebuild = sig !== this.sig[li];
    this.sig[li] = sig;

    if (rebuild) {
      V.curves.forEach((ln, k) => {
        ln.visible = k < loops;
        if (k >= loops) return;
        const pts = [];
        if (L.mode === 'face') {
          const fv = faceVerts(faceAt(L.face, L.walk, c));
          for (let j = 0; j <= CURVE_PTS; j++) {
            const u = j / CURVE_PTS, seg = Math.min(2, Math.floor(u * 3)), w = u * 3 - seg;
            const p0 = fv[seg], p1 = fv[(seg + 1) % 3];
            pts.push(...mix(torusXYZ(p0[0] + (p1[0] - p0[0]) * w, p0[1] + (p1[1] - p0[1]) * w, 0.02), ringXYZ(li, u), e));
          }
        } else {
          for (let j = 0; j <= CURVE_PTS; j++) {
            const u = j / CURVE_PTS;
            const [a, b] = orbitAt(L, u, k, prec);
            pts.push(...mix(torusXYZ(a, b, 0.02), ringXYZ(li, u), e));
          }
        }
        ln.geometry.setPositions(pts);
      });
      const lane = [];
      for (let j = 0; j <= 96; j++) lane.push(...ringXYZ(li, j / 96));
      V.lane.geometry.setPositions(lane);

      // Step positions (loop 0) for the playhead path, editing and the polygon.
      const P = [], N = [];
      for (let i = 0; i < L.len; i++) {
        const [a, b] = this.stepAB(L, i, 0, c, prec);
        P.push(new THREE.Vector3(...mix(torusXYZ(a, b, 0.02), ringXYZ(li, i / L.len), e)));
        const n = torusNormal(a, b), rad = ringXYZ(li, i / L.len).map((x) => x / laneR(li));
        N.push(new THREE.Vector3(...mix(n, rad, e)).normalize());
      }
      this.stepPos[li] = P;
      this.stepNorm[li] = N;
      const act = P.filter((_, i) => L.vel[i] > 0);
      if (act.length > 1) {
        V.poly.geometry.setPositions([...act, act[0]].flatMap((p) => [p.x, p.y, p.z]));
        V.poly.visible = true;
      } else V.poly.visible = false;
    }
    const empty = !L.vel.slice(0, L.len).some((v) => v > 0);
    V.curves.forEach((ln) => (ln.material.opacity = empty && !sel ? 0 : dim * (sel ? 0.85 : 0.3) * (L.mode === 'face' ? 0.8 : 1 - 0.55 * e)));
    V.curves.forEach((ln) => (ln.material.linewidth = sel ? 2.6 : 1.4));
    V.lane.material.opacity = e * dim * (sel ? 0.35 : 0.14);
    V.poly.material.opacity = dim * (sel ? 0.55 : 0.28) * (0.5 + 0.5 * e);

    // Nodes: every on-step of every loop; the selected layer also shows its empty seats.
    let n = 0;
    const M = this.tmpM, C = this.tmpC;
    for (let k = 0; k < loops; k++)
      for (let i = 0; i < L.len; i++) {
        const v = L.vel[i];
        if (!v && !(sel && k === 0)) continue;
        const [a, b] = this.stepAB(L, i, k, c, prec);
        const p = k === 0 && this.stepPos[li][i] ? this.stepPos[li][i] : new THREE.Vector3(...mix(torusXYZ(a, b, 0.02), ringXYZ(li, i / L.len), e));
        const f = this.nodeFlash[li][k * MAX_STEPS + i];
        let s = v ? 0.55 + 0.85 * v + 0.7 * f : 0.32;
        if (this.drag && this.drag.li === li && this.drag.cur === i && this.drag.del) s *= 1.3;
        M.makeScale(s, s, s).setPosition(p);
        V.nodes.setMatrixAt(n, M);
        if (!v) C.setHSL(V.hue / 360, 0.15, 0.32 * dim);
        else if (this.drag && this.drag.li === li && this.drag.cur === i && this.drag.del) C.setHSL(0, 0.9, 0.55);
        else C.setHSL(V.hue / 360, 0.8, Math.min(0.92, (0.3 + 0.32 * L.prob[i] + 0.35 * f) * (k ? 0.8 : 1)) * (0.4 + 0.6 * dim));
        V.nodes.setColorAt(n, C);
        n++;
      }
    V.nodes.count = n;
    V.nodes.instanceMatrix.needsUpdate = true;
    if (V.nodes.instanceColor) V.nodes.instanceColor.needsUpdate = true;

    // Playheads: the asteroid travels the polygon between consecutive active nodes, so it is
    // constructed rather than simulated; the deflection at each node is the strike.
    const act = [];
    for (let i = 0; i < L.len; i++) if (L.vel[i] > 0) act.push(i);
    V.heads.forEach((hd, k) => {
      const show = act.length > 0 && k < L.copies && on;
      hd.h.visible = show;
      hd.trail.forEach((t) => (t.visible = show));
      if (!show) return;
      const { u } = this.layerTime(li, k);
      const at = (uu) => this.pathPoint(li, act, mod(uu, 1) * L.len);
      hd.h.position.copy(at(u));
      hd.h.material.opacity = sel ? 1 : 0.7;
      hd.trail.forEach((t, j) => {
        t.position.copy(at(u - (j + 1) * 0.008));
        t.material.opacity = (sel ? 0.5 : 0.3) * (1 - j / hd.trail.length);
      });
    });
  }

  pathPoint(li, act, x) {
    const P = this.stepPos[li], n = P.length;
    if (act.length === 1) return P[act[0]].clone();
    let j = act.length - 1;
    for (let q = 0; q < act.length; q++) if (act[q] <= x) j = q;
    const a = act[j], b = act[(j + 1) % act.length];
    const span = mod(b - a, n) || n;
    const w = mod(x - a, n) / span;
    return P[a].clone().lerp(P[b], w);
  }

  // ---------- editing ----------

  screen(v) {
    const p = v.clone().project(this.camera);
    return [((p.x + 1) / 2) * this.res.x, ((1 - p.y) / 2) * this.res.y, p.z];
  }

  nearestStep(x, y, li) {
    let best = -1, bd = Infinity;
    (this.stepPos[li] || []).forEach((p, i) => {
      const [sx, sy, z] = this.screen(p);
      const d = Math.hypot(sx - x, sy - y);
      if (z < 1 && d < bd) [bd, best] = [d, i];
    });
    return [best, bd];
  }

  bindPointer() {
    const el = this.host;
    const local = (ev) => {
      const b = el.getBoundingClientRect();
      return [ev.clientX - b.left, ev.clientY - b.top];
    };
    el.addEventListener(
      'pointerdown',
      (ev) => {
        if (ev.button !== 0) return;
        const li = this.S.sel, L = this.S.layers[li];
        const [x, y] = local(ev);
        const [i, d] = this.nearestStep(x, y, li);
        if (i < 0 || d > (ev.pointerType === 'touch' ? 30 : 22)) return; // falls through to orbit
        ev.stopPropagation();
        ev.preventDefault();
        this.controls.enabled = false;
        el.setPointerCapture(ev.pointerId);
        this.drag = { li, start: [x, y], cur: i, on: L.vel[i] > 0, v0: L.vel[i], moved: false, del: false, pitch: null };
      },
      true,
    );
    el.addEventListener('pointermove', (ev) => {
      const D = this.drag;
      if (!D) return;
      const [x, y] = local(ev);
      if (!D.moved && Math.hypot(x - D.start[0], y - D.start[1]) > 6) D.moved = true;
      if (!D.moved || !D.on) return;
      this.dragTo(D, x, y);
    });
    const end = () => {
      const D = this.drag;
      if (!D) return;
      this.drag = null;
      this.controls.enabled = true;
      const L = this.S.layers[D.li];
      if (!D.moved) L.vel[D.cur] = D.on ? 0 : 0.8;
      else if (D.del) clearStep(L, D.cur);
      else if (D.pitch) {
        L.vel[D.cur] = D.v0; // the path to the vertex crossed the velocity zone; a re-pitch keeps velocity
        L.da[D.cur] += D.pitch[0];
        L.db[D.cur] += D.pitch[1];
      }
      this.marker.visible = false;
      this.onEdit(D.li);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // Tangential motion moves the node to the nearest seat; motion along the outward normal sets its
  // velocity; landing on a neighbouring torus vertex re-pitches it; pulling well off the ring deletes it.
  dragTo(D, x, y) {
    const L = this.S.layers[D.li];
    const [j, dj] = this.nearestStep(x, y, D.li);
    D.del = false;
    D.pitch = null;
    if (j >= 0 && j !== D.cur && dj < 26 && !L.vel[j]) {
      moveStep(L, D.cur, j);
      D.cur = j;
      this.onEdit(D.li, true);
    }
    const p = this.stepPos[D.li][D.cur], nrm = this.stepNorm[D.li][D.cur];
    const [sx, sy] = this.screen(p), [nx, ny] = this.screen(p.clone().addScaledVector(nrm, 0.5));
    const nl = Math.hypot(nx - sx, ny - sy) || 1;
    const [ux, uy] = [(nx - sx) / nl, (ny - sy) / nl];
    const along = (x - sx) * ux + (y - sy) * uy;
    const across = Math.abs((x - sx) * -uy + (y - sy) * ux);
    // Over a neighbouring vertex? (torus view only)
    if (this.S.flatten < 0.5) {
      const { c } = this.layerTime(D.li);
      const [ca, cb] = stepVertex(L, D.cur, 0, c);
      for (const v of this.vtx) {
        const [vx, vy, vz] = this.screen(v.dot.position);
        if (vz >= 1 || Math.hypot(vx - x, vy - y) > 16) continue;
        const da = wrap(v.a - mod(ca, A), A), db = wrap(v.b - mod(cb, B), B);
        if (STEPS.some(([sa, sb]) => sa === da && sb === db)) {
          D.pitch = [da, db];
          this.marker.position.copy(v.dot.position);
          this.marker.visible = true;
          return;
        }
      }
    }
    this.marker.visible = false;
    if (Math.hypot(x - sx, y - sy) > 95 && (across > 60 || Math.abs(along) > 95)) {
      D.del = true;
      return;
    }
    L.vel[D.cur] = Math.min(1, Math.max(0.06, D.v0 + along / 110));
    this.onEdit(D.li, true);
  }

  drawDrag() {
    if (this.marker.visible) this.marker.scale.setScalar(1.6 + 0.3 * Math.sin(performance.now() / 120));
  }
}

const wrap = (d, n) => {
  d = mod(d, n);
  return d > n / 2 ? d - n : d;
};

const STEP_KEYS = { vel: 0, prob: 1, flam: 0, rat: 1, da: 0, db: 0 };
export function clearStep(L, i) {
  for (const [k, v] of Object.entries(STEP_KEYS)) L[k][i] = v;
}
export function moveStep(L, i, j) {
  for (const k of Object.keys(STEP_KEYS)) L[k][j] = L[k][i];
  clearStep(L, i);
}
