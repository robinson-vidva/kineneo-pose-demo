# KineNeo Pose Demo

Browser-based live skeleton tracking and behavioral proof-of-concept. Runs entirely
on your device. Nothing is uploaded, recorded, or stored.

**Live demo:** https://robinson-vidva.github.io/kineneo-demo/

---

## Disclaimer

This is a **research proof-of-concept** for exploring what on-device pose and face
tracking can surface. It is **not a medical device**, is **not intended for diagnosis,
triage, or clinical decision-making**, and has not been validated against any
reference standard. The metrics shown are crude heuristics computed from landmark
coordinates, they are noisy, subject-dependent, and can be wrong.

Do not use outputs of this page as evidence for any health-related decision. If you
are concerned about a neurological or behavioral symptom, consult a qualified
clinician.

## What it does

A single HTML page that opens the camera and runs **MediaPipe Holistic** in real
time, with on-canvas overlays and a live metrics panel.

### Model

- **MediaPipe Holistic** - 1 person, 33 body + 21 + 21 hand + 468 face landmarks

### Canvas overlays

- Skeleton with soft glow (CSS-style `shadowBlur`)
- Joint-angle arcs at each tracked vertex with degree readout
- Faint dashed L-R connecting lines between symmetric landmark pairs (visual
  symmetry check)
- Glowing red center-of-mass marker (midpoint of shoulder + hip centers)
- Fading motion trails for nose, both wrists, both ankles (last 16 frames)
- Optional landmark name labels and joint-angle text badges
- **Skeleton Only** mode that hides the video and renders the skeleton on a near
  black canvas (great for screenshots / projection)

### Metrics panel

Each numeric metric has a tiny inline **sparkline** showing the last ~70 frames of
its value, color-matched to its current good / amber / red status.

**Detection** - status, person count, visible-vs-total landmark count, mean
confidence, model name.

**Joint angles (deg)** - left and right shoulder, elbow, hip, knee. Computed only
when the relevant landmarks have visibility >= 0.5.

**Behavior**
- Posture: standing / sitting / squatting / bending / lying when lower body is
  visible, otherwise upright / tilted from upper-body shoulders alone
- Arms: down / one raised / both raised (wrist y vs shoulder y)
- Stillness: still / moving (1s window of average landmark displacement)
- Head tilt: degrees, computed from ear-to-ear vector after sorting by image x
  so 0 deg = level

**Neuro Screen POC**
- Facial symmetry: mean min/max distance ratio across 3 L-R landmark pairs vs
  nose tip
- Blink rate (per minute): eye-aspect-ratio threshold detector, 30s rolling window
- Postural sway: std-dev of hip-center (or shoulder-center fallback) position,
  normalized by shoulder width, 5s window
- Motor symmetry: average of available L-R joint angle deltas (shoulder, elbow,
  hip, knee), 5s window
- Smile: corners-of-mouth height above outer-lip midpoint, normalized by mouth
  width
- Mouth: open / closed via inner-lip gap to mouth-width ratio
- Brow: neutral / raised / furrowed via brow-to-eye gap and inter-brow distance
- Head tremor: std-dev of nose position over a 1.5s window
- Tremor Hz: 128-point FFT over a 4s window of nose y-position with Hann window
  and detrend, dominant frequency reported in 0.5-15 Hz band. Color bands tuned
  to PD rest tremor (4-6 Hz, red) and essential / physiological tremor (8-12 Hz,
  amber)
- Hypomimia: per-coordinate std-dev of 24 mid-face landmarks over a 5s window;
  lower variance = less expressive face

### Controls

- Start Camera / Stop
- Switch Camera (front <-> back)
- Labels / Angles / Skeleton Only toggles
- Fullscreen toggle (uses Fullscreen API; webkit fallback for Safari)

## How it's built

No build step, no bundler, no frameworks. Plain HTML, CSS, and JavaScript, served
as static files by GitHub Pages. Third-party dependencies come from jsDelivr CDN
at runtime.

### File layout

```
index.html       HTML shell + CDN script tags + local script tags
styles.css       All styles (dark theme, panel, sparklines, controls)
js/helpers.js    Shared state, drawing utilities, landmark/model constants
js/spark.js     Auto-injected inline sparkline canvases
js/neuro.js      Behavior + Neuro Screen metric calculations
js/models.js     MediaPipe Holistic model + canvas overlays
js/app.js        DOM bindings, rAF loop, camera lifecycle, event listeners
```

All files attach to a shared `window.KN` namespace so they can see each other
without a module loader. Script order in `index.html` matters: helpers first,
then spark, then neuro, then models, then app.

### Runtime architecture

```
           camera getUserMedia
                   |
         hidden <video> element
                   |
    requestAnimationFrame loop (app.js)
                   |
     KN.model.run(video, canvas, ctx)
                   |
            MediaPipe Holistic
                   |
    { tracking, jointAngles, ... }
                   |
 updateMetrics + neuro.updateBehavior + neuro.updateFace
                   |
 DOM panel + sparkline buffers + canvas overlays
```

The model object exposes `init()`, `run(video, canvas, ctx)`, and `destroy()`.
The MediaPipe Holistic push-based `onResults` callback is wrapped in a Promise
so `run()` can be awaited by the rAF loop.

`helpers.setMetric` is the only place that writes a metric value to the DOM. It
also pushes the value (parsed from text) into the matching sparkline buffer, so
adding new metrics gets sparklines automatically.

### Cache busting

JS / CSS references in `index.html` carry a `?v=N` query string. Bump the
version when a fresh fetch is needed for users on stale GitHub Pages caches.
The current build version also appears in the page footer for verification.

### Privacy

- Camera frames are processed in the browser and discarded each frame
- No recording, no upload, no localStorage / sessionStorage, no cookies, no
  analytics
- The only third-party requests are CDN downloads of model scripts and weights
  on first load

## Limitations

Short list of things that will bite you in practice:

- **Occlusion** - hidden body parts drop to low visibility quickly; metrics that
  require specific landmarks fall back to `-` or to a reduced approximation
- **2D only** - no reliable depth. Sway, tremor, and posture metrics are
  projections onto the image plane, not true world-space measurements
- **Single camera** - no parallax, no ground truth
- **Subject variation** - kids, unusual body shapes, wheelchairs, clothing,
  face coverings all reduce accuracy
- **Frame rate limits** - fast events (PD tremor, strikes, falls) are
  undersampled at typical 24-30 fps webcam rates
- **Lighting** - low light drops landmark confidence and breaks Neuro signals
- **No behavior semantics** - the "action" is never classified, only the skeleton
  / face shape. Higher-level behaviors would need a separate classifier on top
- **Heuristic thresholds** - all good / warn / bad ranges were picked for a POC,
  not tuned on any population

## Local development

The site is plain static files. To serve locally over HTTPS (required by
`getUserMedia` outside `localhost`):

```sh
# any static server works; example with python
python3 -m http.server 8000
# open http://localhost:8000
```

Open the browser dev console to see `[kineneo]` error messages from the model
or neuro layers if anything goes wrong silently.

## Credits

- [MediaPipe Holistic](https://developers.google.com/mediapipe)
- Hosted via [GitHub Pages](https://pages.github.com/)

### Citations

- Bazarevsky, V., Grishchenko, I., Raveendran, K., Zhu, T., Zhang, F., &
  Grundmann, M. (2020). [BlazePose: On-device Real-time Body Pose tracking](https://arxiv.org/abs/2006.10204).
  arXiv:2006.10204.
- Lugaresi, C., Tang, J., Nash, H., et al. (2019). [MediaPipe: A Framework for
  Building Perception Pipelines](https://arxiv.org/abs/1906.08172). arXiv:1906.08172.

## Trademarks

MediaPipe and Google are trademarks of Google LLC. This project is not
affiliated with, endorsed by, or sponsored by Google.

## License

This project's own source code is released under the [MIT License](LICENSE).

Third-party libraries loaded at runtime via CDN are licensed by their
respective owners. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for
the full list and license information.
