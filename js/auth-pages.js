/* =========================================================================
   AUTH PAGES — signup.html, login.html, forgot-password.html.
   Accounts live on the dev server (js/auth.js -> tools/accounts.py).
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
    if (new URLSearchParams(location.search).get('reset') === '1') {
      F().alert(alertEl, 'success', 'Your password has been reset. Sign in with your new password.');
    }
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

  /* ---------- Forgot password: email -> 6-digit code -> new password -> done ----------
     The code and the reset token are handled by the server (js/auth.js →
     recovery). The reset token lives only in this page's memory; nothing
     about the recovery is written to browser storage. */
  var SERVER_DOWN = 'The EvAtlas server can’t be reached. Start the site with: python tools/dev_server.py';
  var NOT_CONFIGURED = 'Password-reset emails aren’t set up on this server yet, so no code can be sent. ' +
    'The site owner needs to add a Resend API key (RESEND_API_KEY) to the server’s .env file; see the README.';

  function clock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }
  function minutes(sec) { var m = Math.ceil(sec / 60); return m <= 1 ? 'a minute' : m + ' minutes'; }

  function forgot() {
    var root = $('fpRoot');
    if (!root) return;
    var recovery = Eventora.auth.recovery;
    var steps = {};
    Array.prototype.forEach.call(root.querySelectorAll('.fp-step'), function (s) { steps[s.getAttribute('data-step')] = s; });
    var state = { email: '', token: '', expiresAt: 0, resendAt: 0, timer: null };
    var reduced = Eventora.motion && Eventora.motion.reduced ? Eventora.motion.reduced() : false;

    function show(name, focusEl) {
      Object.keys(steps).forEach(function (k) { steps[k].hidden = k !== name; });
      var s = steps[name];
      s.classList.remove('is-entering');
      void s.offsetWidth;                                   // restart the entrance animation
      s.classList.add('is-entering');
      var target = focusEl || s;
      if (target === s && !s.hasAttribute('tabindex')) s.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      if (s.getBoundingClientRect().top < 0) s.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    }
    function fill(attr, text) {
      Array.prototype.forEach.call(root.querySelectorAll('[data-a="' + attr + '"]'), function (n) { n.textContent = text; });
    }

    /* ----- timers: code expiry + resend cooldown ----- */
    var waitEl = steps.code.querySelector('[data-a="wait"]');
    var resendBtn = steps.code.querySelector('[data-a="resend"]');
    function tick() {
      var now = Date.now() / 1000;
      if (state.expiresAt) {
        var left = state.expiresAt - now;
        fill('expires', left > 0 ? 'It expires in ' + clock(left) + '.' : 'This code has expired; request a new one below.');
      } else {
        fill('expires', '');
      }
      var wait = state.resendAt - now;
      resendBtn.hidden = wait > 0;
      waitEl.hidden = wait <= 0;
      waitEl.textContent = wait > 0 ? 'Resend code in ' + clock(wait) : '';
    }
    function startTimers(expiresIn, resendIn) {
      var now = Date.now() / 1000;
      if (expiresIn) state.expiresAt = now + expiresIn;
      state.resendAt = now + (resendIn || 0);
      clearInterval(state.timer);
      state.timer = setInterval(tick, 1000);
      tick();
    }
    function stopTimers() { clearInterval(state.timer); state.timer = null; }

    /* ----- 1. email ----- */
    var emailForm = $('forgotForm');
    var emailAlert = $('fpEmailAlert');
    var ve = F().bind(emailForm, { email: V().email });
    var sending = false;

    /** Ask for a code; `onSent(res)` runs on success (or cooldown). */
    function requestCode(email, alertEl, button, onSent) {
      if (sending) return;
      sending = true;
      var restore = F().busy(button, 'Sending code…');
      recovery.request(email).then(function (res) {
        sending = false;
        restore();
        if (res.httpStatus === 200 && res.ok) { onSent(res, false); return; }
        if (res.httpStatus === 429 && res.error === 'cooldown') { onSent(res, true); return; }
        var msg = res.httpStatus === 0 ? SERVER_DOWN
          : res.httpStatus === 503 ? NOT_CONFIGURED
          : res.error === 'too-many' ? 'Too many codes have been requested. Try again in ' + minutes(res.retryAfter || 3600) + '.'
          : res.error === 'invalid-email' ? 'Enter an email address like name@example.com.'
          : 'Something went wrong while sending the code. Please try again.';
        F().alert(alertEl, 'error', msg);
      }, function () {
        sending = false; restore();
        F().alert(alertEl, 'error', SERVER_DOWN);
      });
    }

    emailForm.addEventListener('submit', function (e) {
      e.preventDefault();
      F().alert(emailAlert, 'error', '');
      if (ve.check().length) return;
      var email = emailForm.elements.email.value.trim();
      requestCode(email, emailAlert, emailForm.querySelector('[type="submit"]'), function (res, cooldown) {
        state.email = email;
        fill('email', email);
        clearDigits();
        F().alert(codeAlert, 'error', '');
        if (cooldown) {
          // a code was sent moments ago: keep using it (its expiry is unknown here)
          state.expiresAt = 0;
          startTimers(0, res.retryAfter);
          F().alert(codeAlert, 'success', 'A code was sent to this address a moment ago. Use that code, or request a new one when the timer ends.');
        } else {
          startTimers(res.expiresIn, res.resendIn);
        }
        show('code', digits[0]);
      });
    });

    /* ----- 2. code ----- */
    var otpForm = $('otpForm');
    var codeAlert = $('fpCodeAlert');
    var otpField = $('otpField');
    var digits = Array.prototype.slice.call(otpForm.querySelectorAll('.otp__digit'));
    var verifying = false;

    function code() { return digits.map(function (d) { return d.value; }).join(''); }
    function clearDigits() {
      digits.forEach(function (d) { d.value = ''; });
      otpField.classList.remove('is-invalid');
    }
    /** Spread a run of digits across the boxes, starting at box `from`. */
    function spread(from, text) {
      var chars = String(text).replace(/\D/g, '').split('');
      if (!chars.length) return;
      if (chars.length >= 6) from = 0;                     // a whole code pasted anywhere
      for (var i = 0; i < chars.length && from + i < 6; i++) digits[from + i].value = chars[i];
      var next = Math.min(from + chars.length, 5);
      digits[next].focus();
      digits[next].select();
      if (code().length === 6) submitCode();
    }
    digits.forEach(function (d, i) {
      d.addEventListener('input', function () {
        otpField.classList.remove('is-invalid');
        var v = d.value.replace(/\D/g, '');
        if (v.length > 1) { d.value = ''; spread(i, v); return; }   // autofill / fast typing
        d.value = v;
        if (v && i < 5) { digits[i + 1].focus(); digits[i + 1].select(); }
        if (v && code().length === 6) submitCode();
      });
      d.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !d.value && i > 0) { e.preventDefault(); digits[i - 1].value = ''; digits[i - 1].focus(); }
        else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); digits[i - 1].focus(); digits[i - 1].select(); }
        else if (e.key === 'ArrowRight' && i < 5) { e.preventDefault(); digits[i + 1].focus(); digits[i + 1].select(); }
      });
      d.addEventListener('focus', function () { d.select(); });
      d.addEventListener('paste', function (e) {
        var text = (e.clipboardData || window.clipboardData).getData('text');
        e.preventDefault();
        spread(i, text);
      });
    });

    function submitCode() {
      if (verifying) return;
      F().alert(codeAlert, 'error', '');
      var otp = code();
      if (!/^\d{6}$/.test(otp)) {
        otpField.classList.add('is-invalid');
        F().alert(codeAlert, 'error', 'Enter all 6 digits of the code.');
        digits[Math.min(otp.length, 5)].focus();
        return;
      }
      verifying = true;
      var restore = F().busy(otpForm.querySelector('[type="submit"]'), 'Verifying…');
      recovery.verify(state.email, otp).then(function (res) {
        verifying = false;
        restore();
        if (res.httpStatus === 200 && res.resetToken) {
          state.token = res.resetToken;
          stopTimers();
          clearDigits();
          resetForm.reset();
          vr.reset();
          resetForm.elements.password.dispatchEvent(new Event('input'));
          show('password', resetForm.elements.password);
          return;
        }
        otpField.classList.add('is-invalid');
        clearDigits();
        otpField.classList.add('is-invalid');
        var msg = res.httpStatus === 0 ? SERVER_DOWN : {
          incorrect: 'That code isn’t right. ' + res.attemptsLeft + (res.attemptsLeft === 1 ? ' attempt' : ' attempts') + ' left.',
          locked: 'Too many incorrect attempts, so this code no longer works. Request a new code.',
          expired: 'This code has expired. Request a new code.',
          invalid: 'This code is no longer valid. Request a new code.',
          format: 'Enter all 6 digits of the code.',
          'too-many': 'Too many attempts from this device. Try again in ' + minutes(res.retryAfter || 900) + '.'
        }[res.error] || 'The code couldn’t be checked. Please try again.';
        F().alert(codeAlert, 'error', msg);
        digits[0].focus();
      }, function () {
        verifying = false; restore();
        F().alert(codeAlert, 'error', SERVER_DOWN);
      });
    }
    otpForm.addEventListener('submit', function (e) { e.preventDefault(); submitCode(); });

    resendBtn.addEventListener('click', function () {
      F().alert(codeAlert, 'error', '');
      requestCode(state.email, codeAlert, resendBtn, function (res, cooldown) {
        if (cooldown) { startTimers(0, res.retryAfter); return; }
        clearDigits();
        startTimers(res.expiresIn, res.resendIn);
        F().alert(codeAlert, 'success', 'A new code is on its way. Any earlier code no longer works.');
        digits[0].focus();
      });
    });
    steps.code.querySelector('[data-a="change"]').addEventListener('click', function () {
      stopTimers();
      clearDigits();
      F().alert(emailAlert, 'error', '');
      show('email', emailForm.elements.email);
      emailForm.elements.email.select();
    });

    /* ----- 3. new password ----- */
    var resetForm = $('resetForm');
    var pwAlert = $('fpPwAlert');
    F().passwordToggles(resetForm);
    F().passwordChecklist(resetForm);
    var vr = F().bind(resetForm, {
      password: V().password,
      confirm: function (val, f) { return V().confirm(val, f.elements.password.value); }
    });
    var saving = false;
    resetForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (saving) return;
      F().alert(pwAlert, 'error', '');
      if (vr.check().length) return;
      saving = true;
      var restore = F().busy(resetForm.querySelector('[type="submit"]'), 'Updating password…');
      recovery.reset(state.token, resetForm.elements.password.value).then(function (res) {
        saving = false;
        restore();
        if (res.httpStatus === 200 && res.ok) {
          state.token = '';
          resetForm.reset();
          // this browser's own session for the account ended with the reset
          if (Eventora.auth.current() && Eventora.auth.current().email === state.email.toLowerCase()) Eventora.auth.signOut();
          show('done');
          redirectSoon();
          return;
        }
        if (res.field === 'password') { vr.show('password', res.error); return; }
        if (res.error === 'invalid-token') {
          state.token = '';
          F().alert(pwAlert, 'error', 'This reset session has expired (it lasts 10 minutes) or was already used. ');
          var again = document.createElement('button');
          again.type = 'button';
          again.className = 'fp-linkbtn';
          again.textContent = 'Start again';
          again.addEventListener('click', function () {
            F().alert(pwAlert, 'error', '');
            show('email', emailForm.elements.email);
          });
          pwAlert.appendChild(again);
          return;
        }
        F().alert(pwAlert, 'error', res.httpStatus === 0 ? SERVER_DOWN : 'The password couldn’t be updated. Please try again.');
      }, function () {
        saving = false; restore();
        F().alert(pwAlert, 'error', SERVER_DOWN);
      });
    });

    /* ----- 4. done: on to sign-in ----- */
    function redirectSoon() {
      var left = 6;
      var el = steps.done.querySelector('[data-a="redirect"]');
      (function step() {
        left -= 1;
        if (left <= 0) { location.href = 'login.html?reset=1'; return; }
        el.textContent = 'Taking you to sign in in ' + left + ' second' + (left === 1 ? '' : 's') + '…';
        setTimeout(step, 1000);
      })();
    }
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
