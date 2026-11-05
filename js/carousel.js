/* =========================================================================
   3D POSTER RING — 37 square event posters on a cylinder, camera at its
   centre (CSS perspective === radius), so every card faces the viewer and
   edge cards grow by exactly 1/cos(angle).

   FITTED GEOMETRY. Cards must be shown complete: never behind the browser
   mock, never under the CTA, never cut by the screen edge. fit() therefore
   derives the card size S, radius R, visible half-arc A and vertical position
   from the free band the layout reports (CTA bottom → mock top) and the
   visible half-width:
     · horizontal: the outermost card's far edge, R·tan(A + δ), must stay
       inside the half-width, where δ = atan(S / 2R) is half a card's angle;
     · vertical: with the horizon d = 0.9·S below the card centre, the tallest
       extent (edge card top → centre card bottom) is S·(1.4·m − 0.4), where
       m = cos δ / cos(A + δ) is the outer edge's magnification; it must fit
       the band.
   Cards fade over the last FADE_DEG of the arc, so they appear and leave
   gently instead of being clipped.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var CARD_COUNT = 37;
  var STEP = 360 / CARD_COUNT;            // ≈ 9.73° between cards
  var SPEED_DEG_PER_S = 1.9;
  var DEG = Math.PI / 180;

  var ART = 130;                           // poster artwork is authored on a 130×130 box
  var GAP = 1.10;                          // centre-to-centre spacing = 1.10 × card size
  var SPACING = GAP / Math.tan(STEP * DEG);          // R = SPACING · S
  var HALF_CARD = Math.atan(1 / (2 * SPACING)) / DEG; // δ, half a card's angular width
  var HORIZON = 0.9;                       // horizon sits 0.9·S below the card centre
  var FADE_DEG = 6;
  var MAX_ARC = 40;
  var EDGE_GAP = 10;                       // breathing room inside the band (local px)

  /* Per-mode preferences: the arc we aim for and the largest card allowed. */
  var PREFS = {
    desktop: { arc: 38, maxS: 130 },   // wide arc: the ring spans the hero, as approved
    tablet:  { arc: 30, maxS: 150 },
    phone:   { arc: 14, maxS: 120 }
  };

  var geo = { S: 106, R: 692, A: 35, cardY: 480, horizon: 95 };
  var ring = null;
  var cards = [];
  var phase = -2;           // running rotation, never reset
  var lastTime = null;
  var active = true;        // false while the hero is scrolled off-screen

  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- Geometry ---------- */

  /** Largest projection scale on the outermost card. Its OUTER vertical edge
      sits at angle A + δ and is the closest point to the camera, so it is
      magnified by cos δ / cos(A + δ) — a little more than the card centre's
      1 / cos A. Using the centre value under-sizes the arc by ~6% at 38°. */
  function edgeScale(aDeg) { return Math.cos(HALF_CARD * DEG) / Math.cos((aDeg + HALF_CARD) * DEG); }

  /** Height of the whole arc (edge-card top → centre-card bottom) per unit S. */
  function spanFactor(aDeg) { return (HORIZON + 0.5) * edgeScale(aDeg) - (HORIZON - 0.5); }

  /**
   * Fits the ring into a band.
   * @param {{mode:string, halfWidth:number, bandTop:number, bandBottom:number}} box
   *        all in the ring's local px (design px on desktop/tablet, CSS px on phone)
   */
  function fit(box) {
    var base = PREFS[box.mode] || PREFS.desktop;
    // The layout may blend preferences (e.g. desktop → tablet over the same
    // 120px ramp as the scale law) so the ring never jumps at a breakpoint.
    var pref = { arc: box.arc || base.arc, maxS: box.maxS || base.maxS };
    var halfW = Math.max(60, box.halfWidth);
    var h = Math.max(60, box.bandBottom - box.bandTop - 2 * EDGE_GAP);

    // 1) Card size: the largest square that fits BOTH width and height at the
    //    preferred arc. Size wins over card count, so S is never reduced later.
    var A0 = pref.arc;
    var S = Math.min(pref.maxS,
      halfW / (SPACING * Math.tan((A0 + HALF_CARD) * DEG)),
      h / spanFactor(A0));
    // 2) Arc: widen beyond the preference only as far as that size still fits
    //    horizontally (closed form) and vertically (bisection on spanFactor).
    var aWidth = Math.atan(halfW / (SPACING * S)) / DEG - HALF_CARD;
    var lo = 0, hi = MAX_ARC;
    for (var i = 0; i < 24; i++) {
      var mid = (lo + hi) / 2;
      if (S * spanFactor(mid) <= h) lo = mid; else hi = mid;
    }
    var A = Math.max(1, Math.min(MAX_ARC, aWidth, lo));
    var R = SPACING * S;
    var d = HORIZON * S;
    var span = S * spanFactor(A);
    // Place the arc centred in the band: its top is the edge card's top.
    var top = box.bandTop + EDGE_GAP + (h - span) / 2;
    var cardY = top - d + (d + S / 2) * edgeScale(A);

    geo = { S: S, R: R, A: A, cardY: cardY, horizon: d };
    apply();
    return geo;
  }

  function apply() {
    if (!ring) return;
    ring.style.setProperty('--card-s', geo.S.toFixed(2) + 'px');
    ring.style.setProperty('--card-y', geo.cardY.toFixed(2) + 'px');
    ring.style.setProperty('--art-k', (geo.S / ART).toFixed(4));
    ring.style.perspective = geo.R.toFixed(2) + 'px';
    ring.style.perspectiveOrigin = '586px ' + (geo.cardY + geo.horizon).toFixed(2) + 'px';
    placeCards();
  }

  /* ---------- Poster artwork (130×130 box, scaled by --art-k) ----------
     Photos carry no text; all typography is HTML/CSS overlay. */
  function creative(d) {
    var im = '<img alt="" src="' + esc(d.url) + '" decoding="async">';

    switch (d.v) {
      case 'ticket':
        return '<div class="fill" style="background:#efedea"></div>' +
          '<div class="ph" style="top:0;height:62px">' + im + '</div>' +
          '<div style="position:absolute;left:0;right:0;top:62px;height:3px;background:#e5202f"></div>' +
          '<i class="notch" style="left:-5px"></i><i class="notch" style="right:-5px"></i>' +
          '<div class="cv" style="top:71px;font-size:3.4px;letter-spacing:.15em;color:#8d9298">ADMIT ONE · WORLD TOUR</div>' +
          '<div class="cv t-big" style="top:78px;font-size:14px;color:#16171b">Electric</div>' +
          '<div class="cv t-big" style="top:92px;font-size:14px;color:#e5202f">Live on stage</div>' +
          '<div class="cv" style="top:110px;font-size:5px;font-weight:700;color:#16171b">' +
            '<b class="dot"></b>SAT 14 NOV · <b>ARENA 9</b></div>';   // 14 Nov 2026 is a Saturday

      case 'gala':
        return '<div class="fill" style="background:linear-gradient(168deg,#f9d9e5,#f3bdd2 55%,#e8a3c0)"></div>' +
          '<div class="ph" style="top:58px;bottom:0">' + im +
            '<div class="fill" style="background:linear-gradient(180deg,rgba(247,212,226,.97),rgba(247,212,226,0) 42%)"></div></div>' +
          '<div class="cv t-serif" style="top:13px;font-size:15px;color:#b03a63">WINTER</div>' +
          '<div class="cv t-serif" style="top:30px;font-size:15px;color:#b03a63">GALA 2026</div>';

      case 'workshop':
        return '<div class="fill" style="background:#fff"></div>' +
          '<div class="ph" style="top:0;height:76px">' + im + '</div>' +
          '<div class="cv" style="top:84px;font-size:5.4px;font-weight:700;letter-spacing:.09em;color:#16171b">CREATIVE WORKSHOP</div>' +
          '<div class="cv" style="top:94px;font-size:4.2px;color:#7b8087">Design · Build · Launch</div>' +
          '<div style="position:absolute;left:10px;top:104px;padding:4px 11px;border-radius:20px;background:#16171b;font-size:4.6px;font-weight:600;color:#fff;letter-spacing:.05em">Reserve a seat</div>';

      case 'summit':
        return '<div class="fill" style="background:linear-gradient(180deg,#0a2a4a,#0d3a63 50%,#08192b)"></div>' +
          '<div class="ph" style="top:58px;bottom:0">' + im +
            '<div class="fill" style="background:linear-gradient(180deg,rgba(10,42,74,.98),rgba(10,42,74,0) 45%)"></div></div>' +
          '<div class="cv" style="top:13px;font-size:4.2px;line-height:1.7;color:rgba(255,255,255,.82);width:76px">' +
            'Two days of keynotes, hands-on labs and conversations with the people shaping what comes next.</div>' +
          '<div style="position:absolute;right:10px;top:13px;font-size:5.4px;font-weight:600;color:#fff;opacity:.92">✳ Eventora</div>';

      case 'fest':
        return '<div class="fill" style="background:linear-gradient(158deg,#4a0c80 0%,#7a16a6 40%,#a81fc6 66%,#5c0e90 100%)"></div>' +
          '<div class="ph" style="top:80px;bottom:0;opacity:.45;mix-blend-mode:screen">' + im + '</div>' +
          '<div class="fill" style="background:radial-gradient(48% 22% at 50% 70%,rgba(255,255,255,.75),rgba(255,255,255,0) 72%)"></div>' +
          '<div style="position:absolute;left:-6px;right:-6px;top:14px;height:12px;background:#ff2d8a;transform:rotate(-2.6deg);box-shadow:0 4px 12px rgba(255,45,138,.5)"></div>' +
          '<div style="position:absolute;left:0;right:0;top:15.5px;transform:rotate(-2.6deg);text-align:center;font-size:5.2px;font-weight:700;letter-spacing:.05em;color:#fff">THREE DAYS · OPEN AIR</div>' +
          '<div class="cv t-big" style="top:36px;font-size:22px;color:#fff;text-shadow:0 3px 0 rgba(84,9,124,.6)">Colour</div>' +
          '<div class="cv t-big" style="top:58px;font-size:22px;color:#fff;text-shadow:0 3px 0 rgba(84,9,124,.6)">Fest</div>' +
          '<div class="cv t-big" style="top:84px;font-size:17px;color:#fff">+</div>';

      case 'stage':
        return '<div class="ph phf">' + im + '</div>' +
          '<div class="fill" style="background:linear-gradient(180deg,rgba(6,5,10,0) 28%,rgba(6,5,10,.55) 50%,rgba(6,5,10,.92) 78%)"></div>' +
          '<div class="cv t-serif" style="top:70px;font-size:13px;color:#fff">A NIGHT OF</div>' +
          '<div class="cv t-serif" style="top:85px;font-size:13px;color:#fff">PURE SOUL</div>' +
          '<div class="cv" style="top:104px;font-size:4.2px;letter-spacing:.07em;color:rgba(255,255,255,.85)">one voice, one stage, one evening</div>';

      case 'early':
        return '<div class="ph phf">' + im + '</div>' +
          '<div class="fill" style="background:linear-gradient(180deg,rgba(3,9,20,0) 26%,rgba(3,9,20,.6) 50%,rgba(3,9,20,.95) 76%)"></div>' +
          '<div class="cv t-big" style="top:80px;font-size:9px;color:#fff;opacity:.9">Early bird · til</div>' +
          '<div class="cv t-big" style="top:92px;font-size:20px;color:#3fe3ff;text-shadow:0 0 16px rgba(63,227,255,.5)">40% off</div>';

      default: // 'plain' — full-bleed photo with a tracked caption
        return '<div class="ph phf">' + im + '</div>' +
          '<div class="fill" style="background:linear-gradient(180deg,rgba(4,8,16,0) 40%,rgba(4,8,16,.85) 76%)"></div>' +
          '<div class="cv" style="top:108px;font-size:5.4px;font-weight:600;letter-spacing:.2em;color:#fff">' + esc(d.t || '') + '</div>';
    }
  }

  function build(posters) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < CARD_COUNT; i++) {
      var card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = '<div class="card__art">' + creative(posters[i % posters.length]) + '</div><div class="edge"></div>';
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

  /** Positions every card for the current phase and geometry. */
  function placeCards() {
    var R = geo.R, A = geo.A;
    for (var i = 0; i < cards.length; i++) {
      var el = cards[i];
      // signed angle in -180..180
      var a = ((i * STEP + phase) % 360 + 540) % 360 - 180;
      var abs = Math.abs(a);
      if (abs > A) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = 'visible';
      var r = a * DEG;
      var c = Math.cos(r);
      el.style.transform = 'translate3d(' + (R * Math.sin(r)).toFixed(3) + 'px,0,' +
        (R * (1 - c)).toFixed(3) + 'px) rotateY(' + (-a).toFixed(4) + 'deg)';
      // edges slightly brighter (closer to the camera), as in the reference
      el.style.filter = 'brightness(' + (0.84 + 0.5 * (1 / c - 1)).toFixed(4) + ')';
      // fade in/out over the last FADE_DEG so no card is ever clipped
      el.style.opacity = Math.min(1, (A - abs) / FADE_DEG).toFixed(3);
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
      ring = document.getElementById('ring');
      if (!ring) return;
      build(Eventora.data.posters);
      apply();
      // A backgrounded tab must not jump when it returns.
      document.addEventListener('visibilitychange', function () { lastTime = null; });
      requestAnimationFrame(tick);
    },
    fit: fit,
    geometry: function () { return geo; },
    place: placeCards,
    getPhase: function () { return phase; },
    setActive: function (isActive) { active = !!isActive; },
    isActive: function () { return active; }
  };
})(window.Eventora);
