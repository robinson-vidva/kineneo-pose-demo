// SPDX-License-Identifier: MIT
// spark.js - inline rolling-line sparklines with clinical range bands.
(function () {
  var KN = window.KN = window.KN || {};

  var buffers = {};      // metricId -> array of numeric values (last MAX)
  var canvases = {};     // metricId -> HTMLCanvasElement
  var MAX = 70;          // ~ last 70 frames (about 1-2 seconds)
  var W = 70, H = 14;    // canvas pixel size for each sparkline

  // Per-metric fixed y-axis ranges and good / warn / bad zones (as [lo, hi] in the
  // metric's own units). Drawn as thin translucent horizontal bands behind the
  // rolling trace so each value has instant clinical context.
  // Metrics without a range here fall back to dynamic min/max scaling.
  var RANGES = {
    // Joint angles (0-180 degrees)
    a_lshoulder: { min: 0, max: 180, good: [[60, 180]] },
    a_rshoulder: { min: 0, max: 180, good: [[60, 180]] },
    a_lelbow:    { min: 0, max: 180, good: [[60, 170]] },
    a_relbow:    { min: 0, max: 180, good: [[60, 170]] },
    a_lhip:      { min: 0, max: 180, good: [[120, 180]] },
    a_rhip:      { min: 0, max: 180, good: [[120, 180]] },
    a_lknee:     { min: 0, max: 180, good: [[110, 180]] },
    a_rknee:     { min: 0, max: 180, good: [[110, 180]] },
    // Neuro metrics
    n_facesym:   { min: 0.80, max: 1.00, good: [[0.95, 1.00]], warn: [[0.88, 0.95]], bad: [[0.80, 0.88]] },
    n_blink:     { min: 0,   max: 40,    good: [[12, 25]],     warn: [[6, 12], [25, 35]], bad: [[0, 6], [35, 40]] },
    n_sway:      { min: 0,   max: 0.15,  good: [[0, 0.03]],    warn: [[0.03, 0.07]], bad: [[0.07, 0.15]] },
    n_motorsym:  { min: 0,   max: 50,    good: [[0, 10]],      warn: [[10, 25]],     bad: [[25, 50]] },
    n_headtremor:{ min: 0,   max: 0.10,  good: [[0, 0.02]],    warn: [[0.02, 0.05]], bad: [[0.05, 0.10]] },
    n_tremorhz:  { min: 0,   max: 15,    warn: [[8, 12]],      bad: [[4, 6]] },
    n_hypo:      { min: 0,   max: 0.08,  good: [[0.04, 0.08]], warn: [[0.015, 0.04]], bad: [[0, 0.015]] },
    n_smile:     { min: 0,   max: 1.0 },
    // Behavior
    b_headtilt:  { min: -30, max: 30,    good: [[-8, 8]],      warn: [[-20, -8], [8, 20]], bad: [[-30, -20], [20, 30]] }
  };

  function parseNumber(text) {
    if (text == null) return NaN;
    var s = String(text);
    if (s === '-' || s === '') return NaN;
    var m = s.match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }

  function bind() {
    var rows = document.querySelectorAll('#panel .kv .v[id]');
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i];
      var id = v.id;
      if (id === 'm_model' || id === 'm_status') continue;
      var cvs = document.createElement('canvas');
      cvs.className = 'spark';
      cvs.setAttribute('data-metric', id);
      cvs.width = W; cvs.height = H;
      v.parentNode.insertBefore(cvs, v);
      canvases[id] = cvs;
      buffers[id] = [];
    }
  }

  function push(metricId, text) {
    if (!canvases[metricId]) return;
    var v = parseNumber(text);
    if (!isFinite(v)) {
      buffers[metricId].push(null);
    } else {
      buffers[metricId].push(v);
    }
    if (buffers[metricId].length > MAX) buffers[metricId].shift();
    draw(metricId);
  }

  function drawBands(ctx, rng) {
    if (!rng) return;
    var min = rng.min, max = rng.max;
    if (!(max > min)) return;
    function paint(band, color) {
      if (!band) return;
      for (var i = 0; i < band.length; i++) {
        var lo = band[i][0], hi = band[i][1];
        var y0 = H - ((hi - min) / (max - min)) * H;
        var y1 = H - ((lo - min) / (max - min)) * H;
        if (y0 > y1) { var t = y0; y0 = y1; y1 = t; }
        y0 = Math.max(0, Math.min(H, y0));
        y1 = Math.max(0, Math.min(H, y1));
        ctx.fillStyle = color;
        ctx.fillRect(0, y0, W, y1 - y0);
      }
    }
    paint(rng.good, 'rgba(0, 255, 136, 0.09)');
    paint(rng.warn, 'rgba(255, 179, 71, 0.10)');
    paint(rng.bad,  'rgba(255, 107, 107, 0.11)');
  }

  function draw(metricId) {
    var cvs = canvases[metricId];
    if (!cvs) return;
    var buf = buffers[metricId];
    var ctx = cvs.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    var rng = RANGES[metricId];
    drawBands(ctx, rng);

    // Mid-line guide (only when no range bands, to avoid clutter).
    if (!rng) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    }
    if (!buf || buf.length < 2) return;

    // Y scale: fixed from range when available, otherwise dynamic.
    var lo, hi;
    if (rng) {
      lo = rng.min; hi = rng.max;
    } else {
      lo = Infinity; hi = -Infinity;
      for (var i = 0; i < buf.length; i++) {
        if (buf[i] == null) continue;
        if (buf[i] < lo) lo = buf[i];
        if (buf[i] > hi) hi = buf[i];
      }
      if (!isFinite(lo)) return;
      if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
    }

    var color = readColor(metricId) || '#00FF88';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    var first = true;
    for (var j = 0; j < buf.length; j++) {
      var x = (j / (MAX - 1)) * W;
      var v = buf[j];
      if (v == null) { first = true; continue; }
      var y = H - ((v - lo) / (hi - lo)) * (H - 2) - 1;
      if (y < 0) y = 0; if (y > H) y = H;
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    var last = buf[buf.length - 1];
    if (last != null) {
      var lx = ((buf.length - 1) / (MAX - 1)) * W;
      var ly = H - ((last - lo) / (hi - lo)) * (H - 2) - 1;
      if (ly < 0) ly = 0; if (ly > H) ly = H;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(lx, ly, 1.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  function readColor(metricId) {
    var el = document.getElementById(metricId);
    if (!el) return null;
    if (el.classList.contains('good')) return '#00FF88';
    if (el.classList.contains('warn')) return '#ffb347';
    if (el.classList.contains('bad')) return '#ff6b6b';
    return '#888';
  }

  function clearAll() {
    Object.keys(buffers).forEach(function (k) { buffers[k] = []; draw(k); });
  }

  KN.spark = {
    bind: bind,
    push: push,
    clearAll: clearAll
  };
})();
