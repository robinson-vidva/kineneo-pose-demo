// SPDX-License-Identifier: MIT
// multi-models.js - Tasks API: PoseLandmarker + FaceLandmarker + HandLandmarker.
(function () {
  var KN = window.KN = window.KN || {};
  var H = KN.helpers;

  var TASKS_VERSION = '0.10.34';
  var TASKS_BUNDLE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + TASKS_VERSION + '/vision_bundle.mjs';
  var TASKS_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + TASKS_VERSION + '/wasm';
  var POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
  var FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';
  var HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

  var poseLandmarker = null;
  var faceLandmarker = null;
  var handLandmarker = null;
  var modulePromise = null;
  var filesetPromise = null;

  var POSE_CONNECTIONS = [
    [11,13],[13,15],[12,14],[14,16],
    [11,12],[11,23],[12,24],[23,24],
    [23,25],[25,27],[24,26],[26,28],
    [15,17],[15,19],[15,21],[17,19],
    [16,18],[16,20],[16,22],[18,20],
    [27,29],[27,31],[29,31],
    [28,30],[28,32],[30,32]
  ];

  var HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
    [5,9],[9,13],[13,17]
  ];

  // Subset of face tessellation edges for a lightweight mesh overlay.
  var FACE_OVAL = [
    [10,338],[338,297],[297,332],[332,284],[284,251],[251,389],[389,356],[356,454],[454,323],[323,361],[361,288],
    [288,397],[397,365],[365,379],[379,378],[378,400],[400,377],[377,152],[152,148],[148,176],[176,149],[149,150],
    [150,136],[136,172],[172,58],[58,132],[132,93],[93,234],[234,127],[127,162],[162,21],[21,54],[54,103],[103,67],[67,109],[109,10]
  ];

  var PERSON_COLORS = ['#7FD8FF', '#C084FC', '#00FF88', '#FFB347', '#FF6B6B', '#F472B6'];

  var ANGLE_DEFS = [
    { key: 'a_lshoulder', label: 'L.shl', a: 13, b: 11, c: 23 },
    { key: 'a_rshoulder', label: 'R.shl', a: 14, b: 12, c: 24 },
    { key: 'a_lelbow',    label: 'L.elb', a: 11, b: 13, c: 15 },
    { key: 'a_relbow',    label: 'R.elb', a: 12, b: 14, c: 16 },
    { key: 'a_lhip',      label: 'L.hip', a: 11, b: 23, c: 25 },
    { key: 'a_rhip',      label: 'R.hip', a: 12, b: 24, c: 26 },
    { key: 'a_lknee',     label: 'L.knee', a: 23, b: 25, c: 27 },
    { key: 'a_rknee',     label: 'R.knee', a: 24, b: 26, c: 28 }
  ];

  var LM_NAMES = [
    'nose','L.eye.in','L.eye','L.eye.out','R.eye.in','R.eye','R.eye.out',
    'L.ear','R.ear','mouth.L','mouth.R',
    'L.shoulder','R.shoulder','L.elbow','R.elbow','L.wrist','R.wrist',
    'L.pinky','R.pinky','L.index','R.index','L.thumb','R.thumb',
    'L.hip','R.hip','L.knee','R.knee','L.ankle','R.ankle',
    'L.heel','R.heel','L.foot.ix','R.foot.ix'
  ];
  var LABEL_INDICES = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

  function getModule() {
    if (!modulePromise) modulePromise = import(TASKS_BUNDLE);
    return modulePromise;
  }

  function getFileset() {
    if (!filesetPromise) {
      filesetPromise = getModule().then(function (mod) {
        return mod.FilesetResolver.forVisionTasks(TASKS_WASM).then(function (fs) {
          return { mod: mod, fileset: fs };
        });
      });
    }
    return filesetPromise;
  }

  KN.multiModel = {
    name: 'Tasks API (Pose + Face + Hands)',
    init: function (onProgress) {
      var progress = onProgress || function () {};
      progress('Loading MediaPipe Tasks Vision...');
      return getFileset().then(function (ctx) {
        var tasks = [];
        if (!poseLandmarker) {
          progress('Downloading PoseLandmarker model...');
          tasks.push(
            ctx.mod.PoseLandmarker.createFromOptions(ctx.fileset, {
              baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'GPU' },
              runningMode: 'VIDEO',
              numPoses: 6,
              minPoseDetectionConfidence: 0.5,
              minPosePresenceConfidence: 0.5,
              minTrackingConfidence: 0.5
            }).then(function (lm) { poseLandmarker = lm; console.log('[kineneo-multi] PoseLandmarker ready'); })
          );
        }
        if (!faceLandmarker) {
          progress('Downloading FaceLandmarker model...');
          tasks.push(
            ctx.mod.FaceLandmarker.createFromOptions(ctx.fileset, {
              baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
              runningMode: 'VIDEO',
              numFaces: 6,
              minFaceDetectionConfidence: 0.5,
              minFacePresenceConfidence: 0.5,
              minTrackingConfidence: 0.5
            }).then(function (lm) { faceLandmarker = lm; console.log('[kineneo-multi] FaceLandmarker ready'); })
          );
        }
        if (!handLandmarker) {
          progress('Downloading HandLandmarker model...');
          tasks.push(
            ctx.mod.HandLandmarker.createFromOptions(ctx.fileset, {
              baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
              runningMode: 'VIDEO',
              numHands: 4,
              minHandDetectionConfidence: 0.5,
              minHandPresenceConfidence: 0.5,
              minTrackingConfidence: 0.5
            }).then(function (lm) { handLandmarker = lm; console.log('[kineneo-multi] HandLandmarker ready'); })
          );
        }
        progress('Loading all models...');
        return Promise.all(tasks);
      }).catch(function (err) {
        console.error('[kineneo-multi] init failed:', err);
        throw err;
      });
    },
    run: function (vid, cvs, cx) {
      if (!poseLandmarker || vid.readyState < 2) return Promise.resolve(null);
      var w = vid.videoWidth, h = vid.videoHeight;
      H.ensureCanvasSize(cvs, w, h);
      var ts = performance.now();

      var poseResult, faceResult, handResult;
      try { poseResult = poseLandmarker.detectForVideo(vid, ts); } catch (e) { poseResult = { landmarks: [] }; }
      try { faceResult = faceLandmarker ? faceLandmarker.detectForVideo(vid, ts) : { faceLandmarks: [] }; } catch (e) { faceResult = { faceLandmarks: [] }; }
      try { handResult = handLandmarker ? handLandmarker.detectForVideo(vid, ts) : { landmarks: [] }; } catch (e) { handResult = { landmarks: [] }; }

      cx.save();
      cx.clearRect(0, 0, w, h);
      if (!KN.state.skeletonOnly) cx.drawImage(vid, 0, 0, w, h);
      else { cx.fillStyle = '#0a0a0a'; cx.fillRect(0, 0, w, h); }

      // --- Face meshes ---
      var faces = faceResult.faceLandmarks || [];
      for (var fi = 0; fi < faces.length; fi++) {
        var face = faces[fi];
        cx.save();
        cx.strokeStyle = 'rgba(127,216,255,0.12)';
        cx.lineWidth = 0.5;
        for (var ei = 0; ei < FACE_OVAL.length; ei++) {
          var fa = face[FACE_OVAL[ei][0]], fb = face[FACE_OVAL[ei][1]];
          if (fa && fb) {
            cx.beginPath(); cx.moveTo(fa.x * w, fa.y * h); cx.lineTo(fb.x * w, fb.y * h); cx.stroke();
          }
        }
        cx.restore();
      }

      // --- Hand skeletons ---
      var hands = handResult.landmarks || [];
      var handedness = handResult.handednesses || [];
      for (var hi = 0; hi < hands.length; hi++) {
        var hand = hands[hi];
        var handLabel = (handedness[hi] && handedness[hi][0] && handedness[hi][0].displayName) || '';
        var handCol = handLabel === 'Left' ? '#5BC0EB' : '#C084FC';
        cx.save();
        cx.shadowBlur = 6;
        cx.shadowColor = handCol;
        cx.strokeStyle = handCol;
        cx.lineWidth = 1.5;
        cx.lineCap = 'round';
        for (var hci = 0; hci < HAND_CONNECTIONS.length; hci++) {
          var ha = hand[HAND_CONNECTIONS[hci][0]], hb = hand[HAND_CONNECTIONS[hci][1]];
          if (ha && hb) {
            cx.beginPath(); cx.moveTo(ha.x * w, ha.y * h); cx.lineTo(hb.x * w, hb.y * h); cx.stroke();
          }
        }
        for (var hk = 0; hk < hand.length; hk++) {
          cx.fillStyle = '#FFF';
          cx.beginPath(); cx.arc(hand[hk].x * w, hand[hk].y * h, 2, 0, 2 * Math.PI); cx.fill();
        }
        if (handLabel) H.drawTextBadge(cx, hand[0].x * w + 8, hand[0].y * h - 14, handLabel, handCol);
        cx.shadowBlur = 0;
        cx.restore();
      }

      // --- Body skeletons ---
      var allLandmarks = poseResult.landmarks || [];
      if (!allLandmarks.length) { cx.restore(); return Promise.resolve({ tracking: false, numPersons: 0 }); }

      for (var p = 0; p < allLandmarks.length; p++) {
        var lms = allLandmarks[p];
        var col = PERSON_COLORS[p % PERSON_COLORS.length];

        cx.save();
        cx.shadowBlur = 8;
        cx.shadowColor = col;
        cx.strokeStyle = col;
        cx.lineWidth = 2.5;
        cx.lineCap = 'round';
        for (var ci = 0; ci < POSE_CONNECTIONS.length; ci++) {
          var ai = POSE_CONNECTIONS[ci][0], bi = POSE_CONNECTIONS[ci][1];
          var A = lms[ai], B = lms[bi];
          if (!A || !B) continue;
          var vA = A.visibility != null ? A.visibility : 1;
          var vB = B.visibility != null ? B.visibility : 1;
          if (vA < 0.3 || vB < 0.3) continue;
          cx.beginPath(); cx.moveTo(A.x * w, A.y * h); cx.lineTo(B.x * w, B.y * h); cx.stroke();
        }
        cx.restore();

        for (var ki = 0; ki < lms.length; ki++) {
          var pt = lms[ki];
          if (!pt || (pt.visibility != null && pt.visibility < 0.3)) continue;
          cx.fillStyle = '#FFF';
          cx.shadowBlur = 4; cx.shadowColor = col;
          cx.beginPath(); cx.arc(pt.x * w, pt.y * h, 3, 0, 2 * Math.PI); cx.fill();
          cx.shadowBlur = 0;
        }

        var minX = Infinity, minY = Infinity;
        for (var li = 0; li < lms.length; li++) {
          if (lms[li] && (lms[li].visibility || 0) >= 0.3) {
            if (lms[li].x * w < minX) minX = lms[li].x * w;
            if (lms[li].y * h < minY) minY = lms[li].y * h;
          }
        }
        if (minX < Infinity) H.drawTextBadge(cx, minX, Math.max(0, minY - 22), 'P' + (p + 1), col);

        if (KN.state.showLabels) {
          for (var la = 0; la < LABEL_INDICES.length; la++) {
            var idx = LABEL_INDICES[la];
            var lp = lms[idx];
            if (lp && (lp.visibility || 0) >= 0.5)
              H.drawTextBadge(cx, lp.x * w + 6, lp.y * h + 6, LM_NAMES[idx], '#ffffff');
          }
        }
      }

      // Joint angles for first person
      var bestLms = allLandmarks[0];
      var ja = {};
      for (var ai2 = 0; ai2 < ANGLE_DEFS.length; ai2++) {
        var dd = ANGLE_DEFS[ai2];
        var AA = bestLms[dd.a], BB = bestLms[dd.b], CC = bestLms[dd.c];
        if (!AA || !BB || !CC) { ja[dd.key] = null; continue; }
        if ((AA.visibility || 0) < 0.5 || (BB.visibility || 0) < 0.5 || (CC.visibility || 0) < 0.5) { ja[dd.key] = null; continue; }
        var deg = H.angleDeg(AA, BB, CC);
        ja[dd.key] = deg;
        if (KN.state.showAngles && deg != null) {
          H.drawAngleArcPx(cx, BB.x * w, BB.y * h, AA.x * w, AA.y * h, CC.x * w, CC.y * h, w, h);
          H.drawTextBadge(cx, BB.x * w + 8, BB.y * h - 8, dd.label + ' ' + deg.toFixed(0), '#ffb347');
        }
      }

      var visC = 0, confS = 0;
      for (var si = 0; si < bestLms.length; si++) {
        var v = bestLms[si] ? (bestLms[si].visibility || 0) : 0;
        confS += v; if (v >= 0.5) visC++;
      }
      var totalLms = 33 * allLandmarks.length + faces.length * 478 + hands.length * 21;

      cx.restore();
      return Promise.resolve({
        tracking: true,
        numPersons: allLandmarks.length,
        numFaces: faces.length,
        numHands: hands.length,
        landmarkCount: visC,
        totalLandmarks: totalLms,
        meanConfidence: confS / bestLms.length,
        jointAngles: ja
      });
    },
    destroy: function () {
      if (poseLandmarker) { poseLandmarker.close(); poseLandmarker = null; }
      if (faceLandmarker) { faceLandmarker.close(); faceLandmarker = null; }
      if (handLandmarker) { handLandmarker.close(); handLandmarker = null; }
    }
  };

  KN.multiConstants = { ANGLE_DEFS: ANGLE_DEFS };
})();
