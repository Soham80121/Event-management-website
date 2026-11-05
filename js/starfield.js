/* =========================================================================
   STARFIELD — each layer is a 1x1px div whose whole star field is a single
   box-shadow list. Positions use vw/vh, so it fills any viewport for free.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  function rand(min, max) { return min + Math.random() * (max - min); }

  function paintLayer(el, count, blur, alphaMin, alphaMax) {
    if (!el) return;
    var shadows = new Array(count);
    for (var i = 0; i < count; i++) {
      shadows[i] = rand(0, 100).toFixed(2) + 'vw ' + rand(0, 100).toFixed(2) + 'vh ' +
        blur + 'px 0 rgba(255,255,255,' + rand(alphaMin, alphaMax).toFixed(3) + ')';
    }
    el.style.boxShadow = shadows.join(',');
  }

  Eventora.starfield = {
    init: function () {
      paintLayer(document.getElementById('stA'), 150, 0, 0.05, 0.30);   // dust
      paintLayer(document.getElementById('stB'), 18, 1.2, 0.35, 0.70);  // bright, soft
    }
  };
})(window.Eventora);
