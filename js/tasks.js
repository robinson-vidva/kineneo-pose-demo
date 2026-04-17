// SPDX-License-Identifier: MIT
// tasks.js - MediaPipe Tasks Vision: Face Landmarker (blend shapes) + Gesture Recognizer.
(function () {
  var KN = window.KN = window.KN || {};

  var TASKS_VERSION = '0.10.21';
  // Multiple CDN fallbacks. jsdelivr's package-root URL lets it resolve
  // `exports.default` -> vision_bundle.mjs. unpkg is a second choice if jsdelivr
  // is slow or unreachable.
  var MODULE_URLS = [
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + TASKS_VERSION + '/vision_bundle.mjs',
    'https://unpkg.com/@mediapipe/tasks-vision@' + TASKS_VERSION + '/vision_bundle.mjs'
  ];
  var WASM_URLS = [
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + TASKS_VERSION + '/wasm',
    'https://unpkg.com/@mediapipe/tasks-vision@' + TASKS_VERSION + '/wasm'
  ];
  var FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';
  var GESTURE_MODEL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task';

  var MODULE_TIMEOUT_MS = 45000;
  var MODEL_TIMEOUT_MS = 60000;

  var modulePromise = null;
  var filesetPromise = null;
  var faceLandmarker = null;
  var gestureRecognizer = null;

  function withTimeout(promise, ms, label) {
    var timer;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () { reject(new Error('Timeout after ' + Math.round(ms / 1000) + 's: ' + label)); }, ms);
    });
    return Promise.race([promise, timeout]).finally(function () { clearTimeout(timer); });
  }

  function tryImport(urls) {
    var lastErr = new Error('no URLs tried');
    return urls.reduce(function (chain, url) {
      return chain.catch(function (err) {
        lastErr = err;
        console.log('[kineneo] dynamic import:', url);
        return withTimeout(
          import(/* @vite-ignore */ url).then(function (mod) {
            console.log('[kineneo] loaded:', url);
            return { mod: mod, url: url };
          }),
          MODULE_TIMEOUT_MS,
          url
        ).catch(function (e) { console.warn('[kineneo] import failed for', url, ':', e.message); throw e; });
      });
    }, Promise.reject(lastErr));
  }

  function getModule() {
    if (!modulePromise) {
      modulePromise = tryImport(MODULE_URLS).then(function (res) {
        // Remember the CDN origin that worked so WASM uses the same.
        var ok = res.url;
        var origin = ok.indexOf('unpkg.com') >= 0 ? 1 : 0;
        return { mod: res.mod, wasmUrl: WASM_URLS[origin] };
      });
    }
    return modulePromise;
  }

  function getFileset() {
    if (!filesetPromise) {
      filesetPromise = getModule().then(function (m) {
        console.log('[kineneo] resolving fileset from', m.wasmUrl);
        return withTimeout(
          m.mod.FilesetResolver.forVisionTasks(m.wasmUrl),
          MODULE_TIMEOUT_MS,
          'fileset/WASM'
        ).then(function (fs) { console.log('[kineneo] fileset ready'); return { fileset: fs, mod: m.mod }; });
      });
    }
    return filesetPromise;
  }

  function initFaceLandmarker(onProgress) {
    if (faceLandmarker) return Promise.resolve();
    var progress = onProgress || function () {};
    progress('Loading MediaPipe Tasks Vision (~2 MB)...');
    return getModule().then(function () {
      progress('Loading WASM runtime...');
      return getFileset();
    }).then(function (ctx) {
      progress('Downloading Face Landmarker model (~3 MB)...');
      return withTimeout(
        ctx.mod.FaceLandmarker.createFromOptions(ctx.fileset, {
          baseOptions: {
            modelAssetPath: FACE_MODEL,
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: false,
          numFaces: 1
        }),
        MODEL_TIMEOUT_MS,
        'FaceLandmarker.createFromOptions'
      );
    }).then(function (lm) {
      faceLandmarker = lm;
      console.log('[kineneo] FaceLandmarker ready');
    }).catch(function (err) {
      console.error('[kineneo] FaceLandmarker init failed:', err);
      throw err;
    });
  }

  function initGestureRecognizer(onProgress) {
    if (gestureRecognizer) return Promise.resolve();
    var progress = onProgress || function () {};
    progress('Loading MediaPipe Tasks Vision (~2 MB)...');
    return getModule().then(function () {
      progress('Loading WASM runtime...');
      return getFileset();
    }).then(function (ctx) {
      progress('Downloading Gesture Recognizer model (~8 MB)...');
      return withTimeout(
        ctx.mod.GestureRecognizer.createFromOptions(ctx.fileset, {
          baseOptions: {
            modelAssetPath: GESTURE_MODEL,
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numHands: 2
        }),
        MODEL_TIMEOUT_MS,
        'GestureRecognizer.createFromOptions'
      );
    }).then(function (gr) {
      gestureRecognizer = gr;
      console.log('[kineneo] GestureRecognizer ready');
    }).catch(function (err) {
      console.error('[kineneo] GestureRecognizer init failed:', err);
      throw err;
    });
  }

  function detectFace(video, ts) {
    if (!faceLandmarker || !video || video.readyState < 2) return null;
    try { return faceLandmarker.detectForVideo(video, ts); }
    catch (e) { console.error('[kineneo] detectFace:', e); return null; }
  }

  function detectGesture(video, ts) {
    if (!gestureRecognizer || !video || video.readyState < 2) return null;
    try { return gestureRecognizer.recognizeForVideo(video, ts); }
    catch (e) { console.error('[kineneo] detectGesture:', e); return null; }
  }

  KN.tasks = {
    initFaceLandmarker: initFaceLandmarker,
    initGestureRecognizer: initGestureRecognizer,
    detectFace: detectFace,
    detectGesture: detectGesture
  };
})();
