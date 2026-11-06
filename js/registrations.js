/* =========================================================================
   REGISTRATIONS STORE — per-device registrations in localStorage.

   Kept apart from the event catalogue (js/events.js): the catalogue is static
   content, this is user state. Records point at events by their stable `id`.

   Stored under one key as a versioned envelope:
     eventora:registrations = {
       version: 1,
       registrations: [{
         id:        'EVR-7K3M-Q9TD',            unique registration id
         eventId:   'jazz-nights',               catalogue id (never copied data)
         type:      'registration' | 'waitlist',
         name:      'Ada Lovelace',              trimmed, single-spaced
         email:     'ada@example.com',           trimmed, lower-case
         phone:     '+442079460958',             digits with optional leading +
         createdAt: '2026-11-06T18:04:11.000Z'
       }]
     }
   Only what a booking needs is kept: no event titles, dates or prices (they
   are looked up from the catalogue), no free-text notes, no tracking data.

   Robustness:
   - Missing key → empty list.
   - Unparseable JSON or a wrong shape → treated as empty (a warning is
     logged); the next save writes a clean envelope.
   - Individual malformed records are dropped; valid ones are kept.
   - localStorage unavailable (privacy mode, blocked, quota) → registrations
     live in memory for this page view and the caller is told they weren't
     saved, so the UI can say so honestly.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var KEY = 'eventora:registrations';
  var VERSION = 1;
  var ID_RE = /^EVR-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
  var TYPES = { registration: true, waitlist: true };

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
    if (window.console && console.warn) console.warn('[EVENTORA] ' + msg);
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
      isString(r.createdAt, 40) && !isNaN(Date.parse(r.createdAt));
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
    var clean = data.registrations.filter(validRecord);
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

  Eventora.registrations = {
    KEY: KEY,
    normName: normName,
    normEmail: normEmail,
    normPhone: normPhone,

    /** Every stored registration (sanitised copies). */
    all: function () { return read(); },

    forEvent: function (eventId) {
      return read().filter(function (r) { return r.eventId === eventId; });
    },

    byId: function (id) {
      return read().filter(function (r) { return r.id === id; })[0] || null;
    },

    /** true when registrations survive a reload on this device. */
    persistent: function () { return !!storage(); },

    /**
     * Save a registration.
     * Returns { status: 'created' | 'duplicate', record, saved }.
     * 'duplicate' = this email is already registered for this event; the
     * existing record is returned and nothing new is written.
     */
    create: function (input) {
      var list = read();     // re-read so another tab's writes are respected
      var rec = {
        id: '',
        eventId: String(input.eventId),
        type: input.type === 'waitlist' ? 'waitlist' : 'registration',
        name: normName(input.name),
        email: normEmail(input.email),
        phone: normPhone(input.phone),
        createdAt: new Date().toISOString()
      };
      var existing = list.filter(function (r) {
        return r.eventId === rec.eventId && r.email === rec.email;
      })[0];
      if (existing) return { status: 'duplicate', record: existing, saved: true };

      var taken = {};
      list.forEach(function (r) { taken[r.id] = true; });
      rec.id = newId(taken);
      if (!validRecord(rec)) throw new Error('Invalid registration data');
      list.push(rec);
      var saved = write(list);
      return { status: 'created', record: rec, saved: saved };
    }
  };
})(window.Eventora);
