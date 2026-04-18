// SPDX-License-Identifier: MIT
// play-holdstill.js - "hold still for N seconds" timer that uses the
// stillness hysteresis verdict (KN.multiStill.lastVerdict).
// Start, see a ring fill; breaks on first MOVING verdict, records best.
(function () {
  var KN = window.KN = window.KN || {};

  var state = {
    running: false,
    targetMs: 10000,
    startedAt: 0,
    heldMs: 0,
    bestMs: 0,
    lastResult: null // 'pass' | 'fail' | null
  };

  function start(targetMs) {
    state.running = true;
    state.targetMs = Math.max(1000, targetMs || 10000);
    state.startedAt = performance.now();
    state.heldMs = 0;
    state.lastResult = null;
  }
  function cancel() {
    state.running = false;
    state.heldMs = 0;
    state.lastResult = null;
  }
  function resetBest() { state.bestMs = 0; }

  function process(now) {
    if (!state.running) return;
    var verdict = (KN.multiStill && KN.multiStill.lastVerdict) || 'moving';
    if (verdict !== 'still') {
      // broke early
      state.running = false;
      if (state.heldMs > state.bestMs) state.bestMs = state.heldMs;
      state.lastResult = 'fail';
      return;
    }
    state.heldMs = now - state.startedAt;
    if (state.heldMs >= state.targetMs) {
      state.running = false;
      if (state.heldMs > state.bestMs) state.bestMs = state.heldMs;
      state.lastResult = 'pass';
    }
  }

  function isRunning() { return state.running; }
  function heldMs() { return state.heldMs; }
  function bestMs() { return state.bestMs; }
  function lastResult() { return state.lastResult; }
  function targetMs() { return state.targetMs; }
  function setTarget(ms) { state.targetMs = Math.max(1000, ms); }

  function draw(cvs) {
    if (!cvs) return;
    var ctx = cvs.getContext('2d');
    var w = cvs.width, h = cvs.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(5,8,16,0.7)';
    ctx.fillRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2;
    var radius = Math.min(w, h) / 2 - 18;
    // background ring
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
    // fill arc
    var frac = state.running ? Math.min(1, state.heldMs / state.targetMs) : (state.lastResult === 'pass' ? 1 : 0);
    var col = state.lastResult === 'fail' ? '#ff6b6b' : (state.lastResult === 'pass' ? '#00FF88' : '#7FD8FF');
    ctx.strokeStyle = col;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // center text
    ctx.fillStyle = col;
    ctx.font = 'bold 24px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var sec = (state.running ? state.heldMs : (state.lastResult === 'pass' ? state.targetMs : state.heldMs)) / 1000;
    ctx.fillText(sec.toFixed(1) + 's', cx, cy - 8);
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#888';
    if (state.running) ctx.fillText('of ' + (state.targetMs / 1000).toFixed(0) + 's', cx, cy + 14);
    else if (state.lastResult === 'pass') ctx.fillText('passed', cx, cy + 14);
    else if (state.lastResult === 'fail') ctx.fillText('broke early', cx, cy + 14);
    else ctx.fillText('press Start', cx, cy + 14);
    // best
    if (state.bestMs > 0) {
      ctx.fillStyle = '#666'; ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('best ' + (state.bestMs / 1000).toFixed(1) + 's', 10, 10);
    }
  }

  KN.playHoldStill = {
    start: start, cancel: cancel, resetBest: resetBest, process: process, draw: draw,
    isRunning: isRunning, heldMs: heldMs, bestMs: bestMs, lastResult: lastResult,
    targetMs: targetMs, setTarget: setTarget
  };
})();
