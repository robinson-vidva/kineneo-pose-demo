// SPDX-License-Identifier: MIT
// app.js - DOM bindings, rAF loop, camera lifecycle, mode switching (Pose / Objects).
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
  var skeletonBtn = document.getElementById('skeletonBtn');
  var fullscreenBtn = document.getElementById('fullscreenBtn');
  var statusEl = document.getElementById('status');
  var placeholder = document.getElementById('placeholder');
  var posePanel = document.getElementById('panel');
  var objectsPanel = document.getElementById('objectsPanel');
  var modePoseBtn = document.getElementById('mode_pose');
  var modeObjectsBtn = document.getElementById('mode_objects');

  var m_status = document.getElementById('m_status');
  var m_persons = document.getElementById('m_persons');
  var m_visible = document.getElementById('m_visible');
  var m_conf = document.getElementById('m_conf');

  var o_status = document.getElementById('o_status');
  var o_count = document.getElementById('o_count');
  var o_conf = document.getElementById('o_conf');
  var objList = document.getElementById('objList');

  KN.neuro.bindDom();
  if (KN.spark) KN.spark.bind();

  var currentStream = null;
  var facingMode = 'environment';
  var running = false;
  var poseReady = false;
  var objectsReady = false;
  var mode = 'pose';
  var rafId = null;
  var frameCount = 0;
  var lastFpsUpdate = performance.now();

  function activeModel() {
    return mode === 'pose' ? KN.model : KN.objects;
  }

  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('error', !!isError);
  }

  function clearPosePanel() {
    H.setMetric(m_status, 'NO POSE', 'bad');
    H.setMetric(m_persons, '-');
    H.setMetric(m_visible, '- / ' + C.HOLISTIC_TOTAL);
    H.setMetric(m_conf, '-');
    C.ANGLE_DEFS.forEach(function (d) { H.setMetric(document.getElementById(d.key), '-'); });
    badge.textContent = 'NO POSE';
    badge.classList.remove('tracking');
    badge.classList.add('lost');
    KN.neuro.clearPanel();
  }

  function clearObjectsPanel() {
    H.setMetric(o_status, 'NO OBJECTS', 'bad');
    H.setMetric(o_count, '-');
    H.setMetric(o_conf, '-');
    objList.textContent = 'No objects detected.';
    badge.textContent = 'NO OBJECTS';
    badge.classList.remove('tracking');
    badge.classList.add('lost');
  }

  function classHue(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
    return h % 360;
  }

  function buildObjList(preds) {
    objList.innerHTML = '';
    for (var i = 0; i < preds.length; i++) {
      var p = preds[i];
      var row = document.createElement('div');
      row.className = 'obj-item';
      var hue = classHue(p.class);
      row.innerHTML =
        '<span class="obj-swatch" style="background:hsl(' + hue + ',85%,60%)"></span>' +
        '<span class="obj-class">' + p.class + '</span>' +
        '<span class="obj-score">' + (p.score * 100).toFixed(0) + '%</span>';
      objList.appendChild(row);
    }
    if (!preds.length) objList.textContent = 'No objects detected.';
  }

  function updatePoseMetrics(stats) {
    if (!stats || !stats.tracking) { clearPosePanel(); return; }
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

  function updateObjectsMetrics(stats) {
    if (!stats || !stats.tracking) { clearObjectsPanel(); return; }
    H.setMetric(o_status, 'DETECTING', 'good');
    badge.textContent = 'DETECTING';
    badge.classList.add('tracking');
    badge.classList.remove('lost');
    var cnt = stats.objectCount;
    H.setMetric(o_count, String(cnt), cnt > 0 ? 'good' : 'bad');
    var mc = stats.meanConfidence;
    if (mc != null) {
      var confCls = mc >= 0.75 ? 'good' : (mc >= 0.5 ? 'warn' : 'bad');
      H.setMetric(o_conf, (mc * 100).toFixed(0) + '%', confCls);
    } else {
      H.setMetric(o_conf, '-');
    }
    buildObjList(stats.predictions || []);
  }

  function updateMetrics(stats) {
    if (mode === 'pose') updatePoseMetrics(stats);
    else updateObjectsMetrics(stats);
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

  function rafLoop() {
    if (!running) return;
    rafId = requestAnimationFrame(function () {
      if (!running) return;
      activeModel().run(video, canvas, ctx).then(function (stats) {
        if (!running) return;
        try { updateMetrics(stats); } catch (e) { console.error('[kineneo] updateMetrics error:', e); }
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

  function syncModeUI() {
    modePoseBtn.classList.toggle('on', mode === 'pose');
    modeObjectsBtn.classList.toggle('on', mode === 'objects');
    labelsBtn.style.display = mode === 'pose' ? '' : 'none';
    anglesBtn.style.display = mode === 'pose' ? '' : 'none';
    if (running) {
      posePanel.classList.toggle('hidden', mode !== 'pose');
      objectsPanel.classList.toggle('hidden', mode !== 'objects');
    }
  }

  async function initActiveModel() {
    if (mode === 'pose' && !poseReady) {
      setStatus('Loading MediaPipe Holistic...');
      await KN.model.init();
      poseReady = true;
    } else if (mode === 'objects' && !objectsReady) {
      setStatus('Loading COCO-SSD (first time may take a moment)...');
      await KN.objects.init();
      objectsReady = true;
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
      await initActiveModel();
      H.ensureCanvasSize(canvas, video.videoWidth || 640, video.videoHeight || 480);
      placeholder.style.display = 'none';
      canvas.style.display = 'block';
      fpsEl.style.display = 'block';
      badge.style.display = 'block';
      syncModeUI();
      flipBtn.disabled = false;
      labelsBtn.disabled = false;
      anglesBtn.disabled = false;
      skeletonBtn.disabled = false;
      startBtn.textContent = 'Stop';
      startBtn.disabled = false;
      running = true;
      if (mode === 'pose') clearPosePanel();
      else clearObjectsPanel();
      setStatus('');
      frameCount = 0; lastFpsUpdate = performance.now();
      rafLoop();
    } catch (err) {
      handleCameraError(err);
    }
  }

  async function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    await stopCurrentStream();
    canvas.style.display = 'none';
    fpsEl.style.display = 'none';
    badge.style.display = 'none';
    posePanel.classList.add('hidden');
    objectsPanel.classList.add('hidden');
    placeholder.style.display = 'flex';
    flipBtn.disabled = true;
    labelsBtn.disabled = true;
    anglesBtn.disabled = true;
    skeletonBtn.disabled = true;
    startBtn.textContent = 'Start Camera';
    startBtn.disabled = false;
    setStatus('');
  }

  async function switchMode(newMode) {
    if (newMode === mode) return;
    mode = newMode;
    syncModeUI();
    if (!running) return;
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    try {
      await initActiveModel();
      if (KN.clearTrails) KN.clearTrails();
      if (KN.spark) KN.spark.clearAll();
      KN.neuro.resetState();
      running = true;
      if (mode === 'pose') clearPosePanel();
      else clearObjectsPanel();
      setStatus('');
      frameCount = 0; lastFpsUpdate = performance.now();
      rafLoop();
    } catch (err) {
      setStatus('Failed to load model: ' + (err && err.message ? err.message : 'unknown'), true);
    }
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

  startBtn.addEventListener('click', function () { if (running) stop(); else start(); });
  flipBtn.addEventListener('click', flip);
  modePoseBtn.addEventListener('click', function () { switchMode('pose'); });
  modeObjectsBtn.addEventListener('click', function () { switchMode('objects'); });
  labelsBtn.addEventListener('click', function () {
    KN.state.showLabels = !KN.state.showLabels;
    labelsBtn.classList.toggle('on', KN.state.showLabels);
  });
  anglesBtn.addEventListener('click', function () {
    KN.state.showAngles = !KN.state.showAngles;
    anglesBtn.classList.toggle('on', KN.state.showAngles);
  });
  skeletonBtn.addEventListener('click', function () {
    KN.state.skeletonOnly = !KN.state.skeletonOnly;
    skeletonBtn.classList.toggle('on', KN.state.skeletonOnly);
  });

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

  syncModeUI();
  window.addEventListener('pagehide', function () { stop(); });
})();
