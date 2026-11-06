/* =========================================================================
   MY REGISTRATIONS — my-registrations.html

   Shows the current guest's registrations (js/identity.js decides who that
   is; js/registrations.js holds the records; event details always come from
   the catalogue in js/events.js by eventId).

   - Upcoming / Past tabs. "Past" = the event's date is before today.
   - Status shown: Confirmed, Cancelled, or Completed (a confirmed booking
     whose event date has passed — derived, never stored).
   - A registration whose event is missing from the catalogue still appears,
     with a fallback poster and its booking details.
   - Details open in a modal <dialog>: poster, event facts, registration
     facts and the check-in QR code; print / save as PDF; cancel (with a
     confirmation step) for confirmed upcoming bookings.
   - my-registrations.html#EVR-XXXX-XXXX opens that booking directly.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var cat = Eventora.events;
  var store = Eventora.registrations;
  var identity = Eventora.identity;

  var els = {};
  var tab = 'upcoming';
  var openId = null, returnFocus = null;

  /* Clock, overridable from tests to check Past/Completed behaviour. */
  var clock = function () { return new Date(); };

  function $(root, sel) { return root.querySelector(sel); }
  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function reduced() { return Eventora.motion && Eventora.motion.reduced ? Eventora.motion.reduced() : false; }

  var fmtStamp = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  function stamp(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '—' : fmtStamp.format(d);
  }

  /* ---------- view model ---------- */
  function dayKey(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

  /** Everything the page needs about one registration, in one place. */
  function describe(r) {
    var ev = cat.byId(r.eventId);
    var past = !!ev && dayKey(cat.startOf(ev)) < dayKey(clock());
    var state = r.status === 'cancelled' ? 'cancelled' : (past ? 'completed' : 'confirmed');
    return {
      r: r,
      ev: ev,
      past: past,
      state: state,
      label: { confirmed: 'Confirmed', cancelled: 'Cancelled', completed: 'Completed' }[state],
      canCancel: state === 'confirmed',
      title: ev ? ev.title : 'Event no longer listed',
      when: ev ? cat.dateLabel(ev, true) + ' · ' + cat.timeLabel(ev) : 'Date unavailable',
      where: ev ? ev.venue.name + ', ' + ev.venue.city : 'Event ID: ' + r.eventId
    };
  }

  function mine() {
    var u = identity.current();
    if (!u) return [];
    return store.all().filter(function (r) { return identity.owns(r); }).map(describe);
  }

  function sortItems(items, past) {
    return items.sort(function (a, b) {
      if (!a.ev || !b.ev) return (a.ev ? -1 : 0) + (b.ev ? 1 : 0);      // missing events last
      var d = cat.startOf(a.ev) - cat.startOf(b.ev);
      return past ? -d : d;                                               // past: most recent first
    });
  }

  /* ---------- rendering ---------- */
  function render() {
    var u = identity.current();
    els.who.hidden = !u;
    els.find.hidden = !!u;
    els.board.hidden = !u;
    if (!u) return;

    $(els.who, '[data-who="email"]').textContent = u.email;
    $(els.who, '[data-who="initial"]').textContent = (u.name || u.email).trim().charAt(0).toUpperCase();

    var items = mine();
    var groups = {
      upcoming: sortItems(items.filter(function (x) { return !x.past; }), false),
      past: sortItems(items.filter(function (x) { return x.past; }), true)
    };
    ['upcoming', 'past'].forEach(function (k) {
      $(els.board, '[data-count="' + k + '"]').textContent = groups[k].length;
      var ul = $(els.board, '[data-list="' + k + '"]');
      ul.textContent = '';
      if (!groups[k].length) ul.appendChild(emptyState(k, items.length));
      groups[k].forEach(function (x, i) { ul.appendChild(card(x, i)); });
    });
  }

  function emptyState(k, total) {
    var li = el('li', 'mr-empty');
    var icon = el('span', 'mr-empty__icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
    li.appendChild(icon);
    if (!total) {
      li.appendChild(el('p', 'heading-3', 'No registrations yet'));
      li.appendChild(el('p', 'mr-empty__text', 'When you book an event with this email, it will show up here with its check-in QR code.'));
    } else if (k === 'upcoming') {
      li.appendChild(el('p', 'heading-3', 'Nothing coming up'));
      li.appendChild(el('p', 'mr-empty__text', 'You have no upcoming bookings. Your past events are in the Past tab.'));
    } else {
      li.appendChild(el('p', 'heading-3', 'No past events yet'));
      li.appendChild(el('p', 'mr-empty__text', 'Events you attend will move here after their date.'));
    }
    var a = el('a', 'btn btn--md');
    a.href = 'index.html#featured';
    a.appendChild(el('span', '', 'Explore events'));
    li.appendChild(a);
    return li;
  }

  function statusChip(x, cls) {
    var p = el('p', 'mr-status mr-status--' + x.state + (cls ? ' ' + cls : ''));
    var dot = el('span', 'mr-status__dot');
    dot.setAttribute('aria-hidden', 'true');
    p.appendChild(dot);
    p.appendChild(el('span', '', x.label));
    return p;
  }

  function poster(fig, x, w, h) {
    fig.classList.toggle('is-missing', !x.ev);
    fig.setAttribute('data-fallback', x.ev ? x.ev.category : '?');
    var img = fig.querySelector('img') || fig.appendChild(new Image());
    if (!x.ev) { img.hidden = true; img.removeAttribute('src'); img.alt = ''; return; }
    img.hidden = false;
    img.alt = x.ev.image.alt;
    img.onerror = function () { fig.classList.add('is-broken'); img.hidden = true; };
    fig.classList.remove('is-broken');
    img.src = cat.imageUrl(x.ev, w, h);
  }

  function card(x, i) {
    var li = el('li', 'mr-card mr-card--' + x.state);
    li.style.setProperty('--i', i);
    var fig = el('figure', 'mr-card__poster');
    var img = new Image();
    img.decoding = 'async'; img.loading = 'lazy'; img.width = 200; img.height = 300;
    fig.appendChild(img);
    poster(fig, x, 200, 300);
    li.appendChild(fig);

    var body = el('div', 'mr-card__body');
    body.appendChild(statusChip(x));
    var h = el('h3', 'mr-card__title');
    var btn = el('button', 'mr-card__open', x.title);
    btn.type = 'button';
    btn.setAttribute('data-open', x.r.id);
    btn.setAttribute('aria-label', x.title + ', ' + x.label + ', ' + x.when + '. Registration ' + x.r.id + '. Show details');
    h.appendChild(btn);
    body.appendChild(h);
    body.appendChild(el('p', 'mr-card__meta', x.when));
    body.appendChild(el('p', 'mr-card__meta mr-card__meta--venue', x.where));
    var id = el('p', 'mr-card__id');
    id.appendChild(el('span', 'mr-card__id-label', 'ID'));
    id.appendChild(el('code', '', x.r.id));
    if (x.r.type === 'waitlist') id.appendChild(el('span', 'mr-tag', 'Waitlist'));
    body.appendChild(id);
    li.appendChild(body);

    var go = el('span', 'mr-card__go');
    go.setAttribute('aria-hidden', 'true');
    go.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
    li.appendChild(go);
    return li;
  }

  /* ---------- tabs (WAI-ARIA tabs pattern) ---------- */
  function selectTab(k, focus) {
    tab = k;
    ['upcoming', 'past'].forEach(function (name) {
      var on = name === k;
      var t = els[name + 'Tab'], p = els[name + 'Panel'];
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      p.hidden = !on;
      if (on && !reduced() && p.animate) {
        p.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)' });
      }
    });
    if (focus) els[k + 'Tab'].focus();
  }

  /* ---------- details dialog ---------- */
  function m(key) { return $(els.dialog, '[data-m="' + key + '"]'); }

  function fillDetails(x) {
    var r = x.r, ev = x.ev;
    poster(m('poster'), x, 600, 900);
    m('cat').textContent = ev ? ev.category : 'Registration';
    m('title').textContent = x.title;
    var st = m('status');
    st.className = 'mr-status mr-status--' + x.state;
    m('statusText').textContent = x.label;
    m('missing').hidden = !!ev;
    m('facts').hidden = !ev;
    m('desc').hidden = !ev;
    if (ev) {
      m('date').textContent = cat.dateLabel(ev, true);
      m('time').textContent = cat.timeLabel(ev);
      m('venue').textContent = ev.venue.name + ', ' + ev.venue.city;
      m('price').textContent = ev.price ? cat.priceLabel(ev) : 'Free';
      m('desc').textContent = ev.description;
    }
    m('id').textContent = r.id;
    var qr = m('qr');
    qr.textContent = '';
    try { qr.appendChild(Eventora.qr.svg(r.id, { label: 'QR code for registration ' + r.id, dark: '#05070b' })); qr.hidden = false; }
    catch (err) { qr.hidden = true; }
    qr.classList.toggle('is-void', x.state === 'cancelled');
    m('hint').textContent = x.state === 'cancelled' ? 'Cancelled — this code is no longer valid for entry.'
      : x.state === 'completed' ? 'This event has taken place.' : 'Show this QR code at check-in.';
    m('name').textContent = r.name;
    m('email').textContent = r.email;
    m('phone').textContent = r.phone;
    m('type').textContent = r.type === 'waitlist' ? 'Waitlist' : 'Registration';
    m('created').textContent = stamp(r.createdAt);
    var cancelled = x.state === 'cancelled' && r.cancelledAt;
    m('cancelledLabel').hidden = !cancelled;
    m('cancelled').hidden = !cancelled;
    if (cancelled) m('cancelled').textContent = stamp(r.cancelledAt);
    var link = m('eventLink');
    link.hidden = !ev;
    if (ev) link.href = cat.detailUrl(ev);
    m('cancel').hidden = !x.canCancel;
    m('confirmText').textContent = 'Your place at ' + x.title + (ev ? ' on ' + cat.dateLabel(ev, true) : '') +
      ' will be released. The booking and its ID ' + r.id + ' stay in your history.';
    showConfirm(false);
  }

  function find(id) {
    var r = store.byId(id);
    return r && identity.owns(r) ? describe(r) : null;
  }

  function openDetails(id, opener) {
    var x = find(id);
    if (!x) return false;
    openId = id;
    returnFocus = opener || document.activeElement;
    fillDetails(x);
    if (!els.dialog.open) {
      els.dialog.classList.remove('is-closing');
      els.dialog.showModal();
      document.documentElement.classList.add('mr-locked');
    }
    els.dialog.scrollTop = 0;
    $(els.dialog, '[data-close]').focus();
    if (location.hash !== '#' + id) history.replaceState(null, '', location.pathname + location.search + '#' + id);
    return true;
  }

  function closeDetails() {
    if (!els.dialog.open) return;
    var finish = function () {
      els.dialog.classList.remove('is-closing');
      els.dialog.close();
      document.documentElement.classList.remove('mr-locked');
      openId = null;
      history.replaceState(null, '', location.pathname + location.search);
      // focus the card for this booking (it may have been re-rendered)
      var target = returnFocus && document.contains(returnFocus) ? returnFocus : null;
      if (!target && returnFocus && returnFocus.getAttribute) {
        target = document.querySelector('[data-open="' + returnFocus.getAttribute('data-open') + '"]');
      }
      if (target) target.focus({ preventScroll: true });
    };
    if (reduced()) { finish(); return; }
    els.dialog.classList.add('is-closing');
    setTimeout(finish, 220);
  }

  function showConfirm(on) {
    m('confirm').hidden = !on;
    m('actions').hidden = on;
    if (on) m('keep').focus();
  }

  function doCancel() {
    var res = store.cancel(openId);
    if (!res.ok) { els.status.textContent = 'That registration could not be found.'; return; }
    var refocusId = returnFocus && returnFocus.getAttribute ? returnFocus.getAttribute('data-open') : null;
    render();
    if (refocusId) returnFocus = document.querySelector('[data-open="' + refocusId + '"]');
    fillDetails(describe(res.record));
    els.status.textContent = 'Registration ' + res.record.id + ' cancelled.' +
      (res.saved ? '' : ' This browser is not allowing storage, so the change will be lost when you leave.');
    var st = m('status');
    st.setAttribute('tabindex', '-1');
    st.focus();
    if (!reduced() && st.animate) st.animate([{ transform: 'scale(.92)', opacity: .4 }, { transform: 'none', opacity: 1 }], { duration: 360, easing: 'cubic-bezier(.16,1,.3,1)' });
  }

  /* ---------- lookup ---------- */
  function lookup(ev) {
    ev.preventDefault();
    var input = els.email, err = els.emailError;
    var v = input.value.trim();
    var msg = '';
    if (!v) msg = 'Enter the email address you registered with.';
    else if (v.length > 254 || !/^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]{2,}$/.test(v)) msg = 'Enter an email address like name@example.com.';
    else if (!store.forEmail(v).length) msg = 'We couldn’t find any registrations for ' + v + ' in this browser.';
    err.textContent = msg;
    err.hidden = !msg;
    input.closest('.field').classList.toggle('is-invalid', !!msg);
    if (msg) { input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    input.removeAttribute('aria-invalid');
    var latest = store.forEmail(v).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; })[0];
    identity.signInGuest(v, latest.name);
    selectTab('upcoming');
    els.status.textContent = 'Showing registrations for ' + identity.current().email + '.';
    els.board.querySelector('.mr-tab[aria-selected="true"]').focus();
  }

  /* ---------- wiring ---------- */
  function bind() {
    els.board.addEventListener('click', function (e) {
      var b = e.target.closest('[data-open]');
      if (b) { openDetails(b.getAttribute('data-open'), b); return; }
      var cardEl = e.target.closest('.mr-card');      // whole card is clickable
      if (cardEl) { var open = $(cardEl, '[data-open]'); openDetails(open.getAttribute('data-open'), open); }
    });
    [els.upcomingTab, els.pastTab].forEach(function (t) {
      t.addEventListener('click', function () { selectTab(t === els.pastTab ? 'past' : 'upcoming'); });
      t.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          var next = (e.key === 'Home') ? 'upcoming' : (e.key === 'End') ? 'past' : (tab === 'upcoming' ? 'past' : 'upcoming');
          selectTab(next, true);
        }
      });
    });
    els.findForm.addEventListener('submit', lookup);
    els.switchBtn.addEventListener('click', function () {
      identity.signOut();
      els.email.value = '';
      els.status.textContent = 'Signed out of guest bookings.';
      els.email.focus();
    });
    identity.onChange(render);

    $(els.dialog, '[data-close]').addEventListener('click', closeDetails);
    els.dialog.addEventListener('cancel', function (e) { e.preventDefault(); closeDetails(); });   // Escape
    els.dialog.addEventListener('click', function (e) { if (e.target === els.dialog) closeDetails(); });   // backdrop
    m('print').addEventListener('click', function () { window.print(); });
    m('cancel').addEventListener('click', function () { showConfirm(true); });
    m('keep').addEventListener('click', function () { showConfirm(false); m('cancel').focus(); });
    m('confirmCancel').addEventListener('click', doCancel);

    // another tab registered, cancelled or switched guest → stay in sync
    window.addEventListener('storage', function (e) {
      if (e.key !== store.KEY && e.key !== identity.KEY) return;
      render();
      if (openId) { var x = find(openId); if (x) fillDetails(x); else closeDetails(); }
    });
    window.addEventListener('hashchange', openFromHash);
  }

  function openFromHash() {
    var id = decodeURIComponent(location.hash.slice(1));
    if (/^EVR-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(id) && id !== openId) {
      var x = find(id);
      if (x) { selectTab(x.past ? 'past' : 'upcoming'); openDetails(id, document.querySelector('[data-open="' + id + '"]')); }
    }
  }

  Eventora.myRegistrations = {
    init: function () {
      els.dialog = document.getElementById('mrDialog');
      if (!els.dialog || !cat || !store || !identity) return;
      els.who = document.getElementById('mrWho');
      els.find = document.getElementById('mrFind');
      els.board = document.getElementById('mrBoard');
      els.findForm = document.getElementById('mrFindForm');
      els.email = document.getElementById('mrEmail');
      els.emailError = document.getElementById('mrEmailError');
      els.switchBtn = document.getElementById('mrSwitch');
      els.status = document.getElementById('mrStatus');
      els.upcomingTab = document.getElementById('mrTabUpcoming');
      els.pastTab = document.getElementById('mrTabPast');
      els.upcomingPanel = document.getElementById('mrPanelUpcoming');
      els.pastPanel = document.getElementById('mrPanelPast');
      bind();
      render();
      openFromHash();
    },
    /** Test hook: pretend today is `date`, then re-render. */
    _setClock: function (date) { clock = date ? function () { return new Date(date); } : function () { return new Date(); }; render(); },
    render: render,
    open: openDetails,
    close: closeDetails
  };
})(window.Eventora);
