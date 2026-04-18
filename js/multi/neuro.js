// SPDX-License-Identifier: MIT
// multi/neuro.js - Multi-person aware wrapper around shared neuro.js.
// Tracks primary person identity by nose proximity. Resets neuro state
// when the primary person changes. Pairs face + pose landmarks by
// spatial matching before passing to the shared neuro module.
(function () {
  var KN = window.KN = window.KN || {};
  if (!KN.neuro) return;

  var lastNoseX = null, lastNoseY = null;
  var JUMP = 0.12;

  function checkContinuity(poseLms) {
    if (!poseLms || !poseLms[0]) { lastNoseX = null; lastNoseY = null; return; }
    var nx = poseLms[0].x, ny = poseLms[0].y;
    if (lastNoseX != null) {
      var d = Math.hypot(nx - lastNoseX, ny - lastNoseY);
      if (d > JUMP) {
        KN.neuro.resetState();
      }
    }
    lastNoseX = nx; lastNoseY = ny;
  }

  function findBestFace(faces, poseLms) {
    if (!faces || !faces.length || !poseLms || !poseLms[0]) return null;
    var pn = poseLms[0];
    var best = null, bestDist = Infinity;
    for (var i = 0; i < faces.length; i++) {
      var fn = faces[i][1];
      if (!fn) continue;
      var d = Math.hypot(fn.x - pn.x, fn.y - pn.y);
      if (d < bestDist) { bestDist = d; best = { idx: i, face: faces[i] }; }
    }
    return best;
  }

  KN.multiNeuro = {
    process: function (stats) {
      if (!stats || !stats.tracking || !stats.bestPoseLms) return;
      var pose = stats.bestPoseLms;
      checkContinuity(pose);
      try { KN.neuro.update(stats.bestFaceLms, pose, stats.jointAngles); } catch (e) {}
      try { KN.neuro.updateBehavior(pose, KN.neuro.MP_MAP); } catch (e) {}
      try { if (stats.bestFaceLms) KN.neuro.updateFace(stats.bestFaceLms); } catch (e) {}
    },
    findBestFace: findBestFace,
    reset: function () { lastNoseX = null; lastNoseY = null; KN.neuro.resetState(); }
  };
})();
