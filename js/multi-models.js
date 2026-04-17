// SPDX-License-Identifier: MIT
// multi-models.js - MoveNet MultiPose (up to 6 people, 17 COCO keypoints each).
(function () {
  var KN = window.KN = window.KN || {};
  var H = KN.helpers;

  var CONNECTIONS = [
    [5,7],[7,9],[6,8],[8,10],[5,6],[5,11],[6,12],[11,12],
    [11,13],[13,15],[12,14],[14,16],[0,1],[0,2],[1,3],[2,4]
  ];

  var KP_NAMES = [
    'nose','L.eye','R.eye','L.ear','R.ear',
    'L.shoulder','R.shoulder','L.elbow','R.elbow','L.wrist','R.wrist',
    'L.hip','R.hip','L.knee','R.knee','L.ankle','R.ankle'
  ];

  var ANGLE_DEFS = [
    { key: 'a_lshoulder', label: 'L.shl', a: 7,  b: 5,  c: 11 },
    { key: 'a_rshoulder', label: 'R.shl', a: 8,  b: 6,  c: 12 },
    { key: 'a_lelbow',    label: 'L.elb', a: 5,  b: 7,  c: 9 },
    { key: 'a_relbow',    label: 'R.elb', a: 6,  b: 8,  c: 10 },
    { key: 'a_lhip',      label: 'L.hip', a: 5,  b: 11, c: 13 },
    { key: 'a_rhip',      label: 'R.hip', a: 6,  b: 12, c: 14 },
    { key: 'a_lknee',     label: 'L.knee', a: 11, b: 13, c: 15 },
    { key: 'a_rknee',     label: 'R.knee', a: 12, b: 14, c: 16 }
  ];

  var PERSON_COLORS = ['#7FD8FF', '#C084FC', '#00FF88', '#FFB347', '#FF6B6B', '#F472B6'];

  var detector = null;

  KN.multiModel = {
    name: 'MoveNet MultiPose',
    init: function () {
      if (detector) return Promise.resolve();
      if (!window.poseDetection) return Promise.reject(new Error('TF.js pose-detection failed to load.'));
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

        if (!poses || !poses.length) { cx.restore(); return { tracking: false, numPersons: 0 }; }

        for (var p = 0; p < poses.length; p++) {
          var kps = poses[p].keypoints;
          var col = PERSON_COLORS[p % PERSON_COLORS.length];

          // Skeleton lines with glow
          cx.save();
          cx.shadowBlur = 8;
          cx.shadowColor = col;
          cx.strokeStyle = col;
          cx.lineWidth = 2.5;
          cx.lineCap = 'round';
          for (var ci = 0; ci < CONNECTIONS.length; ci++) {
            var a = kps[CONNECTIONS[ci][0]], b = kps[CONNECTIONS[ci][1]];
            if (a.score >= 0.3 && b.score >= 0.3) {
              cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke();
            }
          }
          cx.restore();

          // Joint dots
          for (var ki = 0; ki < kps.length; ki++) {
            if (kps[ki].score >= 0.3) {
              cx.fillStyle = '#FFF';
              cx.shadowBlur = 4;
              cx.shadowColor = col;
              cx.beginPath(); cx.arc(kps[ki].x, kps[ki].y, 4, 0, 2 * Math.PI); cx.fill();
              cx.shadowBlur = 0;
            }
          }

          // Person label
          var minX = Infinity, minY = Infinity;
          for (var ki2 = 0; ki2 < kps.length; ki2++) {
            if (kps[ki2].score >= 0.3) { if (kps[ki2].x < minX) minX = kps[ki2].x; if (kps[ki2].y < minY) minY = kps[ki2].y; }
          }
          if (minX < Infinity) {
            H.drawTextBadge(cx, minX, Math.max(0, minY - 22), 'P' + (p + 1) + ' ' + (poses[p].score != null ? poses[p].score.toFixed(2) : ''), col);
          }

          // Labels
          if (KN.state.showLabels) {
            for (var li = 0; li < kps.length; li++) {
              if (kps[li].score >= 0.5) H.drawTextBadge(cx, kps[li].x + 6, kps[li].y + 6, KP_NAMES[li], '#ffffff');
            }
          }
        }

        // Joint angles for best person
        var best = poses[0];
        for (var bi = 1; bi < poses.length; bi++) { if ((poses[bi].score || 0) > (best.score || 0)) best = poses[bi]; }
        var bkps = best.keypoints;
        var ja = {};
        for (var ai = 0; ai < ANGLE_DEFS.length; ai++) {
          var dd = ANGLE_DEFS[ai];
          var A = bkps[dd.a], B = bkps[dd.b], CC = bkps[dd.c];
          if (!A || !B || !CC || A.score < 0.5 || B.score < 0.5 || CC.score < 0.5) { ja[dd.key] = null; continue; }
          var deg = H.angleDeg(A, B, CC);
          ja[dd.key] = deg;
          if (KN.state.showAngles && deg != null) {
            H.drawAngleArcPx(cx, B.x, B.y, A.x, A.y, CC.x, CC.y, w, h);
            H.drawTextBadge(cx, B.x + 8, B.y - 8, dd.label + ' ' + deg.toFixed(0), '#ffb347');
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

  KN.multiConstants = { ANGLE_DEFS: ANGLE_DEFS };
})();
