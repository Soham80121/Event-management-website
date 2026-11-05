/* =========================================================================
   CORE — creates the single app namespace `window.Eventora` and the shared
   foundations every module uses: configuration (breakpoints mirrored from
   css/tokens.css), viewport classification, reduced-motion state and tiny
   DOM helpers. Loaded first; has no dependencies.
   ========================================================================= */
(function () {
  'use strict';

  var Eventora = window.Eventora = window.Eventora || {};

  /* ---------- Configuration ---------- */
  Eventora.config = Object.freeze({
    breakpoints: Object.freeze({
      phoneMax: 700,     // <= 700px  : phone flow column
      tabletMin: 701,    // 701–1080 : tablet canvas + burger
      tabletMax: 1080    // > 1080    : desktop canvas
    }),
    canvas: Object.freeze({
      width: 1172,       // fixed design canvas (DESIGN_REFERENCE §1)
      height: 657,
      fitHeight: 560,    // k = min(vw / W, vh / 560)
      tabletMinWindow: 920
    })
  });

  /* ---------- Viewport ---------- */
  Eventora.viewport = {
    /** 'phone' | 'tablet' | 'desktop' for a CSS-pixel width. */
    mode: function (width) {
      var bp = Eventora.config.breakpoints;
      var w = width === undefined ? window.innerWidth : width;
      if (w <= bp.phoneMax) return 'phone';
      if (w <= bp.tabletMax) return 'tablet';
      return 'desktop';
    }
  };

  /* ---------- Motion preference (live) ---------- */
  var reducedQuery = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  Eventora.motion = {
    /** True while the user asks for reduced motion; re-read every call. */
    reduced: function () { return !!reducedQuery.matches; },
    /** Calls fn(isReduced) whenever the OS setting changes. */
    onChange: function (fn) {
      var handler = function (e) { fn(!!e.matches); };
      if (reducedQuery.addEventListener) reducedQuery.addEventListener('change', handler);
      else if (reducedQuery.addListener) reducedQuery.addListener(handler);
    }
  };

  /* ---------- DOM helpers ---------- */
  Eventora.dom = {
    byId: function (id) { return document.getElementById(id); },
    one: function (selector, root) { return (root || document).querySelector(selector); },
    all: function (selector, root) {
      return Array.prototype.slice.call((root || document).querySelectorAll(selector));
    }
  };
})();
