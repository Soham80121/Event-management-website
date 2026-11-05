/* =========================================================================
   STARFIELD — DESIGN_REFERENCE §1. Each layer is a 1x1px div whose whole
   star field is a single box-shadow list: one paint, zero extra DOM nodes.
   Positions use vw/vh, so the field covers any viewport without JS resize
   handling. The field is static (no twinkle), which also keeps it safe for
   reduced-motion users.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  /* Layer specs straight from the reference. */
  var LAYERS = Object.freeze([
    { id: 'stA', count: 150, blur: 0,   alphaMin: 0.05, alphaMax: 0.30 },  // crisp dust
    { id: 'stB', count: 18,  blur: 1.2, alphaMin: 0.35, alphaMax: 0.70 }   // soft, brighter
  ]);

  function rand(min, max) { return min + Math.random() * (max - min); }

  /** Builds "<x>vw <y>vh <blur>px 0 rgba(255,255,255,<a>)" entries. */
  function starList(spec) {
    var shadows = new Array(spec.count);
    for (var i = 0; i < spec.count; i++) {
      shadows[i] = rand(0, 100).toFixed(2) + 'vw ' + rand(0, 100).toFixed(2) + 'vh ' +
        spec.blur + 'px 0 rgba(255,255,255,' + rand(spec.alphaMin, spec.alphaMax).toFixed(3) + ')';
    }
    return shadows.join(',');
  }

  Eventora.starfield = {
    layers: LAYERS,
    /** Paints every layer element present in the document. */
    init: function () {
      LAYERS.forEach(function (spec) {
        var el = document.getElementById(spec.id);
        if (el) el.style.boxShadow = starList(spec);
      });
    }
  };
})(window.Eventora);
