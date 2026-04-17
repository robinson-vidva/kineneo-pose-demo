// SPDX-License-Identifier: MIT
// tasks.js - MediaPipe Tasks Vision: Face Landmarker (blend shapes) + Gesture Recognizer.
(function () {
  var KN = window.KN = window.KN || {};

  var TASKS_VERSION = '0.10.21';
  var TASKS_BUNDLE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + TASKS_VERSION + '/vision_bundle.mjs';
  var TASKS_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + TASKS_VERSION + '/wasm';
  var FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';
  var GESTURE_MODEL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task';

  var modulePromise = null;
  var filesetPromise = null;
  var faceLandmarker = null;
  var gestureRecognizer = null;

  function getModule() {
    if (!modulePromise) modulePromise = import(TASKS_BUNDLE);
    return modulePromise;
  }

  function getFileset() {
    if (!filesetPromise) {
      filesetPromise = getModule().then(function (mod) {
        return mod.FilesetResolver.forVisionTasks(TASKS_WASM);
      });
    }
    return filesetPromise;
  }

  function initFaceLandmarker(onProgress) {
    if (faceLandmarker) return Promise.resolve();
    var progress = onProgress || function () {};
    progress('Loading MediaPipe Tasks Vision...');
    return getModule().then(function (mod) {
      progress('Loading WASM runtime...');
      return getFileset().then(function (fileset) {
        progress('Downloading Face Landmarker model...');
        return mod.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: FACE_MODEL,
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: false,
          numFaces: 1
        });
      });
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
    progress('Loading MediaPipe Tasks Vision...');
    return getModule().then(function (mod) {
      progress('Loading WASM runtime...');
      return getFileset().then(function (fileset) {
        progress('Downloading Gesture Recognizer model...');
        return mod.GestureRecognizer.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: GESTURE_MODEL,
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numHands: 2
        });
      });
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
