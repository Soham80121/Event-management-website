/* =========================================================================
   ACCOUNT NAV — role-based navigation in the nav pill (every page).

   | Role       | "Host an Event" goes to         | Account entry goes to |
   |------------|---------------------------------|-----------------------|
   | Visitor    | Sign in (then back to host.html)| Sign in               |
   | User       | Apply to become a Host          | My Profile            |
   | Event Host | Host Dashboard → Create Event   | My Profile            |
   | Admin      | Admin Dashboard → Create Event  | Admin Dashboard       |

   The visible label stays "Host an Event" (the hero nav is a fitted, pixel-
   laid-out design); only the destination changes. host.html routes signed-in
   people the same way, so the sign-in round trip lands in the right place.
   Admins are recognised from the account the server-verified admin sign-in
   created, so the right destination is set before the server re-confirms
   the admin session (the Admin Dashboard itself still waits for it).

   UI routing only — not authorization (see js/auth.js).
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4"/></svg>';

  function page() { return location.pathname.split('/').pop() || 'index.html'; }

  /** 'visitor' | 'user' | 'host' | 'admin' for navigation purposes. */
  function navRole(u) {
    if (!u) return 'visitor';
    if (u.role === 'admin' || u.adminAccount) return 'admin';
    return u.role;
  }

  var DEST = {
    visitor: { host: 'login.html?next=host.html', account: null },
    user: { host: 'profile.html#host-application', account: 'profile.html' },
    host: { host: 'host-dashboard.html#create', account: 'profile.html' },
    admin: { host: 'admin.html#create', account: 'admin.html' }
  };

  function renderCta(role) {
    var cta = document.querySelector('.nav .btn');
    if (!cta) return;
    cta.href = DEST[role].host;
    var label = { visitor: 'Host an Event: sign in to get started', user: 'Host an Event: apply to become a host',
      host: 'Host an Event: create an event', admin: 'Host an Event: create an event' }[role];
    cta.setAttribute('aria-label', label);
  }

  function renderAccount(u, role) {
    var link = document.getElementById('acctLink');
    if (!link) return;
    var badge = link.querySelector('.acct__badge');
    var labelEl = link.querySelector('.acct__label');
    badge.textContent = '';
    link.classList.toggle('is-signed-in', !!u);
    if (!u) {
      var here = page();
      var authPage = /^(login|signup|forgot-password)\.html$/.test(here);
      link.href = authPage ? 'login.html' : 'login.html?next=' + encodeURIComponent(here + location.search + location.hash);
      link.setAttribute('aria-label', 'Sign in');
      badge.innerHTML = ICON;
      labelEl.textContent = 'Sign in';
      if (here === 'login.html') link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
      return;
    }
    link.href = DEST[role].account;
    var isAdmin = role === 'admin';
    link.setAttribute('aria-label', (isAdmin ? 'Admin dashboard: ' : 'My profile: ') + u.name);
    if (u.avatar) {
      var img = new Image();
      img.alt = '';
      img.src = u.avatar;
      badge.appendChild(img);
    } else {
      badge.textContent = u.name.trim().charAt(0).toUpperCase();
    }
    labelEl.textContent = (isAdmin ? 'Admin dashboard · ' : 'My profile · ') + u.name.split(' ')[0];
    if (page() === link.getAttribute('href')) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }

  function render() {
    if (!Eventora.auth) return;
    var u = Eventora.auth.current();
    var role = navRole(u);
    renderCta(role);
    renderAccount(u, role);
  }

  /** host.html: signed-in people go straight to their own hosting destination. */
  function routeHostPage() {
    if (page() !== 'host.html' || !Eventora.auth) return;
    var role = navRole(Eventora.auth.current());
    if (role !== 'visitor') location.replace(DEST[role].host);
  }

  Eventora.accountNav = {
    init: function () {
      render();
      routeHostPage();
      if (Eventora.auth) {
        Eventora.auth.onChange(render);
        Eventora.auth.ready().then(render);
      }
    },
    destination: function (kind) { return DEST[navRole(Eventora.auth && Eventora.auth.current())][kind]; }
  };
})(window.Eventora);
