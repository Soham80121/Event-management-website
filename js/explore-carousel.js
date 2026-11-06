/* =========================================================================
   EXPLORE CAROUSEL — the interactive curved poster arc in Explore Events,
   plus the expanding event-details panel.

   Interaction ideas adapted (not copied) from the "curved archive" motion
   reference, translated into EVENTORA's design language:
     · posters stand on a curved arc that recedes into depth; the front
       poster faces the viewer and is pushed forward, its neighbours are
       eased apart, far posters shrink, turn, sink slightly and dim
     · one requestAnimationFrame loop with an exponential spring
       (s += (T − s)·(1 − e^(−k·dt))), soft at rest, tight while dragging
     · drag / swipe, arrow buttons, ←/→ keys, horizontal trackpad swipes,
       click a side poster to glide it in, click the front one to open
     · caption swaps by mask-slide in the direction of travel
     · a programme timeline whose dot glides to the front event's date
     · the details panel grows out of the front poster (clip-path) and
       shrinks back into it on close

   Data comes only from js/events.js (programme order = by date).
   The loop sleeps when settled and when the section is off-screen.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var cat = Eventora.events;
  var DEG = Math.PI / 180;
  var COPIES = 3;                 // the ring loops: n events × 3 virtual posters

  var events = [];                // programme order
  var n = 0, M = 0;               // events, virtual posters
  var posters = [];               // { el, v, e, lift, liftT }
  var els = {};

  /* geometry (recomputed on resize) */
  var G = { H: 360, W: 240, P: 1400, U: 470, STEP: 168, EXTRA: 108, XS: null };

  /* motion state */
  var s = 0, T = 0;               // current / target position (virtual index space)
  var tiltX = 0, tiltY = 0, tiltXT = 0, tiltYT = 0;
  var dotX = 0, dotReady = false;
  var activeIndex = -1;           // event index (0..n-1) shown in the caption
  var running = false, lastT = null, visible = true;
  var drag = null, suppressClick = false, wheelTimer = null, wheelFrom = null;
  var announceTimer = null;

  var reducedMotion = function () { return Eventora.motion.reduced(); };

  /* ---------- small helpers ---------- */
  function el(tag, className, text) {
    var x = document.createElement(tag);
    if (className) x.className = className;
    if (text !== undefined && text !== null) x.textContent = text;
    return x;
  }
  function mod(a, b) { return ((a % b) + b) % b; }
  function sign(x) { return x < 0 ? -1 : 1; }
  function smoothstep(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  function ease(rate, dt) { return 1 - Math.exp(-rate * dt); }

  /** Signed distance of virtual poster v from position p, in [−M/2, M/2). */
  function rel(v, p) {
    var d = mod(v - p, M);
    return d >= M / 2 ? d - M : d;
  }

  /* ---------- arc geometry ---------- */

  /** Smooth "push apart" term: neighbours of the front poster get extra room. */
  function B(r) {
    var a = Math.abs(r);
    if (a >= 1) return sign(r) * 0.5;
    return (r + Math.sin(Math.PI * r) / Math.PI) / 2;
  }
  /** Arc length from the centre for relative index r. */
  function F(r) { return r * G.STEP + G.EXTRA * B(r); }
  /** On-screen scale at arc length u: posters shrink with distance. */
  function scl(u) { return 1 / (1 + Math.pow(Math.abs(u) / G.U, 1.6)); }
  /** On-screen x at arc length u = integral of scl (far posters pack tighter). */
  function xsc(u) {
    var a = Math.abs(u) / 2;
    var i = Math.floor(a);
    if (i >= G.XS.length - 1) return sign(u) * G.XS[G.XS.length - 1];
    var f = a - i;
    return sign(u) * (G.XS[i] + (G.XS[i + 1] - G.XS[i]) * f);
  }

  function measure() {
    var probe = els.probe;
    var H = probe ? probe.offsetHeight : 360;
    var phone = Eventora.viewport.mode() === 'phone';
    G.H = H;
    G.W = H / 1.5;                          // portrait 2:3 posters
    G.P = phone ? 1000 : 1400;
    G.U = H * (phone ? 1.05 : 1.3);
    G.STEP = G.W * 0.70;
    G.EXTRA = G.W * 0.45;
    // precompute x(u) by integrating scl in 2px steps
    var XS = [0], acc = 0;
    for (var u = 0; u <= G.U * 3; u += 2) {
      acc += 2 / (1 + Math.pow(u / G.U, 1.6));
      XS.push(acc);
    }
    G.XS = XS;
    els.stage.style.setProperty('--pW', G.W.toFixed(1) + 'px');
    els.stage.style.setProperty('--pH', G.H.toFixed(1) + 'px');
    els.stage.style.perspective = G.P + 'px';
  }

  /** Screen distance between neighbouring posters near the centre. */
  function stepPx() { return F(1); }

  /* ---------- layout of every poster, every frame ---------- */
  function place() {
    var settled = Math.abs(T - s) < 0.3;
    for (var i = 0; i < posters.length; i++) {
      var p = posters[i];
      var r = rel(p.v, s);
      var u = F(r);
      if (Math.abs(u) > G.U * 1.95) {
        if (p.shown) { p.el.style.visibility = 'hidden'; p.shown = false; }
        continue;
      }
      if (!p.shown) { p.el.style.visibility = 'visible'; p.shown = true; }
      var o = smoothstep(Math.max(0, 1 - Math.abs(r)));   // 1 = front poster
      var sc = scl(u), k = 1 / sc;
      var z = G.P * (1 - k) + o * G.H * 0.1;
      var x = xsc(u) * k;
      var y = (G.H * 0.5 * (1 - sc) * 0.42 + o * G.H * 0.012 - p.lift * G.H * 0.05) * k;
      var ry = sign(u) * Math.min(1, Math.abs(u) / G.U) * 32 * (1 - o) + tiltY * o;
      var rx = tiltX * o;
      p.el.style.transform = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,' + z.toFixed(2) +
        'px) rotateX(' + rx.toFixed(3) + 'deg) rotateY(' + ry.toFixed(3) + 'deg)';
      p.el.style.zIndex = String(Math.round(3000 + z));
      p.el.style.setProperty('--shade', Math.min(0.62, (1 - o) * 0.16 + (1 - sc) * 0.55).toFixed(3));
      p.el.style.setProperty('--front', o.toFixed(3));
    }
    els.glow.style.opacity = settled ? '1' : String(Math.max(0, 1 - Math.abs(T - s) * 2));
  }

  /* ---------- the loop ---------- */
  function frame(t) {
    if (!running) return;
    var dt = lastT === null ? 0.016 : Math.min((t - lastT) / 1000, 0.05);
    lastT = t;
    var reduced = reducedMotion();

    // spring toward the target
    if (reduced) s = T;
    else s += (T - s) * ease(drag && drag.active ? 18 : 5.2, dt);
    if (Math.abs(T - s) < 0.0004) s = T;

    // keep the centre copy in view (shift by whole loops; visually identical)
    var shift = 0;
    while (s >= 2 * n) { s -= n; T -= n; shift -= n; if (drag) drag.T0 -= n; }
    while (s < n) { s += n; T += n; shift += n; if (drag) drag.T0 += n; }
    if (shift) rehome(shift);

    // pointer tilt + hover lift
    tiltX += (tiltXT - tiltX) * (reduced ? 1 : ease(7, dt));
    tiltY += (tiltYT - tiltY) * (reduced ? 1 : ease(7, dt));
    var lifting = false;
    for (var i = 0; i < posters.length; i++) {
      var p = posters[i];
      if (p.lift !== p.liftT) {
        p.lift += (p.liftT - p.lift) * (reduced ? 1 : ease(12, dt));
        if (Math.abs(p.liftT - p.lift) < 0.002) p.lift = p.liftT; else lifting = true;
      }
    }

    place();
    updateActive();
    if (pendingFocus) focusTarget();
    var dotMoving = updateDot(dt, reduced);

    var still = s === T && !lifting && !dotMoving && !(drag && drag.active) &&
      Math.abs(tiltX - tiltXT) < 0.01 && Math.abs(tiltY - tiltYT) < 0.01;
    if (still) { running = false; lastT = null; return; }
    requestAnimationFrame(frame);
  }

  function wake() {
    if (running || !visible) return;
    running = true;
    lastT = null;
    requestAnimationFrame(frame);
  }

  /* ---------- active event, caption, live region ---------- */
  function currentIndex() { return mod(Math.round(s), n); }
  function targetVirtual() { return mod(Math.round(T), M); }

  function updateActive() {
    var idx = currentIndex();
    if (idx === activeIndex) return;
    var dir = activeIndex === -1 ? 0 : (T - s >= 0 ? 1 : -1);
    activeIndex = idx;
    swapCaption(events[idx], dir);
    scheduleAnnounce();
  }

  function captionParts(e) {
    return {
      title: e.title,
      meta: e.category + ' · ' + cat.dateLabel(e) + ' · ' + e.venue.name + ', ' + e.venue.city
    };
  }

  /* Mask slide: the new line rises in from the travel direction while the old
     one leaves the other way (no opacity fades). */
  function swapCaption(e, dir) {
    var parts = captionParts(e);
    [['title', els.capTitle], ['meta', els.capMeta]].forEach(function (pair) {
      var mask = pair[1];
      var old = Array.prototype.slice.call(mask.children);
      var span = el('span', 'explore__cap-line', parts[pair[0]]);
      mask.appendChild(span);
      if (!dir || reducedMotion() || !span.animate) { old.forEach(function (o) { o.remove(); }); return; }
      var opts = { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' };
      span.animate([{ transform: 'translateY(' + (dir * 105) + '%)' }, { transform: 'translateY(0)' }], opts);
      old.forEach(function (o) {
        var a = o.animate([{ transform: getComputedStyle(o).transform === 'none' ? 'translateY(0)' : getComputedStyle(o).transform },
          { transform: 'translateY(' + (-dir * 105) + '%)' }], opts);
        a.onfinish = function () { o.remove(); };
      });
    });
  }

  function scheduleAnnounce() {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      var e = events[activeIndex];
      els.live.textContent = 'Event ' + (activeIndex + 1) + ' of ' + n + ': ' + e.title + ', ' +
        e.category + ', ' + cat.dateLabel(e, true) + '.';
    }, 350);
    updateRoving();
  }

  /* Roving focus: only the poster at the target position is in the Tab order
     and exposed to assistive tech; the rest are decorative copies. */
  function updateRoving() {
    var tv = targetVirtual();
    posters.forEach(function (p) {
      var on = p.v === tv;
      p.el.tabIndex = on ? 0 : -1;
      if (on) p.el.removeAttribute('aria-hidden'); else p.el.setAttribute('aria-hidden', 'true');
    });
  }

  /* Keep keyboard focus on the poster at the target position. After a long
     jump (Home/End, timeline) that poster may still be off the arc and
     hidden, and hidden elements can't take focus — so focus parks on the
     stage (which handles the same keys) and moves onto the poster as soon as
     it comes into view during the glide. */
  var pendingFocus = false;
  function focusTarget() {
    var p = posters[targetVirtual()];
    var inside = els.stage.contains(document.activeElement);   // includes the stage itself
    if (!p || (!inside && !pendingFocus)) return;
    if (p.shown) {
      p.el.focus({ preventScroll: true });
      pendingFocus = false;
    } else {
      els.stage.focus({ preventScroll: true });
      pendingFocus = true;
      wake();
    }
  }

  /* The loop shift above swaps which copy of each poster sits at the front.
     Move the roving tab stop (and focus, if a poster had it) onto the copy
     that now occupies the same spot, or focus would be left on a poster that
     just went off the arc and got hidden. */
  function rehome(shift) {
    if (wheelFrom !== null) wheelFrom += shift;   // a wheel gesture in progress
    var a = document.activeElement;
    var had = null;
    for (var i = 0; i < posters.length; i++) if (posters[i].el === a) { had = posters[i]; break; }
    updateRoving();
    if (had) {
      var twin = posters[mod(had.v + shift, M)];
      if (twin) {
        twin.el.style.visibility = 'visible'; twin.shown = true;
        twin.el.focus({ preventScroll: true });
      }
    }
  }

  /* ---------- navigation ---------- */
  function go(delta) {
    T = Math.round(T) + delta;
    updateRoving();
    focusTarget();
    wake();
  }

  /** Glide the poster at virtual index v to the front by the shortest way. */
  function glideTo(v) {
    T = Math.round(T + rel(v, T));
    updateRoving();
    wake();
  }

  /** Bring event index i to the front by the shortest way round. */
  function goToEvent(i) {
    var cur = mod(Math.round(T), n);
    var d = mod(i - cur, n);
    if (d > n / 2) d -= n;
    T = Math.round(T) + d;
    updateRoving();
    wake();
  }

  /* ---------- timeline ---------- */
  var tl = { start: 0, end: 1 };
  function timeOf(e) { return cat.startOf(e).getTime(); }
  function frac(time) { return (time - tl.start) / (tl.end - tl.start); }

  function buildTimeline() {
    var DAY = 864e5;
    tl.start = timeOf(events[0]) - 6 * DAY;
    tl.end = timeOf(events[n - 1]) + 6 * DAY;
    var track = els.timeline;
    track.textContent = '';
    track.appendChild(el('span', 'explore-tl__line'));
    // month marks
    var d = new Date(tl.start);
    var m = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    var fmt = new Intl.DateTimeFormat('en-GB', { month: 'short' });
    var fmtY = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });
    // the starting month, labelled at the left edge (its 1st lies before the range)
    var startMark = el('span', 'explore-tl__month explore-tl__month--start');
    startMark.style.left = '0%';
    startMark.appendChild(el('span', 'explore-tl__label', fmtY.format(d)));
    track.appendChild(startMark);
    var first = false;
    while (m.getTime() < tl.end) {
      var mark = el('span', 'explore-tl__month');
      mark.style.left = (frac(m.getTime()) * 100).toFixed(3) + '%';
      mark.appendChild(el('span', 'explore-tl__label', (first || m.getMonth() === 0) ? fmtY.format(m) : fmt.format(m)));
      track.appendChild(mark);
      first = false;
      m = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    }
    // one tick per event
    events.forEach(function (e) {
      var tick = el('span', 'explore-tl__tick' + (e.featured ? ' is-featured' : ''));
      tick.style.left = (frac(timeOf(e)) * 100).toFixed(3) + '%';
      track.appendChild(tick);
    });
    els.dot = el('span', 'explore-tl__dot');
    track.appendChild(els.dot);
  }

  /** Dot glides between the dates of the events either side of s. */
  function updateDot(dt, reduced) {
    var i0 = mod(Math.floor(s), n), i1 = mod(i0 + 1, n);
    var f = s - Math.floor(s);
    var a = frac(timeOf(events[i0])), b = frac(timeOf(events[i1]));
    var target = i1 === 0 ? (f < 0.5 ? a : b) : a + (b - a) * f;   // wrap: jump at halfway
    if (!dotReady || reduced || Math.abs(target - dotX) > 0.3) dotX = target;
    else dotX += (target - dotX) * ease(14, dt);
    dotReady = true;
    els.dot.style.left = (dotX * 100).toFixed(3) + '%';
    return Math.abs(target - dotX) > 0.0005;
  }

  function onTimelineClick(e) {
    var r = els.timeline.getBoundingClientRect();
    var time = tl.start + (e.clientX - r.left) / r.width * (tl.end - tl.start);
    var best = 0, bestD = Infinity;
    events.forEach(function (ev, i) {
      var d = Math.abs(timeOf(ev) - time);
      if (d < bestD) { bestD = d; best = i; }
    });
    goToEvent(best);
  }

  /* ---------- posters ---------- */
  function buildPosters() {
    var frag = document.createDocumentFragment();
    for (var v = 0; v < M; v++) {
      var e = events[v % n];
      var b = el('button', 'explore-poster');
      b.type = 'button';
      b.setAttribute('data-event-id', e.id);
      b.setAttribute('aria-label', e.title + '. ' + e.category + ', ' + cat.dateLabel(e, true) + ', ' +
        e.venue.name + ', ' + e.venue.city + '. Event ' + ((v % n) + 1) + ' of ' + n + '.');
      b.setAttribute('aria-describedby', 'exploreHelp');

      var img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      img.width = 400; img.height = 600;
      img.sizes = '(max-width: 700px) 60vw, 300px';
      img.srcset = cat.imageUrl(e, 400, 600) + ' 400w, ' + cat.imageUrl(e, 800, 1200) + ' 800w';
      img.src = cat.imageUrl(e, 400, 600);
      img.addEventListener('error', function () { this.parentNode.classList.add('is-broken'); this.remove(); });
      b.appendChild(img);

      if (e.featured) b.appendChild(el('span', 'explore-poster__tag', 'Featured'));
      var text = el('span', 'explore-poster__text');
      text.setAttribute('aria-hidden', 'true');
      text.appendChild(el('span', 'explore-poster__cat', e.category));
      text.appendChild(el('span', 'explore-poster__title', e.title));
      text.appendChild(el('span', 'explore-poster__date', cat.dateLabel(e)));
      b.appendChild(text);
      b.setAttribute('data-fallback', e.category);

      frag.appendChild(b);
      posters.push({ el: b, v: v, e: e, lift: 0, liftT: 0, shown: true });
    }
    els.ring.appendChild(frag);
  }

  /* ---------- input ---------- */
  function bindInput() {
    var stage = els.stage;

    stage.addEventListener('click', function (ev) {
      var b = ev.target.closest('.explore-poster');
      if (!b) return;
      if (suppressClick) { ev.preventDefault(); return; }
      var p = posters[Array.prototype.indexOf.call(els.ring.children, b)];
      var r = rel(p.v, T);
      var keyboard = ev.detail === 0;
      if (Math.abs(r) < 0.5 && (keyboard || Math.abs(T - s) < 0.3)) openDetail(p);
      else glideTo(p.v);
    });

    stage.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowRight') { ev.preventDefault(); go(1); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); go(-1); }
      else if (ev.key === 'Home') { ev.preventDefault(); goToEvent(0); focusTarget(); }
      else if (ev.key === 'End') { ev.preventDefault(); goToEvent(n - 1); focusTarget(); }
    });

    // drag / swipe (vertical page scrolling stays native: touch-action pan-y)
    stage.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      drag = { id: ev.pointerId, x: ev.clientX, T0: T, active: false };
    });
    stage.addEventListener('pointermove', function (ev) {
      if (ev.pointerType === 'mouse') pointerTilt(ev);
      if (!drag || ev.pointerId !== drag.id) return;
      var dx = ev.clientX - drag.x;
      if (!drag.active && Math.abs(dx) > 5) {
        drag.active = true;
        stage.classList.add('is-dragging');
        try { stage.setPointerCapture(ev.pointerId); } catch (e) { /* not capturable */ }
      }
      if (drag.active) { T = drag.T0 - dx / stepPx(); wake(); }
    });
    function endDrag(ev) {
      if (!drag || (ev && ev.pointerId !== drag.id)) return;
      if (drag.active) {
        T = Math.round(T);
        suppressClick = true;
        setTimeout(function () { suppressClick = false; }, 0);
        updateRoving();
        wake();
      }
      stage.classList.remove('is-dragging');
      drag = null;
    }
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('pointerleave', function () { tiltXT = 0; tiltYT = 0; wake(); });

    // horizontal trackpad swipes move the arc; vertical wheel keeps scrolling the page
    stage.addEventListener('wheel', function (ev) {
      if (Math.abs(ev.deltaX) <= Math.abs(ev.deltaY) || detailOpen) return;
      ev.preventDefault();
      if (wheelFrom === null) wheelFrom = Math.round(T);
      T += ev.deltaX / stepPx() * 0.5;
      wake();
      clearTimeout(wheelTimer);
      // when the gesture ends, settle on a whole poster; any deliberate
      // nudge moves at least one, so a single notch is never swallowed
      wheelTimer = setTimeout(function () {
        var d = T - wheelFrom;
        T = wheelFrom + (Math.abs(d) < 0.02 ? 0 : sign(d) * Math.max(1, Math.round(Math.abs(d))));
        wheelFrom = null;
        updateRoving(); wake();
      }, 160);
    }, { passive: false });

    // hover lift on side posters
    stage.addEventListener('pointerover', function (ev) {
      var b = ev.target.closest('.explore-poster');
      posters.forEach(function (p) { p.liftT = (b && p.el === b && Math.abs(rel(p.v, s)) > 0.5) ? 1 : 0; });
      wake();
    });

    els.prev.addEventListener('click', function () { go(-1); });
    els.next.addEventListener('click', function () { go(1); });
    els.timeline.addEventListener('click', onTimelineClick);

    // the active poster's text in the caption opens the details too
    els.caption.addEventListener('click', function () { openDetail(posters[targetVirtual()]); });
  }

  /* Front poster leans toward the pointer; elsewhere a faint parallax. */
  function pointerTilt(ev) {
    var r = els.stage.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var onFront = Math.abs(ev.clientX - cx) < 0.55 * G.W && Math.abs(ev.clientY - cy) < 0.55 * G.H &&
      Math.abs(T - s) < 0.3 && !detailOpen;
    tiltYT = onFront ? (ev.clientX - cx) / (0.55 * G.W) * 8 : (ev.clientX - cx) / r.width * 4;
    tiltXT = onFront ? -(ev.clientY - cy) / (G.H / 2) * 5 : 0;
    els.stage.classList.toggle('is-over-front', onFront);
    wake();
  }

  /* =========================================================================
     DETAILS PANEL — grows out of the front poster, shrinks back on close
     ========================================================================= */
  var detailOpen = false, detailEvent = null, pushedState = false, closing = false, returnFocus = null;
  var EXPAND = { duration: 1050, easing: 'cubic-bezier(.76,0,.18,1)' };
  var COLLAPSE = { duration: 850, easing: 'cubic-bezier(.76,0,.18,1)' };

  function posterRectInset(p) {
    var r = p.el.getBoundingClientRect();
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    return 'inset(' + Math.max(0, r.top).toFixed(1) + 'px ' + Math.max(0, vw - r.right).toFixed(1) + 'px ' +
      Math.max(0, vh - r.bottom).toFixed(1) + 'px ' + Math.max(0, r.left).toFixed(1) + 'px round 10px)';
  }

  function fillDetail(e) {
    var d = els.detail;
    d.querySelector('[data-x="cat"]').textContent = e.category;
    d.querySelector('[data-x="title"]').textContent = e.title;
    var st = d.querySelector('[data-x="status"]');
    st.className = 'xd-line status status--' + e.registration.status;   // keep the rise-in line class
    st.lastChild.textContent = cat.statusLabel(e);
    d.querySelector('[data-x="date"]').textContent = cat.dateLabel(e, true);
    d.querySelector('[data-x="date"]').setAttribute('datetime', e.date);
    d.querySelector('[data-x="time"]').textContent = cat.timeLabel(e);
    d.querySelector('[data-x="time"]').setAttribute('datetime', cat.datetime(e));
    d.querySelector('[data-x="venue"]').textContent = e.venue.name + ', ' + e.venue.city;
    var price = d.querySelector('[data-x="price"]');
    price.textContent = e.price ? cat.priceLabel(e) : 'Free';
    d.querySelector('[data-x="desc"]').textContent = e.description;
    d.querySelector('[data-x="link"]').href = cat.detailUrl(e);
    // Register shortcut → the form on the event page (none when sold out)
    var reg = d.querySelector('[data-x="register"]');
    var regStatus = e.registration.status;
    reg.hidden = regStatus === 'sold-out';
    reg.href = cat.detailUrl(e) + '#register';
    reg.querySelector('span').textContent = regStatus === 'waitlist' ? 'Join the waitlist' : 'Register now';
    var fig = d.querySelector('[data-x="media"]');
    fig.classList.remove('is-broken');
    fig.setAttribute('data-fallback', e.category);
    var img = fig.querySelector('img');
    img.alt = e.image.alt;
    img.srcset = cat.imageUrl(e, 600, 900) + ' 600w, ' + cat.imageUrl(e, 1000, 1500) + ' 1000w';
    img.src = cat.imageUrl(e, 600, 900);
    d.querySelector('[data-x="tag"]').hidden = !e.featured;
  }

  function lockPage(on) {
    document.documentElement.classList.toggle('is-locked', on);
    // everything except the dialog becomes inert (focus can't leave it)
    ['main', '.navlayer', '.site-footer', '.wa', '.skip-link'].forEach(function (sel) {
      var node = document.querySelector(sel);
      if (node) { if (on) node.setAttribute('inert', ''); else node.removeAttribute('inert'); }
    });
  }

  function openDetail(p, opts) {
    opts = opts || {};
    if (!p || detailOpen) return;
    detailOpen = true;
    detailEvent = p.e;
    returnFocus = p.el;
    tiltXT = tiltYT = 0;
    T = Math.round(T);
    fillDetail(p.e);

    var panel = els.detail, sheet = els.sheet;
    panel.hidden = false;
    lockPage(true);
    if (!opts.fromHistory) {
      history.pushState({ exploreEvent: p.e.id }, '', '#event=' + encodeURIComponent(p.e.id));
      pushedState = true;
    }

    var reduced = reducedMotion() || !sheet.animate;
    var lines = Array.prototype.slice.call(panel.querySelectorAll('.xd-line'));
    var media = panel.querySelector('[data-x="media"]');
    if (!reduced) {
      sheet.animate([{ clipPath: posterRectInset(p) }, { clipPath: 'inset(0px 0px 0px 0px round 0px)' }],
        { duration: EXPAND.duration, easing: EXPAND.easing, fill: 'both' });
      lines.forEach(function (line, i) {
        line.animate([{ transform: 'translateY(110%)' }, { transform: 'translateY(0)' }],
          { duration: 900, delay: 620 + i * 75, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
      });
      media.animate([{ clipPath: 'circle(0% at 50% 55%)' }, { clipPath: 'circle(75% at 50% 55%)' }],
        { duration: 1150, delay: 520, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'both' });
    }
    els.closeBtn.focus({ preventScroll: true });
    els.stage.classList.remove('is-over-front');
  }

  function closeDetail(opts) {
    opts = opts || {};
    if (!detailOpen || closing) return;
    // a close we caused ourselves first unwinds the history entry we added
    if (!opts.fromHistory && pushedState) { history.back(); return; }
    // arrived via a shared #event= link: drop the hash so a refresh doesn't reopen it
    if (!opts.fromHistory && hashEventId()) history.replaceState(null, '', location.pathname + location.search);
    closing = true;
    pushedState = false;
    var panel = els.detail, sheet = els.sheet;
    var p = posters[targetVirtual()] || returnFocus;

    var finish = function () {
      panel.getAnimations({ subtree: true }).forEach(function (a) { a.cancel(); });
      panel.hidden = true;
      lockPage(false);
      detailOpen = false;
      closing = false;
      var f = posters[targetVirtual()];
      if (f) f.el.focus({ preventScroll: true });
    };
    if (reducedMotion() || !sheet.animate) { finish(); return; }
    panel.getAnimations({ subtree: true }).forEach(function (a) { a.cancel(); });
    var a = sheet.animate([{ clipPath: 'inset(0px 0px 0px 0px round 0px)' }, { clipPath: posterRectInset(p) }],
      { duration: COLLAPSE.duration, easing: COLLAPSE.easing, fill: 'both' });
    a.onfinish = finish;
    a.oncancel = finish;
  }

  function onPopState() {
    var id = (history.state && history.state.exploreEvent) || hashEventId();
    if (id && !detailOpen) {
      var i = eventIndex(id);
      if (i >= 0) { goToEvent(i); s = T; place(); openDetail(posters[targetVirtual()], { fromHistory: true }); }
    } else if (!id && detailOpen) {
      closeDetail({ fromHistory: true });
    }
  }

  function hashEventId() {
    var m = /^#event=([a-z0-9-]+)$/.exec(location.hash);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function eventIndex(id) {
    for (var i = 0; i < n; i++) if (events[i].id === id) return i;
    return -1;
  }

  function bindDetail() {
    els.closeBtn.addEventListener('click', function () { closeDetail(); });
    els.detail.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); closeDetail(); }
    });
    window.addEventListener('popstate', onPopState);
  }

  /* ---------- public ---------- */
  Eventora.exploreCarousel = {
    init: function () {
      els.section = document.getElementById('featured');
      els.stage = document.getElementById('exploreStage');
      els.ring = document.getElementById('exploreRing');
      els.probe = document.getElementById('exploreProbe');
      els.glow = document.getElementById('exploreGlow');
      els.caption = document.getElementById('exploreCaption');
      els.capTitle = document.getElementById('exploreCapTitle');
      els.capMeta = document.getElementById('exploreCapMeta');
      els.prev = document.getElementById('explorePrev');
      els.next = document.getElementById('exploreNext');
      els.timeline = document.getElementById('exploreTimeline');
      els.live = document.getElementById('exploreLive');
      els.detail = document.getElementById('exploreDetail');
      els.sheet = document.getElementById('exploreSheet');
      els.closeBtn = document.getElementById('exploreClose');
      if (!cat || !els.stage || !els.ring) return;
      els.stage.tabIndex = -1;   // can hold focus briefly during long jumps (no ring: [tabindex=-1])

      events = cat.programme();
      n = events.length; M = n * COPIES;
      buildPosters();
      buildTimeline();
      measure();

      // open on the soonest featured event, centred in the middle copy
      var start = 0;
      for (var i = 0; i < n; i++) if (events[i].featured) { start = i; break; }
      s = T = n + start;
      place();
      updateActive();
      updateDot(0, true);
      updateRoving();

      bindInput();
      bindDetail();
      window.addEventListener('resize', function () { measure(); place(); });

      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
          visible = entries[0].isIntersecting;
          if (visible) wake();
        }).observe(els.stage);
      }

      // deep link: index.html#event=<id> opens that event's panel
      var id = hashEventId();
      if (id && eventIndex(id) >= 0) {
        goToEvent(eventIndex(id)); s = T; place(); updateActive();
        history.replaceState({ exploreEvent: id }, '', location.href);
        requestAnimationFrame(function () {
          els.section.scrollIntoView({ block: 'start' });
          openDetail(posters[targetVirtual()], { fromHistory: true });
          pushedState = false;
        });
      }
    },
    // exposed for tests
    state: function () { return { s: s, T: T, active: activeIndex, open: detailOpen, event: events[activeIndex] && events[activeIndex].id }; },
    next: function () { go(1); },
    prev: function () { go(-1); },
    goTo: goToEvent,
    open: function () { openDetail(posters[targetVirtual()]); },
    close: function () { closeDetail(); }
  };
})(window.Eventora);
