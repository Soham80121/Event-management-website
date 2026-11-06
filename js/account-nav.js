/* =========================================================================
   ACCOUNT NAV — the account entry in the nav pill (every page).

   Desktop: a 32px glass circle in the gap between the link row and the
   "Host an Event" button (nothing else in the pill moves).
   Tablet/phone: a full-width row in the burger panel, above the CTA.

   Signed out → "Sign in" (login.html?next=<this page>)
   Signed in  → avatar or initial, "Account" → profile.html
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4"/></svg>';

  function page() { return location.pathname.split('/').pop() || 'index.html'; }

  function render() {
    var link = document.getElementById('acctLink');
    if (!link || !Eventora.auth) return;
    var u = Eventora.auth.current();
    var badge = link.querySelector('.acct__badge');
    var label = link.querySelector('.acct__label');
    badge.textContent = '';
    link.classList.toggle('is-signed-in', !!u);
    if (!u) {
      var here = page();
      var authPage = /^(login|signup|forgot-password)\.html$/.test(here);
      link.href = authPage ? 'login.html' : 'login.html?next=' + encodeURIComponent(here + location.search + location.hash);
      link.setAttribute('aria-label', 'Sign in');
      badge.innerHTML = ICON;
      label.textContent = 'Sign in';
      if (here === 'login.html') link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
      return;
    }
    link.href = 'profile.html';
    var role = Eventora.auth.ROLE_LABELS[u.role];
    link.setAttribute('aria-label', 'Your account: ' + u.name + ' (' + role + ')');
    if (u.avatar) {
      var img = new Image();
      img.alt = '';
      img.src = u.avatar;
      badge.appendChild(img);
    } else {
      badge.textContent = u.name.trim().charAt(0).toUpperCase();
    }
    label.textContent = 'My account · ' + u.name.split(' ')[0];
    if (page() === 'profile.html') link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }

  Eventora.accountNav = {
    init: function () {
      render();
      if (Eventora.auth) {
        Eventora.auth.onChange(render);
        Eventora.auth.ready().then(render);
      }
    }
  };
})(window.Eventora);
