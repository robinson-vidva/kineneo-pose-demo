// SPDX-License-Identifier: MIT
// viz.js - Canvas 2D visualisations: neuro radar chart + tremor spectrogram.
(function () {
  var KN = window.KN = window.KN || {};

  // ---------------- Radar chart ----------------
  // Each axis is: { label, get: () => normalized 0-1 value, clipTo01: bool }
  // Convention: outer ring = "more healthy / more activity". Sway and motor
  // asymmetry are inverted so lower raw values push outward.
  var RADAR_AXES = [
    { label: 'Symmetry',    get: function (l) { return norm(l.sym, 0.7, 1.0); } },
    { label: 'Blink rate',  get: function (l) { return norm(l.blink, 0, 30); } },
    { label: 'Stillness',   get: function (l) { return invNorm(l.sway, 0, 0.1); } },
    { label: 'Motor sym',   get: function (l) { return invNorm(l.motor, 0, 40); } },
    { label: 'Expressivity', get: function (l) { return norm(l.hypo, 0, 0.06); } },
    { label: 'Smile',       get: function (l) { return norm(l.smile, 0, 1); } }
  ];

  function norm(v, lo, hi) {
    if (v == null || !isFinite(v)) return null;
    return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  }
  function invNorm(v, lo, hi) {
    var n = norm(v, lo, hi);
    return n == null ? null : (1 - n);
  }

  function drawRadar(cvs, latest) {
    if (!cvs) return;
    var ctx = cvs.getContext('2d');
    var W = cvs.width, H = cvs.height;
    ctx.clearRect(0, 0, W, H);
    var cx = W / 2, cy = H / 2 + 4;
    var R = Math.min(W, H) / 2 - 34;
    var n = RADAR_AXES.length;

    // Compute normalized values.
    var vals = new Array(n);
    for (var i = 0; i < n; i++) {
      var v = RADAR_AXES[i].get(latest);
      vals[i] = v == null ? null : v;
    }

    // Concentric grid rings at 0.25 / 0.5 / 0.75 / 1.0.
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (var g = 1; g <= 4; g++) {
      ctx.beginPath();
      for (var j = 0; j < n; j++) {
        var ang = (-Math.PI / 2) + (j * 2 * Math.PI / n);
        var rr = R * (g / 4);
        var x = cx + Math.cos(ang) * rr;
        var y = cy + Math.sin(ang) * rr;
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Axis spokes + labels.
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.fillStyle = '#9a9a9a';
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var k = 0; k < n; k++) {
      var a = (-Math.PI / 2) + (k * 2 * Math.PI / n);
      var ex = cx + Math.cos(a) * R;
      var ey = cy + Math.sin(a) * R;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      var lx = cx + Math.cos(a) * (R + 18);
      var ly = cy + Math.sin(a) * (R + 14);
      ctx.fillText(RADAR_AXES[k].label, lx, ly);
    }

    // Polygon fill + outline.
    var haveAny = false;
    ctx.beginPath();
    var firstDrawn = false;
    for (var p = 0; p < n; p++) {
      var pa = (-Math.PI / 2) + (p * 2 * Math.PI / n);
      var vv = vals[p];
      var rr2 = vv == null ? 0 : vv * R;
      var px = cx + Math.cos(pa) * rr2;
      var py = cy + Math.sin(pa) * rr2;
      if (vv != null) haveAny = true;
      if (!firstDrawn) { ctx.moveTo(px, py); firstDrawn = true; }
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    if (haveAny) {
      var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      grad.addColorStop(0, 'rgba(127, 216, 255, 0.35)');
      grad.addColorStop(1, 'rgba(192, 132, 252, 0.2)');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = '#7FD8FF';
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 8;
      ctx.shadowColor = 'rgba(127, 216, 255, 0.6)';
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Vertex dots.
    for (var q = 0; q < n; q++) {
      var qa = (-Math.PI / 2) + (q * 2 * Math.PI / n);
      var qv = vals[q];
      if (qv == null) continue;
      var qx = cx + Math.cos(qa) * (qv * R);
      var qy = cy + Math.sin(qa) * (qv * R);
      ctx.fillStyle = '#FFF';
      ctx.beginPath();
      ctx.arc(qx, qy, 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Center title.
    ctx.fillStyle = '#666';
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText('NEURO', cx, cy);
  }

  // ---------------- Tremor spectrogram ----------------
  // Scrolling heatmap: X = time (newest on right), Y = frequency (0 Hz bottom, 15 Hz top).
  // Intensity -> color via blue->cyan->green->yellow->red colormap.

  function colormap(t) {
    // t in [0, 1]
    t = Math.max(0, Math.min(1, t));
    // Piecewise lerp: black -> navy -> cyan -> green -> yellow -> red.
    var stops = [
      { at: 0.00, r: 0,   g: 0,   b: 0 },
      { at: 0.15, r: 12,  g: 20,  b: 80 },
      { at: 0.35, r: 30,  g: 200, b: 240 },
      { at: 0.55, r: 40,  g: 220, b: 120 },
      { at: 0.75, r: 250, g: 230, b: 60 },
      { at: 1.00, r: 255, g: 80,  b: 60 }
    ];
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i].at) {
        var a = stops[i - 1], b = stops[i];
        var f = (t - a.at) / (b.at - a.at);
        return [
          Math.round(a.r + (b.r - a.r) * f),
          Math.round(a.g + (b.g - a.g) * f),
          Math.round(a.b + (b.b - a.b) * f)
        ];
      }
    }
    return [0, 0, 0];
  }

  var SPEC_STATE = null; // { cvs, ctx, lastDraw, scratch }

  function initSpectrogram(cvs) {
    if (!cvs) return;
    SPEC_STATE = { cvs: cvs, ctx: cvs.getContext('2d'), lastDraw: 0 };
    var c = SPEC_STATE.ctx;
    c.fillStyle = '#050810';
    c.fillRect(0, 0, cvs.width, cvs.height);
    drawSpectrogramOverlay();
  }

  function drawSpectrogramOverlay() {
    if (!SPEC_STATE) return;
    var c = SPEC_STATE.ctx;
    var cvs = SPEC_STATE.cvs;
    var W = cvs.width, H = cvs.height;
    c.save();
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    // PD tremor band marker (4-6 Hz)
    c.strokeStyle = 'rgba(255, 107, 107, 0.25)';
    c.lineWidth = 1;
    c.setLineDash([2, 3]);
    var y4 = H - (4 / 15) * H;
    var y6 = H - (6 / 15) * H;
    c.beginPath(); c.moveTo(0, y4); c.lineTo(W, y4); c.stroke();
    c.beginPath(); c.moveTo(0, y6); c.lineTo(W, y6); c.stroke();
    c.setLineDash([]);
    c.fillStyle = 'rgba(255, 107, 107, 0.7)';
    c.fillText('PD 4-6Hz', 4, y4 - 7);
    // Essential tremor band (8-12 Hz)
    var y8 = H - (8 / 15) * H;
    var y12 = H - (12 / 15) * H;
    c.strokeStyle = 'rgba(255, 179, 71, 0.2)';
    c.setLineDash([2, 3]);
    c.beginPath(); c.moveTo(0, y8); c.lineTo(W, y8); c.stroke();
    c.beginPath(); c.moveTo(0, y12); c.lineTo(W, y12); c.stroke();
    c.setLineDash([]);
    c.fillStyle = 'rgba(255, 179, 71, 0.7)';
    c.fillText('ET 8-12Hz', 4, y12 - 7);
    c.restore();
  }

  function drawSpectrogramColumn(spectrum) {
    if (!SPEC_STATE || !spectrum) return;
    var c = SPEC_STATE.ctx;
    var cvs = SPEC_STATE.cvs;
    var W = cvs.width, H = cvs.height;

    // Scroll left by 1px.
    var img = c.getImageData(1, 0, W - 1, H);
    c.putImageData(img, 0, 0);
    // Clear rightmost column.
    c.fillStyle = '#050810';
    c.fillRect(W - 1, 0, 1, H);

    // Normalise magnitudes to 0-1 using a rolling max so faint tremors are visible
    // but the display doesn't saturate.
    var mags = spectrum.mags;
    var fs = spectrum.fs, n = spectrum.n;
    var loBin = spectrum.loBin, hiBin = spectrum.hiBin;
    var maxMag = 0;
    for (var i = 0; i < mags.length; i++) if (mags[i] > maxMag) maxMag = mags[i];
    var norm = maxMag > 1e-9 ? 1 / maxMag : 0;

    // Map each Y pixel to its Hz, then to the closest spectrum bin.
    for (var y = 0; y < H; y++) {
      var hz = 15 * (1 - (y / H));  // 15 Hz at top, 0 Hz at bottom
      var bin = Math.round(hz * n / fs);
      if (bin < loBin || bin > hiBin) continue;
      var idx = bin - loBin;
      var t = Math.sqrt(mags[idx] * norm); // sqrt gives perceptually-smoother gradient
      var rgb = colormap(t);
      c.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      c.fillRect(W - 1, y, 1, 1);
    }

    // Redraw the PD / ET overlay lines on top so they're always visible at right edge.
    c.save();
    c.globalAlpha = 0.25;
    c.strokeStyle = 'rgba(255, 107, 107, 1)';
    c.setLineDash([2, 3]);
    var yp1 = H - (4 / 15) * H, yp2 = H - (6 / 15) * H;
    c.beginPath(); c.moveTo(W - 8, yp1); c.lineTo(W - 1, yp1); c.stroke();
    c.beginPath(); c.moveTo(W - 8, yp2); c.lineTo(W - 1, yp2); c.stroke();
    c.strokeStyle = 'rgba(255, 179, 71, 1)';
    var yp3 = H - (8 / 15) * H, yp4 = H - (12 / 15) * H;
    c.beginPath(); c.moveTo(W - 8, yp3); c.lineTo(W - 1, yp3); c.stroke();
    c.beginPath(); c.moveTo(W - 8, yp4); c.lineTo(W - 1, yp4); c.stroke();
    c.setLineDash([]);
    c.restore();
  }

  function clearSpectrogram() {
    if (!SPEC_STATE) return;
    var c = SPEC_STATE.ctx;
    var cvs = SPEC_STATE.cvs;
    c.fillStyle = '#050810';
    c.fillRect(0, 0, cvs.width, cvs.height);
    drawSpectrogramOverlay();
  }

  KN.viz = {
    drawRadar: drawRadar,
    initSpectrogram: initSpectrogram,
    drawSpectrogramColumn: drawSpectrogramColumn,
    clearSpectrogram: clearSpectrogram
  };
})();
