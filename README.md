# Geometric Jelly

A circular drum machine where the rhythm *is* a polygon. Sixteen seats around a ring; the steps you switch on become the vertices of a shape, and that shape is the thing you edit — rotate it, mirror it, pull a vertex in or out, morph it into another shape. Four rings play at once, and each can have its own length, so they drift in and out of phase while you watch.

No build step, no audio files, no dependencies. Open `index.html` in a browser, or run `python3 -m http.server`.

## Playing it

- **Tap a node** to turn a step on or off. **Drag it in or out** to set its velocity.
- **Rings** are the four coloured chips below the circle. Tap one to select it; tap the selected one again (or shift-click any) to mute it.
- Each ring carries its own playhead dot. Set two rings to different lengths and the dots separate — that is the polyrhythm, visible.
- Keys: `Space` play · `1`–`4` select a ring · `M` mute · `[` `]` rotate · `V` visual mode · `Esc` exit.

## Geometry as the editing language

| Control | What it does to the shape | What you hear |
|---|---|---|
| Rotate | turns the polygon one seat | phase shift, displaced groove |
| Mirror | reflects it | retrograde rhythm |
| Contract / Expand | pulls vertices toward or away from the ring | quieter or harder hits |
| Simplify | drops the weakest vertex | rhythm reduction |
| Euclid | places *k* hits as evenly as *n* seats allow | tresillo, cinquillo, bembé |
| Scene morph | interpolates every ring between two held states | hits fade in and out rather than switching at the halfway point |

The Euclidean generator uses `(i · k) mod n < k`, which guarantees a hit on step 0 — so E(3,8) comes out as the tresillo `10010010` rather than one of its rotations.

### The radius conflict, and how it is resolved

The original brief wanted radius to mean velocity *and* concentric rings to mean instruments. Those collide. Here each ring owns a base radius, and velocity moves a node within a narrow band around it. You keep both readings, and dragging radially still feels like what it does.

## Sound

Every voice is synthesised in the Web Audio API at play time:

- **Kick** — sine, 148 Hz dropping to 47 Hz over 85 ms, plus a short triangle click.
- **Snare** — band-passed noise at 1.75 kHz over two detuned triangles.
- **Hat** — noise through a 7.2 kHz high-pass, decay shortening with velocity.
- **Perc** — triangle falling 430→306 Hz with a band-passed noise transient.
- **Space** — a convolution reverb whose impulse response is generated from seeded noise on startup.

Any ring's drum voice can be replaced by a recording or an imported file. Imported audio is trimmed, de-DC'd and normalised before it is used, then capped at 2.5 s.

## Microphone

`Record voice` uses `getUserMedia` and works when this page is served from its own origin — GitHub Pages, Netlify, a local server, or added to an iPhone home screen. Published Claude artifacts are refused microphone access, so there the button reports that and you should use `Import audio` instead.

## Hosting on GitHub Pages

Push, then **Settings → Pages → Deploy from a branch**, `main` / `(root)`. `.nojekyll` is already in place. `index.html` must stay at the root.

## Where it came from

Two parents, both single-page vanilla-JS web audio apps:

- [**Lull v2**](https://github.com/Onyxuz666/Lull-v2) — the offline PCM path (`cleanUp`: trim, de-DC, normalise, fade), the generated reverb impulse, the seeded `mulberry32` RNG, and the pattern of keeping every sound synthesised so nothing has to ship as a file.
- [**Harmonia**](https://github.com/ahhh/Harmonia) — the lookahead scheduler (a 25 ms interval that schedules onto the audio clock, never a timer firing notes), and the circular canvas renderer: nodes around a ring, polygons drawn through them, hue assigned by position on the wheel.

What did **not** transfer: Lull's rhythm layer pre-renders a whole cycle into a looping buffer, which is excellent for an ambient drone and wrong for a sequencer you edit while it plays. That part was rebuilt around Harmonia's scheduler instead.

## Status

v0.1 — the minimum playable instrument. Not yet built: two-deck DJ mode, live voice slicing around the circle, MIDI output, REAPER sync, and a sampler with per-step sample selection.

## Licence

Not set yet. Lull v2 and Harmonia both ship without a licence file, which means neither is open source by default — worth settling with the Harmonia author before this goes anywhere public.
