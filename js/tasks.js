// SPDX-License-Identifier: MIT
// tasks.js - MediaPipe Tasks Vision: Face Landmarker (blend shapes) + Gesture Recognizer.
(function () {
  var KN = window.KN = window.KN || {};

  var TASKS_VERSION = '0.10.34';
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

  // Holistic's Emscripten runtime leaves globals like `Module` and
  // `tflite_web_api` on window with deprecation-warning getters. When the
  // Tasks API's WASM glue later reads window.Module.noExitRuntime, Holistic's
  // getter fires and aborts. Temporarily clearing these globals lets Tasks
  // spin up its own independent runtime, then we restore so Holistic's next
  // inference call still works.
  var SHARED_GLOBALS = ['Module', 'tflite_web_api', 'ENVIRONMENT_IS_NODE', 'ENVIRONMENT_IS_WEB'];

  function saveAndClearGlobals() {
    var saved = {};
    for (var i = 0; i < SHARED_GLOBALS.length; i++) {
      var k = SHARED_GLOBALS[i];
      if (k in window) {
        saved[k] = window[k];
        try { delete window[k]; } catch (e) { try { window[k] = undefined; } catch (e2) {} }
      }
    }
    return saved;
  }

  function restoreGlobals(saved) {
    for (var k in saved) {
      if (saved.hasOwnProperty(k)) {
        try { window[k] = saved[k]; } catch (e) {}
      }
    }
  }

  function isolated(fn) {
    var saved = saveAndClearGlobals();
    var result;
    try { result = fn(); } catch (e) { restoreGlobals(saved); throw e; }
    if (result && typeof result.then === 'function') {
      return result.then(
        function (v) { restoreGlobals(saved); return v; },
        function (e) { restoreGlobals(saved); throw e; }
      );
    }
    restoreGlobals(saved);
    return result;
  }

  function createWithFallback(ctx, TaskClass, options, label, progress) {
    var gpuOpts = JSON.parse(JSON.stringify(options));
    gpuOpts.baseOptions.delegate = 'GPU';
    return withTimeout(
      isolated(function () { return TaskClass.createFromOptions(ctx.fileset, gpuOpts); }),
      MODEL_TIMEOUT_MS,
      label + ' (GPU)'
    ).catch(function (err) {
      console.warn('[kineneo] ' + label + ' GPU init failed, retrying on CPU:', err && err.message ? err.message : err);
      progress('Retrying ' + label + ' on CPU...');
      var cpuOpts = JSON.parse(JSON.stringify(options));
      cpuOpts.baseOptions.delegate = 'CPU';
      return withTimeout(
        isolated(function () { return TaskClass.createFromOptions(ctx.fileset, cpuOpts); }),
        MODEL_TIMEOUT_MS,
        label + ' (CPU)'
      );
    });
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
      return createWithFallback(ctx, ctx.mod.FaceLandmarker, {
        baseOptions: { modelAssetPath: FACE_MODEL },
        runningMode: 'VIDEO',
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
        numFaces: 1
      }, 'FaceLandmarker', progress);
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
      return createWithFallback(ctx, ctx.mod.GestureRecognizer, {
        baseOptions: { modelAssetPath: GESTURE_MODEL },
        runningMode: 'VIDEO',
        numHands: 2
      }, 'GestureRecognizer', progress);
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
