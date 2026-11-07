/* =========================================================================
   ACCOUNT NAV — role-based navigation in the nav pill (every page).

   | Role       | Nav button                       | Account icon        |
   |------------|----------------------------------|---------------------|
   | Visitor    | "Host an Event" → Sign in        | Sign in             |
   | User       | "Host an Event" → apply to host  | My Profile          |
   | Event Host | "Host Dashboard" → own events    | My Profile          |
   | Admin      | "Admin Panel" → admin.html       | Admin account page  |

   Admins also get a "Host an Event" text link after Contact, which opens
   "Create an event" on their account page (profile.html#create-event).

   The Admin Panel (admin.html) and the account page (profile.html, where
   admins also create events) are separate destinations. The button sits in
   the hero's fitted nav; when its label changes, js/layout.js re-fits it.
   host.html routes signed-in people: users to the host application, hosts
   to their dashboard, admins to "Create event" on their account page.
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
    visitor: { cta: 'login.html?next=host.html', label: 'Host an Event', host: 'login.html?next=host.html', account: null },
    user: { cta: 'profile.html#host-application', label: 'Host an Event', host: 'profile.html#host-application', account: 'profile.html' },
    host: { cta: 'host-dashboard.html', label: 'Host Dashboard', host: 'host-dashboard.html#create', account: 'profile.html' },
    admin: { cta: 'admin.html', label: 'Admin Panel', host: 'profile.html#create-event', account: 'profile.html' }
  };

  function renderCta(role) {
    var cta = document.querySelector('.nav .btn');
    var label = document.getElementById('ctaLabel');
    if (!cta || !label) return;
    var d = DEST[role];
    cta.href = d.cta;
    cta.setAttribute('aria-label', { visitor: 'Host an Event: sign in to get started', user: 'Host an Event: apply to become a host',
      host: 'Host Dashboard: manage your events', admin: 'Admin Panel' }[role]);
    if (page() === d.cta.split('#')[0]) cta.setAttribute('aria-current', 'page'); else cta.removeAttribute('aria-current');
    if (label.textContent !== d.label) {
      label.textContent = d.label;
      // the hero nav is a fitted design: re-fit the new label (no-op before layout starts)
      if (Eventora.layout && Eventora.layout.state && Eventora.layout.state.ready) Eventora.layout.layout();
    }
  }

  /** Admins also get a "Host an Event" text link at the end of the link row
      (Create an event on their account page); other roles don't. */
  function renderHostLink(role) {
    var row = document.getElementById('links');
    if (!row) return;
    var link = document.getElementById('navHostLink');
    var want = role === 'admin';
    if (want === !!link) return;
    if (want) {
      link = document.createElement('a');
      link.id = 'navHostLink';
      link.href = DEST.admin.host;
      link.textContent = 'Host an Event';
      link.setAttribute('aria-label', 'Host an Event: create an event on your account page');
      row.appendChild(link);
    } else {
      link.remove();
    }
    if (Eventora.layout && Eventora.layout.state && Eventora.layout.state.ready) Eventora.layout.layout();
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
    link.setAttribute('aria-label', (isAdmin ? 'Admin account: ' : 'My profile: ') + u.name);
    if (u.avatar) {
      var img = new Image();
      img.alt = '';
      img.src = u.avatar;
      badge.appendChild(img);
    } else {
      badge.textContent = u.name.trim().charAt(0).toUpperCase();
    }
    labelEl.textContent = (isAdmin ? 'Admin account · ' : 'My profile · ') + u.name.split(' ')[0];
    if (page() === link.getAttribute('href')) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }

  function render() {
    if (!Eventora.auth) return;
    var u = Eventora.auth.current();
    var role = navRole(u);
    renderCta(role);
    renderHostLink(role);
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
