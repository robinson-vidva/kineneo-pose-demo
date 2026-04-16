# KineNeo Pose Demo

Browser-based live skeleton tracking and behavioral proof-of-concept. Runs entirely on
your device. Nothing is uploaded, recorded, or stored.

**Live demo:** https://robinson-vidva.github.io/kineneo-pose-demo/

---

## Disclaimer

This is a **research proof-of-concept** for exploring what on-device pose and face
tracking can surface. It is **not a medical device**, is **not intended for diagnosis,
triage, or clinical decision-making**, and has not been validated against any reference
standard. The metrics shown are crude heuristics computed from landmark coordinates,
they are noisy, subject-dependent, and can be wrong.

Do not use outputs of this page as evidence for any health-related decision. If you are
concerned about a neurological or behavioral symptom, consult a qualified clinician.

## What it does

A single HTML page that opens the camera and runs one of three skeleton / landmark
models in real time:

- **MediaPipe Pose** - 1 person, 33 body landmarks
- **MediaPipe Holistic** (default) - 1 person, 33 body + 21 + 21 hand + 468 face landmarks
- **MoveNet MultiPose** - up to 6 people, 17 COCO keypoints each

On top of the raw skeleton it computes and displays:

**Joint angles (deg)** - left and right shoulder, elbow, hip, knee, with arc overlays
at each vertex when visible.

**Behavior (works with any model)**
- Posture: standing / sitting / squatting / bending / lying / upright / tilted
- Arms: down / one raised / both raised
- Stillness: still / moving (1s window)
- Head tilt: degrees from horizontal ear line

**Neuro Screen POC (Holistic only, needs face landmarks)**
- Facial symmetry: mean min/max distance ratio across 3 L-R landmark pairs vs nose
- Blink rate per minute: via eye-aspect-ratio threshold, 30s rolling window
- Postural sway: std-dev of hip (or shoulder if hips off-camera) position, normalized to shoulder width, 5s window
- Motor symmetry: mean absolute L-R difference across available joint angles, 5s window
- Smile: corners-of-mouth height above outer-lip midpoint, normalized to mouth width
- Mouth: open / closed
- Brow: neutral / raised / furrowed
- Head tremor: std-dev of nose position over 1.5s window

Each metric is color-coded (green / amber / red) against crude reference ranges.

## How it's built

No build step, no bundler, no frameworks. Plain HTML, CSS, and JavaScript, served as
static files by GitHub Pages. Third-party dependencies come from jsDelivr CDN at
runtime.

### File layout

```
index.html       HTML shell and CDN + local script references
styles.css       All styles
js/helpers.js    Shared utilities, constants, and window.KN.state
js/neuro.js      Neuro Screen logic (all behavior and face metrics)
js/models.js     The three model objects (pose, holistic, movenet)
js/app.js        DOM bindings, rAF loop, camera start/stop/flip, model switching
```

All files attach to a shared `window.KN` namespace so they can see each other without
a module loader. Script order in `index.html` matters: helpers first, then neuro,
then models, then app.

### Runtime architecture

```
      camera getUserMedia
             |
     hidden <video> element
             |
  requestAnimationFrame loop (js/app.js)
             |
  activeModel.run(video, canvas, ctx)
     |            |            |
  pose         holistic     movenet
  (MediaPipe)  (MediaPipe)  (TensorFlow.js)
     |            |            |
     +------------+------------+
                  |
         { tracking, jointAngles, ... }
                  |
       updateMetrics + updateBehavior
                  |
         (Holistic also) updateFace
                  |
              DOM panel
```

Each model object has the same shape: `init()`, `run(video, canvas, ctx)`, `destroy()`.
The two MediaPipe models use a Promise wrapper around their push-based `onResults`
callback so `run()` can be awaited like MoveNet's pull-based API. Swapping models at
runtime tears down the previous detector, stops the camera stream, initializes the new
detector, and restarts the stream.

### Key constraints

- Camera must not auto-start (mobile browsers block unprompted autoplay)
- Prefers rear camera on mobile (`facingMode: environment`) with a front/back toggle
- Handles `NotAllowedError`, `NotFoundError`, `NotReadableError`, and HTTPS errors with
  visible user messages
- Requires HTTPS or localhost for `getUserMedia`
- All processing on-device - no analytics, cookies, localStorage, or backend

## Privacy

- Camera frames are processed in the browser and discarded every frame
- No recording, no upload, no local storage, no cookies, no analytics
- No third-party requests beyond the CDN downloads of the model scripts and weights

## Limitations

Short list of things that will bite you in practice:

- **Occlusion** - hidden body parts drop to low-visibility quickly; metrics that
  require specific landmarks fall back to `-` or a reduced fallback
- **2D only** - there's no reliable depth. Metrics like sway are projections onto the
  image plane, not true world-space measurements
- **Single camera** - no parallax, no ground truth
- **Subject variation** - kids, unusual body shapes, wheelchairs, clothing occlusion,
  face coverings all reduce accuracy
- **Frame rate** - fast movement (tremor, strikes, falls) undersample at camera fps
- **Lighting** - low light tanks landmark confidence
- **No behavior semantics** - the "action" is never classified, only the skeleton /
  face shape. Higher-level behaviors would need a separate classifier on top
- **Neuro metrics are heuristics** - thresholds were picked for a POC, not tuned on
  any population. They will mis-classify neutral faces and typical postures regularly

## Credits

- [MediaPipe Pose and Holistic](https://developers.google.com/mediapipe)
- [TensorFlow.js Pose Detection - MoveNet](https://github.com/tensorflow/tfjs-models/tree/master/pose-detection)
- Hosted via [GitHub Pages](https://pages.github.com/)

## License

MIT. See source for details.
