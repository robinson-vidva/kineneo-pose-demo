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
  var skeletonBtn = document.getElementById('skeletonBtn');
  var radarBtn = document.getElementById('radarBtn');
  var spectrogramBtn = document.getElementById('spectrogramBtn');
  var radarBlock = document.getElementById('radarBlock');
  var spectrogramBlock = document.getElementById('spectrogramBlock');
  var fullscreenBtn = document.getElementById('fullscreenBtn');
  var debugBtn = document.getElementById('debugBtn');
  var debugOverlay = document.getElementById('debugOverlay');
  var debugText = document.getElementById('debugText');
  var debugCopyBtn = document.getElementById('debugCopyBtn');
  var statusEl = document.getElementById('status');
  var placeholder = document.getElementById('placeholder');
  var panel = document.getElementById('panel');

  var m_status = document.getElementById('m_status');
  var m_persons = document.getElementById('m_persons');
  var m_visible = document.getElementById('m_visible');
  var m_conf = document.getElementById('m_conf');

  KN.neuro.bindDom();
  if (KN.spark) KN.spark.bind();
  var radarCvs = document.getElementById('neuroRadar');
  var specCvs = document.getElementById('tremorSpectrogram');
  if (KN.viz && specCvs) KN.viz.initSpectrogram(specCvs);
  var vizFrame = 0;
  var lastSpecTs = 0;

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
    H.setMetric(m_visible, '- / ' + C.HOLISTIC_TOTAL);
    H.setMetric(m_conf, '-');
    C.ANGLE_DEFS.forEach(function (d) { H.setMetric(document.getElementById(d.key), '-'); });
    badge.textContent = 'NO POSE';
    badge.classList.remove('tracking');
    badge.classList.add('lost');
    KN.neuro.clearPanel();
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

  function updateViz() {
    vizFrame++;
    if (!KN.viz) return;
    // Radar at ~4 Hz (every 8th frame at 30 fps) - only when enabled.
    if (KN.state.showRadar && radarCvs && (vizFrame % 8) === 0) {
      try { KN.viz.drawRadar(radarCvs, KN.neuro.getLatest()); }
      catch (e) { console.error('[kineneo] drawRadar:', e); }
    }
    // Spectrogram column at ~10 Hz (every 3rd frame) - only when enabled.
    if (KN.state.showSpectrogram && specCvs && (vizFrame % 3) === 0) {
      var spec = KN.neuro.getSpectrum();
      if (spec) {
        try { KN.viz.drawSpectrogramColumn(spec); }
        catch (e) { console.error('[kineneo] drawSpectrogramColumn:', e); }
      }
    }
  }

  function rafLoop() {
    if (!running) return;
    rafId = requestAnimationFrame(function () {
      if (!running) return;
      KN.model.run(video, canvas, ctx).then(function (stats) {
        if (!running) return;
        try { updateMetrics(stats); } catch (e) { console.error('[kineneo] updateMetrics error:', e); }
        try { updateViz(); } catch (e) { console.error('[kineneo] updateViz error:', e); }
        try { updateDebug(); } catch (e) {}
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
    skeletonBtn.disabled = false;
    radarBtn.disabled = false;
    spectrogramBtn.disabled = false;
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
    if (KN.viz) KN.viz.clearSpectrogram();
    canvas.style.display = 'none';
    fpsEl.style.display = 'none';
    badge.style.display = 'none';
    panel.classList.add('hidden');
    placeholder.style.display = 'flex';
    flipBtn.disabled = true;
    labelsBtn.disabled = true;
    anglesBtn.disabled = true;
    skeletonBtn.disabled = true;
    radarBtn.disabled = true;
    spectrogramBtn.disabled = true;
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
  var SK_MODES = [
    { skel: false, bg: 'none',   label: 'Skeleton Off' },
    { skel: true,  bg: 'none',   label: 'Skeleton' },
    { skel: true,  bg: 'void',   label: 'Skel: Void' }
  ];
  var skModeIdx = 0;
  skeletonBtn.addEventListener('click', function () {
    skModeIdx = (skModeIdx + 1) % SK_MODES.length;
    var m = SK_MODES[skModeIdx];
    KN.state.skeletonOnly = m.skel;
    KN.state.skeletonBg = m.bg;
    skeletonBtn.textContent = m.label;
    skeletonBtn.classList.toggle('on', m.skel);
  });
  radarBtn.addEventListener('click', function () {
    KN.state.showRadar = !KN.state.showRadar;
    radarBtn.classList.toggle('on', KN.state.showRadar);
    radarBlock.classList.toggle('hidden', !KN.state.showRadar);
  });
  spectrogramBtn.addEventListener('click', function () {
    KN.state.showSpectrogram = !KN.state.showSpectrogram;
    spectrogramBtn.classList.toggle('on', KN.state.showSpectrogram);
    spectrogramBlock.classList.toggle('hidden', !KN.state.showSpectrogram);
    if (KN.state.showSpectrogram && KN.viz) KN.viz.clearSpectrogram();
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

  var debugOn = false;
  debugBtn.addEventListener('click', function () {
    debugOn = !debugOn;
    debugBtn.classList.toggle('on', debugOn);
    debugOverlay.style.display = debugOn ? 'block' : 'none';
  });
  function updateDebug() {
    if (!debugOn) return;
    var d = KN.debug || {};
    var fmt = function (v) { return (v == null ? '-' : v.toFixed(4)); };
    var stillSpeed = d.stillSpeed, stillThresh = d.stillThresh || 0.008;
    var stillVerdict = stillSpeed == null ? '-' : (stillSpeed < stillThresh ? 'STILL' : 'MOVING');
    debugText.textContent =
      'STILLNESS (sd, 1s, torso anchors)\n' +
      '  pos sd      : ' + fmt(stillSpeed) + '\n' +
      '  threshold   : ' + fmt(stillThresh) + '\n' +
      '  verdict     : ' + stillVerdict + '\n' +
      '\nTIP: stand still 3s — pos sd = noise floor';
  }
  debugCopyBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var txt = debugText.textContent || '';
    var done = function () {
      var prev = debugCopyBtn.textContent;
      debugCopyBtn.textContent = 'Copied';
      setTimeout(function () { debugCopyBtn.textContent = prev; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(function () {
        var r = document.createRange(); r.selectNodeContents(debugText);
        var s = getSelection(); s.removeAllRanges(); s.addRange(r);
        try { document.execCommand('copy'); done(); } catch (err) {}
      });
    } else {
      var r = document.createRange(); r.selectNodeContents(debugText);
      var s = getSelection(); s.removeAllRanges(); s.addRange(r);
      try { document.execCommand('copy'); done(); } catch (err) {}
    }
  });

  // Collapsible panel sections
  function toggleSection(titleEl) {
    var collapsed = titleEl.classList.toggle('collapsed');
    var el = titleEl.nextElementSibling;
    while (el && !el.classList.contains('section-title')) {
      el.style.display = collapsed ? 'none' : '';
      el = el.nextElementSibling;
    }
  }
  var sectionTitles = document.querySelectorAll('#panel .section-title');
  for (var sti = 0; sti < sectionTitles.length; sti++) {
    sectionTitles[sti].addEventListener('click', function () { toggleSection(this); });
  }

  window.addEventListener('pagehide', function () { stop(); });
})();
