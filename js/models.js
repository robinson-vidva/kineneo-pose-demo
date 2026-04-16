// SPDX-License-Identifier: MIT
// models.js - MediaPipe Holistic model + canvas overlays.
(function () {
  var KN = window.KN = window.KN || {};
  var H = KN.helpers;
  var C = KN.constants;

  var trailHistory = { lWrist: [], rWrist: [], lAnkle: [], rAnkle: [], nose: [] };
  var TRAIL_LEN = 16;
  function pushTrail(key, x, y) {
    var arr = trailHistory[key];
    arr.push({ x: x, y: y });
    if (arr.length > TRAIL_LEN) arr.shift();
  }
  function clearTrails() {
    Object.keys(trailHistory).forEach(function (k) { trailHistory[k].length = 0; });
  }
  KN.clearTrails = clearTrails;

  function drawTrails(cx, color) {
    Object.keys(trailHistory).forEach(function (k) {
      var arr = trailHistory[k];
      if (arr.length < 2) return;
      for (var i = 1; i < arr.length; i++) {
        var alpha = i / arr.length;
        cx.save();
        cx.strokeStyle = color;
        cx.globalAlpha = alpha * 0.6;
        cx.lineWidth = 2 + alpha * 2;
        cx.beginPath();
        cx.moveTo(arr[i - 1].x, arr[i - 1].y);
        cx.lineTo(arr[i].x, arr[i].y);
        cx.stroke();
        cx.restore();
      }
    });
  }

  function drawGlowDot(cx, x, y, r, color) {
    cx.save();
    cx.shadowBlur = 20;
    cx.shadowColor = color;
    cx.fillStyle = color;
    cx.globalAlpha = 0.85;
    cx.beginPath();
    cx.arc(x, y, r, 0, 2 * Math.PI);
    cx.fill();
    cx.restore();
  }

  function drawSymmetryOverlay(cx, lms, w, h) {
    var pairs = [[11, 12], [13, 14], [15, 16], [23, 24], [25, 26], [27, 28]];
    for (var i = 0; i < pairs.length; i++) {
      var L = lms[pairs[i][0]], R = lms[pairs[i][1]];
      if (!L || !R) continue;
      var vL = L.visibility != null ? L.visibility : 1;
      var vR = R.visibility != null ? R.visibility : 1;
      if (vL < 0.5 || vR < 0.5) continue;
      cx.save();
      cx.strokeStyle = 'rgba(0,255,136,0.15)';
      cx.lineWidth = 1;
      cx.setLineDash([3, 3]);
      cx.beginPath();
      cx.moveTo(L.x * w, L.y * h);
      cx.lineTo(R.x * w, R.y * h);
      cx.stroke();
      cx.restore();
    }
  }

  function drawCenterOfMass(cx, lms, w, h, color) {
    var lSh = lms[11], rSh = lms[12], lHip = lms[23], rHip = lms[24];
    if (!lSh || !rSh) return;
    var vS = ((lSh.visibility || 0) + (rSh.visibility || 0)) / 2;
    if (vS < 0.5) return;
    var sx = (lSh.x + rSh.x) / 2, sy = (lSh.y + rSh.y) / 2;
    var cx_, cy_;
    if (lHip && rHip && (lHip.visibility || 0) > 0.5 && (rHip.visibility || 0) > 0.5) {
      var hx = (lHip.x + rHip.x) / 2, hy = (lHip.y + rHip.y) / 2;
      cx_ = (sx + hx) / 2; cy_ = (sy + hy) / 2;
    } else {
      cx_ = sx; cy_ = sy + 0.05;
    }
    drawGlowDot(cx, cx_ * w, cy_ * h, 7, color || '#ff6b6b');
  }

  function computeAnglesMp(lms, ctx, w, h) {
    var ja = {};
    for (var i = 0; i < C.ANGLE_DEFS.length; i++) {
      var d = C.ANGLE_DEFS[i];
      var A = lms[d.a], B = lms[d.b], CC = lms[d.c];
      if (!A || !B || !CC) { ja[d.key] = null; continue; }
      var vA = A.visibility != null ? A.visibility : 1;
      var vB = B.visibility != null ? B.visibility : 1;
      var vC = CC.visibility != null ? CC.visibility : 1;
      if (vA < 0.5 || vB < 0.5 || vC < 0.5) { ja[d.key] = null; continue; }
      var deg = H.angleDeg(A, B, CC);
      ja[d.key] = deg;
      if (KN.state.showAngles && deg != null) {
        var bx = B.x * w, by = B.y * h;
        var ax = A.x * w, ay = A.y * h;
        var cx = CC.x * w, cy = CC.y * h;
        H.drawAngleArcPx(ctx, bx, by, ax, ay, cx, cy, w, h);
        H.drawTextBadge(ctx, bx + 8, by - 8, d.label + ' ' + deg.toFixed(0), '#ffb347');
      }
    }
    return ja;
  }

  function drawLabelsMp(lms, ctx, w, h) {
    if (!KN.state.showLabels) return;
    for (var i = 0; i < C.LABEL_INDICES.length; i++) {
      var idx = C.LABEL_INDICES[i];
      var p = lms[idx];
      if (!p) continue;
      var vis = p.visibility != null ? p.visibility : 1;
      if (vis < 0.5) continue;
      H.drawTextBadge(ctx, p.x * w + 6, p.y * h + 6, C.LM_NAMES[idx], '#ffffff');
    }
  }

  var holistic = (function () {
    var inst = null;
    var resolveFrame = null;
    return {
      name: 'MediaPipe Holistic',
      init: function () {
        if (inst) return Promise.resolve();
        if (!window.Holistic) return Promise.reject(new Error('MediaPipe Holistic failed to load.'));
        inst = new window.Holistic({
          locateFile: function (f) { return 'https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1675471629/' + f; }
        });
        inst.setOptions({ modelComplexity: 1, smoothLandmarks: true, refineFaceLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        inst.onResults(function (results) {
          if (resolveFrame) { var r = resolveFrame; resolveFrame = null; r(results); }
        });
        return inst.initialize();
      },
      run: function (vid, cvs, cx) {
        if (!inst || vid.readyState < 2) return Promise.resolve(null);
        var w = vid.videoWidth, h = vid.videoHeight;
        H.ensureCanvasSize(cvs, w, h);
        return new Promise(function (resolve) {
          resolveFrame = function (results) {
            cx.save();
            cx.clearRect(0, 0, w, h);
            if (!KN.state.skeletonOnly) cx.drawImage(vid, 0, 0, w, h);
            else { cx.fillStyle = '#0a0a0a'; cx.fillRect(0, 0, w, h); }
            var poseLms = results.poseLandmarks;
            var faceLms = results.faceLandmarks;
            var lhLms = results.leftHandLandmarks;
            var rhLms = results.rightHandLandmarks;
            if (poseLms && poseLms.length) {
              drawSymmetryOverlay(cx, poseLms, w, h);
              if (poseLms[15]) pushTrail('lWrist', poseLms[15].x * w, poseLms[15].y * h);
              if (poseLms[16]) pushTrail('rWrist', poseLms[16].x * w, poseLms[16].y * h);
              if (poseLms[27]) pushTrail('lAnkle', poseLms[27].x * w, poseLms[27].y * h);
              if (poseLms[28]) pushTrail('rAnkle', poseLms[28].x * w, poseLms[28].y * h);
              if (poseLms[0]) pushTrail('nose', poseLms[0].x * w, poseLms[0].y * h);
              drawTrails(cx, '#7FD8FF');
              if (faceLms && faceLms.length && window.drawConnectors && window.FACEMESH_TESSELATION)
                window.drawConnectors(cx, faceLms, window.FACEMESH_TESSELATION, { color: 'rgba(127,216,255,0.15)', lineWidth: 0.5 });
              cx.save(); cx.shadowBlur = 8; cx.shadowColor = '#7FD8FF';
              if (window.drawConnectors && window.POSE_CONNECTIONS)
                window.drawConnectors(cx, poseLms, window.POSE_CONNECTIONS, { color: '#7FD8FF', lineWidth: 2 });
              if (window.drawLandmarks)
                window.drawLandmarks(cx, poseLms, { color: '#FFF', fillColor: '#FFF', lineWidth: 1, radius: 3 });
              cx.restore();
              if (lhLms && lhLms.length && window.HAND_CONNECTIONS) {
                window.drawConnectors(cx, lhLms, window.HAND_CONNECTIONS, { color: '#5BC0EB', lineWidth: 1.5 });
                window.drawLandmarks(cx, lhLms, { color: '#FFF', fillColor: '#FFF', lineWidth: 1, radius: 2 });
              }
              if (rhLms && rhLms.length && window.HAND_CONNECTIONS) {
                window.drawConnectors(cx, rhLms, window.HAND_CONNECTIONS, { color: '#5BC0EB', lineWidth: 1.5 });
                window.drawLandmarks(cx, rhLms, { color: '#FFF', fillColor: '#FFF', lineWidth: 1, radius: 2 });
              }
              drawCenterOfMass(cx, poseLms, w, h, '#ff6b6b');
              var ja = computeAnglesMp(poseLms, cx, w, h);
              drawLabelsMp(poseLms, cx, w, h);
              var visC = 0, confS = 0;
              for (var i = 0; i < poseLms.length; i++) {
                var v = poseLms[i].visibility != null ? poseLms[i].visibility : 0;
                confS += v; if (v >= 0.5) visC++;
              }
              var totalVis = visC + (lhLms ? lhLms.length : 0) + (rhLms ? rhLms.length : 0) + (faceLms ? faceLms.length : 0);
              var totalPossible = 33 + (lhLms ? 21 : 0) + (rhLms ? 21 : 0) + (faceLms ? 468 : 0);
              if (KN.neuro) {
                try { KN.neuro.update(faceLms, poseLms, ja); } catch (e) { console.error('[kineneo] neuro.update:', e); }
                try { KN.neuro.updateBehavior(poseLms, KN.neuro.MP_MAP); } catch (e) { console.error('[kineneo] neuro.updateBehavior:', e); }
                try { if (faceLms && faceLms.length) KN.neuro.updateFace(faceLms); } catch (e) { console.error('[kineneo] neuro.updateFace:', e); }
              }
              cx.restore();
              resolve({ tracking: true, numPersons: 1, landmarkCount: totalVis, totalLandmarks: totalPossible, meanConfidence: confS / poseLms.length, jointAngles: ja });
            } else {
              cx.restore();
              resolve({ tracking: false });
            }
          };
          inst.send({ image: vid });
        });
      },
      destroy: function () { resolveFrame = null; if (inst) { inst.close(); inst = null; } }
    };
  })();

  KN.model = holistic;
})();
