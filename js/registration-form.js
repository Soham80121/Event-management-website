/* =========================================================================
   REGISTRATION FORM — event.html

   - "Register now" CTA in the event details (or "Join the waitlist"; sold-out
     events show a closed notice and no form).
   - The CTA reveals the form below the details, scrolls to it and focuses
     the first field. event.html?id=<id>#register opens it directly.
   - Inline validation: on blur once a field has been visited, live while a
     field shows an error, and for every field on submit (focus moves to the
     first problem). Errors are tied to inputs with aria-invalid and
     aria-describedby.
   - Submission: guarded against double submits; the email is unique per
     event, so a repeat submission returns the existing registration instead
     of creating another.
   - Confirmation: event, registration ID with a check-in QR code, and the
     booking details.
   Storage lives in js/registrations.js.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var cat = Eventora.events;
  var store = Eventora.registrations;

  var event = null, kind = 'registration';
  var section, form, views, fields, cta, ctaBtn, mine, status, submitBtn;
  var busy = false;

  function $(root, sel) { return root.querySelector(sel); }
  function reduced() { return Eventora.motion && Eventora.motion.reduced ? Eventora.motion.reduced() : false; }
  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* ---------- validation rules (messages say how to fix it) ---------- */
  var RULES = {
    name: function (v) {
      var s = store.normName(v);
      if (!s) return 'Enter your full name.';
      if (s.length < 2) return 'Your name needs at least 2 characters.';
      if (!/^[\p{L}\p{M}' .\-’]+$/u.test(s) || !/\p{L}/u.test(s)) {
        return 'Use letters, spaces, hyphens and apostrophes only.';
      }
      return '';
    },
    email: function (v) {
      var s = String(v || '').trim();
      if (!s) return 'Enter your email address.';
      if (s.length > 254 || !/^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]{2,}$/.test(s)) {
        return 'Enter an email address like name@example.com.';
      }
      return '';
    },
    phone: function (v) {
      var s = String(v || '').trim();
      if (!s) return 'Enter your phone number.';
      var digits = s.replace(/\D/g, '').length;
      if (!/^\+?[\d\s().\-]+$/.test(s) || digits < 7 || digits > 15) {
        return 'Enter a valid phone number with 7 to 15 digits, e.g. +44 20 7946 0958.';
      }
      return '';
    }
  };

  function showError(name, msg) {
    var f = fields[name];
    f.error.textContent = msg;
    f.error.hidden = !msg;
    if (msg) f.input.setAttribute('aria-invalid', 'true');
    else f.input.removeAttribute('aria-invalid');
    f.wrap.classList.toggle('is-invalid', !!msg);
    f.wrap.classList.toggle('is-valid', !msg && f.input.value.trim() !== '');
  }

  function check(name) {
    var msg = RULES[name](fields[name].input.value);
    showError(name, msg);
    return !msg;
  }

  function bindField(name) {
    var f = fields[name];
    f.input.addEventListener('blur', function () {
      // don't nag about a field the visitor tabbed past without typing
      if (f.visited || f.input.value.trim() !== '') { f.visited = true; check(name); }
    });
    f.input.addEventListener('input', function () {
      if (f.wrap.classList.contains('is-invalid')) check(name);     // clear as soon as it's fixed
      else if (f.wrap.classList.contains('is-valid')) f.wrap.classList.remove('is-valid');
    });
  }

  /* ---------- CTA ---------- */
  function renderCta() {
    cta = document.getElementById('registerCta');
    if (!cta) return;
    cta.textContent = '';
    var st = event.registration.status;
    if (st === 'sold-out') {
      var closed = el('p', 'register-cta__closed', 'Registration is closed — this event is sold out.');
      cta.appendChild(closed);
      return;
    }
    ctaBtn = el('button', 'btn btn--lg register-cta__btn');
    ctaBtn.type = 'button';
    ctaBtn.setAttribute('aria-controls', 'register');
    ctaBtn.setAttribute('aria-expanded', 'false');
    ctaBtn.appendChild(el('span', '', kind === 'waitlist' ? 'Join the waitlist' : 'Register now'));
    ctaBtn.addEventListener('click', function () { openForm(true); });
    cta.appendChild(ctaBtn);
    mine = el('p', 'register-cta__mine');
    mine.setAttribute('aria-live', 'polite');
    cta.appendChild(mine);
    renderMine();
  }

  /** "You're registered" note under the CTA — proves persistence on reload. */
  function renderMine() {
    if (!mine) return;
    var list = store.forEvent(event.id).filter(function (r) { return r.status !== 'cancelled'; });
    mine.textContent = '';
    mine.hidden = list.length === 0;
    if (!list.length) return;
    var tick = el('span', 'register-cta__tick', '✓');
    tick.setAttribute('aria-hidden', 'true');
    mine.appendChild(tick);
    var waitOnly = list.every(function (r) { return r.type === 'waitlist'; });
    var lead = list.length === 1
      ? (waitOnly ? 'On the waitlist from this device · ' : 'Registered on this device · ')
      : list.length + ' registrations on this device · ';
    mine.appendChild(document.createTextNode(lead));
    mine.appendChild(el('code', '', list.map(function (r) { return r.id; }).join(', ')));
    var manage = el('a', 'register-cta__manage', 'My registrations');
    manage.href = 'my-registrations.html';
    mine.appendChild(manage);
  }

  /* ---------- open / reveal ---------- */
  function openForm(focus) {
    var first = section.hidden;
    if (first) {
      section.hidden = false;
      // next frame so the entrance transition runs from its start state
      requestAnimationFrame(function () { requestAnimationFrame(function () { section.classList.add('is-open'); }); });
    }
    if (ctaBtn) ctaBtn.setAttribute('aria-expanded', 'true');
    var target = views.done.hidden ? fields.name.input : views.done;
    if (focus) target.focus({ preventScroll: true });
    section.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    if (location.hash !== '#register') history.replaceState(null, '', location.pathname + location.search + '#register');
  }

  /* ---------- submit ---------- */
  function onSubmit(ev) {
    ev.preventDefault();
    if (busy) return;                                   // double click / double Enter

    var bad = [];
    ['name', 'email', 'phone'].forEach(function (n) {
      fields[n].visited = true;
      if (!check(n)) bad.push(n);
    });
    if (bad.length) {
      status.textContent = bad.length === 1
        ? 'There is 1 problem with the form.'
        : 'There are ' + bad.length + ' problems with the form.';
      fields[bad[0]].input.focus();
      return;
    }

    busy = true;
    submitBtn.setAttribute('aria-disabled', 'true');
    submitBtn.classList.add('is-busy');
    $(submitBtn, 'span').textContent = 'Saving…';
    status.textContent = 'Saving your registration.';

    var result;
    try {
      result = store.create({
        eventId: event.id,
        type: kind,
        name: fields.name.input.value,
        email: fields.email.input.value,
        phone: fields.phone.input.value
      });
    } catch (err) {
      busy = false;
      resetSubmit();
      status.textContent = 'Something went wrong. Please try again.';
      return;
    }

    // a short, visible "saving" beat; the button stays locked throughout
    setTimeout(function () {
      showDone(result);
      busy = false;
      resetSubmit();
    }, reduced() ? 0 : 450);
  }

  function resetSubmit() {
    submitBtn.removeAttribute('aria-disabled');
    submitBtn.classList.remove('is-busy');
    $(submitBtn, 'span').textContent = kind === 'waitlist' ? 'Join the waitlist' : 'Complete registration';
  }

  /* ---------- confirmation ---------- */
  function showDone(result) {
    var r = result.record;
    var dup = result.status === 'duplicate';
    var back = result.status === 'reinstated';
    var wait = r.type === 'waitlist';

    // Temporary guest identity (js/identity.js): the first booker on this
    // browser becomes the guest whose registrations My Registrations shows.
    // Booking for someone else later doesn't switch it.
    var who = Eventora.identity;
    if (who && !who.current()) who.signInGuest(r.email, r.name);
    var d = function (k) { return $(views.done, '[data-d="' + k + '"]'); };

    views.done.classList.toggle('is-duplicate', dup);
    d('kicker').textContent = dup ? 'Already booked' : back ? 'Reinstated' : (wait ? 'Waitlist' : 'Confirmed');
    d('title').textContent = dup
      ? (wait ? 'You’re already on the waitlist' : 'You’re already registered')
      : back ? (wait ? 'You’re back on the waitlist' : 'You’re registered again')
      : (wait ? 'You’re on the waitlist' : 'You’re registered');
    d('msg').textContent = dup
      ? r.email + ' is already booked for this event, so we didn’t create a second registration. Here are your details.'
      : back ? 'You had cancelled this booking. It’s active again under the same registration ID.'
      : (wait
        ? 'We’ll hold your place in the queue and let you know if a spot opens up.'
        : 'Your place is booked. Keep your registration ID handy for check-in.');
    d('id').textContent = r.id;
    d('event').textContent = event.title;
    d('when').textContent = cat.dateLabel(event, true) + ' · ' + cat.timeLabel(event);
    d('venue').textContent = event.venue.name + ', ' + event.venue.city;
    d('name').textContent = r.name;
    d('email').textContent = r.email;
    d('note').textContent = result.saved
      ? 'Demo site: no email is sent. This booking is saved in this browser on this device.'
      : 'Demo site: this browser isn’t allowing storage, so this booking will be lost when you leave the page.';
    renderQr(d('qr'), r.id);
    d('mine').href = 'my-registrations.html#' + r.id;

    swap(views.form, views.done);
    status.textContent = '';
    renderMine();
  }

  /** Cross-fade between the form and the confirmation in the same card. */
  function swap(from, to) {
    from.hidden = true;
    to.hidden = false;
    if (!reduced() && to.animate) {
      to.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
        { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
    to.focus({ preventScroll: true });
    var top = section.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.4) {
      section.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function again() {
    form.reset();
    fields.event.value = event.title;
    ['name', 'email', 'phone'].forEach(function (n) { fields[n].visited = false; showError(n, ''); fields[n].wrap.classList.remove('is-valid'); });
    swap(views.done, views.form);
    fields.name.input.focus({ preventScroll: true });
  }

  /** QR code of the registration ID for check-in (js/qr.js, no library). */
  function renderQr(fig, id) {
    fig.textContent = '';
    if (!Eventora.qr) { fig.hidden = true; return; }
    try {
      fig.appendChild(Eventora.qr.svg(id, { label: 'QR code for registration ' + id, dark: '#05070b' }));
      fig.hidden = false;
    } catch (err) {
      fig.hidden = true;               // the ID is still shown as text
    }
  }

  /* ---------- mount ---------- */
  function mount() {
    var tpl = document.getElementById('registerTemplate');
    var main = document.getElementById('main');
    if (!tpl || !main) return false;
    main.appendChild(tpl.content.cloneNode(true));
    section = document.getElementById('register');
    form = document.getElementById('registerForm');
    status = document.getElementById('regStatus');
    submitBtn = $(form, '.register__submit');
    views = { form: $(section, '[data-view="form"]'), done: $(section, '[data-view="done"]') };

    fields = { event: document.getElementById('regEvent') };
    ['name', 'email', 'phone'].forEach(function (n) {
      var input = document.getElementById('reg' + n.charAt(0).toUpperCase() + n.slice(1));
      fields[n] = { input: input, wrap: input.closest('.field'), error: document.getElementById(input.id + 'Error'), visited: false };
      bindField(n);
    });

    var wait = kind === 'waitlist';
    $(section, '[data-r="kicker"]').textContent = wait ? 'Waitlist' : 'Registration';
    $(section, '[data-r="title"]').textContent = wait ? 'Join the waitlist' : 'Register for this event';
    $(section, '[data-r="submit"]').textContent = wait ? 'Join the waitlist' : 'Complete registration';
    $(section, '[data-r="when"]').textContent = cat.dateLabel(event, true) + ' · ' + cat.timeLabel(event) +
      ' · ' + event.venue.name + ', ' + event.venue.city;
    fields.event.value = event.title;

    form.addEventListener('submit', onSubmit);
    $(views.done, '[data-d="again"]').addEventListener('click', again);
    return true;
  }

  Eventora.registrationForm = {
    init: function () {
      if (!cat || !store || !Eventora.eventPage) return;
      event = Eventora.eventPage.current;
      if (!event) return;
      kind = event.registration.status === 'waitlist' ? 'waitlist' : 'registration';
      renderCta();
      if (event.registration.status === 'sold-out') return;
      if (!mount()) return;
      if (location.hash === '#register') openForm(false);
    }
  };
})(window.Eventora);
