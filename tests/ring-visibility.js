/* =========================================================================
   RING VISIBILITY CHECK (dev tool — not loaded by index.html)

   Samples the rotating poster ring and asserts that every card that is
   visible at all (opacity > 0.02) is:
     · square (layout box width === height)
     · fully inside the visible width
     · fully below the hero CTA and fully above the browser mock
   Run in the console on the home page at scroll 0, after the intro:
     await import('/tests/ring-visibility.js'); await EventoraRingCheck.run()
   ========================================================================= */
(function () {
  'use strict';

  function frame() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function run(opts) {
    opts = opts || {};
    var samples = opts.samples || 12, every = opts.every || 500, tol = 0.75;
    var cta = document.querySelector('.cta2');
    var mock = document.querySelector('.browser');
    var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
    var width = document.documentElement.clientWidth;
    var problems = [], visibleCounts = [], fullyOpaque = [], minSize = Infinity, maxSize = 0;

    for (var s = 0; s < samples; s++) {
      await frame();
      var ctaBottom = cta.getBoundingClientRect().bottom;
      var mockTop = mock.getBoundingClientRect().top;
      var visible = 0, opaque = 0;
      cards.forEach(function (c, i) {
        if (c.style.visibility !== 'visible') return;
        var op = parseFloat(c.style.opacity || '1');
        if (op <= 0.02) return;
        visible++;
        if (op >= 0.999) opaque++;
        if (c.offsetWidth !== c.offsetHeight) problems.push('card ' + i + ' not square: ' + c.offsetWidth + 'x' + c.offsetHeight);
        var r = c.getBoundingClientRect();
        minSize = Math.min(minSize, r.height); maxSize = Math.max(maxSize, r.height);
        if (r.left < -tol || r.right > width + tol) problems.push('sample ' + s + ' card ' + i + ' cut at side: ' + r.left.toFixed(1) + '..' + r.right.toFixed(1) + ' (width ' + width + ')');
        if (r.top < ctaBottom - tol) problems.push('sample ' + s + ' card ' + i + ' under CTA: top ' + r.top.toFixed(1) + ' < ' + ctaBottom.toFixed(1));
        if (r.bottom > mockTop + tol) problems.push('sample ' + s + ' card ' + i + ' behind mock: bottom ' + r.bottom.toFixed(1) + ' > ' + mockTop.toFixed(1));
      });
      visibleCounts.push(visible); fullyOpaque.push(opaque);
      await wait(every);
    }
    var g = window.Eventora && Eventora.carousel ? Eventora.carousel.geometry() : {};
    return {
      viewport: innerWidth + 'x' + innerHeight,
      mode: Eventora.layout.state.mode,
      geometry: { S: +(g.S || 0).toFixed(1), R: +(g.R || 0).toFixed(1), arc: +(g.A || 0).toFixed(1) },
      cardScreenPx: { smallest: +minSize.toFixed(1), largest: +maxSize.toFixed(1) },
      visibleCards: Math.min.apply(null, visibleCounts) + '–' + Math.max.apply(null, visibleCounts),
      fullyOpaqueCards: Math.min.apply(null, fullyOpaque) + '–' + Math.max.apply(null, fullyOpaque),
      problems: problems.slice(0, 12),
      pass: problems.length === 0
    };
  }

  window.EventoraRingCheck = { run: run };
})();
