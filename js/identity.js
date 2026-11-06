/* =========================================================================
   IDENTITY — "who is the current user?" for the registration features.

   Phase 7 used a temporary guest identity keyed by email. Since Phase 8 it
   is backed by accounts (js/auth.js) and ownership is by user id:
     owns(record)  ⇔  record.userId === signed-in user's id
   Bookings made before accounts existed are linked to an account by
   registrations.claim() when that email signs up or signs in.

   The API stays the same so My Registrations and the registration form
   didn't need to know how sign-in works.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  function auth() { return Eventora.auth; }

  Eventora.identity = {
    /** The signed-in user ({ id, email, name, role, ... }) or null. */
    current: function () { return auth() ? auth().current() : null; },

    /** Does this registration belong to the signed-in user? */
    owns: function (record) {
      var u = this.current();
      return !!(u && record && record.userId && record.userId === u.id);
    },

    signOut: function () { if (auth()) auth().signOut(); },

    onChange: function (fn) { if (auth()) auth().onChange(fn); }
  };
})(window.Eventora);
