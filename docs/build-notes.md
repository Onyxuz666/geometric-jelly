# Geometric Jelly: build notes

## v2 (2026-10-31)

Built fresh from `design-v2.md`; v0.1's single `index.html` is gone (it is at `79c0adb` if needed).

### Layout

The spec's four layers are now four modules, meeting only in `js/main.js`:

| Layer | File | Notes |
|---|---|---|
| Sequencer state | `js/state.js` | Plain data, presets, localStorage autosave, share links |
| Audio engine | `js/audio.js` | Excitation → resonator bank → per-layer lane → bus |
| Geometry renderer | `js/render.js` | three.js; also owns pointer editing on the shape |
| Transport | `js/transport.js` | The only code that touches time |

Plus `js/tonnetz.js` (pure torus math, tested under Node), `js/lull.js` (functions lifted from Lull, changes marked), `js/store.js` (IndexedDB recordings) and `js/ui.js` (DOM controls).

### Decisions

- **Which torus is drawn.** The 12 × 3 lattice the spec names, so each pitch class appears three times (each row is a circle of fifths, a major third above the last). The spec's census — 12 / 36 / 24, χ = 0 — is for the glued 12-vertex quotient, and the test checks that. Drawing the cover keeps the two axes as two honest circles, which is what lets (p, q) mean "p turns of fifths, q turns of thirds".
- **Time.** One master clock in sixteenths. A layer is `len` steps over `span` sixteenths, and its position is computed from the master clock every tick, never accumulated. Polymeter (span = len) and polyrhythm (span fixed at a bar) are the same mechanism. The scheduler is stateless: each tick schedules every step whose time falls in `[until, now + 120 ms)`. Tempo changes re-anchor the clock at `until`, so nothing doubles or drops.
- **Swing** applies to odd sixteenths of the master grid only. Triplet and polyrhythmic steps fall off that grid and are left straight, which is musically right.
- **Ring view = drum machine, not unrolled pitch.** In the ring view a step sits at angle 2π·i/len on its layer's lane. On the torus it sits on the knot. For a (1, 0) orbit the two coincide exactly (the fifth-axis unrolls into the ring); for other knots the flatten slider is a continuous homotopy. When geometry and groove disagree, the groove wins.
- **Resonator gain.** A constant-peak band-pass driven by excitation x rings at about sin(ω)/Q · |X(ω)|. Each strike computes |X(ω)| directly (a phasor sum over at most 2048 samples) and sets the makeup gain so the fundamental is normalised and the other partials follow the excitation's own spectrum. A mallet comes out dark and glass bright without separate tuning, and loudness doesn't swing with pitch. Measured peaks across all characters, registers 2–7 and feedback up to 0.95 stay between about 0.08 and 0.65 before the bus compressor (a mallet is softest in the top octave, as a real one is).
- **Resonator feedback** loops the unity-gain band-pass outputs (before makeup) through a comb tuned to the fundamental with a tanh in the loop, so loop gain is the knob value and stays below 1.
- **Pointer editing.** A capture-phase listener on the stage claims the gesture if it starts within 22 px (30 px touch) of a seat of the selected layer; otherwise it falls through to OrbitControls. Tangential motion snaps to the nearest empty seat, motion along the projected surface normal sets velocity, hovering a lattice neighbour of the node's vertex re-pitches it (stored as `da`/`db` offsets), and pulling ~95 px away deletes.

### The §8 open questions, as answered here

1. **Phones**: the torus works on a phone but is small; phones open in the ring view, torus one slider away.
2. **Edge noise**: all 108 edges are drawn very faint. Edges around the selected layer's vertices brighten, edges at struck vertices flash, and a face only lights when all three of its notes sound or a layer is locked to it.
3. **Polyphony**: voice cap 20 on touch devices (3 partials per resonator), 48 elsewhere (5 partials); oldest voice released first. Not yet measured on a real iPhone.
4. **Drift**: continuous visually, quantized for pitch — the integer part of the precession picks the vertex, so pitches change only at cycle boundaries.

### Tested

Headless Chromium (software GL): loads with no console errors; plays; transport and realign readout run; tap, move, velocity, delete and re-pitch drags verified in both views; clicking the shape never changes the selected layer; resonator levels measured as above; 48-voice cap and stealing exercised. `node tests/tonnetz.test.mjs` passes.

### Not tested

Real audio on any device (levels were measured, not listened to), iPhone performance and battery, the microphone path in a real browser, Safari's handling of very high-Q biquads.

---

## v0.1

Built 2026-10-31 from the *Geometric Drum / DJ Workstation* brief v0.1, reusing parts of Lull v2 and Harmonia.

## Audit of the two parents

### Lull v2 (`Onyxuz666/Lull-v2`, a5dc728)

4,302 lines across `engine.js`, `app.js`, `bubble.js`, `store.js`, `sw.js`.

**Transferred:**
- `cleanUp()` from `store.js` — window-RMS silence trim at −36 dB below peak, DC removal, peak normalise to 0.89, 15 ms fades. A phone recording is unusable without this.
- `makeIRData()` — a decaying seeded-noise impulse response, so reverb needs no file.
- `mulberry32()` — seeded RNG, used here for the IR, the noise buffer and Scatter.
- The principle that every sound is synthesised, so the whole app is one file.
- The PWA/iOS knowledge in its build notes: `navigator.audioSession.type`, wake lock, no audio when a home-screen app leaves the screen.

**Not transferred, and why:** `engine.js`'s pulse layer renders a whole rhythmic cycle into a Float32 buffer and loops it (`renderPulse` → `addNote`), rebuilding and crossfading when a parameter changes. That is the right design for a drone that evolves slowly. It is the wrong design for a sequencer, where tapping a step must take effect on the next pass without re-rendering a buffer, and velocity and probability are per-hit. The drone, beats and noise layers are likewise ambient-specific.

One genuinely useful conceptual carry-over: `pulsePattern()` already returns hits as `{voice, step, time, velocity}`, which is the same shape a polygon's vertex list wants. And `bubble.js` already draws star polygons `{n/p}` from rhythm numbers — the brief's central idea has an ancestor in Lull's own visual.

### Harmonia (`ahhh/Harmonia`, c525889)

1,285 lines, one `index.html`, hosted at relax.lockboxx.org. Itself modelled on Lull.

**Transferred:**
- The scheduler shape: `setInterval(tick, 200)` with `LOOKAHEAD`, scheduling onto `ctx.currentTime` rather than firing notes from a JS timer. Tightened here to a 25 ms interval and a 140 ms horizon, which is what a 16th-note grid needs.
- `drawWheel()` — the circular canvas renderer. Nodes placed by `ang(pc)`, polygons drawn as gradient-stroked chords between them, past progressions kept as faint "ghost" figures. That structure maps almost one-to-one onto a step sequencer; only the meaning of a node changes, from pitch class to step.
- `hueOf(pc)` — hue from position on a wheel. Here the four rings take hues spaced by the golden angle (137.5°) instead of by fifths.
- The no-build, `.nojekyll`, GitHub Pages deployment.

## Architecture

Deliberately kept in the four layers the brief asked for, even in one file:

1. **Sequencer state** — `rings[]`, each `{len, vel[16], euc, mute, buffer}`. `vel[i] === 0` means the step is off; any positive value is both "on" and its velocity. One array, no parallel on/off mask to keep in sync.
2. **Audio engine** — `VOICES` (four synthesised drums) and `fire()`, which dispatches to a sample buffer when a ring has one.
3. **Geometry renderer** — `draw()` on a canvas, called from `requestAnimationFrame`, reading `ac.currentTime` for every playhead so the visual never drifts from the audio clock.
4. **Transport** — `scheduler()`, the only thing that touches time.

Rings advance independently: `step = globalSixteenth % ring.len`. A ring of 7 against a ring of 16 realigns every 112 sixteenths, and each ring's playhead dot runs at its own angular speed, which is what makes the polyrhythm legible.

Swing delays odd 16ths by `swing × 0.5 × stepDuration`.

## Decisions worth revisiting

- **Rings static, playheads rotating.** The alternative — one fixed playhead with rings turning underneath — is more literally correct ("angle = time") and looks better, but you cannot drag a moving node. Editing won.
- **Morph threshold at 0.09.** Interpolating velocity and sounding a step once it clears a floor gives hits that fade in, which is more musical than switching them on at t = 0.5. The number is a guess and should be played with.
- **Scene morph writes into the live pattern** rather than being a separate playback path. Simple, and it means an edit after morphing just works — but it destroys the in-between state when you move the slider again.
- **No probability or ratchets yet.** Node size is currently velocity, not probability; the brief wanted both, and the circle only has so many visual variables.

## Not yet tested

Real iPhone audio latency and battery, microphone permission UI, and whether four rings of different lengths stay readable on a phone-sized circle during an actual performance.
