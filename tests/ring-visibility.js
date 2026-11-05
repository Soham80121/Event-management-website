/* =========================================================================
   RING VISIBILITY CHECK (dev tool — not loaded by index.html)

   Samples the rotating poster ring and asserts that every card that is
   visible at all (opacity > 0.02) is:
     · portrait 2:3 (layout box height = 1.5 × width)
     · fully inside the visible width
     · fully below the hero CTA
     · and, against the browser mock: in tuck mode (desktop/tablet) hidden
       behind it by no more than the tuck fraction — and the centre card must
       really tuck; in full mode (phone) entirely above it
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
    var tuck = (Eventora.carousel.geometry().tuck) || 0, maxHidden = 0;

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
        var ratio = c.offsetHeight / c.offsetWidth;
        if (Math.abs(ratio - 1.5) > 0.03) problems.push('card ' + i + ' not 2:3 portrait: ' + c.offsetWidth + 'x' + c.offsetHeight);
        var r = c.getBoundingClientRect();
        minSize = Math.min(minSize, r.height); maxSize = Math.max(maxSize, r.height);
        if (r.left < -tol || r.right > width + tol) problems.push('sample ' + s + ' card ' + i + ' cut at side: ' + r.left.toFixed(1) + '..' + r.right.toFixed(1) + ' (width ' + width + ')');
        if (r.top < ctaBottom - tol) problems.push('sample ' + s + ' card ' + i + ' under CTA: top ' + r.top.toFixed(1) + ' < ' + ctaBottom.toFixed(1));
        var hidden = Math.max(0, r.bottom - mockTop) / r.height;   // share tucked behind the mock
        maxHidden = Math.max(maxHidden, hidden);
        if (tuck > 0) {
          if (hidden > tuck + 0.01) problems.push('sample ' + s + ' card ' + i + ' too far behind mock: ' + (hidden * 100).toFixed(1) + '% hidden');
        } else if (r.bottom > mockTop + tol) {
          problems.push('sample ' + s + ' card ' + i + ' behind mock: bottom ' + r.bottom.toFixed(1) + ' > ' + mockTop.toFixed(1));
        }
      });
      visibleCounts.push(visible); fullyOpaque.push(opaque);
      await wait(every);
    }
    var g = window.Eventora && Eventora.carousel ? Eventora.carousel.geometry() : {};
    // In tuck mode the overlap is the intended look: the centre card must
    // actually sit behind the mock, not float above it.
    if (tuck > 0 && maxHidden < tuck - 0.05) problems.push('expected the centre card to tuck ~' + (tuck * 100) + '% behind the mock; max was ' + (maxHidden * 100).toFixed(1) + '%');
    return {
      viewport: innerWidth + 'x' + innerHeight,
      mode: Eventora.layout.state.mode,
      geometry: { S: +(g.S || 0).toFixed(1), R: +(g.R || 0).toFixed(1), arc: +(g.A || 0).toFixed(1) },
      cardScreenPx: { smallest: +minSize.toFixed(1), largest: +maxSize.toFixed(1) },
      tuckedBehindMock: tuck > 0 ? 'up to ' + (maxHidden * 100).toFixed(1) + '% (target ' + (tuck * 100) + '%)' : 'none (fully visible)',
      visibleCards: Math.min.apply(null, visibleCounts) + '–' + Math.max.apply(null, visibleCounts),
      fullyOpaqueCards: Math.min.apply(null, fullyOpaque) + '–' + Math.max.apply(null, fullyOpaque),
      problems: problems.slice(0, 12),
      pass: problems.length === 0
    };
  }

  window.EventoraRingCheck = { run: run };
})();
