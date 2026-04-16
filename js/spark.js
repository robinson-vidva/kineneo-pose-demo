(function () {
  var KN = window.KN = window.KN || {};

  var buffers = {};      // metricId -> array of numeric values (last MAX)
  var canvases = {};     // metricId -> HTMLCanvasElement
  var MAX = 60;          // ~ last 60 frames (about 1-2 seconds)
  var W = 60, H = 16;    // canvas pixel size for each sparkline

  // Pull a numeric value out of a metric's text content. Returns NaN if not parseable.
  function parseNumber(text) {
    if (text == null) return NaN;
    var s = String(text);
    if (s === '-' || s === '') return NaN;
    var m = s.match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }

  function bind() {
    // Auto-inject a canvas after every .kv .v[id] inside the metrics panel.
    var rows = document.querySelectorAll('#panel .kv .v[id]');
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i];
      var id = v.id;
      // Skip rows that we don't want a sparkline on (e.g. the static Model name).
      if (id === 'm_model' || id === 'm_status') continue;
      var cvs = document.createElement('canvas');
      cvs.className = 'spark';
      cvs.setAttribute('data-metric', id);
      cvs.width = W; cvs.height = H;
      // Insert the canvas before the value, right-aligned via CSS.
      v.parentNode.insertBefore(cvs, v);
      canvases[id] = cvs;
      buffers[id] = [];
    }
  }

  function push(metricId, text) {
    if (!canvases[metricId]) return;
    var v = parseNumber(text);
    if (!isFinite(v)) {
      // For categorical / non-numeric values, push 0 to keep buffer size advancing.
      buffers[metricId].push(null);
    } else {
      buffers[metricId].push(v);
    }
    if (buffers[metricId].length > MAX) buffers[metricId].shift();
    draw(metricId);
  }

  function draw(metricId) {
    var cvs = canvases[metricId];
    if (!cvs) return;
    var buf = buffers[metricId];
    var ctx = cvs.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    // Mid-line guide.
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    if (!buf || buf.length < 2) return;
    // Numeric range over what we have (ignore nulls).
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < buf.length; i++) {
      if (buf[i] == null) continue;
      if (buf[i] < lo) lo = buf[i];
      if (buf[i] > hi) hi = buf[i];
    }
    if (!isFinite(lo)) return;
    if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
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
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Trailing dot.
    var last = buf[buf.length - 1];
    if (last != null) {
      var lx = ((buf.length - 1) / (MAX - 1)) * W;
      var ly = H - ((last - lo) / (hi - lo)) * (H - 2) - 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(lx, ly, 1.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  // Read the color from the matching metric's value element class (good/warn/bad).
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
