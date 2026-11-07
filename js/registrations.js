/* =========================================================================
   REGISTRATIONS — a client of the dev server's registration API
   (tools/eventdata.py, .data/registrations.json). The SERVER is the source of
   truth: it creates and cancels bookings, decides registration vs waitlist,
   sets the owning account from the session, prevents duplicates and enforces
   who may see what (own bookings / a host's own events / admin: all).

   Record shape (unchanged since Phase 6, so IDs and QR codes carry over):
     { id: 'EVR-7K3M-Q9TD', eventId, type: 'registration' | 'waitlist',
       name, email, phone, createdAt, status: 'confirmed' | 'cancelled',
       cancelledAt?, userId }
   "Completed" is never stored: it's derived from the event date when shown.
   Cancelling keeps the record and its id; registering again for the same
   event reinstates that record instead of adding one.

   sync() loads what the signed-in person may see into memory; the getters
   below read that copy (main.js waits for it before pages render).

   Browser storage (eventora:registrations) is NOT the database any more. It
   only holds bookings made before server saving; sync() moves them to the
   server once, keeping their IDs:
     - everyone: their own bookings (same account, or same email, no account);
     - the admin: every booking found in that browser (admin import).
   Each one is removed from the browser after the server confirms it.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var KEY = 'eventora:registrations';
  var VERSION = 1;
  var ID_RE = /^EVR-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
  var TYPES = { registration: true, waitlist: true };
  var STATUSES = { confirmed: true, cancelled: true };

  var memory = null;          // fallback when storage can't be used
  var warned = false;

  function storage() {
    try {
      var s = window.localStorage;
      var probe = KEY + ':probe';
      s.setItem(probe, '1');
      s.removeItem(probe);
      return s;
    } catch (err) {
      return null;
    }
  }

  function warn(msg) {
    if (warned) return;
    warned = true;
    if (window.console && console.warn) console.warn('[EvAtlas] ' + msg);
  }

  function isString(v, max) { return typeof v === 'string' && v.length > 0 && v.length <= max; }

  /** A record is kept only if every field has the expected type and form. */
  function validRecord(r) {
    return !!r && typeof r === 'object' &&
      typeof r.id === 'string' && ID_RE.test(r.id) &&
      isString(r.eventId, 120) &&
      TYPES[r.type] === true &&
      isString(r.name, 80) &&
      isString(r.email, 254) &&
      isString(r.phone, 16) &&
      isString(r.createdAt, 40) && !isNaN(Date.parse(r.createdAt)) &&
      (r.status === undefined || STATUSES[r.status] === true) &&
      (r.cancelledAt === undefined || (isString(r.cancelledAt, 40) && !isNaN(Date.parse(r.cancelledAt)))) &&
      (r.userId === undefined || (typeof r.userId === 'string' && /^usr_[0-9A-Z]{12}$/.test(r.userId)));
  }

  /** Records written before Phase 7 have no status: they are confirmed. */
  function normalise(r) {
    var out = {};
    Object.keys(r).forEach(function (k) { out[k] = r[k]; });
    if (!out.status) out.status = 'confirmed';
    if (out.status !== 'cancelled') delete out.cancelledAt;
    return out;
  }

  /** Read and sanitise. Never throws. */
  function read() {
    var s = storage();
    if (!s) {
      warn('localStorage is unavailable; registrations are kept for this page view only.');
      return (memory || []).slice();
    }
    var raw;
    try { raw = s.getItem(KEY); } catch (err) { raw = null; }
    if (raw === null) return [];
    var data;
    try { data = JSON.parse(raw); } catch (err) {
      warn('Stored registrations were unreadable and have been ignored.');
      return [];
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.registrations)) {
      warn('Stored registrations had an unexpected format and have been ignored.');
      return [];
    }
    var clean = data.registrations.filter(validRecord).map(normalise);
    if (clean.length !== data.registrations.length) {
      warn((data.registrations.length - clean.length) + ' malformed registration record(s) were skipped.');
    }
    return clean;
  }

  /** Write the whole list. Returns true when it reached localStorage. */
  function write(list) {
    var s = storage();
    if (!s) { memory = list.slice(); return false; }
    try {
      s.setItem(KEY, JSON.stringify({ version: VERSION, registrations: list }));
      memory = null;
      return true;
    } catch (err) {               // quota exceeded, etc.
      memory = list.slice();
      warn('Registrations could not be saved to localStorage.');
      return false;
    }
  }

  /* Crockford base32 (no I, L, O, U) — easy to read aloud or type. */
  var ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function randomChars(n) {
    var out = '', bytes = new Uint8Array(n);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < n; j++) out += ALPHABET[bytes[j] % 32];
    return out;
  }
  function newId(taken) {
    var id;
    do { var c = randomChars(8); id = 'EVR-' + c.slice(0, 4) + '-' + c.slice(4); }
    while (taken[id]);
    return id;
  }

  /* ---------- normalisation shared with the form's validation ---------- */
  function normName(v) { return String(v || '').trim().replace(/\s+/g, ' '); }
  function normEmail(v) { return String(v || '').trim().toLowerCase(); }
  function normPhone(v) {
    var s = String(v || '').trim();
    var plus = s.charAt(0) === '+' ? '+' : '';
    return plus + s.replace(/\D/g, '');
  }

  /* ---------- server copy ---------- */
  var cache = [];
  var loaded = false;
  function auth() { return Eventora.auth; }
  function put(rec) {
    var at = -1;
    cache.forEach(function (r, i) { if (r.id === rec.id) at = i; });
    // merge: the attendee's own list also carries eventStatus / eventTitle
    if (at === -1) cache.push(rec); else cache[at] = Object.assign({}, cache[at], rec);
  }
  function serverDown() { return (auth() && auth().SERVER_DOWN) || 'The EvAtlas server can’t be reached.'; }

  /** Move bookings saved only in this browser to the server, keeping their IDs. */
  function migrate(u) {
    var local = read();
    if (!local.length) return Promise.resolve();
    var dropIds = function (ids) {
      if (!ids.length) return;
      var keep = read().filter(function (r) { return ids.indexOf(r.id) === -1; });
      write(keep);
    };
    if (auth().can('viewAllRegistrations')) {
      // the admin's browser: move every booking it holds (idempotent import, IDs kept)
      return auth().request('/api/admin/import', { data: { registrations: local } }).then(function (res) {
        if (res.httpStatus !== 200) return;
        return auth().request('/api/admin/registrations', {}).then(function (all) {
          if (all.httpStatus !== 200) return;
          var onServer = {};
          all.registrations.forEach(function (r) { onServer[r.id] = true; });
          dropIds(local.filter(function (r) { return onServer[r.id]; }).map(function (r) { return r.id; }));
        });
      });
    }
    var mine = local.filter(function (r) { return r.userId === u.id || (!r.userId && r.email === normEmail(u.email)); });
    var moved = [];
    return mine.reduce(function (p, r) {
      return p.then(function () {
        return auth().request('/api/me/registrations/carry-over', { registration: r }).then(function (res) {
          if (res.httpStatus === 200) moved.push(r.id);
        });
      });
    }, Promise.resolve()).then(function () { dropIds(moved); });
  }

  Eventora.registrations = {
    KEY: KEY,
    normName: normName,
    normEmail: normEmail,
    normPhone: normPhone,

    /**
     * Load the bookings the signed-in person may see: their own; an Event
     * Host also those for their own events; the admin every booking.
     */
    sync: function () {
      var a = auth();
      if (!a) return Promise.resolve();
      return a.ready().then(function (u) {
        if (!u) { cache = []; loaded = false; return; }
        return migrate(u).then(function () {
          return Promise.all([
            a.request('/api/me/registrations', {}),
            a.can('manageOwnEvents') ? a.request('/api/host/registrations', {}) : null,
            a.can('viewAllRegistrations') ? a.request('/api/admin/registrations', {}) : null
          ]);
        }).then(function (res) {
          if (res[0].httpStatus !== 200) return;
          cache = [];
          res.forEach(function (r) { if (r && r.httpStatus === 200) r.registrations.forEach(function (x) { put(normalise(x)); }); });
          loaded = true;
        });
      }, function () { /* no session check possible: keep what we have */ });
    },
    /** Whether the last sync reached the server. */
    loaded: function () { return loaded; },

    /** Every booking this person may see (sanitised copies). */
    all: function () { return cache.filter(validRecord).map(normalise); },

    forEvent: function (eventId) {
      return this.all().filter(function (r) { return r.eventId === eventId; });
    },

    byId: function (id) {
      return this.all().filter(function (r) { return r.id === id; })[0] || null;
    },

    /** Bookings owned by this account. */
    forUser: function (userId) {
      return this.all().filter(function (r) { return r.userId === userId; });
    },

    /** Kept for older callers: linking bookings to an account now happens on the server (sync). */
    claim: function () { return 0; },

    /** Bookings made with this email. */
    forEmail: function (email) {
      var e = normEmail(email);
      return this.all().filter(function (r) { return r.email === e; });
    },

    /**
     * Cancel your own booking on the server. The record and its id are kept.
     * Resolves to { ok, record, saved, error? }.
     */
    cancel: function (id) {
      return auth().request('/api/me/registrations/cancel', { id: id }).then(function (res) {
        if (res.httpStatus === 200 && res.record) { put(res.record); return { ok: true, record: normalise(res.record), saved: true }; }
        return { ok: false, record: null, saved: false, error: res.httpStatus === 0 ? serverDown() : (res.error || 'That registration could not be found.') };
      });
    },

    /** Bookings are kept by the server, so they survive on every device. */
    persistent: function () { return true; },

    /**
     * Book an event on the server (it decides registration vs waitlist and
     * the owning account). Resolves to
     *   { status: 'created' | 'duplicate' | 'reinstated', record, saved: true }
     * or { status: 'error', error, field?, errors? }.
     */
    create: function (input) {
      return auth().request('/api/me/registrations/create', {
        eventId: String(input.eventId), name: input.name, email: input.email, phone: input.phone
      }).then(function (res) {
        if (res.httpStatus === 200 && res.record) {
          put(res.record);
          return { status: res.status, record: normalise(res.record), saved: true };
        }
        return { status: 'error', field: res.field, errors: res.errors,
          error: res.httpStatus === 0 ? serverDown() : res.httpStatus === 401 ? 'Your session has ended. Sign in again.'
            : (res.message || res.error || 'Your registration couldn’t be saved. Please try again.') };
      });
    }
  };
})(window.Eventora);
