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
    vpLabel:  { tw: 90,    tc: 9.5 }    // "Explore Events" at 0.95 of natural width
  };
  var CTA_BOTTOM = 349 + 54.5;   // hero CTA: top + height (components.css .cta2)
  var MOCK_TOP = 558;            // browser mock top (showcase.css .browser)
  var RING_GAP_ABOVE = 28;       // tall tablets: max empty gap kept between CTA and ring (design px)
  var LINK_CAP = 7.9;       // shared cap height of the nav links
  var LINK_ROW_W = 317;     // the whole link row is squeezed to this width

  var state = { k: 1, mode: 'desktop', tboost: 1 };
  var els = {};

  var $ = Eventora.dom.byId;

  /* Writes the layout variables on every scaled layer: the hero canvas and
     the fixed nav layer share one coordinate system and must stay in step.
     Inner pages have only the nav layer. */
  function setVars(vars) {
    [els.canvas, els.navlayer].forEach(function (layer) {
      if (!layer) return;
      Object.keys(vars).forEach(function (name) {
        if (vars[name] === null) layer.style.removeProperty(name);
        else layer.style.setProperty(name, vars[name]);
      });
    });
  }

  /* In-page jumps must land below the fixed nav: publish its bottom edge
     (plus breathing room) as --nav-offset for scroll-padding-top. */
  function updateNavOffset() {
    var nav = $('nav');
    if (!nav) return;
    // Layout geometry, not getBoundingClientRect: the entrance animation lifts
    // the nav by a few px for its first second, which must not leak in here.
    // Desktop/tablet: design px × k (the layer is scaled). Phone: k = 1.
    var bottom = (nav.offsetTop + nav.offsetHeight) * state.k;
    document.documentElement.style.setProperty('--nav-offset', Math.round(bottom + 16) + 'px');
  }

  function placeCards() {
    if (Eventora.carousel && Eventora.carousel.place) Eventora.carousel.place();
  }

  /** Computes k and the tablet height split, then writes CSS variables. */
  function resize() {
    // Two widths, on purpose. innerWidth includes a classic (Windows) scrollbar
    // and is what CSS media queries see, so it decides the layout MODE and the
    // tablet ramp (keeping 1080/1081 continuous). clientWidth is the width the
    // page can actually paint into, so it drives the SCALE: otherwise, once the
    // document scrolls, the canvas would be centred under the scrollbar and its
    // right edge clipped. With overlay scrollbars the two are equal.
    var vw = window.innerWidth;
    var avail = document.documentElement.clientWidth || vw;
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
      // Phone: the ring sits at the top of the showcase column, above the
      // browser mock (CSS top), and spans the viewport width.
      var mock = document.querySelector('.browser');
      fitRing({
        mode: 'phone',
        halfWidth: avail / 2 - 10,
        bandTop: 0,
        bandBottom: mock ? parseFloat(getComputedStyle(mock).top) || 212 : 212
      });
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
    var k = Math.min(avail / W, vh / FIT_H);
    var fill = Math.max(0, vh / k - CANVAS_H);   // surplus height in design px
    var stshift = 0, sshift = 0, rs = 1;

    if (mode === 'tablet' && fill > 0) {
      // Share surplus height THREE ways on tall tablets:
      sshift = Math.min(fill * 0.55, 420) * ramp;          // wheel + mock travel down
      rs = 1 + Math.min(fill / 1100, 0.75) * ramp;          // reference wheel growth: kept only so the hero text lands where approved (the ring itself is now fitted by fitRing)
      var slack = 219.5 - 125 * rs + sshift;
      stshift = Math.max(0, slack / 2 - 28) * ramp;         // hero drops to optical centre
      fill -= sshift;                                       // mock keeps the rest
    }

    // The poster ring is fitted between the hero CTA and the browser mock
    // (which overlaps its lower third), in showcase coordinates (the showcase
    // is moved by sshift, the hero text by stshift), and to the visible width.
    var ringBox = {
      mode: mode,
      // tablet preferences blend in with the same ramp as the scale law, so
      // the ring is identical at 1080 and 1081px
      arc: mode === 'tablet' ? 33 - 3 * ramp : 33,
      maxS: mode === 'tablet' ? 150 + 10 * ramp : 150,
      halfWidth: avail / (2 * k) - 12,
      bandTop: CTA_BOTTOM + stshift - sshift,
      bandBottom: MOCK_TOP
    };
    var ringGeo = fitRing(ringBox);

    // Tall tablets: the reference pushes the mock far down to use spare height,
    // but the ring is anchored to the mock, so that would open a large empty gap
    // under the CTA. Lift ring + mock together until the gap is comfortable; the
    // mock grows by the same amount, so it still reaches the bottom edge. The
    // hero text (stshift) stays exactly where it was.
    if (mode === 'tablet' && ringGeo && ringGeo.need) {
      var excess = (MOCK_TOP - ringBox.bandTop) - ringGeo.need;
      var lift = Math.min(sshift, Math.max(0, excess - RING_GAP_ABOVE));
      if (lift > 0.5) {
        sshift -= lift;
        fill += lift;
        ringBox.bandTop = CTA_BOTTOM + stshift - sshift;
        ringGeo = fitRing(ringBox);
      }
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

  function fitRing(box) {
    return Eventora.carousel && Eventora.carousel.fit ? Eventora.carousel.fit(box) : null;
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
      updateNavOffset();
      placeCards();
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
    if (els.navBtn) F.centreLabel(els.navBtn, $('ctaLabel'), TYPE.ctaLabel.tc * T, k);
    if (els.heroBtn) F.centreLabel(els.heroBtn, $('vpLabel'), TYPE.vpLabel.tc * T, k);

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

    updateNavOffset();
    placeCards();
  }

  Eventora.layout = {
    state: state,
    init: function () {
      els.canvas = $('canvas');          // hero canvas (home page only)
      els.navlayer = $('navlayer');      // fixed nav layer (every page)
      els.links = $('links');
      els.navBtn = document.querySelector('.nav .btn');
      els.heroBtn = document.querySelector('.cta2');

      // Fallback for browsers without overflow:clip — never let focus or
      // find-in-page scroll the stage away from its authored position.
      var stage = document.querySelector('.stage');
      if (stage) {
        stage.addEventListener('scroll', function () {
          if (stage.scrollLeft || stage.scrollTop) { stage.scrollLeft = 0; stage.scrollTop = 0; }
        });
      }

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
