// SPDX-License-Identifier: MIT
// models.js - the three model objects (Pose, Holistic, MoveNet) and their canvas overlays.
(function () {
  var KN = window.KN = window.KN || {};
  var H = KN.helpers;
  var C = KN.constants;

  // Trails: buffer of recent points per landmark name, drawn as fading lines.
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

  // Glowing dot for center-of-mass marker.
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

  // L-R symmetry connecting lines (faint), colored by asymmetry of pair distances from midline.
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

  // Center of mass: midpoint of shoulder-center and hip-center (approx).
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

  var models = {};

  models.pose = (function () {
    var inst = null;
    var resolveFrame = null;
    return {
      name: 'MediaPipe Pose',
      init: function () {
        if (inst) return Promise.resolve();
        if (!window.Pose) return Promise.reject(new Error('MediaPipe Pose failed to load.'));
        inst = new window.Pose({
          locateFile: function (f) { return 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/' + f; }
        });
        inst.setOptions({ modelComplexity: 1, smoothLandmarks: true, enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
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
            var lms = results.poseLandmarks;
            if (lms && lms.length) {
              drawSymmetryOverlay(cx, lms, w, h);
              if (lms[15]) pushTrail('lWrist', lms[15].x * w, lms[15].y * h);
              if (lms[16]) pushTrail('rWrist', lms[16].x * w, lms[16].y * h);
              if (lms[27]) pushTrail('lAnkle', lms[27].x * w, lms[27].y * h);
              if (lms[28]) pushTrail('rAnkle', lms[28].x * w, lms[28].y * h);
              if (lms[0]) pushTrail('nose', lms[0].x * w, lms[0].y * h);
              drawTrails(cx, '#00FF88');
              cx.save(); cx.shadowBlur = 8; cx.shadowColor = '#00FF88';
              if (window.drawConnectors && window.POSE_CONNECTIONS)
                window.drawConnectors(cx, lms, window.POSE_CONNECTIONS, { color: '#00FF88', lineWidth: 2 });
              if (window.drawLandmarks)
                window.drawLandmarks(cx, lms, { color: '#FFF', fillColor: '#FFF', lineWidth: 1, radius: 4 });
              cx.restore();
              drawCenterOfMass(cx, lms, w, h, '#ff6b6b');
              var ja = computeAnglesMp(lms, cx, w, h);
              drawLabelsMp(lms, cx, w, h);
              var visC = 0, confS = 0;
              for (var i = 0; i < lms.length; i++) {
                var v = lms[i].visibility != null ? lms[i].visibility : 0;
                confS += v; if (v >= 0.5) visC++;
              }
              if (KN.neuro) KN.neuro.updateBehavior(lms, KN.neuro.MP_MAP);
              cx.restore();
              resolve({ tracking: true, numPersons: 1, landmarkCount: visC, totalLandmarks: 33, meanConfidence: confS / lms.length, jointAngles: ja });
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

  models.holistic = (function () {
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

  models.movenet = (function () {
    var detector = null;
    return {
      name: 'MoveNet MultiPose',
      init: function () {
        if (detector) return Promise.resolve();
        if (!window.poseDetection) return Promise.reject(new Error('TensorFlow.js pose-detection failed to load.'));
        return tf.setBackend('webgl').then(function () { return tf.ready(); }).then(function () {
          return poseDetection.createDetector(
            poseDetection.SupportedModels.MoveNet,
            { modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING, enableTracking: true, trackerType: poseDetection.TrackerType.BoundingBox }
          );
        }).then(function (d) { detector = d; });
      },
      run: function (vid, cvs, cx) {
        if (!detector || vid.readyState < 2) return Promise.resolve(null);
        var w = vid.videoWidth, h = vid.videoHeight;
        H.ensureCanvasSize(cvs, w, h);
        return detector.estimatePoses(vid, { maxPoses: 6, flipHorizontal: false }).then(function (poses) {
          cx.save();
          cx.clearRect(0, 0, w, h);
          if (!KN.state.skeletonOnly) cx.drawImage(vid, 0, 0, w, h);
          else { cx.fillStyle = '#0a0a0a'; cx.fillRect(0, 0, w, h); }
          var personColors = ['#FFB347', '#FF6B6B', '#7FD8FF', '#00FF88', '#C084FC', '#F472B6'];
          if (!poses || !poses.length) { cx.restore(); return { tracking: false }; }
          for (var p = 0; p < poses.length; p++) {
            var kps = poses[p].keypoints;
            var col = personColors[p % personColors.length];
            for (var ci = 0; ci < C.MOVENET_CONNECTIONS.length; ci++) {
              var a = kps[C.MOVENET_CONNECTIONS[ci][0]], b = kps[C.MOVENET_CONNECTIONS[ci][1]];
              if (a.score >= 0.3 && b.score >= 0.3) {
                cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y);
                cx.strokeStyle = col; cx.lineWidth = 2; cx.stroke();
              }
            }
            for (var ki = 0; ki < kps.length; ki++) {
              if (kps[ki].score >= 0.3) {
                cx.beginPath(); cx.arc(kps[ki].x, kps[ki].y, 4, 0, 2 * Math.PI);
                cx.fillStyle = '#FFF'; cx.fill();
              }
            }
            var minX = Infinity, minY = Infinity;
            for (var ki2 = 0; ki2 < kps.length; ki2++) {
              if (kps[ki2].score >= 0.3) { if (kps[ki2].x < minX) minX = kps[ki2].x; if (kps[ki2].y < minY) minY = kps[ki2].y; }
            }
            if (minX < Infinity) H.drawTextBadge(cx, minX, Math.max(0, minY - 20), 'P' + (p + 1) + ' ' + (poses[p].score != null ? poses[p].score.toFixed(2) : ''), col);
          }
          var best = poses[0];
          for (var bi = 1; bi < poses.length; bi++) { if ((poses[bi].score || 0) > (best.score || 0)) best = poses[bi]; }
          var bkps = best.keypoints;
          var ja = {};
          for (var ai = 0; ai < C.MOVENET_ANGLE_DEFS.length; ai++) {
            var dd = C.MOVENET_ANGLE_DEFS[ai];
            var A = bkps[dd.a], B = bkps[dd.b], CC = bkps[dd.c];
            if (!A || !B || !CC || A.score < 0.5 || B.score < 0.5 || CC.score < 0.5) { ja[dd.key] = null; continue; }
            var deg = H.angleDeg(A, B, CC);
            ja[dd.key] = deg;
            if (KN.state.showAngles && deg != null) {
              H.drawAngleArcPx(cx, B.x, B.y, A.x, A.y, CC.x, CC.y, w, h);
              H.drawTextBadge(cx, B.x + 8, B.y - 8, dd.label + ' ' + deg.toFixed(0), '#ffb347');
            }
          }
          if (KN.state.showLabels) {
            for (var li = 0; li < C.MOVENET_LABEL_INDICES.length; li++) {
              var idx = C.MOVENET_LABEL_INDICES[li];
              var kp = bkps[idx];
              if (kp && kp.score >= 0.5) H.drawTextBadge(cx, kp.x + 6, kp.y + 6, C.MOVENET_KP_NAMES[idx], '#ffffff');
            }
          }
          var visC = 0, confS = 0;
          for (var si = 0; si < bkps.length; si++) {
            var sc = bkps[si].score || 0;
            confS += sc; if (sc >= 0.5) visC++;
          }
          if (KN.neuro) {
            var nkps = bkps.map(function(k) { return { x: k.x / w, y: k.y / h, score: k.score }; });
            KN.neuro.updateBehavior(nkps, KN.neuro.MV_MAP);
          }
          cx.restore();
          return { tracking: true, numPersons: poses.length, landmarkCount: visC, totalLandmarks: 17, meanConfidence: confS / bkps.length, jointAngles: ja };
        });
      },
      destroy: function () { if (detector) { detector.dispose(); detector = null; } }
    };
  })();

  KN.models = models;
})();
