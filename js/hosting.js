/* =========================================================================
   HOSTING — Event Host applications and host-created events (Phase 8).

   PROTOTYPE, NOT SECURE: data lives in localStorage and every permission
   check below runs in the browser, so it only shapes the UI. In Phase 11
   the same functions become backend endpoints that enforce them.

   eventora:host-applications
     { version, applications: [{ id: 'APP-XXXX-XXXX', userId, name, email,
       phone, organization, reason, info, status: 'pending'|'approved'|'rejected',
       createdAt, decidedAt?, decidedBy?, note? }] }
     - one pending application per user at a time
     - approving sets the user's role to "host" (auth.admin.setHost)

   eventora:hosted-events
     { version, events: [{ ...catalogue event fields, id: 'h-<slug>-<4>',
       hostId, status: 'pending'|'approved'|'rejected'|'unpublished',
       createdAt, updatedAt, submittedAt, decidedAt?, note? }] }
     - only 'approved' events are public (they join Eventora.events)
     - hosts edit/delete their own events while pending or rejected;
       an edit (re)submits the event for approval
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var APPS = 'eventora:host-applications';
  var EVENTS_KEY = 'eventora:hosted-events';
  var APP_ID = /^APP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
  var APP_STATUS = { pending: true, approved: true, rejected: true };
  var EV_STATUS = { pending: true, approved: true, rejected: true, unpublished: true };

  var auth = function () { return Eventora.auth; };
  var cat = function () { return Eventora.events; };
  var V = function () { return Eventora.validate; };

  /* ---------- storage ---------- */
  function read(key, field) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return [];
      var data = JSON.parse(raw);
      return data && Array.isArray(data[field]) ? data[field] : [];
    } catch (err) { return []; }
  }
  function write(key, field, list) {
    try {
      var o = { version: 1 }; o[field] = list;
      window.localStorage.setItem(key, JSON.stringify(o));
      return true;
    } catch (err) { return false; }
  }
  function str(v, max) { return typeof v === 'string' && v.length <= max; }

  function validApp(a) {
    return !!a && APP_ID.test(a.id) && typeof a.userId === 'string' && APP_STATUS[a.status] &&
      str(a.name, 80) && str(a.email, 254) && str(a.phone, 16) && str(a.reason, 1000) &&
      (a.organization === undefined || str(a.organization, 100)) && (a.info === undefined || str(a.info, 1000)) &&
      !isNaN(Date.parse(a.createdAt));
  }
  function readApps() { return read(APPS, 'applications').filter(validApp); }

  function validHosted(e) {
    return !!e && typeof e.id === 'string' && /^h-[a-z0-9-]+$/.test(e.id) && typeof e.hostId === 'string' &&
      EV_STATUS[e.status] && !isNaN(Date.parse(e.createdAt)) && cat().check(publicShape(e)).length === 0;
  }
  function readHosted() { return read(EVENTS_KEY, 'events').filter(validHosted); }

  /** The catalogue-shaped, public view of a hosted event (no host/admin fields). */
  function publicShape(e) {
    var o = {
      id: e.id, title: e.title, category: e.category, date: e.date, time: e.time,
      venue: { name: e.venue && e.venue.name, city: e.venue && e.venue.city },
      image: { src: e.image && e.image.src, alt: e.image && e.image.alt },
      description: e.description, featured: false,
      registration: { status: 'open' },
      hostedBy: e.hostName || ''
    };
    if (e.price && e.price.amount > 0) o.price = { amount: e.price.amount, currency: 'USD' };
    return o;
  }

  /* ---------- ids ---------- */
  var ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function rand(n) {
    var b = new Uint8Array(n), s = '';
    window.crypto.getRandomValues(b);
    for (var i = 0; i < n; i++) s += ALPHABET[b[i] % 32];
    return s;
  }
  function slug(title) {
    return String(title).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'event';
  }

  function me() { return auth() && auth().current(); }
  function deny(msg) { return { ok: false, error: msg || 'You don’t have permission to do that.' }; }

  /* ---------- host event fields ---------- */
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** Validate host-entered fields. Returns { errors, value }. */
  function checkEvent(f) {
    var v = V(), errs = {};
    var title = String(f.title || '').trim().replace(/\s+/g, ' ');
    errs.title = v.required(title, 'an event title', 3, 80);
    errs.category = cat().categories.indexOf(f.category) === -1 ? 'Choose a category.' : '';
    errs.date = !/^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? 'Choose a date.'
      : (f.date < todayISO() ? 'Choose today or a future date.' : '');
    errs.time = !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.time || '') ? 'Choose a start time.' : '';
    errs.venue = v.required(f.venue, 'the venue name', 2, 60);
    errs.city = v.required(f.city, 'the city', 2, 60);
    errs.description = v.required(f.description, 'a short description', 20, 400);
    var price = String(f.price === undefined ? '' : f.price).trim();
    var amount = price === '' ? 0 : Number(price);
    errs.price = (isNaN(amount) || amount < 0 || amount > 10000 || Math.round(amount) !== amount)
      ? 'Enter a whole-dollar price from 0 (free) to 10000.' : '';
    var image = Eventora.hosting.coverImages().filter(function (i) { return i.src === f.image; })[0];
    errs.image = image ? '' : 'Choose a cover image.';
    Object.keys(errs).forEach(function (k) { if (!errs[k]) delete errs[k]; });
    return {
      errors: errs,
      value: {
        title: title, category: f.category, date: f.date, time: f.time,
        venue: { name: String(f.venue || '').trim(), city: String(f.city || '').trim() },
        image: image ? { src: image.src, alt: image.alt } : null,
        description: String(f.description || '').trim(),
        price: amount > 0 ? { amount: amount, currency: 'USD' } : null
      }
    };
  }

  Eventora.hosting = {
    KEYS: { applications: APPS, events: EVENTS_KEY },
    statusLabel: function (s) {
      return { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', unpublished: 'Unpublished' }[s] || s;
    },

    /** Cover photos a host can choose (the catalogue's own photography). */
    coverImages: function () {
      var seen = {};
      return cat().catalogue().filter(function (e) {
        if (seen[e.image.src]) return false;
        seen[e.image.src] = true;
        return true;
      }).map(function (e) { return { src: e.image.src, alt: e.image.alt, category: e.category }; });
    },

    /* ----- applications (signed-in user) ----- */
    myApplications: function () {
      var u = me();
      if (!u) return [];
      return readApps().filter(function (a) { return a.userId === u.id; })
        .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    },
    latestApplication: function () { return this.myApplications()[0] || null; },

    apply: function (f) {
      var u = me();
      if (!u) return deny('Sign in to apply.');
      if (u.role === 'host') return deny('You’re already an Event Host.');
      if (u.role === 'admin') return deny('Admins can already manage events.');
      var list = readApps();
      if (list.some(function (a) { return a.userId === u.id && a.status === 'pending'; })) {
        return deny('You already have an application waiting for review.');
      }
      var v = V();
      var errs = {
        organization: v.optional(f.organization, 100),
        reason: v.required(f.reason, 'why you want to host events', 30, 1000),
        info: v.optional(f.info, 1000)
      };
      if (errs.organization || errs.reason || errs.info) return { ok: false, errors: errs };
      var taken = {};
      list.forEach(function (a) { taken[a.id] = true; });
      var id; do { var r = rand(8); id = 'APP-' + r.slice(0, 4) + '-' + r.slice(4); } while (taken[id]);
      var app = {
        id: id, userId: u.id, name: u.name, email: u.email, phone: u.phone,
        reason: String(f.reason).trim(), status: 'pending', createdAt: new Date().toISOString()
      };
      var org = String(f.organization || '').trim(), info = String(f.info || '').trim();
      if (org) app.organization = org;
      if (info) app.info = info;
      list.push(app);
      if (!write(APPS, 'applications', list)) return deny('Your application couldn’t be saved in this browser.');
      return { ok: true, application: app };
    },

    /* ----- hosted events (host) ----- */
    myEvents: function () {
      var u = me();
      if (!u) return [];
      return readHosted().filter(function (e) { return e.hostId === u.id; })
        .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    },

    checkEvent: checkEvent,

    createEvent: function (f) {
      var u = me();
      if (!u || !auth().can('manageOwnEvents')) return deny('Only Event Hosts can create events.');
      var c = checkEvent(f);
      if (Object.keys(c.errors).length) return { ok: false, errors: c.errors };
      var list = readHosted();
      var id; do { id = 'h-' + slug(c.value.title) + '-' + rand(4).toLowerCase(); }
      while (cat().isCatalogue(id) || list.some(function (e) { return e.id === id; }));
      var now = new Date().toISOString();
      var ev = Object.assign({ id: id, hostId: u.id, hostName: u.name, status: 'pending',
        createdAt: now, updatedAt: now, submittedAt: now }, c.value);
      if (!ev.price) delete ev.price;
      list.push(ev);
      if (!write(EVENTS_KEY, 'events', list)) return deny('The event couldn’t be saved in this browser.');
      return { ok: true, event: ev };
    },

    /** Hosts edit their own events while pending or rejected (re-submits it). */
    updateEvent: function (id, f) {
      var u = me();
      var list = readHosted();
      var ev = list.filter(function (e) { return e.id === id; })[0];
      if (!u || !ev || ev.hostId !== u.id) return deny('You can only edit your own events.');
      if (ev.status !== 'pending' && ev.status !== 'rejected') {
        return deny('Approved and unpublished events are locked. Ask an admin if something needs to change.');
      }
      var c = checkEvent(f);
      if (Object.keys(c.errors).length) return { ok: false, errors: c.errors };
      Object.assign(ev, c.value);
      if (!c.value.price) delete ev.price;
      var now = new Date().toISOString();
      ev.status = 'pending'; ev.updatedAt = now; ev.submittedAt = now;
      delete ev.decidedAt; delete ev.note;
      write(EVENTS_KEY, 'events', list);
      return { ok: true, event: ev };
    },

    deleteEvent: function (id) {
      var u = me();
      var list = readHosted();
      var ev = list.filter(function (e) { return e.id === id; })[0];
      if (!u || !ev || ev.hostId !== u.id) return deny('You can only delete your own events.');
      if (ev.status !== 'pending' && ev.status !== 'rejected') return deny('Only pending or rejected events can be deleted.');
      write(EVENTS_KEY, 'events', list.filter(function (e) { return e.id !== id; }));
      return { ok: true };
    },

    /** Registrations for an event — its host or an admin only. */
    registrationsFor: function (eventId) {
      var u = me();
      if (!u) return null;
      var ev = readHosted().filter(function (e) { return e.id === eventId; })[0];
      var allowed = auth().can('viewAllRegistrations') || (ev && ev.hostId === u.id);
      if (!allowed || !Eventora.registrations) return null;
      return Eventora.registrations.all().filter(function (r) { return r.eventId === eventId; });
    },

    /** Public, approved host events (catalogue source). */
    publicEvents: function () {
      return readHosted().filter(function (e) { return e.status === 'approved'; }).map(publicShape);
    },

    /* ----- admin review ----- */
    admin: {
      _require: function (perm) { if (!auth().can(perm)) throw new Error('Admin only'); },

      applications: function () {
        this._require('reviewApplications');
        return readApps().sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
      },
      decideApplication: function (id, decision, note) {
        this._require('reviewApplications');
        if (decision !== 'approved' && decision !== 'rejected') return deny('Unknown decision.');
        var list = readApps();
        var app = list.filter(function (a) { return a.id === id; })[0];
        if (!app) return deny('Application not found.');
        if (app.status !== 'pending') return deny('This application was already ' + app.status + '.');
        if (decision === 'approved') {
          var r = auth().admin.setHost(app.userId, true);
          if (!r.ok) return r;
        }
        app.status = decision;
        app.decidedAt = new Date().toISOString();
        app.decidedBy = me().id;
        if (note && String(note).trim()) app.note = String(note).trim().slice(0, 500);
        write(APPS, 'applications', list);
        return { ok: true, application: app };
      },

      events: function () {
        this._require('reviewEvents');
        return readHosted().sort(function (a, b) { return a.submittedAt < b.submittedAt ? 1 : -1; });
      },
      setEventStatus: function (id, status, note) {
        this._require('reviewEvents');
        if (!EV_STATUS[status] || status === 'pending') return deny('Unknown status.');
        var list = readHosted();
        var ev = list.filter(function (e) { return e.id === id; })[0];
        if (!ev) return deny('Event not found.');
        ev.status = status;
        ev.decidedAt = new Date().toISOString();
        if (note && String(note).trim()) ev.note = String(note).trim().slice(0, 500); else delete ev.note;
        write(EVENTS_KEY, 'events', list);
        return { ok: true, event: ev };
      }
    }
  };

  // Approved host events join the public programme.
  if (cat() && cat().addSource) cat().addSource(function () { return Eventora.hosting.publicEvents(); });
})(window.Eventora);
