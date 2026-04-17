// SPDX-License-Identifier: MIT
// multi-app.js - DOM bindings, rAF loop, and camera lifecycle for multi-person MoveNet.
(function () {
  var KN = window.KN = window.KN || {};
  var H = KN.helpers;
  var C = KN.multiConstants;

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
  var panel = document.getElementById('panel');

  var m_status = document.getElementById('m_status');
  var m_persons = document.getElementById('m_persons');
  var m_visible = document.getElementById('m_visible');
  var m_conf = document.getElementById('m_conf');

  var currentStream = null;
  var facingMode = 'environment';
  var running = false;
  var modelReady = false;
  var rafId = null;
  var frameCount = 0;
  var lastFpsUpdate = performance.now();

  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('error', !!isError);
  }

  function clearPanel() {
    H.setMetric(m_status, 'NO POSE', 'bad');
    H.setMetric(m_persons, '-');
    H.setMetric(m_visible, '- / 17');
    H.setMetric(m_conf, '-');
    C.ANGLE_DEFS.forEach(function (d) { H.setMetric(document.getElementById(d.key), '-'); });
    badge.textContent = 'NO POSE';
    badge.classList.remove('tracking');
    badge.classList.add('lost');
  }

  function updateMetrics(stats) {
    if (!stats || !stats.tracking) { clearPanel(); return; }
    H.setMetric(m_status, 'TRACKING', 'good');
    badge.textContent = stats.numPersons + 'P ' + (stats.numFaces || 0) + 'F ' + (stats.numHands || 0) + 'H';
    badge.classList.add('tracking');
    badge.classList.remove('lost');
    H.setMetric(m_persons, stats.numPersons + ' body, ' + (stats.numFaces || 0) + ' face, ' + (stats.numHands || 0) + ' hand', stats.numPersons > 1 ? 'good' : null);
    var vis = stats.landmarkCount;
    var visCls = vis >= 12 ? 'good' : (vis >= 7 ? 'warn' : 'bad');
    H.setMetric(m_visible, vis + ' / ' + stats.totalLandmarks, visCls);
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

  function rafLoop() {
    if (!running) return;
    rafId = requestAnimationFrame(function () {
      if (!running) return;
      KN.multiModel.run(video, canvas, ctx).then(function (stats) {
        if (!running) return;
        try { updateMetrics(stats); } catch (e) { console.error('[kineneo-multi] updateMetrics error:', e); }
        tickFps();
        rafLoop();
      }).catch(function (err) {
        console.error('[kineneo-multi] model.run error:', err);
        if (running) rafLoop();
      });
    });
  }

  function handleCameraError(err) {
    startBtn.disabled = false;
    var name = err && err.name ? err.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      setStatus('Camera permission was denied.', true);
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      setStatus('No camera found.', true);
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      setStatus('Camera in use by another app.', true);
    } else if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      setStatus('Camera requires HTTPS.', true);
    } else {
      setStatus('Could not start camera: ' + (err && err.message ? err.message : 'unknown'), true);
    }
  }

  async function start() {
    if (running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Camera API not available.', true);
      return;
    }
    startBtn.disabled = true;
    setStatus('Requesting camera access...');
    try { await startStream(); } catch (err) { handleCameraError(err); return; }
    if (!modelReady) {
      setStatus('Loading PoseLandmarker...');
      try { await KN.multiModel.init(function (msg) { setStatus(msg); }); modelReady = true; }
      catch (err) {
        console.error('[kineneo-multi] model init failed:', err);
        setStatus('Failed to load PoseLandmarker: ' + (err && err.message ? err.message : 'unknown'), true);
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
    skeletonBtn.disabled = false;
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
    panel.classList.add('hidden');
    placeholder.style.display = 'flex';
    flipBtn.disabled = true;
    labelsBtn.disabled = true;
    anglesBtn.disabled = true;
    skeletonBtn.disabled = true;
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
      if (currentStream) { currentStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); currentStream = null; }
      await startStream();
      H.ensureCanvasSize(canvas, video.videoWidth || 640, video.videoHeight || 480);
      running = true;
      frameCount = 0; lastFpsUpdate = performance.now();
      rafLoop();
    } catch (err) {
      setStatus('Could not switch camera: ' + (err && err.message ? err.message : 'unknown'), true);
    } finally { flipBtn.disabled = !running; }
  }

  startBtn.addEventListener('click', function () { if (running) stop(); else start(); });
  flipBtn.addEventListener('click', flip);
  labelsBtn.addEventListener('click', function () { KN.state.showLabels = !KN.state.showLabels; labelsBtn.classList.toggle('on', KN.state.showLabels); });
  anglesBtn.addEventListener('click', function () { KN.state.showAngles = !KN.state.showAngles; anglesBtn.classList.toggle('on', KN.state.showAngles); });
  skeletonBtn.addEventListener('click', function () { KN.state.skeletonOnly = !KN.state.skeletonOnly; skeletonBtn.classList.toggle('on', KN.state.skeletonOnly); skeletonBtn.textContent = KN.state.skeletonOnly ? 'Skeleton On' : 'Skeleton Off'; });

  function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function requestFs(el) { if (el.requestFullscreen) return el.requestFullscreen(); if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen(); }
  function exitFs() { if (document.exitFullscreen) return document.exitFullscreen(); if (document.webkitExitFullscreen) return document.webkitExitFullscreen(); }
  function syncFsBtn() { var on = isFullscreen(); fullscreenBtn.classList.toggle('on', on); fullscreenBtn.textContent = on ? 'Exit Fullscreen' : 'Fullscreen'; }
  fullscreenBtn.addEventListener('click', function () { if (isFullscreen()) exitFs(); else requestFs(document.documentElement); });
  document.addEventListener('fullscreenchange', syncFsBtn);
  document.addEventListener('webkitfullscreenchange', syncFsBtn);
  window.addEventListener('pagehide', function () { stop(); });
})();
