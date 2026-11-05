/* =========================================================================
   LAYOUT — scales the fixed 1172x657 design canvas to the viewport and runs
   the type fitter. Three architectures: desktop (>1080), tablet (701–1080)
   and phone (<=700, CSS flow column, no scaling).
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var CANVAS = Eventora.config.canvas;
  var BP = Eventora.config.breakpoints;
  var CANVAS_W = CANVAS.width;            // design canvas width (1172)
  var CANVAS_H = CANVAS.height;           // design canvas height (657)
  var FIT_H = CANVAS.fitHeight;           // height divisor — see scale law below
  var TAB_MAX = BP.tabletMax, TAB_MIN = BP.tabletMin, DW_MIN = CANVAS.tabletMinWindow;

  /* Type targets in design px: ink width, cap height, baseline y.
     Ink widths are tuned to EVENTORA's copy so the fitted lines keep the same
     gentle horizontal condensing as the reference (≈0.9–0.95 of natural). */
  var TYPE = {
    h1a:      { tw: 576,   tc: 37.2, y: 204.5, pre: 'translateX(-50%)' },
    h1b:      { tw: 318,   tc: 37.2, y: 258.5, pre: 'translateX(-50%)' },
    sub1:     { tw: 332,   tc: 8.4,  y: 300.5, pre: 'translateX(-50%)' },
    sub2:     { tw: 276,   tc: 8.4,  y: 316.5, pre: 'translateX(-50%)' },
    badgeTxt: { tw: 184,   tc: 9.4,  pre: 'translate(2px,-1px)' },
    wmName:   { tw: 70,    tc: 11.4, y: 38.5 },
    ctaLabel: { tw: 86,    tc: 8.9 },
    vpLabel:  { tw: 72,    tc: 9.5 }
  };
  var LINK_CAP = 7.9;       // shared cap height of the nav links
  var LINK_ROW_W = 317;     // the whole link row is squeezed to this width

  var state = { k: 1, mode: 'desktop', tboost: 1 };
  var els = {};

  var $ = Eventora.dom.byId;

  function setVars(vars) {
    Object.keys(vars).forEach(function (name) {
      if (vars[name] === null) els.canvas.style.removeProperty(name);
      else els.canvas.style.setProperty(name, vars[name]);
    });
  }

  /** Computes k and the tablet height split, then writes CSS variables. */
  function resize() {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var mode = Eventora.viewport.mode(vw);
    state.mode = mode;
    document.documentElement.setAttribute('data-layout', mode);

    // The burger panel only exists in the <=1080 band; force it shut outside.
    if (mode === 'desktop' && Eventora.nav) Eventora.nav.close(false);

    if (mode === 'phone') {
      state.k = 1;
      state.tboost = 1;
      setVars({ '--k': null, '--fill': null, '--stshift': null, '--sshift': null, '--rs': null });
      layout();
      return;
    }

    var W = CANVAS_W;
    var ramp = 0;
    if (mode === 'tablet') {
      // The design WINDOW narrows with the viewport so type stops shrinking,
      // and W === CANVAS_W at 1080 keeps k continuous across the breakpoint.
      W = DW_MIN + (vw - TAB_MIN) * (CANVAS_W - DW_MIN) / (TAB_MAX - TAB_MIN);
      if (vh > vw * 1.15) W = Math.min(W, 900);   // portrait tablet: read larger
      ramp = Math.min(1, (TAB_MAX - vw) / 120);   // ease the change in over 120px
    }

    // Scale law: k = min(vw/W, vh/560). Dividing by 560 (not 657) fills the
    // width and lets the browser mock bleed off the bottom edge instead of
    // letterboxing the composition.
    var k = Math.min(vw / W, vh / FIT_H);
    var fill = Math.max(0, vh / k - CANVAS_H);   // surplus height in design px
    var stshift = 0, sshift = 0, rs = 1;

    if (mode === 'tablet' && fill > 0) {
      // Share surplus height THREE ways on tall tablets:
      sshift = Math.min(fill * 0.55, 420) * ramp;          // wheel + mock travel down
      rs = 1 + Math.min(fill / 1100, 0.75) * ramp;          // wheel grows (closer camera)
      var slack = 219.5 - 125 * rs + sshift;
      stshift = Math.max(0, slack / 2 - 28) * ramp;         // hero drops to optical centre
      fill -= sshift;                                       // mock keeps the rest
    }

    state.k = k;
    state.tboost = mode === 'tablet' ? 1 + 0.14 * ramp : 1;
    setVars({
      '--k': String(k),
      '--fill': fill.toFixed(2) + 'px',
      '--stshift': stshift.toFixed(2) + 'px',
      '--sshift': sshift.toFixed(2) + 'px',
      '--rs': rs.toFixed(4)
    });
    layout();
  }

  function fitterTargets() {
    return ['h1a', 'h1b', 'sub1', 'sub2', 'badgeTxt', 'wmName', 'ctaLabel', 'vpLabel'];
  }

  /** Runs the type fitter for the current mode. */
  function layout() {
    var F = Eventora.fitter;
    var k = state.k;

    if (state.mode === 'phone') {
      // Hand back EVERY inline style the fitter wrote, or a stale transform
      // shifts the headline off-screen after resizing down from desktop.
      F.reset(fitterTargets().map($));
      els.links.style.fontSize = '';
      els.links.style.transform = '';
      Array.prototype.forEach.call(els.links.children, function (a) { a.style.fontSize = ''; });
      Eventora.carousel.place();
      return;
    }

    var T = state.mode === 'tablet' ? state.tboost : 1;
    fitterTargets().forEach(function (id) {
      var cfg = TYPE[id];
      var node = $(id);
      if (!node) return;
      F.fitBox(node, cfg.tw * T, cfg.tc * T, cfg.pre, k);
      if (cfg.y !== undefined) F.baseline(node, cfg.y);
    });
    F.centreLabel(els.navBtn, $('ctaLabel'), TYPE.ctaLabel.tc * T, k);
    F.centreLabel(els.heroBtn, $('vpLabel'), TYPE.vpLabel.tc * T, k);

    // Nav links: one shared size, then squeeze the whole row.
    els.links.style.transform = '';
    var links = Array.prototype.slice.call(els.links.children);
    if (state.mode === 'tablet') {
      links.forEach(function (a) { a.style.fontSize = ''; });
    } else {
      links.forEach(function (a) { a.style.fontSize = ''; });
      var fs = LINK_CAP / F.capRatio(links[0]);
      links.forEach(function (a) { a.style.fontSize = fs + 'px'; });
      var rowW = F.inkWidth(els.links, k);
      if (rowW > 0) els.links.style.transform = 'scaleX(' + (LINK_ROW_W / rowW) + ')';
    }

    Eventora.carousel.place();
  }

  Eventora.layout = {
    state: state,
    init: function () {
      els.canvas = $('canvas');
      els.links = $('links');
      els.navBtn = document.querySelector('.nav .btn');
      els.heroBtn = document.querySelector('.cta2');

      // Fallback for browsers without overflow:clip — never let focus or
      // find-in-page scroll the stage away from its authored position.
      var stage = $('stage');
      stage.addEventListener('scroll', function () {
        if (stage.scrollLeft || stage.scrollTop) { stage.scrollLeft = 0; stage.scrollTop = 0; }
      });

      window.addEventListener('resize', resize);
      if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
      resize();

      // Re-fit once the web fonts are in, plus two safety passes.
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
      setTimeout(layout, 400);
      setTimeout(layout, 1400);
    },
    resize: resize,
    layout: layout
  };
})(window.Eventora);
