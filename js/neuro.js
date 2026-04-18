// SPDX-License-Identifier: MIT
// neuro.js - Behavior + Neuro Screen metric calculations (posture, blink, sway, FFT, etc.).
(function () {
  var KN = window.KN = window.KN || {};
  var H = KN.helpers;

  var dom = {};
  var state = {
    blinkTimes: [],
    blinkStartTime: null,
    eyeClosed: false,
    hipHistory: [],
    asymHistory: [],
    allLmHistory: [],
    noseHistory: [],
    faceLmHistory: [],
    fftBuf: [],
    lastSpectrum: null  // { mags: Float array, fs: Hz, n: points, loBin, hiBin }
  };

  // Latest raw computed values, used by radar / spectrogram renderers.
  var latest = { sym: null, blink: null, sway: null, motor: null, hypo: null, smile: null };

  // Named landmark map for MediaPipe Holistic/Pose body landmarks (33 indices).
  var MP_MAP = {
    nose: 0, lEar: 7, rEar: 8,
    lShoulder: 11, rShoulder: 12,
    lElbow: 13, rElbow: 14,
    lWrist: 15, rWrist: 16,
    lHip: 23, rHip: 24,
    lKnee: 25, rKnee: 26,
    lAnkle: 27, rAnkle: 28
  };

  function conf(lm) {
    if (!lm) return 0;
    if (lm.visibility != null) return lm.visibility;
    if (lm.score != null) return lm.score;
    return 0;
  }

  function bindDom() {
    dom.n_facesym = document.getElementById('n_facesym');
    dom.n_blink = document.getElementById('n_blink');
    dom.n_sway = document.getElementById('n_sway');
    dom.n_motorsym = document.getElementById('n_motorsym');
    dom.n_smile = document.getElementById('n_smile');
    dom.n_mouth = document.getElementById('n_mouth');
    dom.n_brow = document.getElementById('n_brow');
    dom.n_headtremor = document.getElementById('n_headtremor');
    dom.n_tremorhz = document.getElementById('n_tremorhz');
    dom.n_hypo = document.getElementById('n_hypo');
    dom.b_posture = document.getElementById('b_posture');
    dom.b_arms = document.getElementById('b_arms');
    dom.b_stillness = document.getElementById('b_stillness');
    dom.b_headtilt = document.getElementById('b_headtilt');
  }

  function clearPanel() {
    H.setMetric(dom.n_facesym, '-');
    H.setMetric(dom.n_blink, '-');
    H.setMetric(dom.n_sway, '-');
    H.setMetric(dom.n_motorsym, '-');
    H.setMetric(dom.n_smile, '-');
    H.setMetric(dom.n_mouth, '-');
    H.setMetric(dom.n_brow, '-');
    H.setMetric(dom.n_headtremor, '-');
    H.setMetric(dom.n_tremorhz, '-');
    H.setMetric(dom.n_hypo, '-');
    H.setMetric(dom.b_posture, '-');
    H.setMetric(dom.b_arms, '-');
    H.setMetric(dom.b_stillness, '-');
    H.setMetric(dom.b_headtilt, '-');
  }

  function resetState() {
    state.blinkTimes = [];
    state.blinkStartTime = null;
    state.eyeClosed = false;
    state.hipHistory = [];
    state.asymHistory = [];
    state.allLmHistory = [];
    state.noseHistory = [];
    state.faceLmHistory = [];
    state.fftBuf = [];
    state.lastSpectrum = null;
    latest.sym = latest.blink = latest.sway = latest.motor = latest.hypo = latest.smile = null;
  }

  function getLatest() { return latest; }
  function getSpectrum() { return state.lastSpectrum; }

  function computeFaceSymmetry(face) {
    if (!face || face.length < 300) return null;
    var nose = face[1];
    if (!nose) return null;
    var pairs = [[61, 291], [33, 263], [70, 300]];
    var ratios = [];
    for (var i = 0; i < pairs.length; i++) {
      var L = face[pairs[i][0]], R = face[pairs[i][1]];
      if (!L || !R) continue;
      var dL = Math.hypot(L.x - nose.x, L.y - nose.y);
      var dR = Math.hypot(R.x - nose.x, R.y - nose.y);
      if (dL === 0 || dR === 0) continue;
      ratios.push(Math.min(dL, dR) / Math.max(dL, dR));
    }
    if (!ratios.length) return null;
    var s = 0;
    for (var j = 0; j < ratios.length; j++) s += ratios[j];
    return s / ratios.length;
  }

  function computeEAR(face) {
    var lT = face[159], lB = face[145], lO = face[33], lI = face[133];
    var rT = face[386], rB = face[374], rO = face[263], rI = face[362];
    if (!lT || !lB || !lO || !lI || !rT || !rB || !rO || !rI) return null;
    var lV = Math.hypot(lT.x - lB.x, lT.y - lB.y);
    var lH = Math.hypot(lO.x - lI.x, lO.y - lI.y);
    var rV = Math.hypot(rT.x - rB.x, rT.y - rB.y);
    var rH = Math.hypot(rO.x - rI.x, rO.y - rI.y);
    if (lH === 0 || rH === 0) return null;
    return ((lV / lH) + (rV / rH)) / 2;
  }

  function updateBlinkRate(face, now) {
    var ear = computeEAR(face);
    if (ear == null) return null;
    if (state.blinkStartTime == null) state.blinkStartTime = now;
    var CLOSED = 0.15;
    var OPEN = 0.22;
    if (!state.eyeClosed && ear < CLOSED) {
      state.eyeClosed = true;
      state.blinkTimes.push(now);
    } else if (state.eyeClosed && ear > OPEN) {
      state.eyeClosed = false;
    }
    var windowMs = 30000;
    var cutoff = now - windowMs;
    while (state.blinkTimes.length && state.blinkTimes[0] < cutoff) {
      state.blinkTimes.shift();
    }
    var elapsedSec = Math.min(windowMs, now - state.blinkStartTime) / 1000;
    if (elapsedSec < 2) return null;
    return (state.blinkTimes.length / elapsedSec) * 60;
  }

  function updatePosturalSway(pose, now) {
    if (!pose || pose.length < 15) return null;
    var lSh = pose[11], rSh = pose[12];
    if (!lSh || !rSh || (lSh.visibility || 0) < 0.5 || (rSh.visibility || 0) < 0.5) return null;
    var shoulderW = Math.hypot(lSh.x - rSh.x, lSh.y - rSh.y);
    if (shoulderW < 0.01) return null;
    // Prefer hip center; fall back to shoulder center if hips not visible.
    var lHip = pose[23], rHip = pose[24];
    var hipsVis = lHip && rHip && (lHip.visibility || 0) > 0.5 && (rHip.visibility || 0) > 0.5;
    var cx, cy;
    if (hipsVis) { cx = (lHip.x + rHip.x) / 2; cy = (lHip.y + rHip.y) / 2; }
    else { cx = (lSh.x + rSh.x) / 2; cy = (lSh.y + rSh.y) / 2; }
    state.hipHistory.push({ t: now, x: cx, y: cy });
    var cutoff = now - 5000;
    while (state.hipHistory.length && state.hipHistory[0].t < cutoff) {
      state.hipHistory.shift();
    }
    if (state.hipHistory.length < 10) return null;
    var mx = 0, my = 0;
    for (var i = 0; i < state.hipHistory.length; i++) {
      mx += state.hipHistory[i].x; my += state.hipHistory[i].y;
    }
    mx /= state.hipHistory.length; my /= state.hipHistory.length;
    var vx = 0, vy = 0;
    for (var k = 0; k < state.hipHistory.length; k++) {
      vx += Math.pow(state.hipHistory[k].x - mx, 2);
      vy += Math.pow(state.hipHistory[k].y - my, 2);
    }
    vx /= state.hipHistory.length; vy /= state.hipHistory.length;
    var swayMag = Math.sqrt(vx + vy);
    return swayMag / shoulderW;
  }

  function updateMotorSymmetry(ja, now) {
    if (!ja) return null;
    var diffs = [];
    if (ja.a_lshoulder != null && ja.a_rshoulder != null)
      diffs.push(Math.abs(ja.a_lshoulder - ja.a_rshoulder));
    if (ja.a_lelbow != null && ja.a_relbow != null)
      diffs.push(Math.abs(ja.a_lelbow - ja.a_relbow));
    if (ja.a_lhip != null && ja.a_rhip != null)
      diffs.push(Math.abs(ja.a_lhip - ja.a_rhip));
    if (ja.a_lknee != null && ja.a_rknee != null)
      diffs.push(Math.abs(ja.a_lknee - ja.a_rknee));
    if (!diffs.length) return null;
    var avg = 0;
    for (var di = 0; di < diffs.length; di++) avg += diffs[di];
    avg /= diffs.length;
    state.asymHistory.push({ t: now, value: avg });
    var cutoff = now - 5000;
    while (state.asymHistory.length && state.asymHistory[0].t < cutoff) {
      state.asymHistory.shift();
    }
    if (state.asymHistory.length < 5) return null;
    var s = 0;
    for (var i = 0; i < state.asymHistory.length; i++) s += state.asymHistory[i].value;
    return s / state.asymHistory.length;
  }

  // Posture classification from named pose keypoints (MediaPipe-style normalized coords).
  function detectPosture(lm, map) {
    var lSh = lm[map.lShoulder], rSh = lm[map.rShoulder];
    var lHip = lm[map.lHip], rHip = lm[map.rHip];
    var lKn = lm[map.lKnee], rKn = lm[map.rKnee];
    if (!lSh || !rSh || conf(lSh) < 0.4 || conf(rSh) < 0.4) return null;
    var hipsVis = lHip && rHip && conf(lHip) > 0.4 && conf(rHip) > 0.4;
    // Upper-body-only fallback when hips not in frame.
    if (!hipsVis) {
      var shDy = Math.abs(lSh.y - rSh.y);
      var shDx = Math.abs(lSh.x - rSh.x);
      if (shDx < 0.05) return 'upright';
      return shDy / shDx < 0.3 ? 'upright' : 'tilted';
    }
    var shY = (lSh.y + rSh.y) / 2;
    var hipY = (lHip.y + rHip.y) / 2;
    var torsoDy = Math.abs(hipY - shY);
    var torsoDx = Math.abs(((lSh.x + rSh.x) / 2) - ((lHip.x + rHip.x) / 2));
    var torsoTilt = Math.atan2(torsoDx, torsoDy) * 180 / Math.PI; // 0 = vertical
    if (torsoTilt > 55) return 'lying';
    var kneeY = (lKn && rKn && conf(lKn) > 0.4 && conf(rKn) > 0.4) ? (lKn.y + rKn.y) / 2 : null;
    if (kneeY != null) {
      var hipKneeDy = kneeY - hipY;
      if (torsoTilt > 30) return 'bending';
      if (hipKneeDy < 0.03) return 'squatting';
      if (hipKneeDy < 0.12) return 'sitting';
      return 'standing';
    }
    return torsoTilt > 30 ? 'bending' : 'standing';
  }

  function detectArms(lm, map) {
    var lSh = lm[map.lShoulder], rSh = lm[map.rShoulder];
    var lW = lm[map.lWrist], rW = lm[map.rWrist];
    if (!lSh || !rSh) return null;
    if (conf(lSh) < 0.4 || conf(rSh) < 0.4) return null;
    var lUp = lW && conf(lW) > 0.4 && lW.y < lSh.y;
    var rUp = rW && conf(rW) > 0.4 && rW.y < rSh.y;
    if (lUp && rUp) return 'both raised';
    if (lUp || rUp) return 'one raised';
    return 'down';
  }

  function detectHeadTilt(lm, map) {
    var lE = lm[map.lEar], rE = lm[map.rEar];
    if (!lE || !rE || conf(lE) < 0.4 || conf(rE) < 0.4) return null;
    // Sort by x so the angle is always measured from image-left to image-right.
    var leftEar = lE.x < rE.x ? lE : rE;
    var rightEar = lE.x < rE.x ? rE : lE;
    var dx = rightEar.x - leftEar.x;
    var dy = rightEar.y - leftEar.y;
    return Math.atan2(dy, dx) * 180 / Math.PI;
  }

  // Stillness from torso-anchor movement across 1s window. Uses std-dev of the
  // mean position over the window (robust to single-frame spikes). Averages a
  // fixed subset — both shoulders (11,12) + both hips (23,24) — instead of a
  // visibility-gated set, so the subset can't flicker frame-to-frame and
  // inject fake motion into the mean.
  var STILL_ANCHORS = [11, 12, 23, 24];
  function updateStillness(lm, now) {
    var summary = null;
    if (lm && lm.length) {
      var xs = 0, ys = 0, n = 0;
      for (var ai = 0; ai < STILL_ANCHORS.length; ai++) {
        var p = lm[STILL_ANCHORS[ai]];
        if (p && conf(p) > 0.5) { xs += p.x; ys += p.y; n++; }
      }
      if (n >= 2) summary = { t: now, x: xs / n, y: ys / n };
    }
    if (!summary) return null;
    state.allLmHistory.push(summary);
    var cutoff = now - 1000;
    while (state.allLmHistory.length && state.allLmHistory[0].t < cutoff) state.allLmHistory.shift();
    if (state.allLmHistory.length < 5) return null;
    var N = state.allLmHistory.length;
    var mx = 0, my = 0;
    for (var k = 0; k < N; k++) { mx += state.allLmHistory[k].x; my += state.allLmHistory[k].y; }
    mx /= N; my /= N;
    var vx = 0, vy = 0;
    for (var k2 = 0; k2 < N; k2++) {
      var ddx = state.allLmHistory[k2].x - mx;
      var ddy = state.allLmHistory[k2].y - my;
      vx += ddx * ddx; vy += ddy * ddy;
    }
    var sd = Math.sqrt((vx + vy) / N);
    var STILL_THRESH = 0.008;
    window.KN.debug = window.KN.debug || {};
    window.KN.debug.stillSpeed = sd;
    window.KN.debug.stillThresh = STILL_THRESH;
    return sd < STILL_THRESH ? 'still' : 'moving';
  }

  // Head tremor: std-dev of nose position over last 1.5s, normalized by inter-eye distance.
  function updateHeadTremor(face, now) {
    if (!face || face.length < 300) return null;
    var nose = face[1];
    var lEye = face[33], rEye = face[263];
    if (!nose || !lEye || !rEye) return null;
    var ref = Math.hypot(lEye.x - rEye.x, lEye.y - rEye.y);
    if (ref < 0.01) return null;
    state.noseHistory.push({ t: now, x: nose.x, y: nose.y });
    var cutoff = now - 1500;
    while (state.noseHistory.length && state.noseHistory[0].t < cutoff) state.noseHistory.shift();
    if (state.noseHistory.length < 10) return null;
    var mx = 0, my = 0;
    for (var i = 0; i < state.noseHistory.length; i++) { mx += state.noseHistory[i].x; my += state.noseHistory[i].y; }
    mx /= state.noseHistory.length; my /= state.noseHistory.length;
    var vx = 0, vy = 0;
    for (var k = 0; k < state.noseHistory.length; k++) {
      vx += Math.pow(state.noseHistory[k].x - mx, 2);
      vy += Math.pow(state.noseHistory[k].y - my, 2);
    }
    vx /= state.noseHistory.length; vy /= state.noseHistory.length;
    return Math.sqrt(vx + vy) / ref;
  }

  // Smile score: corners-of-mouth height above outer-lip midpoint, normalized by mouth width.
  // >0 smile, ~0 neutral, <0 frown. Uses outer lips (0=upper lip top, 17=lower lip bottom).
  function computeSmile(face) {
    var ul = face[0], ll = face[17], lc = face[61], rc = face[291];
    if (!ul || !ll || !lc || !rc) return null;
    var midY = (ul.y + ll.y) / 2;
    var cornerY = (lc.y + rc.y) / 2;
    var width = Math.hypot(rc.x - lc.x, rc.y - lc.y);
    if (width < 0.01) return null;
    return (midY - cornerY) / width;
  }

  function computeMouthOpen(face) {
    var ul = face[13], ll = face[14], lc = face[61], rc = face[291];
    if (!ul || !ll || !lc || !rc) return null;
    var height = Math.hypot(ll.x - ul.x, ll.y - ul.y);
    var width = Math.hypot(rc.x - lc.x, rc.y - lc.y);
    if (width < 0.01) return null;
    return height / width;
  }

  function computeBrow(face) {
    var lB = face[105], rB = face[334];
    var lBi = face[107], rBi = face[336];
    var lE = face[159], rE = face[386];
    if (!lB || !rB || !lE || !rE || !lBi || !rBi) return null;
    var lGap = Math.abs(lE.y - lB.y);
    var rGap = Math.abs(rE.y - rB.y);
    var browInnerDx = Math.hypot(lBi.x - rBi.x, lBi.y - rBi.y);
    var eyeDx = Math.hypot(lE.x - rE.x, lE.y - rE.y);
    if (eyeDx < 0.01) return null;
    var gap = (lGap + rGap) / 2 / eyeDx;
    var innerRatio = browInnerDx / eyeDx;
    return { gap: gap, innerRatio: innerRatio };
  }

  function updateBehavior(lm, map) {
    var now = performance.now();
    var posture = detectPosture(lm, map);
    H.setMetric(dom.b_posture, posture || '-');
    var arms = detectArms(lm, map);
    var armsCls = arms === 'both raised' || arms === 'one raised' ? 'good' : null;
    H.setMetric(dom.b_arms, arms || '-', armsCls);
    var still = updateStillness(lm, now);
    H.setMetric(dom.b_stillness, still || '-', still === 'still' ? 'good' : (still === 'moving' ? 'warn' : null));
    var tilt = detectHeadTilt(lm, map);
    if (tilt == null) H.setMetric(dom.b_headtilt, '-');
    else {
      var tiltAbs = Math.abs(tilt);
      var tiltCls = tiltAbs < 8 ? 'good' : (tiltAbs < 20 ? 'warn' : 'bad');
      H.setMetric(dom.b_headtilt, tilt.toFixed(1) + ' deg', tiltCls);
    }
  }

  function updateFace(face) {
    var now = performance.now();
    var smile = computeSmile(face);
    if (smile == null) { H.setMetric(dom.n_smile, '-'); latest.smile = null; }
    else {
      var s = Math.max(0, Math.min(1, (smile + 0.02) * 15));
      latest.smile = s;
      var smCls = s > 0.5 ? 'good' : (s > 0.2 ? 'warn' : null);
      H.setMetric(dom.n_smile, s.toFixed(2), smCls);
    }
    var mo = computeMouthOpen(face);
    if (mo == null) H.setMetric(dom.n_mouth, '-');
    else H.setMetric(dom.n_mouth, mo > 0.35 ? 'open' : 'closed', mo > 0.35 ? 'warn' : null);
    var brow = computeBrow(face);
    if (!brow) H.setMetric(dom.n_brow, '-');
    else {
      var label;
      if (brow.innerRatio < 0.17) label = 'furrowed';
      else if (brow.gap > 0.55) label = 'raised';
      else label = 'neutral';
      H.setMetric(dom.n_brow, label, label === 'furrowed' ? 'bad' : (label === 'raised' ? 'warn' : null));
    }
    var tr = updateHeadTremor(face, now);
    if (tr == null) H.setMetric(dom.n_headtremor, '-');
    else {
      var trCls = tr < 0.02 ? 'good' : (tr < 0.05 ? 'warn' : 'bad');
      H.setMetric(dom.n_headtremor, tr.toFixed(3), trCls);
    }
    var thz = computeTremorHz(face, now);
    if (thz == null) H.setMetric(dom.n_tremorhz, '-');
    else {
      var hzCls;
      if (thz >= 4 && thz <= 6) hzCls = 'bad';        // PD rest tremor band
      else if (thz >= 8 && thz <= 12) hzCls = 'warn'; // essential / physiological
      else hzCls = 'good';
      H.setMetric(dom.n_tremorhz, thz.toFixed(1) + ' Hz', hzCls);
    }
    var hypo = computeHypomimia(face, now);
    latest.hypo = hypo;
    if (hypo == null) H.setMetric(dom.n_hypo, '-');
    else {
      var hypoCls = hypo > 0.04 ? 'good' : (hypo > 0.015 ? 'warn' : 'bad');
      H.setMetric(dom.n_hypo, hypo.toFixed(3), hypoCls);
    }
  }

  // Tiny radix-2 in-place FFT. re[] is real input, im[] starts as zeros.
  function fft(re, im) {
    var n = re.length;
    var j = 0;
    for (var i = 0; i < n - 1; i++) {
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
      var k = n >> 1;
      while (k <= j) { j -= k; k >>= 1; }
      j += k;
    }
    for (var s = 1; (1 << s) <= n; s++) {
      var m = 1 << s;
      var halfM = m >> 1;
      var wmRe = Math.cos(-2 * Math.PI / m);
      var wmIm = Math.sin(-2 * Math.PI / m);
      for (var ki = 0; ki < n; ki += m) {
        var wRe = 1, wIm = 0;
        for (var jj = 0; jj < halfM; jj++) {
          var idx = ki + jj;
          var idx2 = idx + halfM;
          var trRe = wRe * re[idx2] - wIm * im[idx2];
          var trIm = wRe * im[idx2] + wIm * re[idx2];
          re[idx2] = re[idx] - trRe; im[idx2] = im[idx] - trIm;
          re[idx] = re[idx] + trRe;  im[idx] = im[idx] + trIm;
          var nwRe = wRe * wmRe - wIm * wmIm;
          wIm = wRe * wmIm + wIm * wmRe;
          wRe = nwRe;
        }
      }
    }
  }

  // Estimate dominant tremor frequency from nose y-position over last ~4s.
  // Returns Hz (0.5-15 Hz band) or null.
  function computeTremorHz(face, now) {
    if (!face || face.length < 100) return null;
    var nose = face[1];
    if (!nose) return null;
    state.fftBuf.push({ t: now, y: nose.y });
    var WIN_MS = 4000;
    var cutoff = now - WIN_MS;
    while (state.fftBuf.length && state.fftBuf[0].t < cutoff) state.fftBuf.shift();
    if (state.fftBuf.length < 64) return null;
    // Resample to power-of-two length at fixed rate via linear interpolation.
    var N = 128;
    var t0 = state.fftBuf[0].t;
    var t1 = state.fftBuf[state.fftBuf.length - 1].t;
    var span = t1 - t0;
    if (span < 2000) return null;
    var fs = N / (span / 1000); // Hz
    var re = new Array(N), im = new Array(N);
    var bi = 0;
    for (var i = 0; i < N; i++) {
      var t = t0 + (span * i) / (N - 1);
      while (bi + 1 < state.fftBuf.length && state.fftBuf[bi + 1].t < t) bi++;
      var b0 = state.fftBuf[bi], b1 = state.fftBuf[Math.min(bi + 1, state.fftBuf.length - 1)];
      var dt = b1.t - b0.t;
      var f = dt > 0 ? (t - b0.t) / dt : 0;
      re[i] = b0.y + (b1.y - b0.y) * f;
      im[i] = 0;
    }
    // Detrend (remove mean) and apply Hann window.
    var mean = 0;
    for (var k1 = 0; k1 < N; k1++) mean += re[k1];
    mean /= N;
    for (var k2 = 0; k2 < N; k2++) {
      var hann = 0.5 * (1 - Math.cos((2 * Math.PI * k2) / (N - 1)));
      re[k2] = (re[k2] - mean) * hann;
    }
    fft(re, im);
    var bestBin = 0, bestMag = 0;
    var minBin = Math.max(1, Math.floor(0.5 * N / fs));
    var maxBin = Math.min(N / 2, Math.ceil(15 * N / fs));
    // Store full spectrum within the band for the spectrogram renderer.
    var mags = new Array(maxBin - minBin + 1);
    for (var b = minBin; b <= maxBin; b++) {
      var mag = re[b] * re[b] + im[b] * im[b];
      mags[b - minBin] = mag;
      if (mag > bestMag) { bestMag = mag; bestBin = b; }
    }
    state.lastSpectrum = { mags: mags, fs: fs, n: N, loBin: minBin, hiBin: maxBin };
    if (bestMag < 1e-7) return null;
    return (bestBin * fs) / N;
  }

  // Hypomimia: facial expressivity proxy from rolling variance of all face landmarks
  // over a 5s window. Lower = less expressive (relates to PD masked-face).
  function computeHypomimia(face, now) {
    if (!face || face.length < 300) return null;
    // Sample 24 stable mid-face landmarks (mouth + brow + eye corners) to keep it cheap.
    var idxs = [0, 17, 13, 14, 61, 291, 78, 308, 33, 263, 133, 362, 105, 334, 107, 336, 65, 295, 70, 300, 159, 386, 145, 374];
    var snap = [];
    for (var i = 0; i < idxs.length; i++) {
      var p = face[idxs[i]];
      if (p) snap.push(p.x, p.y);
    }
    state.faceLmHistory.push({ t: now, snap: snap });
    var cutoff = now - 5000;
    while (state.faceLmHistory.length && state.faceLmHistory[0].t < cutoff) state.faceLmHistory.shift();
    if (state.faceLmHistory.length < 10) return null;
    // Per-coord std-dev, summed.
    var L = state.faceLmHistory.length;
    var dim = state.faceLmHistory[0].snap.length;
    var mean = new Array(dim).fill(0);
    for (var s = 0; s < L; s++) for (var d = 0; d < dim; d++) mean[d] += state.faceLmHistory[s].snap[d];
    for (var d2 = 0; d2 < dim; d2++) mean[d2] /= L;
    var sq = new Array(dim).fill(0);
    for (var s2 = 0; s2 < L; s2++) for (var d3 = 0; d3 < dim; d3++) {
      var dv = state.faceLmHistory[s2].snap[d3] - mean[d3];
      sq[d3] += dv * dv;
    }
    var sum = 0;
    for (var d4 = 0; d4 < dim; d4++) sum += Math.sqrt(sq[d4] / L);
    return sum;
  }

  function update(face, pose, jointAngles) {
    var now = performance.now();

    var sym = computeFaceSymmetry(face);
    latest.sym = sym;
    if (sym == null) H.setMetric(dom.n_facesym, '-');
    else {
      var symCls = sym >= 0.95 ? 'good' : (sym >= 0.88 ? 'warn' : 'bad');
      H.setMetric(dom.n_facesym, sym.toFixed(3), symCls);
    }

    var br = updateBlinkRate(face || [], now);
    latest.blink = br;
    if (br == null) H.setMetric(dom.n_blink, '-');
    else {
      var brCls = (br >= 12 && br <= 25) ? 'good' : ((br >= 6 && br < 12) || (br > 25 && br <= 35) ? 'warn' : 'bad');
      H.setMetric(dom.n_blink, br.toFixed(1), brCls);
    }

    var sway = updatePosturalSway(pose, now);
    latest.sway = sway;
    if (sway == null) H.setMetric(dom.n_sway, '-');
    else {
      var swCls = sway < 0.03 ? 'good' : (sway < 0.07 ? 'warn' : 'bad');
      H.setMetric(dom.n_sway, sway.toFixed(3), swCls);
    }

    var ms = updateMotorSymmetry(jointAngles, now);
    latest.motor = ms;
    if (ms == null) H.setMetric(dom.n_motorsym, '-');
    else {
      var msCls = ms < 10 ? 'good' : (ms < 25 ? 'warn' : 'bad');
      H.setMetric(dom.n_motorsym, ms.toFixed(1) + ' deg', msCls);
    }
  }

  KN.neuro = {
    bindDom: bindDom,
    clearPanel: clearPanel,
    resetState: resetState,
    update: update,
    updateBehavior: updateBehavior,
    updateFace: updateFace,
    getLatest: getLatest,
    getSpectrum: getSpectrum,
    MP_MAP: MP_MAP
  };
})();
