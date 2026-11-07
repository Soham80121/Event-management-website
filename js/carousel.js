/* =========================================================================
   3D POSTER RING — 37 portrait (2:3) event posters on a cylinder, camera at
   its centre (CSS perspective === radius), so every card faces the viewer
   and edge cards grow by exactly 1/cos(angle).

   FITTED GEOMETRY. As in the reference, the browser mock sits in front of the
   ring and hides the lower third of the centre poster (phones excepted, where
   posters are shown whole). Posters never rise under the CTA and are never
   cut by the screen edge. fit() derives the poster width W (height = 1.5 W),
   radius R, visible half-arc A and vertical position from the band the
   layout reports (CTA bottom → mock top) and the visible half-width:
     · horizontal: the outermost poster's far edge, R·tan(A + δ), must stay
       inside the half-width, where δ = atan(W / 2R) is half a poster's angle;
     · vertical: with the horizon d = 0.6·H below the poster centre, the
       tallest extent (edge poster top → centre poster bottom) is
       H·(1.1·m − 0.1), where m = cos δ / cos(A + δ) is the outer edge's
       magnification; it must fit between the CTA and the mock top plus the
       tucked part.
   Posters fade over the last FADE_DEG of the arc, so they appear and leave
   gently instead of being clipped.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var CARD_COUNT = 37;
  var STEP = 360 / CARD_COUNT;            // ≈ 9.73° between cards
  var SPEED_DEG_PER_S = 1.9;
  var DEG = Math.PI / 180;

  var ART_W = 130, ART_H = 195;            // poster artwork board (2:3)
  var ASPECT = ART_H / ART_W;              // height = 1.5 × width
  var GAP = 1.12;                          // centre-to-centre spacing = 1.12 × poster width
  var SPACING = GAP / Math.tan(STEP * DEG);          // R = SPACING · W
  var HALF_CARD = Math.atan(1 / (2 * SPACING)) / DEG; // δ, half a poster's angular width
  var HORIZON = 0.6;                       // horizon sits 0.6·H below the poster centre
  var FADE_DEG = 6;
  var MAX_ARC = 40;
  var EDGE_GAP = 10;                       // breathing room inside the band (local px)

  /* Per-mode preferences: the arc we aim for, the widest poster allowed and
     how much of the centre poster tucks behind the browser mock. */
  var PREFS = {
    desktop: { arc: 33, maxS: 120, tuck: 0.35 },  // mock overlaps the lower third, as in the reference
    tablet:  { arc: 30, maxS: 130, tuck: 0.35 },
    phone:   { arc: 14, maxS: 100, tuck: 0 }      // width-limited: posters stay fully visible
  };

  var geo = { S: 100, H: 150, R: 642, A: 33, cardY: 560, horizon: 90, tuck: 0.35 };
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

  /** Largest projection scale on the outermost poster. Its OUTER vertical edge
      sits at angle A + δ and is the closest point to the camera, so it is
      magnified by cos δ / cos(A + δ) — a little more than the poster centre's
      1 / cos A. */
  function edgeScale(aDeg) { return Math.cos(HALF_CARD * DEG) / Math.cos((aDeg + HALF_CARD) * DEG); }

  /** Height of the whole arc (edge-poster top → centre-poster bottom) per unit H. */
  function spanFactor(aDeg) { return (HORIZON + 0.5) * edgeScale(aDeg) - (HORIZON - 0.5); }

  /**
   * Fits the ring into a band.
   * @param {{mode:string, halfWidth:number, bandTop:number, bandBottom:number,
   *          arc?:number, maxS?:number, tuck?:number}} box
   *        lengths in the ring's local px (design px on desktop/tablet, CSS px on phone)
   *
   * tuck > 0 (desktop/tablet): the browser mock sits IN FRONT of the ring, as in
   * the reference composition — the centre poster's bottom tuck·H is hidden
   * behind it; edge posters ride higher on the arc and show more.
   * tuck = 0 (phone): posters are width-limited, so they stay fully visible,
   * centred in the band.
   */
  function fit(box) {
    var base = PREFS[box.mode] || PREFS.desktop;
    // The layout may blend preferences (e.g. desktop → tablet over the same
    // 120px ramp as the scale law) so the ring never jumps at a breakpoint.
    var pref = {
      arc: box.arc || base.arc,
      maxS: box.maxS || base.maxS,
      tuck: box.tuck !== undefined ? box.tuck : base.tuck
    };
    var tuck = pref.tuck;
    var halfW = Math.max(60, box.halfWidth);
    // Vertical room: from just below the CTA to the mock top (+ the tucked part).
    var h = Math.max(60, box.bandBottom - box.bandTop - (tuck > 0 ? EDGE_GAP : 2 * EDGE_GAP));
    function fitsHeight(W, a) { return W * ASPECT * (spanFactor(a) - tuck) <= h; }

    // 1) Poster width: the largest that fits BOTH width and height at the
    //    preferred arc. Size wins over poster count, so W is never reduced later.
    var A0 = pref.arc;
    var W = Math.min(pref.maxS,
      halfW / (SPACING * Math.tan((A0 + HALF_CARD) * DEG)),
      h / (ASPECT * (spanFactor(A0) - tuck)));
    // 2) Arc: widen beyond the preference only as far as that size still fits
    //    horizontally (closed form) and vertically (bisection).
    var aWidth = Math.atan(halfW / (SPACING * W)) / DEG - HALF_CARD;
    var lo = 0, hi = MAX_ARC;
    for (var i = 0; i < 24; i++) {
      var mid = (lo + hi) / 2;
      if (fitsHeight(W, mid)) lo = mid; else hi = mid;
    }
    var A = Math.max(1, Math.min(MAX_ARC, aWidth, lo));
    var H = W * ASPECT;
    var R = SPACING * W;
    var d = HORIZON * H;
    var cardY;
    if (tuck > 0) {
      // centre poster's bottom sits tuck·H below the mock's top edge
      cardY = box.bandBottom + tuck * H - H / 2;
    } else {
      // centred in the band: the arc's top is the edge poster's top
      var span = H * spanFactor(A);
      var top = box.bandTop + EDGE_GAP + (h - span) / 2;
      cardY = top - d + (d + H / 2) * edgeScale(A);
    }

    // Height the arc actually needs inside the band (CTA gap included), so the
    // layout can tell how much spare room is left above the ring.
    var need = tuck > 0 ? H * (spanFactor(A) - tuck) + EDGE_GAP : H * spanFactor(A) + 2 * EDGE_GAP;
    geo = { S: W, H: H, R: R, A: A, cardY: cardY, horizon: d, tuck: tuck, need: need };
    apply();
    return geo;
  }

  function apply() {
    if (!ring) return;
    ring.style.setProperty('--card-w', geo.S.toFixed(2) + 'px');
    ring.style.setProperty('--card-h', geo.H.toFixed(2) + 'px');
    ring.style.setProperty('--card-y', geo.cardY.toFixed(2) + 'px');
    ring.style.setProperty('--art-k', (geo.S / ART_W).toFixed(4));
    ring.style.perspective = geo.R.toFixed(2) + 'px';
    ring.style.perspectiveOrigin = '586px ' + (geo.cardY + geo.horizon).toFixed(2) + 'px';
    placeCards();
  }

  /* ---------- Poster artwork (130×195 board, scaled by --art-k) ----------
     Photos carry no text; all typography is HTML/CSS overlay. Every title
     and detail lives in the top ~60% of the poster (y < 120), because the
     lower third of the centre poster tucks behind the browser mock; only
     photography runs into that zone. */
  function creative(d) {
    var im = '<img alt="" src="' + esc(d.url) + '" decoding="async">';

    switch (d.v) {
      case 'ticket':   // 14 Nov 2026 is a Saturday
        return '<div class="fill" style="background:#efedea"></div>' +
          '<div class="cv" style="top:14px;font-size:3.6px;letter-spacing:.15em;color:#8d9298">ADMIT ONE · WORLD TOUR</div>' +
          '<div class="cv t-big" style="top:23px;font-size:15px;color:#16171b">Electric</div>' +
          '<div class="cv t-big" style="top:38px;font-size:15px;color:#e5202f">Live on stage</div>' +
          '<div class="cv" style="top:60px;font-size:5.2px;font-weight:700;color:#16171b;line-height:1.7">' +
            '<div><b class="dot"></b>SAT 14 NOV · <b>ARENA 9</b></div>' +
            '<div style="margin-top:4px"><b class="dot sq"></b>DOORS AT <b>7 PM</b> · ALL AGES</div></div>' +
          '<div style="position:absolute;left:0;right:0;top:92px;height:3px;background:#e5202f"></div>' +
          '<i class="notch" style="left:-5px"></i><i class="notch" style="right:-5px"></i>' +
          '<div class="ph" style="top:95px;bottom:0">' + im + '</div>';

      case 'gala':
        return '<div class="fill" style="background:linear-gradient(168deg,#f9d9e5,#f3bdd2 55%,#e8a3c0)"></div>' +
          '<div class="ph" style="top:78px;bottom:0">' + im +
            '<div class="fill" style="background:linear-gradient(180deg,rgba(247,212,226,.97),rgba(247,212,226,0) 34%)"></div></div>' +
          '<div class="cv t-serif" style="top:20px;font-size:16px;color:#b03a63">WINTER</div>' +
          '<div class="cv t-serif" style="top:38px;font-size:16px;color:#b03a63">GALA 2026</div>' +
          '<div class="cv" style="top:62px;font-size:4.4px;letter-spacing:.14em;color:#8a3a58">BLACK TIE · VIENNA</div>';

      case 'workshop':
        return '<div class="fill" style="background:#fff"></div>' +
          '<div class="cv" style="top:16px;font-size:5.6px;font-weight:700;letter-spacing:.09em;color:#16171b">CREATIVE WORKSHOP</div>' +
          '<div class="cv" style="top:27px;font-size:4.4px;color:#7b8087">Design · Build · Launch</div>' +
          '<div style="position:absolute;left:10px;top:38px;padding:4px 11px;border-radius:20px;background:#16171b;font-size:4.8px;font-weight:600;color:#fff;letter-spacing:.05em">Reserve a seat</div>' +
          '<div class="ph" style="top:60px;bottom:0">' + im + '</div>';

      case 'summit':
        return '<div class="fill" style="background:linear-gradient(180deg,#0a2a4a,#0d3a63 50%,#08192b)"></div>' +
          '<div class="ph" style="top:76px;bottom:0">' + im +
            '<div class="fill" style="background:linear-gradient(180deg,rgba(10,42,74,.98),rgba(10,42,74,0) 40%)"></div></div>' +
          '<div class="cv" style="top:16px;font-size:4.4px;line-height:1.7;color:rgba(255,255,255,.82);width:78px">' +
            'Two days of keynotes, hands-on labs and conversations with the people shaping what comes next.</div>' +
          '<div style="position:absolute;right:10px;top:16px;font-size:5.6px;font-weight:600;color:#fff;opacity:.92">✳ EvAtlas</div>';

      case 'fest':
        return '<div class="fill" style="background:linear-gradient(158deg,#4a0c80 0%,#7a16a6 40%,#a81fc6 66%,#5c0e90 100%)"></div>' +
          '<div class="ph" style="top:112px;bottom:0;opacity:.45;mix-blend-mode:screen">' + im + '</div>' +
          '<div class="fill" style="background:radial-gradient(46% 18% at 50% 62%,rgba(255,255,255,.75),rgba(255,255,255,0) 72%)"></div>' +
          '<div style="position:absolute;left:-6px;right:-6px;top:22px;height:13px;background:#ff2d8a;transform:rotate(-2.6deg);box-shadow:0 4px 12px rgba(255,45,138,.5)"></div>' +
          '<div style="position:absolute;left:0;right:0;top:23.5px;transform:rotate(-2.6deg);text-align:center;font-size:5.6px;font-weight:700;letter-spacing:.05em;color:#fff">THREE DAYS · OPEN AIR</div>' +
          '<div class="cv t-big" style="top:46px;font-size:24px;color:#fff;text-shadow:0 3px 0 rgba(84,9,124,.6)">Colour</div>' +
          '<div class="cv t-big" style="top:70px;font-size:24px;color:#fff;text-shadow:0 3px 0 rgba(84,9,124,.6)">Fest</div>' +
          '<div class="cv t-big" style="top:96px;font-size:18px;color:#fff">+</div>';

      case 'stage':
        return '<div class="ph phf">' + im + '</div>' +
          '<div class="fill" style="background:linear-gradient(0deg,rgba(6,5,10,0) 45%,rgba(6,5,10,.55) 66%,rgba(6,5,10,.9) 100%)"></div>' +
          '<div class="cv t-serif" style="top:18px;font-size:15px;color:#fff">A NIGHT OF</div>' +
          '<div class="cv t-serif" style="top:35px;font-size:15px;color:#fff">PURE SOUL</div>' +
          '<div class="cv" style="top:57px;font-size:4.4px;letter-spacing:.07em;color:rgba(255,255,255,.85)">one voice, one stage, one evening</div>';

      case 'early':
        return '<div class="ph phf">' + im + '</div>' +
          '<div class="fill" style="background:linear-gradient(0deg,rgba(3,9,20,0) 48%,rgba(3,9,20,.6) 68%,rgba(3,9,20,.94) 100%)"></div>' +
          '<div class="cv t-big" style="top:18px;font-size:10px;color:#fff;opacity:.9">Early bird · til</div>' +
          '<div class="cv t-big" style="top:31px;font-size:22px;color:#3fe3ff;text-shadow:0 0 16px rgba(63,227,255,.5)">40% off</div>';

      default: // 'plain' — full-bleed photo with a tracked caption
        return '<div class="ph phf">' + im + '</div>' +
          '<div class="fill" style="background:linear-gradient(0deg,rgba(4,8,16,0) 62%,rgba(4,8,16,.8) 100%)"></div>' +
          '<div class="cv" style="top:16px;font-size:5.6px;font-weight:600;letter-spacing:.2em;color:#fff">' + esc(d.t || '') + '</div>';
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
