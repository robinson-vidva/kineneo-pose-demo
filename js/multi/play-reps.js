// SPDX-License-Identifier: MIT
// play-reps.js - rep counter for squats / arm raises via joint-angle cycles.
//
// A "rep" is a full low→high→low cycle on the chosen angle:
//   squat:     knee angle. low ≈ 90° (flexed), high ≈ 170° (extended).
//   armRaise:  shoulder angle. low ≈ 20° (down), high ≈ 160° (overhead).
// We record peak-to-trough amplitude per rep, best single-rep ROM, and rep times.
(function () {
  var KN = window.KN = window.KN || {};

  var MODES = {
    squat:    { angleKey: 'a_rknee',     lowEnter: 110, highEnter: 160, label: 'Squat (R knee)' },
    armRaise: { angleKey: 'a_rshoulder', lowEnter: 40,  highEnter: 140, label: 'Arm raise (R shoulder)' }
  };

  var state = {
    mode: 'squat',
    phase: 'low', // 'low' | 'high' | 'transition'
    minInRep: 999,
    maxInRep: -999,
    reps: [],      // { t, rom, durationMs }
    lastTransitionT: 0,
    currentAngle: null
  };

  function setMode(mode) {
    if (!MODES[mode]) return;
    if (state.mode === mode) return;
    state.mode = mode;
    state.phase = 'low';
    state.minInRep = 999; state.maxInRep = -999;
    state.lastTransitionT = performance.now();
  }
  function reset() {
    state.reps = [];
    state.phase = 'low';
    state.minInRep = 999; state.maxInRep = -999;
    state.lastTransitionT = performance.now();
  }

  function process(jointAngles, now) {
    var cfg = MODES[state.mode];
    var a = jointAngles ? jointAngles[cfg.angleKey] : null;
    state.currentAngle = a;
    if (a == null) return;
    if (a < state.minInRep) state.minInRep = a;
    if (a > state.maxInRep) state.maxInRep = a;
    if (state.phase === 'low' && a >= cfg.highEnter) {
      state.phase = 'high';
      state.lastTransitionT = now;
    } else if (state.phase === 'high' && a <= cfg.lowEnter) {
      var dur = now - state.lastTransitionT;
      // valid rep: must have transitioned through both ends
      var rom = state.maxInRep - state.minInRep;
      state.reps.push({ t: now, rom: rom, durationMs: dur });
      state.phase = 'low';
      state.lastTransitionT = now;
      state.minInRep = a;
      state.maxInRep = a;
    }
  }

  function count() { return state.reps.length; }
  function bestRom() {
    var best = 0;
    for (var i = 0; i < state.reps.length; i++) if (state.reps[i].rom > best) best = state.reps[i].rom;
    return best;
  }
  function lastRom() { return state.reps.length ? state.reps[state.reps.length - 1].rom : null; }
  function lastDurMs() { return state.reps.length ? state.reps[state.reps.length - 1].durationMs : null; }
  function currentAngle() { return state.currentAngle; }
  function phase() { return state.phase; }
  function mode() { return state.mode; }
  function modeLabel() { return MODES[state.mode].label; }
  function cfg() { return MODES[state.mode]; }

  function draw(cvs) {
    if (!cvs) return;
    var ctx = cvs.getContext('2d');
    var w = cvs.width, h = cvs.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(5,8,16,0.7)';
    ctx.fillRect(0, 0, w, h);
    var c = cfg();
    // gauge: angle from lowEnter-20 to highEnter+20
    var aMin = c.lowEnter - 30, aMax = c.highEnter + 30;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#666'; ctx.textAlign = 'left';
    ctx.fillText(c.label, 10, 14);
    // track
    var trackY = h / 2 + 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(10, trackY); ctx.lineTo(w - 10, trackY); ctx.stroke();
    // thresholds
    function xAt(deg) { return 10 + ((deg - aMin) / (aMax - aMin)) * (w - 20); }
    ctx.strokeStyle = 'rgba(192,132,252,0.5)';
    ctx.beginPath(); ctx.moveTo(xAt(c.lowEnter), trackY - 8); ctx.lineTo(xAt(c.lowEnter), trackY + 8); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,255,136,0.5)';
    ctx.beginPath(); ctx.moveTo(xAt(c.highEnter), trackY - 8); ctx.lineTo(xAt(c.highEnter), trackY + 8); ctx.stroke();
    // labels
    ctx.fillStyle = '#C084FC'; ctx.textAlign = 'center';
    ctx.fillText(c.lowEnter + '°', xAt(c.lowEnter), trackY + 22);
    ctx.fillStyle = '#00FF88';
    ctx.fillText(c.highEnter + '°', xAt(c.highEnter), trackY + 22);
    // current angle dot
    if (state.currentAngle != null) {
      var ax = xAt(Math.max(aMin, Math.min(aMax, state.currentAngle)));
      ctx.fillStyle = state.phase === 'high' ? '#00FF88' : '#7FD8FF';
      ctx.beginPath(); ctx.arc(ax, trackY, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8e8e8'; ctx.textAlign = 'right';
      ctx.fillText(state.currentAngle.toFixed(0) + '°', w - 10, 14);
    }
  }

  KN.playReps = {
    setMode: setMode, reset: reset, process: process, draw: draw,
    count: count, bestRom: bestRom, lastRom: lastRom, lastDurMs: lastDurMs,
    currentAngle: currentAngle, phase: phase, mode: mode, modeLabel: modeLabel
  };
})();
