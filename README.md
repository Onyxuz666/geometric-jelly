# Geometric Jelly

A drum machine on the Tonnetz torus. Join the 12 pitch classes by fifths and major thirds and the lattice closes into a torus whose every edge is a consonance and every face a major or minor triad. Each layer of the drum machine is a closed orbit on that surface — a (p, q) torus knot — and every strike tunes a resonator to the vertex it lands on. p against q is the polyrhythm.

Flatten the torus and it unrolls into a ring drum machine: same data, same state, two readings.

No build step, no audio files. Everything is synthesised in the Web Audio API. three.js (pinned, from jsDelivr) is the one dependency.

```bash
python3 -m http.server
```

Then open http://localhost:8000. It must be served, not opened as a file, because it uses ES modules.

## Playing it

- **Layers** are the five chips under the stage: Kick, Snare, Hat, Perc, Bell. Only these change the selected layer; touching the shape never does. `M` and `S` on each chip mute and solo.
- **On the shape** (selected layer only): tap a node to toggle it, tap an empty seat to add one. Drag a node along the orbit to move it (it snaps to steps), outward to set velocity, onto a neighbouring torus vertex to re-pitch it, or well off the ring to delete it. Drag empty space to rotate the view.
- **Torus ↔ Ring** slider morphs continuously between the two views. Phones open on the ring.
- **Visual** hides the controls, goes full screen and holds a wake lock.
- **Step strip** under the layer name edits velocity, probability, flams, ratchets (×1–×4), and shows each step's pitch.
- Keys: `Space` play · `1`–`5` layer · `M` mute · `S` solo · `[` `]` rotate · `F` flatten · `V` visual · `Esc` exit.

## Rhythm

A layer has `len` steps spread over a cycle of `span` sixteenths. 16 over 16 is an ordinary bar of 16ths; 7 over 7 against 16 over 16 is a polymeter; 3 over 16 against 2 over 16 is a 3:2 polyrhythm in one bar. The readout top-right counts down to the next point where every sounding layer starts its cycle together.

All timing comes off one master clock on `AudioContext.currentTime` with a 25 ms / 120 ms lookahead scheduler. Each layer's position is derived from that clock rather than accumulated, so nothing drifts and edits land on the grid immediately.

Drummer controls: swing (50% straight to 75%, on the off-16ths), humanize, per-step probability (seeded, so a pattern repeats exactly), flams, ratchets, seeded variation that drops and softens hits over a 4-cycle phrase, and choke groups.

**Phasing**: up to four copies of a layer, each running slightly slower than the last, drift apart and back together — Reich's *Drumming* on a drum layer.

**Knot rhythm** fills the layer with the hits a (p, q) knot makes crossing its meridian (p per cycle) and its longitude (q per cycle), accenting where they coincide. When gcd(p, q) > 1 the orbit is a link of several loops and each loop sounds its own pitch.

**Drift** precesses the orbit around the fifth-axis by a set fraction of a step each cycle: the rhythm stays locked, the pitches wander and come home. It defaults to 0.

**Face mode** locks a layer to one triangle — a three-note arpeggio of that triad. P, L and R move it to a neighbouring face (C → Cm, Em, Am). A walk such as `LR` applies one move per cycle, so a chord progression is an orbit edit.

### Presets

Four on the floor · son clave 3-2 and 2-3 · rumba clave 3-2 and 2-3 · bossa nova · songo · jazz swing ride · shuffle · half-time shuffle · Afro 6/8 bell · tresillo · polyrhythm 3:2, 3:4, 5:4, 7:8 · polymeter 16/7/5 · phase study · trefoil (3, 2) knot · PLR walk.

The Afro-Cuban and shuffle patterns are reasonable starting points written on a grid, not transcriptions; adjust to taste.

## Sound

Each strike is an **excitation into a resonator bank**:

- **Excitation** — the layer's synthesised drum (kick, snare, hat, perc), a short burst shaped by its *character* (skin, stick, glass, bell, mallet), or a recording.
- **Resonators** — band-pass filters tuned to the struck pitch class and the character's partials (membrane modes for skin, free-bar modes for stick, Lull's partial tables for glass, bell and mallet).
- **Body** moves one voice from dry kit (resonator barely there) through tuned percussion to struck bell (resonator dominant, long ring).

Per layer: ring, resonator feedback (the shell rings into itself), attack and sustain shaping, tape speed (pitch and time together), brightness, tempo-synced filter sweep, bit and sample-rate reduction, level, pan, echo and reverb sends.

Bus: convolution reverb from a generated impulse, tempo-synced ping-pong echo, and an optional just-intonation drone whose partials swell at rates taken from the active polyrhythm.

Voices are capped (20 on touch devices, 48 elsewhere); the oldest is released when the cap is reached.

## Recordings

**Record** (4 s, needs a page served from its own origin) or **Import** an audio file into the selected layer. It is trimmed, de-DC'd and normalised, then becomes that layer's excitation: dry at low Body, ringing the tuned resonators as Body rises. Recordings are kept in IndexedDB on the device and never uploaded. Share links carry the pattern, not the recordings.

## Tests

```bash
node tests/tonnetz.test.mjs
```

Checks the torus census (12 vertices, 36 edges, 24 faces, χ = 0, only fifths and thirds as edges), that every face is a triad, the PLR moves, that link loops are distinct, and the Euclid and knot rhythms.

## Hosting on GitHub Pages

**Settings → Pages → Deploy from a branch**, `main` / `(root)`. `.nojekyll` is in place.

## Where it came from

- [**Lull v2**](https://github.com/Onyxuz666/Lull-v2) — `cleanUp`, `makeIRData`, `makeNoiseData`, `mulberry32`, `warmthHz`, the `TONES` and `CHORDS` tables, `fieldRates`, `droneAmps` (in `js/lull.js`, changes marked), the IndexedDB store, the ping-pong echo topology and the phasing copies.
- [**Harmonia**](https://github.com/ahhh/Harmonia) — the lookahead scheduler shape and hue-from-wheel-position.

Not reused: Lull's `renderPulse` / `addNote` path, which renders a rhythm into a looping buffer and cannot be edited while playing.

The design is in [`docs/design-v2.md`](docs/design-v2.md); build decisions in [`docs/build-notes.md`](docs/build-notes.md).

## Licence

Not set yet. Lull v2 and Harmonia both ship without a licence file, so neither is open source by default — worth settling with the Harmonia author before this goes anywhere public.
