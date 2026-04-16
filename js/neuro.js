(function () {
  var KN = window.KN = window.KN || {};
  var H = KN.helpers;

  var dom = {};
  var state = {
    blinkTimes: [],
    eyeClosed: false,
    hipHistory: [],
    asymHistory: []
  };

  function bindDom() {
    dom.n_facesym = document.getElementById('n_facesym');
    dom.n_blink = document.getElementById('n_blink');
    dom.n_sway = document.getElementById('n_sway');
    dom.n_motorsym = document.getElementById('n_motorsym');
    dom.neuroHint = document.getElementById('neuroHint');
  }

  function clearPanel() {
    H.setMetric(dom.n_facesym, '-');
    H.setMetric(dom.n_blink, '-');
    H.setMetric(dom.n_sway, '-');
    H.setMetric(dom.n_motorsym, '-');
  }

  function resetState() {
    state.blinkTimes = [];
    state.eyeClosed = false;
    state.hipHistory = [];
    state.asymHistory = [];
  }

  function setHintVisible(visible) {
    dom.neuroHint.classList.toggle('hidden', !visible);
  }

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
    var elapsedSec = Math.min(windowMs, now - (state.blinkTimes.length ? state.blinkTimes[0] : now - 1000)) / 1000;
    if (elapsedSec < 2) return null;
    return (state.blinkTimes.length / elapsedSec) * 60;
  }

  function updatePosturalSway(pose, now) {
    if (!pose || pose.length < 25) return null;
    var lHip = pose[23], rHip = pose[24], lSh = pose[11], rSh = pose[12];
    if (!lHip || !rHip || !lSh || !rSh) return null;
    var visOK = (lHip.visibility || 0) > 0.5 && (rHip.visibility || 0) > 0.5 && (lSh.visibility || 0) > 0.5 && (rSh.visibility || 0) > 0.5;
    if (!visOK) return null;
    var hx = (lHip.x + rHip.x) / 2, hy = (lHip.y + rHip.y) / 2;
    var shoulderW = Math.hypot(lSh.x - rSh.x, lSh.y - rSh.y);
    if (shoulderW < 0.01) return null;
    state.hipHistory.push({ t: now, x: hx, y: hy });
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
    if (ja.a_lshoulder == null || ja.a_rshoulder == null) return null;
    if (ja.a_lelbow == null || ja.a_relbow == null) return null;
    var shDiff = Math.abs(ja.a_lshoulder - ja.a_rshoulder);
    var elDiff = Math.abs(ja.a_lelbow - ja.a_relbow);
    var avg = (shDiff + elDiff) / 2;
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

  function update(face, pose, jointAngles) {
    var now = performance.now();

    var sym = computeFaceSymmetry(face);
    if (sym == null) H.setMetric(dom.n_facesym, '-');
    else {
      var symCls = sym >= 0.95 ? 'good' : (sym >= 0.88 ? 'warn' : 'bad');
      H.setMetric(dom.n_facesym, sym.toFixed(3), symCls);
    }

    var br = updateBlinkRate(face || [], now);
    if (br == null) H.setMetric(dom.n_blink, '-');
    else {
      var brCls = (br >= 12 && br <= 25) ? 'good' : ((br >= 6 && br < 12) || (br > 25 && br <= 35) ? 'warn' : 'bad');
      H.setMetric(dom.n_blink, br.toFixed(1), brCls);
    }

    var sway = updatePosturalSway(pose, now);
    if (sway == null) H.setMetric(dom.n_sway, '-');
    else {
      var swCls = sway < 0.03 ? 'good' : (sway < 0.07 ? 'warn' : 'bad');
      H.setMetric(dom.n_sway, sway.toFixed(3), swCls);
    }

    var ms = updateMotorSymmetry(jointAngles, now);
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
    setHintVisible: setHintVisible,
    update: update
  };
})();
