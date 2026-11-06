/* =========================================================================
   AUTH PAGES — signup.html, login.html, forgot-password.html.
   Accounts are a browser-only prototype (js/auth.js); the pages say so.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var F = function () { return Eventora.forms; };
  var V = function () { return Eventora.validate; };
  function $(id) { return document.getElementById(id); }

  /** Already signed in? Offer the way on instead of a second account. */
  function signedInNotice(card, u, next) {
    var box = $('authSignedIn');
    if (!box || !u) return false;
    box.hidden = false;
    box.querySelector('[data-a="name"]').textContent = u.name;
    box.querySelector('[data-a="continue"]').href = next;
    card.hidden = true;
    return true;
  }

  function signup() {
    var form = $('signupForm');
    if (!form) return;
    var next = F().nextUrl('profile.html');
    if (signedInNotice(form.closest('.auth-card__body'), Eventora.auth.current(), next)) return;
    F().passwordToggles(form);
    F().passwordChecklist(form);
    var v = F().bind(form, {
      name: V().name, email: V().email, phone: V().phone, password: V().password,
      confirm: function (val, f) { return V().confirm(val, f.elements.password.value); }
    });
    var alertEl = $('signupAlert');
    var submitting = false;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (submitting) return;
      F().alert(alertEl, 'error', '');
      if (v.check().length) { F().alert(alertEl, 'error', 'Please fix the highlighted fields.'); return; }
      submitting = true;
      var restore = F().busy(form.querySelector('[type="submit"]'), 'Creating account…');
      Eventora.auth.signUp({
        name: form.elements.name.value, email: form.elements.email.value, phone: form.elements.phone.value,
        password: form.elements.password.value, confirm: form.elements.confirm.value,
        remember: form.elements.remember.checked
      }).then(function (res) {
        submitting = false;
        restore();
        if (!res.ok) {
          if (res.errors) { Object.keys(res.errors).forEach(function (k) { if (res.errors[k]) v.show(k, res.errors[k]); }); return; }
          if (res.field && res.field !== 'form') v.show(res.field, res.error);
          F().alert(alertEl, 'error', res.error);
          return;
        }
        form.hidden = true;
        var done = $('signupDone');
        done.hidden = false;
        done.querySelector('[data-a="name"]').textContent = res.user.name.split(' ')[0];
        done.querySelector('[data-a="role"]').textContent = Eventora.auth.ROLE_LABELS[res.user.role];
        done.querySelector('[data-a="continue"]').href = next;
        var claimed = Eventora.registrations ? Eventora.registrations.forUser(res.user.id).length : 0;
        done.querySelector('[data-a="claimed"]').textContent = claimed
          ? claimed + (claimed === 1 ? ' earlier booking' : ' earlier bookings') + ' made with this email ' + (claimed === 1 ? 'is' : 'are') + ' now in My registrations.'
          : '';
        done.focus();
      }).catch(function () {
        submitting = false; restore();
        F().alert(alertEl, 'error', 'Something went wrong while creating your account. Please try again.');
      });
    });
  }

  function login() {
    var form = $('loginForm');
    if (!form) return;
    var next = F().nextUrl('profile.html');
    if (signedInNotice(form.closest('.auth-card__body'), Eventora.auth.current(), next)) return;
    F().passwordToggles(form);
    var v = F().bind(form, {
      email: V().email,
      password: function (val) { return val ? '' : 'Enter your password.'; }
    });
    var alertEl = $('loginAlert');
    var submitting = false;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (submitting) return;
      F().alert(alertEl, 'error', '');
      if (v.check().length) return;
      submitting = true;
      var restore = F().busy(form.querySelector('[type="submit"]'), 'Signing in…');
      Eventora.auth.signIn(form.elements.email.value, form.elements.password.value, form.elements.remember.checked)
        .then(function (res) {
          submitting = false;
          if (!res.ok) {
            restore();
            F().alert(alertEl, 'error', res.error);
            form.elements.password.value = '';
            form.elements.password.focus();
            return;
          }
          F().alert(alertEl, 'success', 'Welcome back, ' + res.user.name.split(' ')[0] + '. Taking you on…');
          setTimeout(function () { location.href = next; }, Eventora.motion && Eventora.motion.reduced() ? 0 : 600);
        }).catch(function () {
          submitting = false; restore();
          F().alert(alertEl, 'error', 'Something went wrong while signing in. Please try again.');
        });
    });
  }

  function forgot() {
    var form = $('forgotForm');
    if (!form) return;
    var v = F().bind(form, { email: V().email });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (v.check().length) return;
      // Same answer whether or not the account exists (no account probing).
      var done = $('forgotDone');
      done.querySelector('[data-a="email"]').textContent = form.elements.email.value.trim();
      form.hidden = true;
      done.hidden = false;
      done.focus();
    });
  }

  Eventora.authPages = {
    init: function () {
      if (!Eventora.auth || !Eventora.forms) return;
      // "Sign in" ⇄ "Create account" links keep the ?next= return address
      var next = new URLSearchParams(location.search).get('next');
      if (next) {
        Array.prototype.forEach.call(document.querySelectorAll('[data-keep-next]'), function (a) {
          a.href = a.getAttribute('href').split('?')[0] + '?next=' + encodeURIComponent(next);
        });
      }
      signup(); login(); forgot();
    }
  };
})(window.Eventora);
