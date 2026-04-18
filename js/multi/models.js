// SPDX-License-Identifier: MIT
// multi-models.js - Tasks API: PoseLandmarker + FaceLandmarker + HandLandmarker.
(function () {
  var KN = window.KN = window.KN || {};
  var H = KN.helpers;

  var TASKS_VERSION = '0.10.34';
  var TASKS_BUNDLE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + TASKS_VERSION + '/vision_bundle.mjs';
  var TASKS_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + TASKS_VERSION + '/wasm';
  var POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';
  var FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';
  var GESTURE_MODEL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task';

  var poseLandmarker = null;
  var faceLandmarker = null;
  var gestureRecognizer = null;
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

  // --- Per-person visual state ---
  var perPerson = {}; // tracked-id -> { prevLms, velocities, regionIntensity, trails, smoothed, cx, cy }
  var nextPersonId = 0;
  var prevFrameIds = []; // array of tracked-ids from last frame
  var VEL_SMOOTH = 0.15, VEL_MIN = 0.004, VEL_MAX = 0.03;
  var DEPTH_Z_RANGE = 0.3;
  var HEATMAP_DECAY = 0.97, HEATMAP_GAIN = 8.0;
  var TRAIL_LEN = 16;
  var TRAIL_KEYS = ['lWrist', 'rWrist', 'lAnkle', 'rAnkle', 'nose'];
  var TRAIL_IDX = { lWrist: 15, rWrist: 16, lAnkle: 27, rAnkle: 28, nose: 0 };
  var REGION_MAP = {
    head: [0,1,2,3,4,5,6,7,8,9,10], torso: [11,12,23,24],
    leftArm: [11,13,15,17,19,21], rightArm: [12,14,16,18,20,22],
    leftLeg: [23,25,27,29,31], rightLeg: [24,26,28,30,32]
  };
  var SYM_PAIRS = [[11,12],[13,14],[15,16],[23,24],[25,26],[27,28]];

  function centroid(lms) {
    var sx = 0, sy = 0, n = 0;
    for (var i = 0; i < lms.length; i++) {
      if (lms[i] && (lms[i].visibility || 0) > 0.3) { sx += lms[i].x; sy += lms[i].y; n++; }
    }
    return n > 0 ? { x: sx / n, y: sy / n } : { x: 0.5, y: 0.5 };
  }

  // Match current frame's people to previous frame's tracked IDs by nearest centroid.
  function matchPersonIds(allLandmarks) {
    var curCentroids = [];
    for (var i = 0; i < allLandmarks.length; i++) curCentroids.push(centroid(allLandmarks[i]));

    var ids = new Array(allLandmarks.length);
    var usedPrev = {};

    for (var ci = 0; ci < curCentroids.length; ci++) {
      var bestId = -1, bestDist = 0.15; // max match distance
      for (var pi = 0; pi < prevFrameIds.length; pi++) {
        if (usedPrev[pi]) continue;
        var ps = perPerson[prevFrameIds[pi]];
        if (!ps) continue;
        var d = Math.hypot(curCentroids[ci].x - ps.cx, curCentroids[ci].y - ps.cy);
        if (d < bestDist) { bestDist = d; bestId = pi; }
      }
      if (bestId >= 0) {
        ids[ci] = prevFrameIds[bestId];
        usedPrev[bestId] = true;
      } else {
        ids[ci] = nextPersonId++;
      }
      // Update stored centroid
      if (!perPerson[ids[ci]]) {
        var trails = {};
        for (var t = 0; t < TRAIL_KEYS.length; t++) trails[TRAIL_KEYS[t]] = [];
        perPerson[ids[ci]] = { prevLms: null, velocities: new Array(33).fill(0), regionIntensity: { head:0, torso:0, leftArm:0, rightArm:0, leftLeg:0, rightLeg:0 }, trails: trails, smoothed: null, cx: 0.5, cy: 0.5 };
      }
      perPerson[ids[ci]].cx = curCentroids[ci].x;
      perPerson[ids[ci]].cy = curCentroids[ci].y;
    }
    prevFrameIds = ids;
    return ids;
  }

  function getPersonState(pid) { return perPerson[pid]; }

  var SMOOTH_FACTOR = 0.12;          // face smoothing (constant)
  // Velocity-adaptive pose smoothing: heavy when still, snappy when moving
  var POSE_SMOOTH_MIN = 0.12;        // at rest: kills jitter
  var POSE_SMOOTH_MAX = 0.6;         // fast motion: ~1-frame lag
  var POSE_VEL_REF = 0.02;           // velocity at which alpha reaches max

  function smoothLandmarks(ps, lms) {
    if (!ps.smoothed) {
      ps.smoothed = [];
      for (var k = 0; k < lms.length; k++) ps.smoothed.push({ x: lms[k].x, y: lms[k].y, z: lms[k].z || 0, visibility: lms[k].visibility });
      return ps.smoothed;
    }
    for (var i = 0; i < Math.min(lms.length, ps.smoothed.length); i++) {
      var vel = ps.velocities[i] || 0;
      var t = Math.min(1, vel / POSE_VEL_REF);
      var a = POSE_SMOOTH_MIN + (POSE_SMOOTH_MAX - POSE_SMOOTH_MIN) * t;
      ps.smoothed[i].x += (lms[i].x - ps.smoothed[i].x) * a;
      ps.smoothed[i].y += (lms[i].y - ps.smoothed[i].y) * a;
      ps.smoothed[i].z += ((lms[i].z || 0) - ps.smoothed[i].z) * a;
      ps.smoothed[i].visibility = lms[i].visibility;
    }
    return ps.smoothed;
  }

  var smoothedFaces = {};

  function clearAllPersonState() { perPerson = {}; smoothedFaces = {}; prevFrameIds = []; nextPersonId = 0; }

  function smoothFace(fid, lms) {
    if (!smoothedFaces[fid]) {
      smoothedFaces[fid] = [];
      for (var k = 0; k < lms.length; k++) smoothedFaces[fid].push({ x: lms[k].x, y: lms[k].y, z: lms[k].z || 0 });
      return smoothedFaces[fid];
    }
    var s = smoothedFaces[fid];
    for (var i = 0; i < Math.min(lms.length, s.length); i++) {
      s[i].x += (lms[i].x - s[i].x) * SMOOTH_FACTOR;
      s[i].y += (lms[i].y - s[i].y) * SMOOTH_FACTOR;
      s[i].z += ((lms[i].z || 0) - s[i].z) * SMOOTH_FACTOR;
    }
    return s;
  }

  function depthScale(z) { var t = -(z || 0) / DEPTH_Z_RANGE; return 1 + Math.max(-1, Math.min(1, t)) * 0.5; }

  function velColor(vel) {
    var t = Math.max(0, Math.min(1, (vel - VEL_MIN) / (VEL_MAX - VEL_MIN)));
    return 'hsl(' + Math.round(200 - t * 200) + ',' + Math.round(80 + t * 20) + '%,' + Math.round(58 + t * 14) + '%)';
  }

  function heatColor(t) { return 'hsla(' + Math.round(240 - Math.max(0, Math.min(1, t)) * 240) + ',90%,55%,'; }

  function updateVelocities(ps, lms) {
    if (!ps.prevLms) { ps.prevLms = []; for (var k = 0; k < lms.length; k++) ps.prevLms.push({ x: lms[k].x, y: lms[k].y }); return; }
    for (var i = 0; i < Math.min(lms.length, 33); i++) {
      var dx = lms[i].x - ps.prevLms[i].x, dy = lms[i].y - ps.prevLms[i].y;
      ps.velocities[i] = ps.velocities[i] * (1 - VEL_SMOOTH) + Math.sqrt(dx * dx + dy * dy) * VEL_SMOOTH;
      ps.prevLms[i].x = lms[i].x; ps.prevLms[i].y = lms[i].y;
    }
  }

  function updateRegionIntensity(ps) {
    var keys = Object.keys(REGION_MAP);
    for (var k = 0; k < keys.length; k++) {
      var idxs = REGION_MAP[keys[k]], sum = 0;
      for (var i = 0; i < idxs.length; i++) sum += ps.velocities[idxs[i]] || 0;
      ps.regionIntensity[keys[k]] = ps.regionIntensity[keys[k]] * HEATMAP_DECAY + (sum / idxs.length) * HEATMAP_GAIN * (1 - HEATMAP_DECAY);
    }
  }

  function drawHeatmapForPerson(cx, ps, lms, w, h) {
    var keys = Object.keys(REGION_MAP);
    cx.save();
    for (var k = 0; k < keys.length; k++) {
      var idxs = REGION_MAP[keys[k]], sx = 0, sy = 0, cnt = 0, maxD = 0;
      for (var i = 0; i < idxs.length; i++) { var p = lms[idxs[i]]; if (p && (p.visibility||0) > 0.3) { sx += p.x*w; sy += p.y*h; cnt++; } }
      if (cnt < 2) continue;
      var cx_ = sx/cnt, cy_ = sy/cnt;
      for (var j = 0; j < idxs.length; j++) { var q = lms[idxs[j]]; if (q && (q.visibility||0) > 0.3) { var d = Math.hypot(q.x*w-cx_, q.y*h-cy_); if (d > maxD) maxD = d; } }
      var r = Math.max(maxD * 1.3, 30), t = Math.min(1, ps.regionIntensity[keys[k]] * 4);
      if (t < 0.02) continue;
      var base = heatColor(t), grad = cx.createRadialGradient(cx_, cy_, 0, cx_, cy_, r);
      grad.addColorStop(0, base + (0.3*t).toFixed(2) + ')'); grad.addColorStop(1, base + '0)');
      cx.fillStyle = grad; cx.beginPath(); cx.arc(cx_, cy_, r, 0, 2*Math.PI); cx.fill();
    }
    cx.restore();
  }

  function drawTrailsForPerson(cx, ps, lms, w, h) {
    for (var ti = 0; ti < TRAIL_KEYS.length; ti++) {
      var key = TRAIL_KEYS[ti], idx = TRAIL_IDX[key], arr = ps.trails[key];
      var p = lms[idx]; if (p && (p.visibility||0) > 0.3) { arr.push({ x: p.x*w, y: p.y*h }); if (arr.length > TRAIL_LEN) arr.shift(); }
    }
    Object.keys(ps.trails).forEach(function(k) {
      var arr = ps.trails[k]; if (arr.length < 2) return;
      for (var i = 1; i < arr.length; i++) {
        var alpha = i / arr.length;
        cx.save(); cx.globalAlpha = alpha * 0.4; cx.lineWidth = 1.5 + alpha * 1.5;
        var grad = cx.createLinearGradient(arr[i-1].x, arr[i-1].y, arr[i].x, arr[i].y);
        grad.addColorStop(0, 'rgba(127,216,255,0.3)'); grad.addColorStop(1, 'rgba(200,132,252,0.6)');
        cx.strokeStyle = grad; cx.beginPath(); cx.moveTo(arr[i-1].x, arr[i-1].y); cx.lineTo(arr[i].x, arr[i].y); cx.stroke(); cx.restore();
      }
    });
  }

  function drawSymmetryLines(cx, lms, w, h) {
    cx.save(); cx.strokeStyle = 'rgba(0,255,136,0.12)'; cx.lineWidth = 1; cx.setLineDash([3,3]);
    for (var i = 0; i < SYM_PAIRS.length; i++) {
      var L = lms[SYM_PAIRS[i][0]], R = lms[SYM_PAIRS[i][1]];
      if (!L || !R || (L.visibility||0) < 0.5 || (R.visibility||0) < 0.5) continue;
      cx.beginPath(); cx.moveTo(L.x*w, L.y*h); cx.lineTo(R.x*w, R.y*h); cx.stroke();
    }
    cx.setLineDash([]); cx.restore();
  }

  function drawCenterOfMass(cx, lms, w, h, color) {
    var lSh = lms[11], rSh = lms[12]; if (!lSh || !rSh || (lSh.visibility||0) < 0.5 || (rSh.visibility||0) < 0.5) return;
    var sx = (lSh.x+rSh.x)/2, sy = (lSh.y+rSh.y)/2, cx_, cy_;
    var lHip = lms[23], rHip = lms[24];
    if (lHip && rHip && (lHip.visibility||0) > 0.5 && (rHip.visibility||0) > 0.5) { cx_ = (sx+(lHip.x+rHip.x)/2)/2; cy_ = (sy+(lHip.y+rHip.y)/2)/2; }
    else { cx_ = sx; cy_ = sy + 0.05; }
    cx.save(); cx.shadowBlur = 20; cx.shadowColor = color; cx.fillStyle = color; cx.globalAlpha = 0.85;
    cx.beginPath(); cx.arc(cx_*w, cy_*h, 7, 0, 2*Math.PI); cx.fill(); cx.restore();
  }

  function drawGradientVoid(cx, w, h) {
    cx.save(); var now = performance.now() * 0.0003;
    var cx_ = w/2+Math.sin(now)*w*0.1, cy_ = h/2+Math.cos(now*0.7)*h*0.08;
    var grad = cx.createRadialGradient(cx_, cy_, 0, cx_, cy_, Math.max(w,h)*0.7);
    grad.addColorStop(0,'rgba(20,10,40,1)'); grad.addColorStop(0.4,'rgba(8,14,32,1)'); grad.addColorStop(1,'rgba(4,4,8,1)');
    cx.fillStyle = grad; cx.fillRect(0,0,w,h);
    cx.globalAlpha = 0.04;
    for (var i = 0; i < 120; i++) {
      var nx = (Math.sin(i*127.1+now*2)*0.5+0.5)*w, ny = (Math.cos(i*311.7+now*1.3)*0.5+0.5)*h;
      cx.fillStyle = i%3===0 ? '#C084FC' : '#7FD8FF'; cx.beginPath(); cx.arc(nx,ny,1+Math.sin(i+now*3)*0.5,0,2*Math.PI); cx.fill();
    }
    cx.globalAlpha = 1; cx.restore();
  }

  function drawVelocitySkeleton(cx, ps, lms, w, h) {
    cx.save(); cx.lineCap = 'round';
    for (var i = 0; i < POSE_CONNECTIONS.length; i++) {
      var ai = POSE_CONNECTIONS[i][0], bi = POSE_CONNECTIONS[i][1], A = lms[ai], B = lms[bi];
      if (!A || !B || (A.visibility||0) < 0.3 || (B.visibility||0) < 0.3) continue;
      var ax = A.x*w, ay = A.y*h, bx = B.x*w, by = B.y*h;
      var grad = cx.createLinearGradient(ax,ay,bx,by); grad.addColorStop(0,velColor(ps.velocities[ai])); grad.addColorStop(1,velColor(ps.velocities[bi]));
      cx.strokeStyle = grad; var avgVel = (ps.velocities[ai]+ps.velocities[bi])/2, avgZ = ((A.z||0)+(B.z||0))/2, ds = depthScale(avgZ);
      cx.lineWidth = 3*ds; cx.shadowBlur = (10+avgVel*400)*ds; cx.shadowColor = velColor(avgVel);
      cx.beginPath(); cx.moveTo(ax,ay); cx.lineTo(bx,by); cx.stroke();
    }
    for (var j = 0; j < Math.min(lms.length,33); j++) {
      var p = lms[j]; if (!p || (p.visibility||0) < 0.3) continue;
      var ds2 = depthScale(p.z); cx.shadowBlur = 6*ds2; cx.shadowColor = velColor(ps.velocities[j]); cx.fillStyle = '#FFF';
      cx.beginPath(); cx.arc(p.x*w,p.y*h,3*ds2,0,2*Math.PI); cx.fill();
    }
    cx.shadowBlur = 0; cx.restore();
  }

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

  // Create a task with GPU delegate, falling back to CPU on failure.
  function createWithFallback(TaskCls, fileset, opts, label) {
    var gpuOpts = JSON.parse(JSON.stringify(opts));
    gpuOpts.baseOptions.delegate = 'GPU';
    return TaskCls.createFromOptions(fileset, gpuOpts).then(
      function (inst) { console.log('[kineneo-multi] ' + label + ' ready (GPU)'); return inst; },
      function (gpuErr) {
        console.warn('[kineneo-multi] ' + label + ' GPU failed, trying CPU:', gpuErr && gpuErr.message);
        var cpuOpts = JSON.parse(JSON.stringify(opts));
        cpuOpts.baseOptions.delegate = 'CPU';
        return TaskCls.createFromOptions(fileset, cpuOpts).then(function (inst) {
          console.log('[kineneo-multi] ' + label + ' ready (CPU)'); return inst;
        });
      }
    );
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
            createWithFallback(ctx.mod.PoseLandmarker, ctx.fileset, {
              baseOptions: { modelAssetPath: POSE_MODEL },
              runningMode: 'VIDEO',
              numPoses: 6,
              minPoseDetectionConfidence: 0.5,
              minPosePresenceConfidence: 0.6,
              minTrackingConfidence: 0.6
            }, 'PoseLandmarker').then(function (lm) { poseLandmarker = lm; })
          );
        }
        if (!faceLandmarker) {
          progress('Downloading FaceLandmarker model...');
          tasks.push(
            createWithFallback(ctx.mod.FaceLandmarker, ctx.fileset, {
              baseOptions: { modelAssetPath: FACE_MODEL },
              runningMode: 'VIDEO',
              numFaces: 6,
              outputFaceBlendshapes: true,
              minFaceDetectionConfidence: 0.5,
              minFacePresenceConfidence: 0.5,
              minTrackingConfidence: 0.5
            }, 'FaceLandmarker').then(function (lm) { faceLandmarker = lm; })
          );
        }
        if (!gestureRecognizer) {
          progress('Downloading GestureRecognizer model...');
          tasks.push(
            createWithFallback(ctx.mod.GestureRecognizer, ctx.fileset, {
              baseOptions: { modelAssetPath: GESTURE_MODEL },
              runningMode: 'VIDEO',
              numHands: 4,
              minHandDetectionConfidence: 0.5,
              minHandPresenceConfidence: 0.5,
              minTrackingConfidence: 0.5
            }, 'GestureRecognizer').then(function (gr) { gestureRecognizer = gr; })
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
      try { handResult = gestureRecognizer ? gestureRecognizer.recognizeForVideo(vid, ts) : { landmarks: [], gestures: [], handednesses: [] }; } catch (e) { handResult = { landmarks: [], gestures: [], handednesses: [] }; }
      // Normalize GestureRecognizer property names (it uses 'landmarks' not 'handLandmarks')
      if (!handResult.landmarks && handResult.handLandmarks) handResult.landmarks = handResult.handLandmarks;
      if (!handResult.handednesses && handResult.handedness) handResult.handednesses = handResult.handedness;

      cx.save();
      cx.clearRect(0, 0, w, h);
      if (!KN.state.skeletonOnly) cx.drawImage(vid, 0, 0, w, h);
      else { cx.fillStyle = '#0a0a0a'; cx.fillRect(0, 0, w, h); if ((KN.state.skeletonBg||'none') === 'void') drawGradientVoid(cx,w,h); }

      // --- Face meshes (smoothed) ---
      var rawFaces = faceResult.faceLandmarks || [];
      var faces = [];
      for (var sfi = 0; sfi < rawFaces.length; sfi++) faces.push(smoothFace(sfi, rawFaces[sfi]));
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
      var hands = handResult.landmarks || handResult.handLandmarks || [];
      var handedness = handResult.handednesses || handResult.handedness || [];
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
        if (handLabel && hand[0]) H.drawTextBadge(cx, hand[0].x * w + 8, hand[0].y * h - 14, handLabel, handCol);
        cx.shadowBlur = 0;
        cx.restore();
      }

      // --- Body skeletons (full visual pipeline per person) ---
      var allLandmarks = poseResult.landmarks || [];
      if (!allLandmarks.length) { cx.restore(); return Promise.resolve({ tracking: false, numPersons: 0 }); }

      var trackedIds = matchPersonIds(allLandmarks);
      for (var p = 0; p < allLandmarks.length; p++) {
        var ps = getPersonState(trackedIds[p]);
        updateVelocities(ps, allLandmarks[p]); // velocity from RAW landmarks
        var lms = smoothLandmarks(ps, allLandmarks[p]); // smooth for drawing
        var col = PERSON_COLORS[trackedIds[p] % PERSON_COLORS.length];

        drawSymmetryLines(cx, lms, w, h);
        updateRegionIntensity(ps);
        drawHeatmapForPerson(cx, ps, lms, w, h);
        drawTrailsForPerson(cx, ps, lms, w, h);
        drawVelocitySkeleton(cx, ps, lms, w, h);
        drawCenterOfMass(cx, lms, w, h, col);

        // Person label
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

      // Joint angles for first person (use smoothed)
      var bestPs = getPersonState(trackedIds[0]);
      var bestLms = (bestPs && bestPs.smoothed) ? bestPs.smoothed : allLandmarks[0];
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

      // Pair best face with best pose by nose proximity
      var bestFace = null, bestBlendShapes = null, bestFaceIdx = 0;
      if (faces.length > 0 && bestLms && bestLms[0]) {
        var poseNose = bestLms[0];
        var minDist = Infinity;
        for (var bfi = 0; bfi < faces.length; bfi++) {
          var fn = faces[bfi][1]; // face nose landmark
          if (!fn) continue;
          var fd = Math.hypot(fn.x - poseNose.x, fn.y - poseNose.y);
          if (fd < minDist) { minDist = fd; bestFaceIdx = bfi; }
        }
        bestFace = faces[bestFaceIdx];
      }
      if (faceResult.faceBlendshapes && faceResult.faceBlendshapes[bestFaceIdx]) {
        bestBlendShapes = faceResult.faceBlendshapes[bestFaceIdx].categories;
      }

      cx.restore();
      return Promise.resolve({
        tracking: true,
        numPersons: allLandmarks.length,
        numFaces: faces.length,
        numHands: hands.length,
        landmarkCount: visC,
        totalLandmarks: totalLms,
        meanConfidence: confS / bestLms.length,
        jointAngles: ja,
        bestPoseLms: bestLms,
        bestFaceLms: bestFace,
        blendShapes: bestBlendShapes,
        gestures: handResult.gestures || [],
        gestureHandednesses: handResult.handednesses || handResult.handedness || []
      });
    },
    clearState: clearAllPersonState,
    destroy: function () {
      clearAllPersonState();
      if (poseLandmarker) { poseLandmarker.close(); poseLandmarker = null; }
      if (faceLandmarker) { faceLandmarker.close(); faceLandmarker = null; }
      if (gestureRecognizer) { gestureRecognizer.close(); gestureRecognizer = null; }
    }
  };

  KN.multiConstants = { ANGLE_DEFS: ANGLE_DEFS };
})();
