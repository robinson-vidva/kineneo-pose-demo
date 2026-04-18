// SPDX-License-Identifier: MIT
// play-compass.js - head yaw (turn L/R) estimator + needle drawer.
// Yaw estimate: nose-tip x-offset from midpoint of outer face-contour points
// (234 = left temple, 454 = right temple in MediaPipe Face Mesh).
// Positive = head turned right, negative = head turned left.
(function () {
  var KN = window.KN = window.KN || {};

  var state = { yawDeg: null, best: 0, challengeStart: 0, challengeHoldMs: 0, inChallenge: false };

  var MAX_YAW_DEG = 45;

  function process(face, now) {
    if (!face || face.length < 460) { state.yawDeg = null; return; }
    var nose = face[1], left = face[234], right = face[454];
    if (!nose || !left || !right) { state.yawDeg = null; return; }
    var w = right.x - left.x;
    if (Math.abs(w) < 0.01) { state.yawDeg = null; return; }
    var midX = (left.x + right.x) / 2;
    var norm = (nose.x - midX) / (w / 2); // ~-1..+1
    // Flip so looking right of camera reads positive (mirror-friendly).
    var yaw = -Math.max(-1, Math.min(1, norm)) * MAX_YAW_DEG;
    state.yawDeg = yaw;
    if (state.inChallenge) {
      if (Math.abs(yaw) < 3) {
        state.challengeHoldMs = now - state.challengeStart;
        if (state.challengeHoldMs > state.best) state.best = state.challengeHoldMs;
      } else {
        state.challengeStart = now;
        state.challengeHoldMs = 0;
      }
    }
  }

  function startChallenge() { state.inChallenge = true; state.challengeStart = performance.now(); state.challengeHoldMs = 0; }
  function stopChallenge() { state.inChallenge = false; }
  function resetBest() { state.best = 0; }

  function getYaw() { return state.yawDeg; }
  function getBest() { return state.best; }
  function getHold() { return state.challengeHoldMs; }
  function isInChallenge() { return state.inChallenge; }

  function draw(cvs) {
    if (!cvs) return;
    var ctx = cvs.getContext('2d');
    var w = cvs.width, h = cvs.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(5,8,16,0.7)';
    ctx.fillRect(0, 0, w, h);
    // scale bar
    var midY = h / 2 + 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(10, midY); ctx.lineTo(w - 10, midY); ctx.stroke();
    // ticks every 15 deg
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    for (var d = -45; d <= 45; d += 15) {
      var x = 10 + ((d + 45) / 90) * (w - 20);
      ctx.beginPath(); ctx.moveTo(x, midY - 4); ctx.lineTo(x, midY + 4); ctx.stroke();
      ctx.fillText(d + '°', x, midY + 18);
    }
    // centered zone
    var cz0 = 10 + ((-3 + 45) / 90) * (w - 20);
    var cz1 = 10 + ((3 + 45) / 90) * (w - 20);
    ctx.fillStyle = 'rgba(0,255,136,0.08)';
    ctx.fillRect(cz0, midY - 14, cz1 - cz0, 28);
    // needle
    if (state.yawDeg != null) {
      var clamped = Math.max(-45, Math.min(45, state.yawDeg));
      var nx = 10 + ((clamped + 45) / 90) * (w - 20);
      ctx.strokeStyle = Math.abs(state.yawDeg) < 3 ? '#00FF88' : '#7FD8FF';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(nx, midY - 18); ctx.lineTo(nx, midY + 18); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.textAlign = 'left';
      ctx.fillText(state.yawDeg.toFixed(1) + '°', 10, 16);
    } else {
      ctx.fillStyle = '#666'; ctx.textAlign = 'left';
      ctx.fillText('face not detected', 10, 16);
    }
    // challenge status
    if (state.inChallenge) {
      ctx.fillStyle = '#FFB347'; ctx.textAlign = 'right';
      ctx.fillText('hold ' + (state.challengeHoldMs / 1000).toFixed(1) + 's', w - 10, 16);
    } else if (state.best > 0) {
      ctx.fillStyle = '#888'; ctx.textAlign = 'right';
      ctx.fillText('best ' + (state.best / 1000).toFixed(1) + 's', w - 10, 16);
    }
  }

  KN.playCompass = {
    process: process, draw: draw,
    startChallenge: startChallenge, stopChallenge: stopChallenge, resetBest: resetBest,
    getYaw: getYaw, getBest: getBest, getHold: getHold, isInChallenge: isInChallenge
  };
})();
