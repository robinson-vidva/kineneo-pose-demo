// SPDX-License-Identifier: MIT
// helpers.js - shared state, drawing utilities, and landmark/model constants on window.KN.
(function () {
  var KN = window.KN = window.KN || {};

  KN.state = {
    showLabels: true,
    showAngles: true,
    skeletonOnly: false,
    showRadar: false,
    showSpectrogram: false
  };

  KN.constants = {
    LM_NAMES: [
      'nose','L.eye.in','L.eye','L.eye.out','R.eye.in','R.eye','R.eye.out',
      'L.ear','R.ear','mouth.L','mouth.R',
      'L.shoulder','R.shoulder','L.elbow','R.elbow','L.wrist','R.wrist',
      'L.pinky','R.pinky','L.index','R.index','L.thumb','R.thumb',
      'L.hip','R.hip','L.knee','R.knee','L.ankle','R.ankle',
      'L.heel','R.heel','L.foot.ix','R.foot.ix'
    ],
    LABEL_INDICES: [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28],
    ANGLE_DEFS: [
      { key: 'a_lshoulder', label: 'L.shl', a: 13, b: 11, c: 23 },
      { key: 'a_rshoulder', label: 'R.shl', a: 14, b: 12, c: 24 },
      { key: 'a_lelbow',    label: 'L.elb', a: 11, b: 13, c: 15 },
      { key: 'a_relbow',    label: 'R.elb', a: 12, b: 14, c: 16 },
      { key: 'a_lhip',      label: 'L.hip', a: 11, b: 23, c: 25 },
      { key: 'a_rhip',      label: 'R.hip', a: 12, b: 24, c: 26 },
      { key: 'a_lknee',     label: 'L.knee', a: 23, b: 25, c: 27 },
      { key: 'a_rknee',     label: 'R.knee', a: 24, b: 26, c: 28 }
    ],
    HOLISTIC_TOTAL: 543
  };

  KN.helpers = {
    ensureCanvasSize: function (canvas, w, h) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    },
    setMetric: function (el, text, cls) {
      el.textContent = text;
      el.classList.remove('good', 'warn', 'bad');
      if (cls) el.classList.add(cls);
      if (KN.spark && el.id) KN.spark.push(el.id, text);
    },
    angleDeg: function (a, b, c) {
      var v1x = a.x - b.x, v1y = a.y - b.y;
      var v2x = c.x - b.x, v2y = c.y - b.y;
      var dot = v1x * v2x + v1y * v2y;
      var m1 = Math.hypot(v1x, v1y);
      var m2 = Math.hypot(v2x, v2y);
      if (m1 === 0 || m2 === 0) return null;
      var cos = dot / (m1 * m2);
      if (cos > 1) cos = 1;
      if (cos < -1) cos = -1;
      return (Math.acos(cos) * 180) / Math.PI;
    },
    drawAngleArcPx: function (ctx, bx, by, ax, ay, cx, cy, w, h) {
      var ang1 = Math.atan2(ay - by, ax - bx);
      var ang2 = Math.atan2(cy - by, cx - bx);
      var r = Math.max(14, Math.min(w, h) * 0.03);
      var diff = ang2 - ang1;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 179, 71, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx, by, r, ang1, ang2, diff < 0);
      ctx.stroke();
      ctx.restore();
    },
    drawTextBadge: function (ctx, x, y, text, color) {
      ctx.save();
      ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
      var padX = 4, padY = 2;
      var metrics = ctx.measureText(text);
      var tw = metrics.width + padX * 2;
      var th = 14 + padY * 2;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.fillRect(x, y, tw, th);
      ctx.fillStyle = color || '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + padX, y + th / 2);
      ctx.restore();
    }
  };
})();
