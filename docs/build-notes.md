# Geometric Jelly: build notes

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
