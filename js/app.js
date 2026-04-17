// SPDX-License-Identifier: MIT
// app.js - DOM bindings, rAF loop, camera lifecycle, and event listeners.
(function () {
  var KN = window.KN = window.KN || {};
  var H = KN.helpers;
  var C = KN.constants;

  var video = document.getElementById('video');
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var fpsEl = document.getElementById('fps');
  var badge = document.getElementById('trackingBadge');
  var startBtn = document.getElementById('startBtn');
  var flipBtn = document.getElementById('flipBtn');
  var labelsBtn = document.getElementById('labelsBtn');
  var anglesBtn = document.getElementById('anglesBtn');
  var bgBtn = document.getElementById('bgBtn');
  var blendBtn = document.getElementById('blendBtn');
  var gestureBtn = document.getElementById('gestureBtn');
  var fullscreenBtn = document.getElementById('fullscreenBtn');
  var statusEl = document.getElementById('status');
  var placeholder = document.getElementById('placeholder');
  var panel = document.getElementById('panel');
  var blendTitle = document.getElementById('blendTitle');
  var bsGrid = document.getElementById('bsGrid');
  var gestureWidget = document.getElementById('gestureWidget');

  var m_status = document.getElementById('m_status');
  var m_persons = document.getElementById('m_persons');
  var m_visible = document.getElementById('m_visible');
  var m_conf = document.getElementById('m_conf');

  KN.neuro.bindDom();
  if (KN.spark) KN.spark.bind();

  var currentStream = null;
  var facingMode = 'environment';
  var running = false;
  var modelReady = false;
  var rafId = null;
  var frameCount = 0;
  var lastFpsUpdate = performance.now();

  // --- Blend shapes UI ---
  // Subset most relevant for neuroscience / facial expression work.
  var BLEND_KEYS = [
    'eyeBlinkLeft', 'eyeBlinkRight',
    'browInnerUp', 'browDownLeft', 'browDownRight',
    'browOuterUpLeft', 'browOuterUpRight',
    'mouthSmileLeft', 'mouthSmileRight',
    'mouthFrownLeft', 'mouthFrownRight',
    'mouthPucker', 'jawOpen',
    'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
    'noseSneerLeft', 'noseSneerRight'
  ];
  var bsRows = {};

  function buildBlendShapeRows() {
    if (Object.keys(bsRows).length) return;
    for (var i = 0; i < BLEND_KEYS.length; i++) {
      var key = BLEND_KEYS[i];
      var row = document.createElement('div');
      row.className = 'bs-row';
      row.innerHTML =
        '<span class="bs-label">' + key + '</span>' +
        '<span class="bs-bar"><span class="bs-fill" style="width:0%"></span></span>' +
        '<span class="bs-val">0.00</span>';
      bsGrid.appendChild(row);
      bsRows[key] = {
        fill: row.querySelector('.bs-fill'),
        val: row.querySelector('.bs-val')
      };
    }
  }

  function updateBlendShapes(categories) {
    if (!categories) return;
    var map = {};
    for (var i = 0; i < categories.length; i++) map[categories[i].categoryName] = categories[i].score;
    for (var j = 0; j < BLEND_KEYS.length; j++) {
      var k = BLEND_KEYS[j];
      var s = map[k] || 0;
      var row = bsRows[k];
      if (!row) continue;
      row.fill.style.width = (s * 100).toFixed(1) + '%';
      row.val.textContent = s.toFixed(2);
    }
  }

  function clearBlendShapes() {
    for (var k in bsRows) {
      if (!bsRows.hasOwnProperty(k)) continue;
      bsRows[k].fill.style.width = '0%';
      bsRows[k].val.textContent = '0.00';
    }
  }

  // --- Gesture widget ---
  function updateGesture(result) {
    if (!result) { gestureWidget.style.display = 'none'; return; }
    var gestures = result.gestures || [];
    var handedness = result.handednesses || [];
    if (!gestures.length) { gestureWidget.style.display = 'none'; return; }
    var parts = [];
    for (var i = 0; i < gestures.length; i++) {
      var g = gestures[i] && gestures[i][0];
      if (!g || g.categoryName === 'None') continue;
      var handLabel = (handedness[i] && handedness[i][0] && handedness[i][0].displayName) || ('H' + (i + 1));
      parts.push(
        '<span class="ghand">' + handLabel + '</span>' +
        '<span class="gname">' + g.categoryName + '</span>' +
        '<span class="gscore">' + (g.score * 100).toFixed(0) + '%</span>'
      );
    }
    if (!parts.length) { gestureWidget.style.display = 'none'; return; }
    gestureWidget.innerHTML = parts.join(' &nbsp; ');
    gestureWidget.style.display = 'block';
  }

  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('error', !!isError);
  }

  function clearPanel() {
    H.setMetric(m_status, 'NO POSE', 'bad');
    H.setMetric(m_persons, '-');
    H.setMetric(m_visible, '- / ' + C.HOLISTIC_TOTAL);
    H.setMetric(m_conf, '-');
    C.ANGLE_DEFS.forEach(function (d) { H.setMetric(document.getElementById(d.key), '-'); });
    badge.textContent = 'NO POSE';
    badge.classList.remove('tracking');
    badge.classList.add('lost');
    KN.neuro.clearPanel();
    clearBlendShapes();
  }

  function updateMetrics(stats) {
    if (!stats || !stats.tracking) { clearPanel(); return; }
    H.setMetric(m_status, 'TRACKING', 'good');
    badge.textContent = 'TRACKING';
    badge.classList.add('tracking');
    badge.classList.remove('lost');
    H.setMetric(m_persons, String(stats.numPersons));
    var total = stats.totalLandmarks || C.HOLISTIC_TOTAL;
    var vis = stats.landmarkCount;
    var visCls = vis >= 20 ? 'good' : (vis >= 10 ? 'warn' : 'bad');
    H.setMetric(m_visible, vis + ' / ' + total, visCls);
    var mc = stats.meanConfidence;
    var confCls = mc >= 0.75 ? 'good' : (mc >= 0.5 ? 'warn' : 'bad');
    H.setMetric(m_conf, mc.toFixed(2), confCls);
    var ja = stats.jointAngles || {};
    for (var i = 0; i < C.ANGLE_DEFS.length; i++) {
      var d = C.ANGLE_DEFS[i];
      var el = document.getElementById(d.key);
      var v = ja[d.key];
      if (v == null) H.setMetric(el, '-');
      else H.setMetric(el, v.toFixed(1) + ' deg');
    }
  }

  function tickFps() {
    frameCount++;
    var now = performance.now();
    var elapsed = now - lastFpsUpdate;
    if (elapsed >= 500) {
      var fps = Math.round((frameCount * 1000) / elapsed);
      fpsEl.textContent = fps + ' FPS';
      frameCount = 0;
      lastFpsUpdate = now;
    }
  }

  function stopCurrentStream() {
    return new Promise(function (resolve) {
      if (currentStream) {
        currentStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        currentStream = null;
      }
      if (video.srcObject) video.srcObject = null;
      resolve();
    });
  }

  async function startStream() {
    var constraints = {
      audio: false,
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } }
    };
    var stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 } }
      });
    }
    currentStream = stream;
    video.srcObject = stream;
    await new Promise(function (resolve) {
      if (video.readyState >= 2) return resolve();
      video.onloadedmetadata = function () { resolve(); };
    });
    try { await video.play(); } catch (e) {}
  }

  function runTasks() {
    var ts = performance.now();
    if (KN.state.blendShapesEnabled && KN.tasks) {
      var fr = KN.tasks.detectFace(video, ts);
      if (fr && fr.faceBlendshapes && fr.faceBlendshapes[0]) {
        updateBlendShapes(fr.faceBlendshapes[0].categories);
      }
    }
    if (KN.state.gesturesEnabled && KN.tasks) {
      var gr = KN.tasks.detectGesture(video, ts);
      updateGesture(gr);
    }
  }

  function rafLoop() {
    if (!running) return;
    rafId = requestAnimationFrame(function () {
      if (!running) return;
      KN.model.run(video, canvas, ctx).then(function (stats) {
        if (!running) return;
        try { updateMetrics(stats); } catch (e) { console.error('[kineneo] updateMetrics error:', e); }
        try { runTasks(); } catch (e) { console.error('[kineneo] runTasks error:', e); }
        tickFps();
        rafLoop();
      }).catch(function (err) {
        console.error('[kineneo] model.run error:', err);
        if (running) rafLoop();
      });
    });
  }

  function handleCameraError(err) {
    startBtn.disabled = false;
    var name = err && err.name ? err.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      setStatus('Camera permission was denied. Please allow camera access in your browser settings and try again.', true);
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      setStatus('No camera was found on this device.', true);
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      setStatus('The camera is already in use by another application.', true);
    } else if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      setStatus('Camera access requires HTTPS. Please open this page over HTTPS.', true);
    } else {
      setStatus('Could not start camera: ' + (err && err.message ? err.message : 'unknown error'), true);
    }
  }

  async function start() {
    if (running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Camera API is not available in this browser.', true);
      return;
    }
    startBtn.disabled = true;
    setStatus('Requesting camera access...');
    try {
      await startStream();
    } catch (err) {
      handleCameraError(err);
      return;
    }
    if (!modelReady) {
      setStatus('Loading MediaPipe Holistic...');
      try {
        await KN.model.init();
        modelReady = true;
      } catch (err) {
        console.error('[kineneo] model init failed:', err);
        setStatus('Failed to load MediaPipe Holistic: ' + (err && err.message ? err.message : 'unknown error'), true);
        startBtn.disabled = false;
        await stopCurrentStream();
        return;
      }
    }
    H.ensureCanvasSize(canvas, video.videoWidth || 640, video.videoHeight || 480);
    placeholder.style.display = 'none';
    canvas.style.display = 'block';
    fpsEl.style.display = 'block';
    badge.style.display = 'block';
    panel.classList.remove('hidden');
    flipBtn.disabled = false;
    labelsBtn.disabled = false;
    anglesBtn.disabled = false;
    bgBtn.disabled = false;
    blendBtn.disabled = false;
    gestureBtn.disabled = false;
    startBtn.textContent = 'Stop';
    startBtn.disabled = false;
    running = true;
    clearPanel();
    setStatus('');
    frameCount = 0; lastFpsUpdate = performance.now();
    rafLoop();
  }

  async function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    await stopCurrentStream();
    canvas.style.display = 'none';
    fpsEl.style.display = 'none';
    badge.style.display = 'none';
    gestureWidget.style.display = 'none';
    panel.classList.add('hidden');
    placeholder.style.display = 'flex';
    flipBtn.disabled = true;
    labelsBtn.disabled = true;
    anglesBtn.disabled = true;
    bgBtn.disabled = true;
    blendBtn.disabled = true;
    gestureBtn.disabled = true;
    startBtn.textContent = 'Start Camera';
    startBtn.disabled = false;
    setStatus('');
  }

  async function flip() {
    if (!running) return;
    flipBtn.disabled = true;
    facingMode = (facingMode === 'environment') ? 'user' : 'environment';
    try {
      running = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (currentStream) {
        currentStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        currentStream = null;
      }
      await startStream();
      H.ensureCanvasSize(canvas, video.videoWidth || 640, video.videoHeight || 480);
      running = true;
      frameCount = 0; lastFpsUpdate = performance.now();
      rafLoop();
    } catch (err) {
      setStatus('Could not switch camera: ' + (err && err.message ? err.message : 'unknown error'), true);
    } finally {
      flipBtn.disabled = !running;
    }
  }

  // --- Background cycling ---
  var BG_ORDER = ['normal', 'blur', 'cutout', 'skeleton'];
  var BG_LABEL = { normal: 'Bg: Normal', blur: 'Bg: Blur', cutout: 'Bg: Cutout', skeleton: 'Bg: Skeleton' };
  function cycleBackground() {
    var i = BG_ORDER.indexOf(KN.state.backgroundMode || 'normal');
    var next = BG_ORDER[(i + 1) % BG_ORDER.length];
    KN.state.backgroundMode = next;
    bgBtn.textContent = BG_LABEL[next];
    bgBtn.classList.toggle('on', next !== 'normal');
  }

  // --- Blend shapes toggle ---
  async function toggleBlendShapes() {
    if (KN.state.blendShapesEnabled) {
      KN.state.blendShapesEnabled = false;
      blendBtn.classList.remove('on');
      blendTitle.classList.add('hidden');
      bsGrid.classList.add('hidden');
      clearBlendShapes();
      return;
    }
    blendBtn.disabled = true;
    try {
      await KN.tasks.initFaceLandmarker(function (msg) { setStatus(msg); });
      KN.state.blendShapesEnabled = true;
      blendBtn.classList.add('on');
      buildBlendShapeRows();
      blendTitle.classList.remove('hidden');
      bsGrid.classList.remove('hidden');
      setStatus('');
    } catch (err) {
      setStatus('Failed to load Face Landmarker: ' + (err && err.message ? err.message : 'unknown error'), true);
    } finally {
      blendBtn.disabled = false;
    }
  }

  // --- Gestures toggle ---
  async function toggleGestures() {
    if (KN.state.gesturesEnabled) {
      KN.state.gesturesEnabled = false;
      gestureBtn.classList.remove('on');
      gestureWidget.style.display = 'none';
      return;
    }
    gestureBtn.disabled = true;
    try {
      await KN.tasks.initGestureRecognizer(function (msg) { setStatus(msg); });
      KN.state.gesturesEnabled = true;
      gestureBtn.classList.add('on');
      setStatus('');
    } catch (err) {
      setStatus('Failed to load Gesture Recognizer: ' + (err && err.message ? err.message : 'unknown error'), true);
    } finally {
      gestureBtn.disabled = false;
    }
  }

  startBtn.addEventListener('click', function () { if (running) stop(); else start(); });
  flipBtn.addEventListener('click', flip);
  labelsBtn.addEventListener('click', function () {
    KN.state.showLabels = !KN.state.showLabels;
    labelsBtn.classList.toggle('on', KN.state.showLabels);
  });
  anglesBtn.addEventListener('click', function () {
    KN.state.showAngles = !KN.state.showAngles;
    anglesBtn.classList.toggle('on', KN.state.showAngles);
  });
  bgBtn.addEventListener('click', cycleBackground);
  blendBtn.addEventListener('click', toggleBlendShapes);
  gestureBtn.addEventListener('click', toggleGestures);

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function requestFs(el) {
    if (el.requestFullscreen) return el.requestFullscreen();
    if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
  }
  function exitFs() {
    if (document.exitFullscreen) return document.exitFullscreen();
    if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
  }
  function syncFsBtn() {
    var on = isFullscreen();
    fullscreenBtn.classList.toggle('on', on);
    fullscreenBtn.textContent = on ? 'Exit Fullscreen' : 'Fullscreen';
  }
  fullscreenBtn.addEventListener('click', function () {
    if (isFullscreen()) exitFs();
    else requestFs(document.documentElement);
  });
  document.addEventListener('fullscreenchange', syncFsBtn);
  document.addEventListener('webkitfullscreenchange', syncFsBtn);

  window.addEventListener('pagehide', function () { stop(); });
})();
