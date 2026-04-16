// app.js - DOM bindings, rAF loop, camera lifecycle, model switching, and event listeners.
(function () {
  var KN = window.KN = window.KN || {};
  var H = KN.helpers;
  var C = KN.constants;
  var MODEL_INFO = C.MODEL_INFO;

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
  var modelSubtitle = document.getElementById('modelSubtitle');

  var m_status = document.getElementById('m_status');
  var m_persons = document.getElementById('m_persons');
  var m_visible = document.getElementById('m_visible');
  var m_conf = document.getElementById('m_conf');
  var m_model = document.getElementById('m_model');

  var mdlBtns = {
    pose: document.getElementById('mdl_pose'),
    holistic: document.getElementById('mdl_holistic'),
    movenet: document.getElementById('mdl_movenet')
  };

  KN.neuro.bindDom();
  if (KN.spark) KN.spark.bind();

  var currentStream = null;
  var facingMode = 'environment';
  var running = false;
  var activeModel = null;
  var switching = false;
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
    H.setMetric(m_visible, '- / ' + MODEL_INFO[KN.state.activeModelKey].total);
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
    var total = stats.totalLandmarks || MODEL_INFO[KN.state.activeModelKey].total;
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

  function rafLoop() {
    if (!running) return;
    rafId = requestAnimationFrame(function () {
      if (!running || !activeModel) return;
      activeModel.run(video, canvas, ctx).then(function (stats) {
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

  function setModelBtns(disabled) {
    Object.keys(mdlBtns).forEach(function (k) { mdlBtns[k].disabled = disabled; });
  }

  function highlightModelBtn(key) {
    Object.keys(mdlBtns).forEach(function (k) {
      mdlBtns[k].classList.toggle('on', k === key);
    });
    modelSubtitle.textContent = MODEL_INFO[key].desc;
    m_model.textContent = MODEL_INFO[key].name;
    KN.neuro.setHintVisible(key !== 'holistic');
    KN.neuro.resetState();
    KN.neuro.clearPanel();
    if (KN.clearTrails) KN.clearTrails();
    if (KN.spark) KN.spark.clearAll();
  }

  function switchModel(key) {
    if (key === KN.state.activeModelKey && activeModel) return Promise.resolve();
    if (switching) return Promise.resolve();
    switching = true;
    setModelBtns(true);
    var wasRunning = running;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (activeModel) { activeModel.destroy(); activeModel = null; }
    KN.state.activeModelKey = key;
    highlightModelBtn(key);
    setStatus('Loading ' + MODEL_INFO[key].name + '...');
    return KN.models[key].init().then(function () {
      activeModel = KN.models[key];
      switching = false;
      setModelBtns(false);
      clearPanel();
      setStatus('');
      if (wasRunning) rafLoop();
    }).catch(function (err) {
      switching = false;
      setModelBtns(false);
      setStatus('Failed to load ' + MODEL_INFO[key].name + ': ' + (err && err.message ? err.message : 'unknown'), true);
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
      await switchModel(KN.state.activeModelKey);
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
    } catch (err) {
      handleCameraError(err);
    }
  }

  async function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (activeModel) { activeModel.destroy(); activeModel = null; }
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

  Object.keys(mdlBtns).forEach(function (key) {
    mdlBtns[key].addEventListener('click', function () {
      if (switching || key === KN.state.activeModelKey) return;
      if (running) {
        running = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        if (activeModel) { activeModel.destroy(); activeModel = null; }
        stopCurrentStream().then(function () {
          return switchModel(key);
        }).then(function () {
          return startStream();
        }).then(function () {
          H.ensureCanvasSize(canvas, video.videoWidth || 640, video.videoHeight || 480);
          running = true;
          frameCount = 0; lastFpsUpdate = performance.now();
          rafLoop();
        }).catch(function (err) {
          setStatus('Could not restart camera: ' + (err && err.message ? err.message : 'unknown'), true);
        });
      } else {
        KN.state.activeModelKey = key;
        highlightModelBtn(key);
      }
    });
  });

  highlightModelBtn('holistic');
  window.addEventListener('pagehide', function () { stop(); });
})();
