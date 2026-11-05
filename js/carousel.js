/* =========================================================================
   3D POSTER RING — 37 event posters on a cylinder, camera at its centre.

   Geometry: radius R = 891 and CSS perspective = 891, so the viewer sits
   exactly at the ring's axis. Each card is pushed out along its angle and
   rotated back by the same angle, which makes it tangent to the cylinder and
   square-on to the camera; the slanted tops you see are pure perspective.
   Step = 360/37 ≈ 9.73°. Anything beyond ±42° is behind the browser mock or
   off-canvas, so it is culled (visibility:hidden) to save compositing work.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var CARD_COUNT = 37;
  var RADIUS = 891;
  var STEP = 360 / CARD_COUNT;
  var CULL_DEG = 42;
  var SPEED_DEG_PER_S = 1.9;
  var DEG = Math.PI / 180;

  var cards = [];
  var phase = -2;           // running rotation, never reset
  var lastTime = null;
  var active = true;        // false while the hero is scrolled off-screen

  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Returns the poster artwork for one creative. Photos carry no text;
      all typography is HTML/CSS overlay. */
  function creative(d) {
    var im = '<img alt="" src="' + esc(d.url) + '" decoding="async">';

    switch (d.v) {
      case 'ticket':
        return '<div class="fill" style="background:#efedea"></div>' +
          '<div class="ph" style="top:112px;bottom:0">' + im + '</div>' +
          '<svg class="ph" style="top:118px;bottom:0;background:none" viewBox="0 0 130 182" preserveAspectRatio="none" aria-hidden="true">' +
            '<g stroke="#e5202f" stroke-width="8" fill="none" opacity=".92" stroke-linecap="square">' +
              '<path d="M2 42h30M14 30v96M4 100l26-16"/>' +
              '<path d="M96 34v58M120 34v58M96 92q12 15 24 0"/>' +
              '<path d="M92 108l14 34M126 108l-12 34"/></g></svg>' +
          '<div class="cv" style="top:20px;text-align:right;font-size:3.4px;letter-spacing:.15em;color:#8d9298">ADMIT ONE · WORLD TOUR</div>' +
          '<div class="cv t-big" style="top:32px;font-size:14px;color:#16171b">Electric</div>' +
          '<div class="cv t-big" style="top:47px;font-size:14px;color:#e5202f">Live on stage</div>' +
          '<div class="cv" style="top:76px;font-size:5.2px;font-weight:700;color:#16171b;line-height:1.7">' +
            '<div><b class="dot"></b>FRI 14 NOV · <b>ARENA 9</b></div>' +
            '<div style="margin-top:8px"><b class="dot sq"></b>DOORS AT <b>7 PM</b><br>' +
            '<span style="margin-left:11px">ALL AGES</span></div></div>';

      case 'gala':
        return '<div class="fill" style="background:linear-gradient(168deg,#f9d9e5,#f3bdd2 55%,#e8a3c0)"></div>' +
          '<div class="ph" style="top:100px;bottom:0">' + im +
            '<div class="fill" style="background:linear-gradient(180deg,rgba(249,217,229,.97),rgba(249,217,229,0) 30%)"></div></div>' +
          '<div class="cv t-serif" style="top:36px;font-size:17px;color:#b03a63">WINTER</div>' +
          '<div class="cv t-serif" style="top:55px;font-size:17px;color:#b03a63">GALA 2026</div>';

      case 'workshop':
        return '<div class="fill" style="background:#fff"></div>' +
          '<div class="ph" style="top:0;height:148px">' + im + '</div>' +
          '<div class="cv" style="top:158px;font-size:5.4px;font-weight:700;letter-spacing:.09em;color:#16171b">CREATIVE WORKSHOP</div>' +
          '<div class="cv" style="top:168px;font-size:4.2px;color:#7b8087">Design · Build · Launch</div>' +
          '<div style="position:absolute;left:10px;top:180px;padding:4px 11px;border-radius:20px;background:#16171b;font-size:4.6px;font-weight:600;color:#fff;letter-spacing:.05em">Reserve a seat</div>';

      case 'summit':
        return '<div class="fill" style="background:linear-gradient(180deg,#0a2a4a,#0d3a63 50%,#08192b)"></div>' +
          '<div class="ph" style="top:92px;bottom:0">' + im +
            '<div class="fill" style="background:linear-gradient(180deg,rgba(10,42,74,.98),rgba(10,42,74,0) 36%)"></div></div>' +
          '<div class="cv" style="top:16px;font-size:4.2px;line-height:1.7;color:rgba(255,255,255,.82);width:74px">' +
            'Two days of keynotes, hands-on labs and conversations with the people shaping what comes next.</div>' +
          '<div style="position:absolute;right:10px;top:16px;font-size:5.4px;font-weight:600;color:#fff;opacity:.92">✳ Eventora</div>';

      case 'fest':
        return '<div class="fill" style="background:linear-gradient(158deg,#4a0c80 0%,#7a16a6 40%,#a81fc6 66%,#5c0e90 100%)"></div>' +
          '<div class="ph" style="top:140px;bottom:0;opacity:.45;mix-blend-mode:screen">' + im + '</div>' +
          '<div class="fill" style="background:radial-gradient(44% 16% at 50% 62%,rgba(255,255,255,.92),rgba(255,255,255,0) 72%)"></div>' +
          '<div style="position:absolute;left:-6px;right:-6px;top:44px;height:13px;background:#ff2d8a;transform:rotate(-2.6deg);box-shadow:0 4px 12px rgba(255,45,138,.5)"></div>' +
          '<div style="position:absolute;left:0;right:0;top:45.5px;transform:rotate(-2.6deg);text-align:center;font-size:5.6px;font-weight:700;letter-spacing:.05em;color:#fff">THREE DAYS · OPEN AIR</div>' +
          '<div class="cv t-big" style="top:64px;font-size:24px;color:#fff;text-shadow:0 3px 0 rgba(84,9,124,.6)">Colour</div>' +
          '<div class="cv t-big" style="top:87px;font-size:24px;color:#fff;text-shadow:0 3px 0 rgba(84,9,124,.6)">Fest</div>' +
          '<div class="cv t-big" style="top:113px;font-size:19px;color:#fff">+</div>';

      case 'stage':
        return '<div class="ph phf">' + im + '</div>' +
          '<div class="fill" style="background:linear-gradient(180deg,rgba(6,5,10,0) 34%,rgba(6,5,10,.55) 52%,rgba(6,5,10,.92) 72%)"></div>' +
          '<div class="cv t-serif" style="top:132px;font-size:16px;color:#fff">A NIGHT OF</div>' +
          '<div class="cv t-serif" style="top:150px;font-size:16px;color:#fff">PURE SOUL</div>' +
          '<div class="cv" style="top:171px;font-size:4.4px;letter-spacing:.07em;color:rgba(255,255,255,.85)">one voice, one stage, one evening</div>';

      case 'early':
        return '<div class="ph phf">' + im + '</div>' +
          '<div class="fill" style="background:linear-gradient(180deg,rgba(3,9,20,0) 30%,rgba(3,9,20,.6) 48%,rgba(3,9,20,.95) 70%)"></div>' +
          '<div class="cv t-big" style="top:126px;font-size:10px;color:#fff;opacity:.9">Early bird · til</div>' +
          '<div class="cv t-big" style="top:139px;font-size:22px;color:#3fe3ff;text-shadow:0 0 16px rgba(63,227,255,.5)">40% off</div>';

      default: // 'plain' — full-bleed photo with a tracked caption
        return '<div class="ph phf">' + im + '</div>' +
          '<div class="fill" style="background:linear-gradient(180deg,rgba(4,8,16,0) 38%,rgba(4,8,16,.85) 68%)"></div>' +
          '<div class="cv" style="top:150px;font-size:5.4px;font-weight:600;letter-spacing:.2em;color:#fff">' + esc(d.t || '') + '</div>';
    }
  }

  function build(ring, posters) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < CARD_COUNT; i++) {
      var card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = creative(posters[i % posters.length]) + '<div class="edge"></div>';
      var img = card.querySelector('img');
      if (img) {
        // A failed photo reveals the gradient placeholder instead of a broken icon.
        img.addEventListener('error', function () { this.closest('.card').classList.add('broken'); });
      }
      frag.appendChild(card);
      cards.push(card);
    }
    ring.appendChild(frag);
  }

  /** Positions every card for the current phase. */
  function placeCards() {
    for (var i = 0; i < cards.length; i++) {
      var el = cards[i];
      // signed angle in -180..180
      var a = ((i * STEP + phase) % 360 + 540) % 360 - 180;
      if (Math.abs(a) > CULL_DEG) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = 'visible';
      var r = a * DEG;
      var c = Math.cos(r);
      el.style.transform = 'translate3d(' + (RADIUS * Math.sin(r)).toFixed(3) + 'px,0,' +
        (RADIUS * (1 - c)).toFixed(3) + 'px) rotateY(' + (-a).toFixed(4) + 'deg)';
      // edges dim, front bright
      el.style.filter = 'brightness(' + (0.84 + 0.5 * (1 / c - 1)).toFixed(4) + ')';
    }
  }

  function tick(t) {
    // Off-screen: skip the work and drop the timestamp so the ring resumes
    // from where it was instead of jumping by the time spent away.
    if (!active) { lastTime = null; requestAnimationFrame(tick); return; }
    // Reduced motion freezes the spin but the ring still renders.
    if (lastTime !== null && !Eventora.motion.reduced()) {
      var dt = Math.min((t - lastTime) / 1000, 0.1);
      phase -= SPEED_DEG_PER_S * dt;
      placeCards();
    }
    lastTime = t;
    requestAnimationFrame(tick);
  }

  Eventora.carousel = {
    count: CARD_COUNT,
    init: function () {
      var ring = document.getElementById('ring');
      if (!ring) return;
      build(ring, Eventora.data.posters);
      placeCards();
      // A backgrounded tab must not jump when it returns.
      document.addEventListener('visibilitychange', function () { lastTime = null; });
      requestAnimationFrame(tick);
    },
    place: placeCards,
    getPhase: function () { return phase; },
    setActive: function (isActive) { active = !!isActive; },
    isActive: function () { return active; }
  };
})(window.Eventora);
