// SPDX-License-Identifier: MIT
// multi-app.js - DOM bindings, rAF loop, camera lifecycle for multi-person Tasks API.
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

  var gestureWidget = document.getElementById('gestureWidget');
  var bsGrid = document.getElementById('bsGrid');

  var ftLrate = document.getElementById('ft_lrate');
  var ftRrate = document.getElementById('ft_rrate');
  var ftLtotal = document.getElementById('ft_ltotal');
  var ftRtotal = document.getElementById('ft_rtotal');
  var ftCanvas = document.getElementById('fingerTapCanvas');
  var ftResetBtn = document.getElementById('ftResetBtn');
  if (ftResetBtn && KN.playFingerTap) {
    ftResetBtn.addEventListener('click', function () { KN.playFingerTap.reset(); });
  }

  var hcYaw = document.getElementById('hc_yaw');
  var hcHold = document.getElementById('hc_hold');
  var hcBest = document.getElementById('hc_best');
  var compassCanvas = document.getElementById('compassCanvas');
  var hcStartBtn = document.getElementById('hcStartBtn');
  var hcResetBtn = document.getElementById('hcResetBtn');
  if (hcStartBtn && KN.playCompass) {
    hcStartBtn.addEventListener('click', function () {
      if (KN.playCompass.isInChallenge()) { KN.playCompass.stopChallenge(); hcStartBtn.textContent = 'Start Hold-Center Challenge'; hcStartBtn.classList.remove('on'); }
      else { KN.playCompass.startChallenge(); hcStartBtn.textContent = 'Stop Challenge'; hcStartBtn.classList.add('on'); }
    });
  }
  if (hcResetBtn && KN.playCompass) hcResetBtn.addEventListener('click', function () { KN.playCompass.resetBest(); });

  var rpCount = document.getElementById('rp_count');
  var rpPhase = document.getElementById('rp_phase');
  var rpLast = document.getElementById('rp_last');
  var rpBest = document.getElementById('rp_best');
  var rpDur = document.getElementById('rp_dur');
  var repsCanvas = document.getElementById('repsCanvas');
  var rpSquatBtn = document.getElementById('rpModeSquatBtn');
  var rpArmBtn = document.getElementById('rpModeArmBtn');
  var rpResetBtn = document.getElementById('rpResetBtn');
  function syncRepsMode() {
    var m = KN.playReps && KN.playReps.mode();
    if (rpSquatBtn) rpSquatBtn.classList.toggle('on', m === 'squat');
    if (rpArmBtn) rpArmBtn.classList.toggle('on', m === 'armRaise');
  }
  if (rpSquatBtn && KN.playReps) rpSquatBtn.addEventListener('click', function () { KN.playReps.setMode('squat'); syncRepsMode(); });
  if (rpArmBtn && KN.playReps) rpArmBtn.addEventListener('click', function () { KN.playReps.setMode('armRaise'); syncRepsMode(); });
  if (rpResetBtn && KN.playReps) rpResetBtn.addEventListener('click', function () { KN.playReps.reset(); });
  syncRepsMode();

  var hsHeld = document.getElementById('hs_held');
  var hsBest = document.getElementById('hs_best');
  var hsVerdict = document.getElementById('hs_verdict');
  var holdCanvas = document.getElementById('holdCanvas');
  var hsStart10 = document.getElementById('hsStart10');
  var hsStart30 = document.getElementById('hsStart30');
  var hsStart60 = document.getElementById('hsStart60');
  var hsCancel = document.getElementById('hsCancel');
  var hsResetBest = document.getElementById('hsResetBest');
  if (hsStart10 && KN.playHoldStill) hsStart10.addEventListener('click', function () { KN.playHoldStill.start(10000); });
  if (hsStart30 && KN.playHoldStill) hsStart30.addEventListener('click', function () { KN.playHoldStill.start(30000); });
  if (hsStart60 && KN.playHoldStill) hsStart60.addEventListener('click', function () { KN.playHoldStill.start(60000); });
  if (hsCancel && KN.playHoldStill) hsCancel.addEventListener('click', function () { KN.playHoldStill.cancel(); });
  if (hsResetBest && KN.playHoldStill) hsResetBest.addEventListener('click', function () { KN.playHoldStill.resetBest(); });

  var currentTab = 'body';
  var currentSub = { body: 'angles', face: 'expression', signals: 'tremor', play: 'fingertap' };
  function isActive(main, sub) { return currentTab === main && (sub ? currentSub[main] === sub : true); }
  var tabButtons = document.querySelectorAll('.tab-bar .tab');
  var tabPanes = document.querySelectorAll('.tab-pane');
  for (var ti = 0; ti < tabButtons.length; ti++) {
    tabButtons[ti].addEventListener('click', function () {
      var name = this.getAttribute('data-tab');
      currentTab = name;
      for (var i = 0; i < tabButtons.length; i++) tabButtons[i].classList.toggle('active', tabButtons[i] === this);
      for (var j = 0; j < tabPanes.length; j++) tabPanes[j].classList.toggle('active', tabPanes[j].getAttribute('data-pane') === name);
    });
  }
  var subtabBars = document.querySelectorAll('.subtab-bar');
  for (var sbi = 0; sbi < subtabBars.length; sbi++) {
    (function (bar) {
      var parent = bar.getAttribute('data-sub-of');
      var btns = bar.querySelectorAll('.subtab');
      for (var k = 0; k < btns.length; k++) {
        btns[k].addEventListener('click', function () {
          var sub = this.getAttribute('data-sub');
          currentSub[parent] = sub;
          for (var m = 0; m < btns.length; m++) btns[m].classList.toggle('active', btns[m] === this);
          var panes = document.querySelectorAll('.tab-pane[data-pane="' + parent + '"] .subtab-pane');
          for (var n = 0; n < panes.length; n++) {
            panes[n].classList.toggle('active', panes[n].getAttribute('data-subpane') === parent + '/' + sub);
          }
        });
      }
    })(subtabBars[sbi]);
  }

  // --- Blend shapes UI ---
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
    if (Object.keys(bsRows).length || !bsGrid) return;
    for (var i = 0; i < BLEND_KEYS.length; i++) {
      var key = BLEND_KEYS[i], row = document.createElement('div');
      row.className = 'bs-row';
      row.innerHTML = '<span class="bs-label">' + key + '</span><span class="bs-bar"><span class="bs-fill" style="width:0%"></span></span><span class="bs-val">0.00</span>';
      bsGrid.appendChild(row);
      bsRows[key] = { fill: row.querySelector('.bs-fill'), val: row.querySelector('.bs-val') };
    }
  }

  function updateBlendShapes(categories) {
    if (!categories || !Object.keys(bsRows).length) return;
    var map = {};
    for (var i = 0; i < categories.length; i++) map[categories[i].categoryName] = categories[i].score;
    for (var j = 0; j < BLEND_KEYS.length; j++) {
      var k = BLEND_KEYS[j], s = map[k] || 0, row = bsRows[k];
      if (!row) continue;
      row.fill.style.width = (s * 100).toFixed(1) + '%';
      row.val.textContent = s.toFixed(2);
    }
  }

  function updateGesture(gestures, handednesses) {
    if (!gestureWidget) return;
    if (!gestures || !gestures.length) { gestureWidget.style.display = 'none'; return; }
    var parts = [];
    for (var i = 0; i < gestures.length; i++) {
      var g = gestures[i] && gestures[i][0];
      if (!g || g.categoryName === 'None') continue;
      var hl = (handednesses[i] && handednesses[i][0] && handednesses[i][0].displayName) || ('H' + (i+1));
      parts.push('<span class="ghand">' + hl + '</span><span class="gname">' + g.categoryName + '</span><span class="gscore">' + (g.score*100).toFixed(0) + '%</span>');
    }
    if (!parts.length) { gestureWidget.style.display = 'none'; return; }
    gestureWidget.innerHTML = parts.join(' &nbsp; ');
    gestureWidget.style.display = 'block';
  }

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
    H.setMetric(m_visible, '-');
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
    badge.textContent = stats.numPersons + 'P ' + (stats.numFaces || 0) + 'F ' + (stats.numHands || 0) + 'H';
    badge.classList.add('tracking');
    badge.classList.remove('lost');
    H.setMetric(m_persons, stats.numPersons + ' body, ' + (stats.numFaces || 0) + ' face, ' + (stats.numHands || 0) + ' hand', stats.numPersons > 1 ? 'good' : null);
    H.setMetric(m_visible, stats.landmarkCount + ' / ' + stats.totalLandmarks, stats.landmarkCount >= 20 ? 'good' : 'warn');
    var mc = stats.meanConfidence;
    H.setMetric(m_conf, mc.toFixed(2), mc >= 0.75 ? 'good' : (mc >= 0.5 ? 'warn' : 'bad'));
    var ja = stats.jointAngles || {};
    for (var i = 0; i < C.ANGLE_DEFS.length; i++) {
      var d = C.ANGLE_DEFS[i], el = document.getElementById(d.key), v = ja[d.key];
      if (v == null) H.setMetric(el, '-');
      else H.setMetric(el, v.toFixed(1) + ' deg');
    }
    // Neuro metrics for primary person (always runs to keep rolling buffers fed).
    if (KN.multiNeuro) KN.multiNeuro.process(stats);
    // Gestures: widget is on the canvas stage, always render.
    try { updateGesture(stats.gestures, stats.gestureHandednesses); } catch (e) {}
    // Blend shapes are ~18 DOM writes/frame — only update when that subtab is active.
    if (isActive('face', 'blend')) { try { updateBlendShapes(stats.blendShapes); } catch (e) {} }
    // Play widgets: processing always runs; DOM/canvas writes gated below.
    var now = performance.now();
    if (KN.playFingerTap) {
      try { KN.playFingerTap.process(stats.handLandmarks, stats.handHandednesses, now); } catch (e) {}
    }
    if (KN.playCompass) { try { KN.playCompass.process(stats.bestFaceLms, now); } catch (e) {} }
    if (KN.playReps) { try { KN.playReps.process(stats.jointAngles, now); } catch (e) {} }
    if (KN.playHoldStill) { try { KN.playHoldStill.process(now); } catch (e) {} }
    // DOM writes for the active Play subtab only.
    if (isActive('play', 'fingertap') && KN.playFingerTap) {
      try {
        var lr = KN.playFingerTap.rate('L'), rr = KN.playFingerTap.rate('R');
        if (ftLrate) H.setMetric(ftLrate, lr.toFixed(2), lr > 2 ? 'good' : null);
        if (ftRrate) H.setMetric(ftRrate, rr.toFixed(2), rr > 2 ? 'good' : null);
        if (ftLtotal) H.setMetric(ftLtotal, String(KN.playFingerTap.total('L')));
        if (ftRtotal) H.setMetric(ftRtotal, String(KN.playFingerTap.total('R')));
      } catch (e) {}
    }
    if (isActive('play', 'compass') && KN.playCompass) {
      var y = KN.playCompass.getYaw();
      H.setMetric(hcYaw, y == null ? '-' : y.toFixed(1) + '°');
      var hold = KN.playCompass.getHold();
      H.setMetric(hcHold, KN.playCompass.isInChallenge() ? (hold / 1000).toFixed(1) + 's' : '-');
      H.setMetric(hcBest, KN.playCompass.getBest() > 0 ? (KN.playCompass.getBest() / 1000).toFixed(1) + 's' : '-');
    }
    if (isActive('play', 'reps') && KN.playReps) {
      H.setMetric(rpCount, String(KN.playReps.count()));
      H.setMetric(rpPhase, KN.playReps.phase());
      var lr2 = KN.playReps.lastRom();
      H.setMetric(rpLast, lr2 == null ? '-' : lr2.toFixed(0) + '°');
      H.setMetric(rpBest, KN.playReps.bestRom() === 0 ? '-' : KN.playReps.bestRom().toFixed(0) + '°');
      var ld = KN.playReps.lastDurMs();
      H.setMetric(rpDur, ld == null ? '-' : (ld / 1000).toFixed(1) + 's');
    }
    if (isActive('play', 'holdstill') && KN.playHoldStill) {
      var held = KN.playHoldStill.heldMs();
      H.setMetric(hsHeld, held > 0 || KN.playHoldStill.isRunning() ? (held / 1000).toFixed(1) + 's' : '-');
      var bm = KN.playHoldStill.bestMs();
      H.setMetric(hsBest, bm > 0 ? (bm / 1000).toFixed(1) + 's' : '-');
      var v = (KN.multiStill && KN.multiStill.lastVerdict) || '-';
      H.setMetric(hsVerdict, v, v === 'still' ? 'good' : (v === 'moving' ? 'warn' : null));
    }
  }

  function updateViz() {
    vizFrame++;
    if (!KN.viz) return;
    if (isActive('signals', 'radar') && radarCvs && (vizFrame % 8) === 0) {
      try { KN.viz.drawRadar(radarCvs, KN.neuro.getLatest()); } catch (e) {}
    }
    if (isActive('signals', 'spectrogram') && specCvs && (vizFrame % 3) === 0) {
      var spec = KN.neuro.getSpectrum();
      if (spec) { try { KN.viz.drawSpectrogramColumn(spec); } catch (e) {} }
    }
    if (isActive('play', 'fingertap') && ftCanvas && KN.playFingerTap && (vizFrame % 2) === 0) {
      try { KN.playFingerTap.draw(ftCanvas); } catch (e) {}
    }
    if (isActive('play', 'compass') && compassCanvas && KN.playCompass && (vizFrame % 2) === 0) {
      try { KN.playCompass.draw(compassCanvas); } catch (e) {}
    }
    if (isActive('play', 'reps') && repsCanvas && KN.playReps && (vizFrame % 2) === 0) {
      try { KN.playReps.draw(repsCanvas); } catch (e) {}
    }
    if (isActive('play', 'holdstill') && holdCanvas && KN.playHoldStill) {
      try { KN.playHoldStill.draw(holdCanvas); } catch (e) {}
    }
  }

  function tickFps() {
    frameCount++;
    var now = performance.now();
    if (now - lastFpsUpdate >= 500) {
      fpsEl.textContent = Math.round((frameCount * 1000) / (now - lastFpsUpdate)) + ' FPS';
      frameCount = 0; lastFpsUpdate = now;
    }
  }

  function stopCurrentStream() {
    return new Promise(function (resolve) {
      if (currentStream) { currentStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); currentStream = null; }
      if (video.srcObject) video.srcObject = null;
      resolve();
    });
  }

  async function startStream() {
    var stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } } }); }
    catch (e) { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 } } }); }
    currentStream = stream; video.srcObject = stream;
    await new Promise(function (resolve) { if (video.readyState >= 2) return resolve(); video.onloadedmetadata = function () { resolve(); }; });
    try { await video.play(); } catch (e) {}
  }

  function rafLoop() {
    if (!running) return;
    rafId = requestAnimationFrame(function () {
      if (!running) return;
      KN.multiModel.run(video, canvas, ctx).then(function (stats) {
        if (!running) return;
        try { updateMetrics(stats); } catch (e) {}
        try { updateViz(); } catch (e) {}
        try { updateDebug(); } catch (e) {}
        tickFps(); rafLoop();
      }).catch(function (err) { console.error('[kineneo-multi] run:', err); if (running) rafLoop(); });
    });
  }

  async function start() {
    if (running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setStatus('Camera API not available.', true); return; }
    startBtn.disabled = true; setStatus('Requesting camera access...');
    try { await startStream(); } catch (err) { setStatus('Camera error: ' + (err.message || 'unknown'), true); startBtn.disabled = false; return; }
    if (!modelReady) {
      try { await KN.multiModel.init(function (msg) { setStatus(msg); }); modelReady = true; }
      catch (err) { setStatus('Failed to load models: ' + (err.message || 'unknown'), true); startBtn.disabled = false; await stopCurrentStream(); return; }
    }
    H.ensureCanvasSize(canvas, video.videoWidth || 640, video.videoHeight || 480);
    placeholder.style.display = 'none'; canvas.style.display = 'block'; fpsEl.style.display = 'block'; badge.style.display = 'block';
    panel.classList.remove('hidden');
    [flipBtn, labelsBtn, anglesBtn, skeletonBtn].forEach(function (b) { b.disabled = false; });
    startBtn.textContent = 'Stop'; startBtn.disabled = false;
    running = true; clearPanel(); buildBlendShapeRows(); setStatus('');
    frameCount = 0; lastFpsUpdate = performance.now(); rafLoop();
  }

  async function stop() {
    running = false; if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    await stopCurrentStream();
    if (KN.viz) KN.viz.clearSpectrogram();
    if (gestureWidget) gestureWidget.style.display = 'none';
    canvas.style.display = 'none'; fpsEl.style.display = 'none'; badge.style.display = 'none';
    panel.classList.add('hidden'); placeholder.style.display = 'flex';
    [flipBtn, labelsBtn, anglesBtn, skeletonBtn].forEach(function (b) { b.disabled = true; });
    startBtn.textContent = 'Start Camera'; startBtn.disabled = false; setStatus('');
  }

  async function flip() {
    if (!running) return; flipBtn.disabled = true;
    facingMode = (facingMode === 'environment') ? 'user' : 'environment';
    try {
      running = false; if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (currentStream) { currentStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); currentStream = null; }
      await startStream(); H.ensureCanvasSize(canvas, video.videoWidth || 640, video.videoHeight || 480);
      running = true; frameCount = 0; lastFpsUpdate = performance.now(); rafLoop();
    } catch (err) { setStatus('Could not switch camera.', true); }
    finally { flipBtn.disabled = !running; }
  }

  // Skeleton cycling: Off → Skeleton → Void
  var SK_MODES = [
    { skel: false, bg: 'none', label: 'Skeleton Off' },
    { skel: true, bg: 'none', label: 'Skeleton' },
    { skel: true, bg: 'void', label: 'Skel: Void' }
  ];
  var skModeIdx = 0;

  startBtn.addEventListener('click', function () { if (running) stop(); else start(); });
  flipBtn.addEventListener('click', flip);
  labelsBtn.addEventListener('click', function () { KN.state.showLabels = !KN.state.showLabels; labelsBtn.classList.toggle('on', KN.state.showLabels); });
  anglesBtn.addEventListener('click', function () { KN.state.showAngles = !KN.state.showAngles; anglesBtn.classList.toggle('on', KN.state.showAngles); });
  skeletonBtn.addEventListener('click', function () {
    skModeIdx = (skModeIdx + 1) % SK_MODES.length;
    var m = SK_MODES[skModeIdx]; KN.state.skeletonOnly = m.skel; KN.state.skeletonBg = m.bg;
    skeletonBtn.textContent = m.label; skeletonBtn.classList.toggle('on', m.skel);
  });

  function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function requestFs(el) { if (el.requestFullscreen) return el.requestFullscreen(); if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen(); }
  function exitFs() { if (document.exitFullscreen) return document.exitFullscreen(); if (document.webkitExitFullscreen) return document.webkitExitFullscreen(); }
  function syncFsBtn() { var on = isFullscreen(); fullscreenBtn.classList.toggle('on', on); fullscreenBtn.textContent = on ? 'Exit Fullscreen' : 'Fullscreen'; }
  fullscreenBtn.addEventListener('click', function () { if (isFullscreen()) exitFs(); else requestFs(document.documentElement); });

  var debugOn = false;
  var debugCalibBtn = document.getElementById('debugCalibBtn');
  var debugResetBtn = document.getElementById('debugResetBtn');
  debugBtn.addEventListener('click', function () {
    debugOn = !debugOn;
    debugBtn.classList.toggle('on', debugOn);
    debugOverlay.style.display = debugOn ? 'block' : 'none';
  });
  var calibState = null; // { start: ts, samples: [] }
  function startCalibration() {
    calibState = { start: performance.now(), samples: [] };
    debugCalibBtn.textContent = 'Hold still...';
    debugCalibBtn.disabled = true;
  }
  function finishCalibration() {
    var samples = calibState.samples.slice().sort(function (a, b) { return a - b; });
    calibState = null;
    debugCalibBtn.textContent = 'Calibrate';
    debugCalibBtn.disabled = false;
    if (samples.length < 10) return; // too few, bail
    var median = samples[Math.floor(samples.length / 2)];
    var cfg = KN.multiStill;
    cfg.enter = Math.max(0.001, median * 2.5);
    cfg.exit = Math.max(cfg.enter + 0.001, median * 4);
  }
  function updateDebug() {
    if (!debugOn) return;
    var d = KN.multiDebug || {};
    var cfg = KN.multiStill || {};
    var fmt = function (v) { return (v == null ? '-' : v.toFixed(4)); };
    var sd = d.stillSpeed;
    var vLast = cfg.lastVerdict ? cfg.lastVerdict.toUpperCase() : '-';
    if (calibState && sd != null) {
      calibState.samples.push(sd);
      var elapsed = performance.now() - calibState.start;
      if (elapsed >= 3000) finishCalibration();
    }
    var calibLine = calibState
      ? '\nCALIBRATING... ' + Math.max(0, (3 - (performance.now() - calibState.start) / 1000)).toFixed(1) + 's  (' + calibState.samples.length + ' samples)'
      : '';
    debugText.textContent =
      'POSE SMOOTHING\n' +
      '  raw vel max : ' + fmt(d.maxRawVel) + '\n' +
      '  smooth vel  : ' + fmt(d.maxSmoothVel) + '\n' +
      '  alpha max   : ' + fmt(d.maxAlpha) + '\n' +
      '  (min ' + fmt(d.smoothMin) + '  max ' + fmt(d.smoothMax) + '  ref ' + fmt(d.velRef) + ')\n' +
      '\nSTILLNESS (sd, 1s, torso anchors)\n' +
      '  pos sd      : ' + fmt(sd) + '\n' +
      '  enter still : ' + fmt(cfg.enter) + '\n' +
      '  exit still  : ' + fmt(cfg.exit) + '\n' +
      '  verdict     : ' + vLast +
      calibLine + '\n' +
      '\nTIP: stand still 3s — raw/smooth/sd = noise floor';
  }
  debugCalibBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!calibState) startCalibration();
  });
  debugResetBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var cfg = KN.multiStill;
    if (cfg) { cfg.enter = 0.006; cfg.exit = 0.010; }
    if (calibState) { calibState = null; debugCalibBtn.textContent = 'Calibrate'; debugCalibBtn.disabled = false; }
  });
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
  document.addEventListener('fullscreenchange', syncFsBtn);
  document.addEventListener('webkitfullscreenchange', syncFsBtn);
  // Collapsible panel sections — click title to toggle content until next title
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
  // Default: collapse Neuro + Blend Shapes to keep panel compact on multi
  sectionTitles.forEach(function (t) {
    var txt = t.textContent.toLowerCase();
    if (txt.indexOf('neuro') >= 0 || txt.indexOf('blend') >= 0) toggleSection(t);
  });

  window.addEventListener('pagehide', function () { stop(); });
})();
