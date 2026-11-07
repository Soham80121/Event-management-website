/* =========================================================================
   EVENT DETAILS — the one canonical event-details experience.

   The cinematic panel that grows out of the poster you selected (clip-path
   expansion, rising text lines, circular photo reveal) and shrinks back into
   it on close. Moved here unchanged from the Explore carousel so EVERY entry
   point uses it: carousel posters, Upcoming / search / category cards, and
   links from other pages (index.html#event=<id>).

   It shows everything about the event (category, title, availability, date,
   time, venue, price, description, poster) and handles registration inside
   the panel (js/registration-form.js): visitors are sent to sign in and come
   back to this panel with the form open; signed-in users register here.

   URLs and history:
     index.html#event=<id>            opens the panel (shareable)
     index.html#event=<id>&register   opens it with the registration form
     Opening pushes a history entry, so Back closes the panel; Close and
     Escape do the same. event.html?id=<id> (old links) redirects here.

   Origins: open(id, { origin }) grows from that element's rect. Other code
   can register an origin provider (the carousel glides to the event and
   returns its front poster) for deep links and Back/Forward.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var cat = Eventora.events;
  var els = {};
  var isOpen = false, closing = false, pushedState = false;
  var current = null, originEl = null, returnFocus = null;
  var providers = [];
  var EXPAND = { duration: 1050, easing: 'cubic-bezier(.76,0,.18,1)' };
  var COLLAPSE = { duration: 850, easing: 'cubic-bezier(.76,0,.18,1)' };

  function reducedMotion() { return Eventora.motion && Eventora.motion.reduced ? Eventora.motion.reduced() : false; }
  function $(sel) { return els.panel.querySelector(sel); }

  /* ---------- geometry ---------- */
  function rectInset(el) {
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (!r || r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > vh) {
      // no visible origin: grow from a poster-sized rect in the middle
      var w = Math.min(240, vw * 0.4), h = w * 1.5;
      r = { left: (vw - w) / 2, right: (vw + w) / 2, top: (vh - h) / 2, bottom: (vh + h) / 2 };
    }
    return 'inset(' + Math.max(0, r.top).toFixed(1) + 'px ' + Math.max(0, vw - r.right).toFixed(1) + 'px ' +
      Math.max(0, vh - r.bottom).toFixed(1) + 'px ' + Math.max(0, r.left).toFixed(1) + 'px round 10px)';
  }

  /* ---------- content ---------- */
  function availability(e) {
    var r = e.registration;
    if (r.status === 'limited' && r.spotsLeft) return r.spotsLeft + ' spots left';
    return { open: 'Spots available', limited: 'Few spots left', waitlist: 'Full · waitlist open', 'sold-out': 'Sold out' }[r.status] || '';
  }

  function fill(e) {
    $('[data-x="cat"]').textContent = e.category + (e.hostedBy ? ' · Hosted by ' + e.hostedBy : '');
    $('[data-x="title"]').textContent = e.title;
    var st = $('[data-x="status"]');
    st.className = 'xd-line status status--' + e.registration.status;   // keep the rise-in line class
    st.lastChild.textContent = cat.statusLabel(e);
    $('[data-x="date"]').textContent = cat.dateLabel(e, true);
    $('[data-x="date"]').setAttribute('datetime', e.date);
    $('[data-x="time"]').textContent = cat.timeLabel(e);
    $('[data-x="time"]').setAttribute('datetime', cat.datetime(e));
    $('[data-x="venue"]').textContent = e.venue.name + ', ' + e.venue.city;
    $('[data-x="price"]').textContent = e.price ? cat.priceLabel(e) : 'Free';
    $('[data-x="spots"]').textContent = availability(e);
    $('[data-x="desc"]').textContent = e.description;
    var fig = $('[data-x="media"]');
    fig.classList.remove('is-broken');
    fig.setAttribute('data-fallback', e.category);
    var img = fig.querySelector('img');
    img.alt = e.image.alt;
    img.srcset = cat.imageUrl(e, 600, 900) + ' 600w, ' + cat.imageUrl(e, 1000, 1500) + ' 1000w';
    img.src = cat.imageUrl(e, 600, 900);
    $('[data-x="tag"]').hidden = !e.featured;

    // registration lives inside the panel (Register now, form, confirmation)
    if (Eventora.registrationForm && Eventora.registrationForm.attach) {
      Eventora.registrationForm.attach({
        event: e,
        cta: $('[data-x="actions"]'),
        host: $('[data-x="register-host"]'),
        returnTo: 'index.html#event=' + encodeURIComponent(e.id) + '&register'
      });
    }
  }

  /* ---------- page lock (everything but the panel is inert) ---------- */
  function lockPage(on) {
    document.documentElement.classList.toggle('is-locked', on);
    ['main', '.navlayer', '.site-footer', '.wa', '.skip-link'].forEach(function (sel) {
      var node = document.querySelector(sel);
      if (node) { if (on) node.setAttribute('inert', ''); else node.removeAttribute('inert'); }
    });
  }

  /* ---------- open / close (the original cinematic animation) ---------- */
  function open(id, opts) {
    opts = opts || {};
    var e = cat.byId(id);
    if (!e || isOpen || !els.panel) return false;
    isOpen = true;
    current = e;
    originEl = opts.origin || null;
    returnFocus = opts.returnFocus || originEl;
    fill(e);

    var panel = els.panel, sheet = els.sheet;
    panel.hidden = false;
    sheet.scrollTop = 0;
    lockPage(true);
    if (!opts.fromHistory) {
      history.pushState({ eventDetail: e.id }, '', '#event=' + encodeURIComponent(e.id));
      pushedState = true;
    }

    var reduced = reducedMotion() || !sheet.animate;
    var lines = Array.prototype.slice.call(panel.querySelectorAll('.xd-line'));
    var media = $('[data-x="media"]');
    if (!reduced) {
      sheet.animate([{ clipPath: rectInset(originEl) }, { clipPath: 'inset(0px 0px 0px 0px round 0px)' }],
        { duration: EXPAND.duration, easing: EXPAND.easing, fill: 'both' });
      lines.forEach(function (line, i) {
        line.animate([{ transform: 'translateY(110%)' }, { transform: 'translateY(0)' }],
          { duration: 900, delay: 620 + i * 75, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
      });
      media.animate([{ clipPath: 'circle(0% at 50% 55%)' }, { clipPath: 'circle(75% at 50% 55%)' }],
        { duration: 1150, delay: 520, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'both' });
    }
    els.closeBtn.focus({ preventScroll: true });

    if (opts.register && Eventora.registrationForm) {
      // after the expansion, go straight to the form (or to sign in)
      setTimeout(function () { if (isOpen && current === e) Eventora.registrationForm.start(); },
        reduced ? 0 : EXPAND.duration);
    }
    return true;
  }

  function close(opts) {
    opts = opts || {};
    if (!isOpen || closing) return;
    // a close we caused ourselves first unwinds the history entry we added
    if (!opts.fromHistory && pushedState) { history.back(); return; }
    // arrived via a shared #event= link: drop the hash so a refresh doesn't reopen it
    if (!opts.fromHistory && hashState()) history.replaceState(null, '', location.pathname + location.search);
    closing = true;
    pushedState = false;
    var panel = els.panel, sheet = els.sheet;
    var target = originFor(current.id, true) || originEl;

    var finish = function () {
      panel.getAnimations({ subtree: true }).forEach(function (a) { a.cancel(); });
      panel.hidden = true;
      lockPage(false);
      isOpen = false;
      closing = false;
      var f = (returnFocus && document.contains(returnFocus)) ? returnFocus : target;
      if (f && f.focus) f.focus({ preventScroll: true });
      current = null;
    };
    if (reducedMotion() || !sheet.animate) { finish(); return; }
    panel.getAnimations({ subtree: true }).forEach(function (a) { a.cancel(); });
    var a = sheet.animate([{ clipPath: 'inset(0px 0px 0px 0px round 0px)' }, { clipPath: rectInset(target) }],
      { duration: COLLAPSE.duration, easing: COLLAPSE.easing, fill: 'both' });
    a.onfinish = finish;
    a.oncancel = finish;
  }

  /* ---------- origins ---------- */
  /** Ask registered providers for an element to grow from / shrink into. */
  function originFor(id, closingNow) {
    if (closingNow && originEl && document.contains(originEl) && originEl.getBoundingClientRect().height > 0) {
      var r = originEl.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) return originEl;
    }
    // an event card for this event that's already on screen (no scrolling)
    var cards = document.querySelectorAll('.event-card[data-event-id="' + id + '"] .event-card__media');
    for (var c = 0; c < cards.length; c++) {
      var cr = cards[c].getBoundingClientRect();
      if (cr.height > 0 && cr.top >= 0 && cr.bottom <= window.innerHeight) return cards[c];
    }
    for (var i = 0; i < providers.length; i++) {
      var el = null;
      try { el = providers[i](id, !!closingNow); } catch (err) { el = null; }
      if (el) return el;
    }
    return null;
  }

  /* ---------- history ---------- */
  function hashState() {
    var m = /^#event=([a-z0-9-]+)(&register)?$/.exec(location.hash);
    return m ? { id: decodeURIComponent(m[1]), register: !!m[2] } : null;
  }

  function onPopState() {
    var h = (history.state && history.state.eventDetail) ? { id: history.state.eventDetail } : hashState();
    if (h && !isOpen) {
      open(h.id, { fromHistory: true, origin: originFor(h.id, false), register: h.register });
    } else if (!h && isOpen) {
      close({ fromHistory: true });
    }
  }

  /* ---------- cards: open in place instead of navigating ---------- */
  function onDocumentClick(ev) {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var a = ev.target.closest && ev.target.closest('a[href]');
    if (!a || els.panel.contains(a)) return;
    var m = /(?:^|\/)(?:index\.html)?#event=([a-z0-9-]+)$/.exec(a.getAttribute('href'));
    if (!m || !cat.byId(m[1])) return;
    ev.preventDefault();
    var card = a.closest('.event-card');
    var origin = card ? (card.querySelector('.event-card__media') || card) : a;
    open(m[1], { origin: origin, returnFocus: a });
  }

  Eventora.eventDetail = {
    init: function () {
      els.panel = document.getElementById('exploreDetail');
      els.sheet = document.getElementById('exploreSheet');
      els.closeBtn = document.getElementById('exploreClose');
      if (!els.panel || !cat) return;
      els.closeBtn.addEventListener('click', function () { close(); });
      els.panel.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); close(); }
      });
      window.addEventListener('popstate', onPopState);
      document.addEventListener('click', onDocumentClick);

      // deep link: index.html#event=<id>[&register]
      var h = hashState();
      if (h && cat.byId(h.id)) {
        history.replaceState({ eventDetail: h.id }, '', location.pathname + location.search + '#event=' + encodeURIComponent(h.id));
        requestAnimationFrame(function () {
          open(h.id, { fromHistory: true, origin: originFor(h.id, false), register: h.register });
          pushedState = false;
        });
      }
    },
    open: open,
    close: function () { close(); },
    isOpen: function () { return isOpen; },
    current: function () { return current; },
    /** fn(eventId, closing) → element to grow from / shrink into, or null. */
    addOriginProvider: function (fn) { if (typeof fn === 'function') providers.push(fn); },
    url: function (id) { return 'index.html#event=' + encodeURIComponent(id); }
  };
})(window.Eventora);
