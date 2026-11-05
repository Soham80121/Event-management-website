/* =========================================================================
   MASTER ENTRANCE TIMELINE — runs exactly once, then the page is still.
   Animates the individual translate / scale / clip-path properties (never
   `transform`, which belongs to the fitter and the ring loop). When the last
   animation finishes, every intro animation is cancelled and the .intro
   class removed, so the final frame is exactly the authored design.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var EXPO = 'cubic-bezier(.16,1,.3,1)';
  var SOFT = 'cubic-bezier(.22,.61,.36,1)';
  var root = document.documentElement;

  function settle() {
    if (document.getAnimations) {
      document.getAnimations().forEach(function (a) {
        if (a.id && a.id.indexOf('intro:') === 0) a.cancel();
      });
    }
    root.classList.remove('intro');
    // Labels measured mid-scale are re-fitted against the settled design.
    if (Eventora.layout) Eventora.layout.layout();
  }

  Eventora.intro = {
    settled: false,
    run: function () {
      var self = this;
      var reduced = Eventora.motion.reduced();
      if (!root.classList.contains('intro') || reduced || !Element.prototype.animate) {
        self.settled = true;
        settle();
        return;
      }

      var D = Eventora.viewport.mode() === 'phone' ? 0.66 : 1;   // phones travel shorter distances
      var n = 0;
      var last = null, lastEnd = 0;

      function Y(px) { return '0 ' + (px * D) + 'px'; }

      function play(el, from, dur, delay, ease) {
        if (!el) return;
        var to = { opacity: 1 };
        if ('translate' in from) to.translate = '0 0';
        if ('scale' in from) to.scale = '1';
        if ('clipPath' in from) to.clipPath = 'inset(-30% 0 -30% 0)';
        var anim = el.animate([from, to], { duration: dur, delay: delay, easing: ease, fill: 'both' });
        anim.id = 'intro:' + n++;
        if (delay + dur >= lastEnd) { lastEnd = delay + dur; last = anim; }
      }

      var q = function (s) { return document.querySelector(s); };

      // the frame settles
      play(q('.nav'),  { opacity: 0, translate: Y(-9) }, 620, 60, EXPO);
      play(q('.mark'), { opacity: 0, translate: Y(6) }, 520, 150, SOFT);
      play(q('.wm'),   { opacity: 0, translate: Y(6) }, 520, 185, SOFT);
      document.querySelectorAll('.links a').forEach(function (a, i) {
        play(a, { opacity: 0, translate: Y(6) }, 460, 215 + i * 45, SOFT);
      });
      play(q('.burger'),   { opacity: 0, translate: Y(6) }, 460, 300, SOFT);
      play(q('.nav .btn'), { opacity: 0, translate: Y(6) }, 500, 400, SOFT);

      // context, then the message
      play(q('.badge'), { opacity: 0, translate: Y(11), scale: .985 }, 560, 270, EXPO);
      play(q('#h1a'), { opacity: 0, translate: Y(15), clipPath: 'inset(100% 0 -30% 0)' }, 900, 380, EXPO);
      play(q('#h1b'), { opacity: 0, translate: Y(15), clipPath: 'inset(100% 0 -30% 0)' }, 900, 470, EXPO);
      play(q('#sub1'), { opacity: 0, translate: Y(10) }, 620, 690, EXPO);
      play(q('#sub2'), { opacity: 0, translate: Y(10) }, 620, 745, EXPO);
      play(q('.cta2'), { opacity: 0, translate: Y(13), scale: .985 }, 620, 830, EXPO);

      // the payoff — the wheel rises into depth, the mock lands in FRONT last
      play(q('.ring'),    { opacity: 0, translate: Y(18), scale: .99 }, 950, 700, EXPO);
      play(q('.browser'), { opacity: 0, translate: Y(26) }, 900, 900, EXPO);
      play(q('.wa'),      { opacity: 0, scale: .88 }, 500, 1260, EXPO);

      var done = function () {
        if (self.settled) return;
        self.settled = true;
        settle();
      };
      if (last) last.finished.then(done).catch(done);
      else done();
      // Failsafe: if frames stall (background tab, throttled renderer), the
      // fill:'both' animations would keep content hidden even after the head
      // script drops .intro — so force the settled state at 4s regardless.
      setTimeout(done, 4000);
    }
  };
})(window.Eventora);
