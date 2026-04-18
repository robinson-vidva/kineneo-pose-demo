// SPDX-License-Identifier: MIT
// play-fingertap.js - thumb-index pinch tap counter + rate, per hand.
// Normalizes pinch distance by wrist-to-middle-MCP length so it's hand-size
// independent. Tap edge is detected with hysteresis (open > 0.45, close < 0.25).
(function () {
  var KN = window.KN = window.KN || {};

  var OPEN_THRESH = 0.45;
  var CLOSE_THRESH = 0.25;
  var RATE_WINDOW_MS = 3000;
  var HISTORY_MS = 5000;

  function freshSide() { return { open: true, taps: [], total: 0, history: [] }; }
  var state = { L: freshSide(), R: freshSide() };

  function sideFor(handedness, i) {
    var h = handedness && handedness[i] && handedness[i][0];
    if (!h) return 'L';
    var name = h.categoryName || h.displayName || '';
    return name === 'Right' ? 'R' : 'L';
  }

  function process(hands, handedness, now) {
    if (!hands || !hands.length) return;
    for (var i = 0; i < hands.length; i++) {
      var h = hands[i];
      if (!h || h.length < 21) continue;
      var thumb = h[4], index = h[8], wrist = h[0], midMcp = h[9];
      if (!thumb || !index || !wrist || !midMcp) continue;
      var palm = Math.hypot(wrist.x - midMcp.x, wrist.y - midMcp.y);
      if (palm < 0.001) continue;
      var d = Math.hypot(thumb.x - index.x, thumb.y - index.y) / palm;
      var side = sideFor(handedness, i);
      var st = state[side];
      st.history.push({ t: now, d: d });
      while (st.history.length && st.history[0].t < now - HISTORY_MS) st.history.shift();
      if (st.open && d < CLOSE_THRESH) {
        st.open = false;
        st.total++;
        st.taps.push(now);
      } else if (!st.open && d > OPEN_THRESH) {
        st.open = true;
      }
      while (st.taps.length && st.taps[0] < now - RATE_WINDOW_MS) st.taps.shift();
    }
  }

  function rate(side) { return state[side].taps.length / (RATE_WINDOW_MS / 1000); }
  function total(side) { return state[side].total; }

  function draw(cvs) {
    if (!cvs) return;
    var ctx = cvs.getContext('2d');
    var w = cvs.width, h = cvs.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(5,8,16,0.7)';
    ctx.fillRect(0, 0, w, h);
    // threshold guides
    var openY = h - Math.min(1, OPEN_THRESH / 1.5) * h;
    var closeY = h - Math.min(1, CLOSE_THRESH / 1.5) * h;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, openY); ctx.lineTo(w, openY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, closeY); ctx.lineTo(w, closeY); ctx.stroke();
    var now = performance.now();
    var sides = ['L', 'R'], colors = { L: '#7FD8FF', R: '#C084FC' };
    for (var s = 0; s < sides.length; s++) {
      var side = sides[s];
      var hist = state[side].history;
      if (!hist.length) continue;
      ctx.beginPath();
      ctx.strokeStyle = colors[side];
      ctx.lineWidth = 1.6;
      for (var i = 0; i < hist.length; i++) {
        var age = now - hist[i].t;
        if (age > HISTORY_MS) continue;
        var x = w - (age / HISTORY_MS) * w;
        var y = h - Math.min(1, hist[i].d / 1.5) * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // legend
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = colors.L; ctx.fillText('L', 6, 12);
    ctx.fillStyle = colors.R; ctx.fillText('R', 18, 12);
  }

  function reset() { state.L = freshSide(); state.R = freshSide(); }

  KN.playFingerTap = { process: process, rate: rate, total: total, draw: draw, reset: reset };
})();
