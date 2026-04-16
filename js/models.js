(function () {
  var KN = window.KN = window.KN || {};
  var H = KN.helpers;
  var C = KN.constants;

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
            cx.drawImage(vid, 0, 0, w, h);
            var lms = results.poseLandmarks;
            if (lms && lms.length) {
              if (window.drawConnectors && window.POSE_CONNECTIONS)
                window.drawConnectors(cx, lms, window.POSE_CONNECTIONS, { color: '#00FF88', lineWidth: 2 });
              if (window.drawLandmarks)
                window.drawLandmarks(cx, lms, { color: '#FFF', fillColor: '#FFF', lineWidth: 1, radius: 4 });
              var ja = computeAnglesMp(lms, cx, w, h);
              drawLabelsMp(lms, cx, w, h);
              var visC = 0, confS = 0;
              for (var i = 0; i < lms.length; i++) {
                var v = lms[i].visibility != null ? lms[i].visibility : 0;
                confS += v; if (v >= 0.5) visC++;
              }
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
            cx.drawImage(vid, 0, 0, w, h);
            var poseLms = results.poseLandmarks;
            var faceLms = results.faceLandmarks;
            var lhLms = results.leftHandLandmarks;
            var rhLms = results.rightHandLandmarks;
            if (poseLms && poseLms.length) {
              if (faceLms && faceLms.length && window.drawConnectors && window.FACEMESH_TESSELATION)
                window.drawConnectors(cx, faceLms, window.FACEMESH_TESSELATION, { color: 'rgba(127,216,255,0.15)', lineWidth: 0.5 });
              if (window.drawConnectors && window.POSE_CONNECTIONS)
                window.drawConnectors(cx, poseLms, window.POSE_CONNECTIONS, { color: '#7FD8FF', lineWidth: 2 });
              if (window.drawLandmarks)
                window.drawLandmarks(cx, poseLms, { color: '#FFF', fillColor: '#FFF', lineWidth: 1, radius: 3 });
              if (lhLms && lhLms.length && window.HAND_CONNECTIONS) {
                window.drawConnectors(cx, lhLms, window.HAND_CONNECTIONS, { color: '#5BC0EB', lineWidth: 1.5 });
                window.drawLandmarks(cx, lhLms, { color: '#FFF', fillColor: '#FFF', lineWidth: 1, radius: 2 });
              }
              if (rhLms && rhLms.length && window.HAND_CONNECTIONS) {
                window.drawConnectors(cx, rhLms, window.HAND_CONNECTIONS, { color: '#5BC0EB', lineWidth: 1.5 });
                window.drawLandmarks(cx, rhLms, { color: '#FFF', fillColor: '#FFF', lineWidth: 1, radius: 2 });
              }
              var ja = computeAnglesMp(poseLms, cx, w, h);
              drawLabelsMp(poseLms, cx, w, h);
              var visC = 0, confS = 0;
              for (var i = 0; i < poseLms.length; i++) {
                var v = poseLms[i].visibility != null ? poseLms[i].visibility : 0;
                confS += v; if (v >= 0.5) visC++;
              }
              var totalVis = visC + (lhLms ? lhLms.length : 0) + (rhLms ? rhLms.length : 0) + (faceLms ? faceLms.length : 0);
              var totalPossible = 33 + (lhLms ? 21 : 0) + (rhLms ? 21 : 0) + (faceLms ? 468 : 0);
              if (KN.neuro) KN.neuro.update(faceLms, poseLms, ja);
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
          cx.drawImage(vid, 0, 0, w, h);
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
          cx.restore();
          return { tracking: true, numPersons: poses.length, landmarkCount: visC, totalLandmarks: 17, meanConfidence: confS / bkps.length, jointAngles: ja };
        });
      },
      destroy: function () { if (detector) { detector.dispose(); detector = null; } }
    };
  })();

  KN.models = models;
})();
