// SPDX-License-Identifier: MIT
// objects.js - COCO-SSD object detection with dynamic TF.js loading.
(function () {
  var KN = window.KN = window.KN || {};
  var H = KN.helpers;

  var detector = null;
  var scriptsLoaded = false;

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Failed to load ' + url)); };
      document.head.appendChild(s);
    });
  }

  function classHue(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
    return h % 360;
  }

  function drawDetections(cx, preds, w, h) {
    cx.save();
    cx.lineWidth = 2;
    cx.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace';
    cx.textBaseline = 'top';
    for (var i = 0; i < preds.length; i++) {
      var p = preds[i];
      var bx = p.bbox[0], by = p.bbox[1], bw = p.bbox[2], bh = p.bbox[3];
      var hue = classHue(p.class);
      var borderColor = 'hsl(' + hue + ',85%,60%)';
      var fillColor = 'hsla(' + hue + ',85%,60%,0.08)';
      var glowColor = 'hsla(' + hue + ',85%,60%,0.5)';

      cx.shadowBlur = 12;
      cx.shadowColor = glowColor;
      cx.strokeStyle = borderColor;
      cx.fillStyle = fillColor;
      H.roundRect(cx, bx, by, bw, bh, 6);
      cx.fill();
      cx.stroke();

      var label = p.class + ' ' + (p.score * 100).toFixed(0) + '%';
      var tm = cx.measureText(label);
      var lw = tm.width + 10;
      var lh = 20;
      var ly = by - lh - 2;
      if (ly < 0) ly = by + 2;

      cx.shadowBlur = 0;
      cx.fillStyle = 'rgba(0,0,0,0.7)';
      H.roundRect(cx, bx, ly, lw, lh, 4);
      cx.fill();
      cx.fillStyle = borderColor;
      cx.fillText(label, bx + 5, ly + 4);
    }
    cx.restore();
  }

  KN.objects = {
    name: 'COCO-SSD Objects',
    init: function () {
      if (detector) return Promise.resolve();
      var chain = Promise.resolve();
      if (!scriptsLoaded) {
        chain = chain
          .then(function () { return loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.15.0/dist/tf.min.js'); })
          .then(function () { return loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js'); })
          .then(function () { scriptsLoaded = true; });
      }
      return chain
        .then(function () { return tf.setBackend('webgl'); })
        .then(function () { return tf.ready(); })
        .then(function () { return cocoSsd.load({ base: 'lite_mobilenet_v2' }); })
        .then(function (model) { detector = model; });
    },
    run: function (vid, cvs, cx) {
      if (!detector || vid.readyState < 2) return Promise.resolve(null);
      var w = vid.videoWidth, h = vid.videoHeight;
      H.ensureCanvasSize(cvs, w, h);
      return detector.detect(vid).then(function (preds) {
        cx.save();
        cx.clearRect(0, 0, w, h);
        if (!KN.state.skeletonOnly) cx.drawImage(vid, 0, 0, w, h);
        else { cx.fillStyle = '#0a0a0a'; cx.fillRect(0, 0, w, h); }
        if (preds && preds.length) {
          drawDetections(cx, preds, w, h);
          var confSum = 0;
          for (var i = 0; i < preds.length; i++) confSum += preds[i].score;
          cx.restore();
          return { tracking: true, predictions: preds, objectCount: preds.length, meanConfidence: confSum / preds.length };
        }
        cx.restore();
        return { tracking: false, predictions: [], objectCount: 0 };
      });
    },
    destroy: function () {
      if (detector) { detector.dispose(); detector = null; }
    }
  };
})();
