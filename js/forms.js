/* =========================================================================
   FORMS — small helpers shared by the account, host and admin pages.
   Same behaviour as the registration form: a field is checked when you leave
   it (after typing), live while it shows an error, and on submit (focus goes
   to the first problem). Errors are tied to inputs with aria-invalid +
   aria-describedby. Markup: .field > .field__label + input + .field__error.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  function errorEl(input) {
    var id = input.id + 'Error';
    var e = document.getElementById(id);
    if (!e) {
      e = document.createElement('p');
      e.className = 'field__error';
      e.id = id;
      e.hidden = true;
      (input.closest('.field__control') || input).insertAdjacentElement('afterend', e);
      var d = (input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
      if (d.indexOf(id) === -1) d.push(id);
      input.setAttribute('aria-describedby', d.join(' '));
    }
    return e;
  }

  function show(input, msg) {
    var e = errorEl(input);
    e.textContent = msg || '';
    e.hidden = !msg;
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    var wrap = input.closest('.field');
    if (wrap) {
      wrap.classList.toggle('is-invalid', !!msg);
      wrap.classList.toggle('is-valid', !msg && String(input.value).trim() !== '' && input.type !== 'password');
    }
  }

  /**
   * Wire a form. `rules` maps input name → function(value, form) returning a
   * message ('' = valid). Returns { check(): names of invalid fields, show,
   * reset }.
   */
  function bind(form, rules) {
    var visited = {};
    function input(name) { return form.elements[name]; }
    function check(name) {
      var el = input(name);
      var msg = rules[name](el.value, form);
      show(el, msg);
      return !msg;
    }
    Object.keys(rules).forEach(function (name) {
      var el = input(name);
      if (!el) return;
      el.addEventListener('blur', function () {
        if (visited[name] || String(el.value).trim() !== '') { visited[name] = true; check(name); }
      });
      el.addEventListener('input', function () {
        var wrap = el.closest('.field');
        if (wrap && wrap.classList.contains('is-invalid')) check(name);
      });
    });
    return {
      check: function () {
        var bad = [];
        Object.keys(rules).forEach(function (n) { visited[n] = true; if (input(n) && !check(n)) bad.push(n); });
        if (bad.length) input(bad[0]).focus();
        return bad;
      },
      show: function (name, msg) { show(input(name), msg); if (msg) input(name).focus(); },
      reset: function () {
        Object.keys(rules).forEach(function (n) { visited[n] = false; if (input(n)) show(input(n), ''); });
      }
    };
  }

  /** Show/hide toggles: <button data-toggle-password="inputId">. */
  function passwordToggles(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('[data-toggle-password]'), function (btn) {
      var input = document.getElementById(btn.getAttribute('data-toggle-password'));
      if (!input) return;
      btn.setAttribute('aria-controls', input.id);
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', function () {
        var showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.setAttribute('aria-pressed', String(!showing));
        btn.setAttribute('aria-label', (showing ? 'Show' : 'Hide') + ' password');
        btn.querySelector('.pw-toggle__text').textContent = showing ? 'Show' : 'Hide';
        input.focus();
      });
    });
  }

  /** Live checklist: <ul data-password-checks="inputId"> <li data-check="length">… */
  function passwordChecklist(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('[data-password-checks]'), function (ul) {
      var input = document.getElementById(ul.getAttribute('data-password-checks'));
      if (!input) return;
      var update = function () {
        var c = Eventora.validate.passwordChecks(input.value);
        Array.prototype.forEach.call(ul.querySelectorAll('[data-check]'), function (li) {
          var ok = !!c[li.getAttribute('data-check')];
          li.classList.toggle('is-met', ok);
          li.querySelector('.visually-hidden').textContent = ok ? ' (done)' : ' (not yet)';
        });
      };
      input.addEventListener('input', update);
      update();
    });
  }

  /** Disable a submit button with a busy label; returns a restore function. */
  function busy(button, label) {
    var span = button.querySelector('span') || button;
    var original = span.textContent;
    button.setAttribute('aria-disabled', 'true');
    button.classList.add('is-busy');
    span.textContent = label;
    return function () {
      button.removeAttribute('aria-disabled');
      button.classList.remove('is-busy');
      span.textContent = original;
    };
  }

  /** Banner messages: el.className 'form-alert form-alert--error|success'. */
  function alert(el, kind, text) {
    el.className = 'form-alert form-alert--' + kind;
    el.textContent = text;
    el.hidden = !text;
  }

  /** A safe same-site "next" target from ?next= (relative pages only). */
  function nextUrl(fallback) {
    var n = new URLSearchParams(location.search).get('next') || '';
    if (/^[a-z0-9-]+\.html(?:[?#][^\s]*)?$/i.test(n) && !/^(login|signup|forgot-password)\.html/i.test(n)) return n;
    return fallback;
  }

  Eventora.forms = { bind: bind, show: show, passwordToggles: passwordToggles, passwordChecklist: passwordChecklist,
    busy: busy, alert: alert, nextUrl: nextUrl };
})(window.Eventora);
