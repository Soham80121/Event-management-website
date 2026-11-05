/* =========================================================================
   HERO REGRESSION SNAPSHOT (dev tool — not loaded by index.html)

   Records the geometry and computed styles of every hero element so a
   refactor can be proven visually inert. Moving parts are excluded on
   purpose: card transforms/filters (the ring rotates), star positions
   (random per load) and the concierge pulse (animated).

   Usage in the browser console on http://localhost:5500/ once the intro has
   settled:
     await import('/tests/hero-snapshot.js')            // or paste the file
     EventoraSnapshot.save('desktop-1440')              // before a change
     EventoraSnapshot.compare('desktop-1440')           // after the change
   Baselines live in localStorage on the dev origin only.
   ========================================================================= */
(function () {
  'use strict';

  var PROPS = [
    'display', 'position', 'visibility', 'opacity', 'z-index',
    'color', 'background-color', 'background-image',
    'border-top-width', 'border-top-style', 'border-top-color', 'border-radius',
    'box-shadow', 'text-shadow', 'filter', 'backdrop-filter', 'mask-image',
    'transform', 'transform-origin', 'perspective', 'perspective-origin',
    'font-family', 'font-size', 'font-weight', 'font-style',
    'letter-spacing', 'word-spacing', 'line-height', 'text-transform',
    'white-space', 'overflow-x', 'overflow-y', 'clip-path', 'translate', 'scale'
  ];

  /* selector -> options. `all` snapshots every match; `skip` lists
     properties excluded because they legitimately vary between loads. */
  var TARGETS = {
    'html': {}, 'body': {}, '.stage': {}, '.bg': {},
    '#stA': { skip: ['box-shadow'] }, '#stB': { skip: ['box-shadow'] },
    '.canvas': {}, '.nav': {}, '.mark': {}, '.wm': {}, '.wm .kick': {}, '#wmName': {},
    '.links': {}, '.links a': { all: true }, '.burger': {}, '.burger span': { all: true },
    '.navmenu': {}, '.nav .btn': {}, '#ctaLabel': {},
    '.badge': {}, '.badge i': {}, '.badge i svg': {}, '#badgeTxt': {},
    '#h1a': {}, '#h1b': {}, '.subcopy': {}, '#sub1': {}, '#sub2': {}, '.sub b': {},
    '.cta2': {}, '#vpLabel': {},
    '.showcase': {}, '.ring': {},
    '.card': { noRect: true, skip: ['transform', 'filter', 'visibility'] },
    '.card .edge': { noRect: true }, '.card .t-serif': { noRect: true }, '.card .t-big': { noRect: true },
    '.browser': {}, '.bar': {}, '.dots i': { all: true }, '.omni': {}, '.omni span': {}, '.tools': {},
    '.page': {}, '.ann': {}, '.ann span': {}, '.shoplogo em': {}, '.shoplogo i': {}, '.shopicons': {},
    '.pagebody': {}, '.pghero': {}, '.pghero .scrim': {}, '.pghero .copy em': {}, '.pghero .copy i': {},
    '.pgsec b': {}, '.pggrid': {}, '.pgcard': { all: true }, '.pgcard .tag': {}, '.pgcard s': {},
    '.pgstrip': {}, '.pgstrip span': {},
    '.wa': {}, '.wa svg': {}, '.skip-link': {}
  };
  var PSEUDO = [
    ['.nav .btn', '::before'], ['.nav .btn', '::after'],
    ['.cta2', '::before'], ['.cta2', '::after'],
    ['.browser', '::before'],
    ['.wa', '::after', ['transform', 'opacity']]
  ];
  var INLINE = ['h1a', 'h1b', 'sub1', 'sub2', 'badgeTxt', 'wmName', 'ctaLabel', 'vpLabel', 'links'];

  function round(n) { return Math.round(n * 10) / 10; }

  function styleOf(el, pseudo, skip) {
    var cs = getComputedStyle(el, pseudo || null);
    var out = {};
    PROPS.forEach(function (p) { if (!skip || skip.indexOf(p) < 0) out[p] = cs.getPropertyValue(p); });
    return out;
  }

  function take() {
    var snap = {
      viewport: innerWidth + 'x' + innerHeight,
      mode: window.Eventora && Eventora.layout ? Eventora.layout.state.mode : '?',
      k: window.Eventora && Eventora.layout ? round(Eventora.layout.state.k * 1000) / 1000 : null,
      elements: {}, inline: {}, counts: {}
    };
    Object.keys(TARGETS).forEach(function (sel) {
      var opt = TARGETS[sel];
      var nodes = opt.all ? document.querySelectorAll(sel) : [document.querySelector(sel)];
      Array.prototype.forEach.call(nodes, function (el, i) {
        if (!el) { snap.elements[sel] = 'MISSING'; return; }
        var entry = { style: styleOf(el, null, opt.skip) };
        if (!opt.noRect) {
          var r = el.getBoundingClientRect();
          entry.rect = [round(r.left), round(r.top), round(r.width), round(r.height)];
        }
        snap.elements[sel + (opt.all ? '[' + i + ']' : '')] = entry;
      });
    });
    PSEUDO.forEach(function (p) {
      var el = document.querySelector(p[0]);
      if (el) snap.elements[p[0] + p[1]] = { style: styleOf(el, p[1], p[2]) };
    });
    INLINE.forEach(function (id) {
      var el = document.getElementById(id);
      snap.inline[id] = el ? el.getAttribute('style') : 'MISSING';
    });
    snap.counts.cards = document.querySelectorAll('.card').length;
    snap.counts.visibleCards = Array.prototype.filter.call(document.querySelectorAll('.card'),
      function (c) { return c.style.visibility === 'visible'; }).length;
    snap.counts.starsA = (document.getElementById('stA').style.boxShadow.match(/rgba/g) || []).length;
    snap.counts.starsB = (document.getElementById('stB').style.boxShadow.match(/rgba/g) || []).length;
    return snap;
  }

  /** Returns a flat list of differences between two snapshots. */
  function diff(a, b) {
    var out = [];
    ['viewport', 'mode', 'k'].forEach(function (key) {
      if (a[key] !== b[key]) out.push(key + ': ' + a[key] + ' -> ' + b[key]);
    });
    Object.keys(a.counts).forEach(function (c) {
      // visible-card count may legitimately flip by one as the ring turns
      if (c === 'visibleCards' ? Math.abs(a.counts[c] - b.counts[c]) > 1 : a.counts[c] !== b.counts[c]) {
        out.push('count ' + c + ': ' + a.counts[c] + ' -> ' + b.counts[c]);
      }
    });
    Object.keys(a.inline).forEach(function (id) {
      if (a.inline[id] !== b.inline[id]) out.push('#' + id + ' inline: ' + a.inline[id] + ' -> ' + b.inline[id]);
    });
    var keys = Object.keys(a.elements).concat(Object.keys(b.elements))
      .filter(function (k, i, arr) { return arr.indexOf(k) === i; });
    keys.forEach(function (sel) {
      var ea = a.elements[sel], eb = b.elements[sel];
      if (!ea || !eb || typeof ea === 'string' || typeof eb === 'string') {
        if (JSON.stringify(ea) !== JSON.stringify(eb)) out.push(sel + ': presence ' + JSON.stringify(ea && 1) + ' -> ' + JSON.stringify(eb && 1));
        return;
      }
      if (ea.rect && JSON.stringify(ea.rect) !== JSON.stringify(eb.rect)) {
        out.push(sel + ' rect: ' + ea.rect + ' -> ' + eb.rect);
      }
      Object.keys(ea.style).forEach(function (p) {
        if (ea.style[p] !== eb.style[p]) out.push(sel + ' ' + p + ': ' + ea.style[p] + ' -> ' + eb.style[p]);
      });
    });
    return out;
  }

  var PREFIX = 'eventora:snapshot:';

  window.EventoraSnapshot = {
    take: take,
    diff: diff,
    save: function (name) {
      var s = take();
      localStorage.setItem(PREFIX + name, JSON.stringify(s));
      return { saved: name, elements: Object.keys(s.elements).length, viewport: s.viewport, mode: s.mode };
    },
    compare: function (name) {
      var base = localStorage.getItem(PREFIX + name);
      if (!base) return { error: 'no baseline named ' + name };
      var d = diff(JSON.parse(base), take());
      return { name: name, differences: d.length, details: d.slice(0, 40) };
    }
  };
})();
