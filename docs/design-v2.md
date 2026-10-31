# Geometric Jelly v2 — design spec

Status: design settled, not yet implemented. This document is the brief for the v2 build.
v0.1 (the flat 16-step polygon sequencer) is on `main` at `79c0adb` and should be treated as a
throwaway prototype, not a base to extend.

Decisions taken: **12-TET**. **Periodic orbits with controllable drift**, not free physics.
**One excitation into a tuned resonator**, which spans dry drum kit through struck bell on a single
control. Polyrhythm is the headline feature, not a mode.

---

## 1. The core claim

The instrument is one object seen two ways.

The harmonic surface is the **Tonnetz torus**. Take the 12 pitch classes, join each to its fifth and
to its major third, and in 12-TET the lattice closes on itself into a torus. Verified census:

| | count | content |
|---|---|---|
| vertices | 12 | the 12 pitch classes |
| edges | 36 | 12 perfect fifths, 12 major thirds, 12 minor thirds |
| faces | 24 | all 12 major and all 12 minor triads, each exactly once |

Euler characteristic 12 − 36 + 24 = 0, which is the torus.

Two facts do the work:

1. **Every face is a triad and every edge is a consonance.** There are no semitone edges and no
   tritone edges anywhere on the surface. A path that moves along edges cannot produce a dissonant
   step. Consonance is geometry here, not a rule applied afterwards.
2. **The two cycles of the torus are the circle of fifths and the major-third cycle** — the two moves
   in Coltrane's circle. The hand-drawn circle and the Tonnetz are the same object; one is the other's
   boundary walk.

A closed orbit on a torus is a **(p, q) torus knot**: p turns around the fifth-axis, q around the
third-axis, then it closes. So an orbit is specified by two integers, it is guaranteed periodic, and
**p against q is the polyrhythm**. When gcd(p, q) = 1 the orbit is a single knot; when gcd(p, q) = g
it is a link of g separate loops, which is g independent voices arising from the topology.

Unrolled flat, the torus is a 12 × 3 grid, and the fifth-axis unrolls into the ring of v0.1. That is
the drum-machine view. Same data, same state, two renderings.

## 2. What must not be lost

Marz is a drummer. The drum machine has to be genuinely solid before any of the above earns its place:

- Loops must be sample-exact. All timing comes off `AudioContext.currentTime` via a lookahead
  scheduler; never a timer firing notes.
- Polyrhythm is the front-page feature. Per-layer cycle length and the (p, q) pair are primary
  controls, not buried. Show the realignment countdown (the LCM) so the drift is legible.
- Preset rhythms ship with it: 4-on-the-floor, son and rumba clave (3-2 and 2-3), bossa, songo,
  jazz swing ride, shuffle, half-time shuffle, Afro 6/8 bell, tresillo, and polyrhythm study presets
  (3:2, 3:4, 5:4, 7:8).
- Swing, humanize, flams, ratchets/rolls and per-step probability. These are drummer controls and
  their absence is felt immediately.

If the geometry ever fights the groove, the groove wins.

## 3. Rhythm model

**Angle is time.** A layer's playhead advances at constant angular velocity around its cycle; one lap
is that layer's bar. A step fires when the playhead crosses an active node. This keeps timing exact
for any pattern, even and uneven alike, which a constant-linear-speed bouncing ball cannot do — a
clave is 3-3-4-2-4, not five evenly spaced hits, so true billiard physics can never express one.

The asteroid is therefore **constructed, not simulated**. It travels the path between consecutive
active nodes and the "bounce" is the deflection at each strike. For evenly spaced patterns the path
is exactly the star polygon {n/p} that Lull already draws; for a clave it is an irregular polygon.
Both close.

Each layer has:

- `len` — cycle length in steps (2–32). Different lengths across layers is the polyrhythm.
- `(p, q)` — winding numbers, which place the layer's nodes on the torus and so decide its pitches.
- `vel[]` — per-step velocity, 0 meaning off.
- `prob[]` — per-step probability, seeded so a pattern is reproducible.
- `drift` — 0 means locked and exactly periodic; above 0 the orbit precesses by a controlled amount
  per cycle, so the pattern wanders and re-locks. This is the "with drift" answer; it must default
  to 0 so that the machine is tight unless asked otherwise.

## 4. Pitch model

A strike lands on a torus vertex and that vertex's pitch class tunes the resonator for that hit.
Octave comes from the layer's register setting. Because edges are consonant, a layer sweeping along
its knot produces a consonant line by construction.

Face-locking: snapping an orbit to circulate one face gives a three-note arpeggio of that triad.
Walking to an adjacent face is a Neo-Riemannian P, L or R move — exactly the transformations labelled
in the reference image — so chord progressions become orbit edits.

## 5. Voice model — excitation into resonator

One structure covers Marz's "between all three" answer. Per strike:

```
excitation  ->  resonator bank  ->  per-layer FX  ->  bus FX  ->  out
```

- **Excitation**: a short noise or impulse burst with a shaped envelope. Character control selects
  skin / stick / glass / bell / mallet (Lull's `TONES` partial tables are the starting point).
- **Resonator bank**: parallel bandpass or comb resonators tuned to the struck pitch class and its
  partials. A single **Body** control from 0 to 1 moves the voice from dry kit (resonator barely
  present, reads as kick/snare/hat) through tuned percussion to struck bell (resonator dominant,
  long ring). This is one knob, not three modes.
- Kick, snare, hat and perc remain as named layers with sensible defaults at low Body, so the thing
  opens as a drum machine.

### Modulation to carry over from Lull v2

Per layer: tape-style speed/pitch, brightness (low-pass, `warmthHz`), ring/decay, register,
pan, velocity, probability, seeded variation with drops over up to 4 cycles, ping-pong echo,
reverb send.

Phasing deserves its own mention: Lull runs 1–4 copies of a voice that drift apart, Reich-style.
Applied to a drum layer this is *Drumming*, and for a drummer interested in polyrhythm it is the
single most valuable import from the old app.

Bus: shared convolution reverb from a generated impulse (`makeIRData`), ping-pong delay with
tempo-sync, and a just-intonation drone bed whose partials swell at rates taken from the active
polyrhythm (`fieldRates`) — the meditative floor under the kit.

Worth adding beyond Lull: sample-rate and bit reduction, a tempo-synced filter sweep, transient
shaping (attack/sustain), choke groups, and a resonator feedback control that lets the shell ring
into itself.

## 6. Interaction

Corrections to v0.1 behaviour, as specified:

- **Clicking the 3D object or the rings never changes the selected layer.** Only the layer buttons
  below do that. Pointer interaction with the shape only ever edits nodes within the already-selected
  layer.
- **Nodes are draggable and snap.** Dragging a node tangentially moves it to a different step, snapping
  to the grid. Dragging radially sets velocity. Dragging a node onto an adjacent torus vertex changes
  its pitch. Dragging it off the ring deletes it.
- The 3D view is rotatable (orbit controls, inertia, no roll). A flatten control morphs continuously
  between the torus and the unrolled ring view so the two readings are visibly the same object.
- Full-screen visual mode with the controls hidden, wake lock held.

## 7. Implementation notes

Stay vanilla and buildless if possible, as both parent apps are; three.js from a pinned CDN build is
the one justified dependency for the torus. Keep the four layers separated as in v0.1:

1. sequencer state, 2. audio engine, 3. geometry renderer, 4. transport.

Everything the renderer draws reads `AudioContext.currentTime` so the visual can never drift from the
audio. Audio must never wait on the renderer.

Reuse directly from `Lull-v2`: `cleanUp()`, `makeIRData()`, `makeNoiseData()`, `mulberry32()`,
`warmthHz()`, the `TONES` partial tables, `fieldRates()`, and the IndexedDB store in `store.js` for
recordings. Reuse from `Harmonia`: the lookahead `tick()` shape and the hue-from-wheel-position idea.
Do not reuse Lull's `renderPulse`/`addNote` looped-buffer rhythm path; it cannot be edited while
playing.

## 8. Open questions for the build

- Does the torus stay readable on a phone, or is 3D desktop-only with rings on mobile?
- Thirty-six edges drawn at once may be visual noise; probably only the active knot and its
  neighbouring faces should be lit.
- Resonator count per strike versus polyphony cost on an iPhone — needs a voice cap and stealing.
- Whether `drift` precesses the orbit continuously or in quantized steps at cycle boundaries.
