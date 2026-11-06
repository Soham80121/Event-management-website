/* =========================================================================
   VALIDATE — shared field rules (registration form, sign-up, profile).
   Each rule takes the raw value and returns '' when valid, otherwise a
   message that says how to fix it. Pure functions, no DOM.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var EMAIL_RE = /^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]{2,}$/;

  function normName(v) { return String(v || '').trim().replace(/\s+/g, ' '); }

  Eventora.validate = {
    EMAIL_RE: EMAIL_RE,

    name: function (v) {
      var s = normName(v);
      if (!s) return 'Enter your full name.';
      if (s.length < 2) return 'Your name needs at least 2 characters.';
      if (s.length > 80) return 'Keep your name under 80 characters.';
      if (!/^[\p{L}\p{M}' .\-’]+$/u.test(s) || !/\p{L}/u.test(s)) {
        return 'Use letters, spaces, hyphens and apostrophes only.';
      }
      return '';
    },

    email: function (v) {
      var s = String(v || '').trim();
      if (!s) return 'Enter your email address.';
      if (s.length > 254 || !EMAIL_RE.test(s)) return 'Enter an email address like name@example.com.';
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
    },

    /** 8–128 characters with at least one letter and one number. */
    password: function (v) {
      var s = String(v || '');
      if (!s) return 'Enter a password.';
      if (s.length < 8) return 'Use at least 8 characters.';
      if (s.length > 128) return 'Use 128 characters or fewer.';
      if (!/[A-Za-z\p{L}]/u.test(s) || !/\d/.test(s)) return 'Include at least one letter and one number.';
      return '';
    },

    /** Individual password requirements, for the live checklist. */
    passwordChecks: function (v) {
      var s = String(v || '');
      return {
        length: s.length >= 8 && s.length <= 128,
        letter: /[A-Za-z\p{L}]/u.test(s),
        number: /\d/.test(s)
      };
    },

    confirm: function (v, original) {
      if (!String(v || '')) return 'Confirm your password.';
      if (v !== original) return 'The passwords don’t match.';
      return '';
    },

    required: function (v, label, min, max) {
      var s = String(v || '').trim();
      if (!s) return 'Enter ' + label + '.';
      if (min && s.length < min) return 'Write at least ' + min + ' characters.';
      if (max && s.length > max) return 'Keep it under ' + max + ' characters.';
      return '';
    },

    optional: function (v, max) {
      var s = String(v || '').trim();
      if (max && s.length > max) return 'Keep it under ' + max + ' characters.';
      return '';
    }
  };
})(window.Eventora);
