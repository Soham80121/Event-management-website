/* =========================================================================
   IDENTITY — who "the current user" is, until real accounts exist.

   Temporary strategy (Phase 7): a GUEST IDENTITY KEYED BY EMAIL.
   - A registration already stores the booker's email, so the email is the
     natural owner key. My Registrations shows only the registrations whose
     email matches the current guest — never "everything on this device",
     because one browser may hold bookings for several people (e.g. via
     "Register someone else").
   - The guest identity is set when someone completes a registration and no
     guest is active yet, or when they look themselves up on My
     Registrations by email. "Not you?" clears it.
   - It is NOT authentication: anyone using this browser can enter an email.
     That is acceptable only because the data never leaves this browser.

   Stored under its own key, separate from registrations:
     eventora:session = { version: 1, user: { kind: 'guest', email, name, since } }

   Phase 8 swap-over: replace this module's internals with real sign-in and
   keep the API — current(), owns(record), signInGuest(), signOut(),
   onChange(). A signed-in user would carry an `id`; owns() would then match
   record.userId first and fall back to the email for older guest bookings.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var KEY = 'eventora:session';
  var listeners = [];

  function norm(email) {
    return Eventora.registrations ? Eventora.registrations.normEmail(email) : String(email || '').trim().toLowerCase();
  }

  function read() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      var u = data && data.user;
      if (!u || u.kind !== 'guest' || typeof u.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(u.email)) {
        return null;                        // corrupt or unknown → treated as signed out
      }
      return { kind: 'guest', email: norm(u.email), name: typeof u.name === 'string' ? u.name : '', since: u.since || '' };
    } catch (err) {
      return null;                          // unreadable or storage blocked
    }
  }

  function write(user) {
    try {
      if (user) window.localStorage.setItem(KEY, JSON.stringify({ version: 1, user: user }));
      else window.localStorage.removeItem(KEY);
      return true;
    } catch (err) {
      return false;
    }
  }

  var memory = null;                         // when storage is blocked

  function emit() {
    var u = Eventora.identity.current();
    listeners.forEach(function (fn) { try { fn(u); } catch (err) { /* keep others running */ } });
  }

  Eventora.identity = {
    KEY: KEY,

    /** The current guest, or null. */
    current: function () { return read() || memory; },

    /** Does this registration belong to the current user? */
    owns: function (record) {
      var u = this.current();
      return !!(u && record && record.email === u.email);
    },

    /** Become this guest (after registering, or a lookup on My Registrations). */
    signInGuest: function (email, name) {
      var user = { kind: 'guest', email: norm(email), name: name || '', since: new Date().toISOString() };
      if (!write(user)) memory = user;
      emit();
      return user;
    },

    signOut: function () {
      write(null);
      memory = null;
      emit();
    },

    onChange: function (fn) { listeners.push(fn); }
  };
})(window.Eventora);
