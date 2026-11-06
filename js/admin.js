/* =========================================================================
   ADMIN DASHBOARD — admin.html.
   Shown only when the dev server confirms the signed-in email is ADMIN_EMAIL
   (js/auth.js). Every action re-checks the role before it runs, but this is
   still browser code: in the prototype it is NOT authorization. Phase 11's
   backend enforces the same rules on the server.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var auth, hosting, cat, F;
  var tab = 'users';
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  var fmtDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  function day(iso) { var d = new Date(iso); return isNaN(d) ? '—' : fmtDay.format(d); }
  function chip(status, label) {
    var s = el('span', 'app-status app-status--' + status);
    s.appendChild(el('span', 'app-status__dot'));
    s.appendChild(document.createTextNode(label || hosting.statusLabel(status)));
    return s;
  }
  function roleBadge(role) { return el('span', 'role-badge role-badge--' + role, auth.ROLE_LABELS[role]); }
  function regsFor(eventId) {
    return (Eventora.registrations ? Eventora.registrations.all() : []).filter(function (r) { return r.eventId === eventId && r.status !== 'cancelled'; }).length;
  }

  /** A button that needs a second click within 4 s (no blocking confirm()). */
  function armed(label, confirmLabel, cls, fn) {
    var b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', function () {
      if (b.getAttribute('data-armed') !== 'true') {
        b.setAttribute('data-armed', 'true');
        b.textContent = confirmLabel;
        setTimeout(function () { if (document.contains(b)) { b.removeAttribute('data-armed'); b.textContent = label; } }, 4000);
        return;
      }
      fn();
    });
    return b;
  }
  function button(label, cls, fn) { var b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function done(res, okMsg) {
    F.alert($('adAlert'), res.ok ? 'success' : 'error', res.ok ? okMsg : res.error);
    renderAll();
  }

  /* ---------- users ---------- */
  function renderUsers() {
    var users = auth.admin.listUsers().sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
    var me = auth.current();
    $('cUsers').textContent = users.length;
    var tbody = $('usersBody');
    tbody.textContent = '';
    users.forEach(function (u) {
      var tr = el('tr', u.status === 'suspended' ? 'is-muted' : '');
      var who = el('td');
      var name = el('div', 'cell-strong', u.name + (me && me.id === u.id ? ' (you)' : ''));
      who.appendChild(name);
      who.appendChild(el('div', 'cell-sub', u.email));
      tr.appendChild(who);
      var role = el('td');
      role.appendChild(roleBadge(u.role));
      tr.appendChild(role);
      var st = el('td');
      st.appendChild(chip(u.status === 'active' ? 'approved' : 'rejected', u.status === 'active' ? 'Active' : 'Suspended'));
      tr.appendChild(st);
      tr.appendChild(el('td', 'cell-sub', day(u.createdAt)));
      tr.appendChild(el('td', 'num', String(Eventora.registrations ? Eventora.registrations.forUser(u.id).length : 0)));
      var act = el('td', 'cell-actions');
      if (u.role === 'admin') {
        act.appendChild(el('span', 'cell-sub', 'Server-configured (ADMIN_EMAIL)'));
      } else {
        act.appendChild(u.role === 'host'
          ? armed('Revoke host', 'Confirm revoke', 'btn-ghost btn-sm', function () { done(auth.admin.setHost(u.id, false), u.name + ' is now a User.'); })
          : button('Make host', 'btn-ghost btn-sm', function () { done(auth.admin.setHost(u.id, true), u.name + ' is now an Event Host.'); }));
        act.appendChild(u.status === 'active'
          ? armed('Suspend', 'Confirm suspend', 'btn-ghost btn-sm btn-danger', function () { done(auth.admin.setStatus(u.id, 'suspended'), u.name + '’s account is suspended.'); })
          : button('Reactivate', 'btn-ghost btn-sm', function () { done(auth.admin.setStatus(u.id, 'active'), u.name + '’s account is active again.'); }));
      }
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  }

  /* ---------- host applications ---------- */
  function appCard(a) {
    var li = el('li', 'app-card');
    var head = el('div', 'app-card__head');
    var who = el('div');
    who.appendChild(el('p', 'cell-strong', a.name));
    who.appendChild(el('p', 'cell-sub', a.email + ' · ' + a.phone));
    head.appendChild(who);
    head.appendChild(chip(a.status));
    li.appendChild(head);
    var dl = el('dl', 'app-card__facts');
    [['Application', a.id], ['Submitted', day(a.createdAt)], ['Organization', a.organization || '—'],
      ['Current role', auth.ROLE_LABELS[(auth.userById(a.userId) || {}).role] || 'Account removed']].forEach(function (p) {
      dl.appendChild(el('dt', '', p[0])); dl.appendChild(el('dd', '', p[1]));
    });
    li.appendChild(dl);
    li.appendChild(el('p', 'app-card__label', 'Why they want to host'));
    li.appendChild(el('p', 'app-card__text', a.reason));
    if (a.info) { li.appendChild(el('p', 'app-card__label', 'Additional information')); li.appendChild(el('p', 'app-card__text', a.info)); }
    return li;
  }

  function renderApps() {
    var apps = hosting.admin.applications();
    var pending = apps.filter(function (a) { return a.status === 'pending'; });
    var processed = apps.filter(function (a) { return a.status !== 'pending'; });
    $('cApps').textContent = pending.length;
    var list = $('appsPending');
    list.textContent = '';
    if (!pending.length) list.appendChild(el('li', 'dash-empty dash-empty--small', 'No applications waiting for review.'));
    pending.forEach(function (a) {
      var li = appCard(a);
      var noteId = 'note-' + a.id;
      var lab = el('label', 'field__label', 'Note to the applicant (optional)');
      lab.htmlFor = noteId;
      var note = el('textarea', 'field__input field__input--area');
      note.id = noteId; note.rows = 2; note.maxLength = 500;
      var field = el('div', 'field');
      field.appendChild(lab); field.appendChild(note);
      li.appendChild(field);
      var actions = el('div', 'cluster');
      var approve = button('', 'btn btn--md', function () {
        done(hosting.admin.decideApplication(a.id, 'approved', note.value), a.name + ' is approved and is now an Event Host.');
      });
      approve.appendChild(el('span', '', 'Approve'));          // .btn labels sit in a span
      actions.appendChild(approve);
      actions.appendChild(armed('Reject', 'Confirm reject', 'btn-ghost btn-danger', function () {
        done(hosting.admin.decideApplication(a.id, 'rejected', note.value), a.name + '’s application was rejected. They keep the User role.');
      }));
      li.appendChild(actions);
      list.appendChild(li);
    });

    var tbody = $('appsBody');
    tbody.textContent = '';
    $('appsProcessedEmpty').hidden = processed.length > 0;
    $('appsTable').hidden = processed.length === 0;
    processed.forEach(function (a) {
      var tr = el('tr');
      var who = el('td');
      who.appendChild(el('div', 'cell-strong', a.name));
      who.appendChild(el('div', 'cell-sub', a.email));
      tr.appendChild(who);
      var st = el('td'); st.appendChild(chip(a.status)); tr.appendChild(st);
      tr.appendChild(el('td', 'cell-sub', day(a.createdAt)));
      tr.appendChild(el('td', 'cell-sub', day(a.decidedAt)));
      tr.appendChild(el('td', 'cell-sub', a.note || '—'));
      tbody.appendChild(tr);
    });
  }

  /* ---------- events ---------- */
  function renderEvents() {
    var events = hosting.admin.events();
    $('cEvents').textContent = events.filter(function (e) { return e.status === 'pending'; }).length;
    var tbody = $('eventsBody');
    tbody.textContent = '';
    $('eventsEmpty').hidden = events.length > 0;
    $('eventsTable').hidden = events.length === 0;
    events.forEach(function (e) {
      var tr = el('tr');
      var t = el('td');
      t.appendChild(el('div', 'cell-strong', e.title));
      t.appendChild(el('div', 'cell-sub', e.category + ' · ' + e.date + ' ' + e.time + ' · ' + e.venue.city));
      if (e.note) t.appendChild(el('div', 'cell-sub', 'Note: ' + e.note));
      tr.appendChild(t);
      var host = auth.userById(e.hostId);
      var h = el('td');
      h.appendChild(el('div', '', host ? host.name : 'Unknown host'));
      h.appendChild(el('div', 'cell-sub', host ? host.email : e.hostId));
      tr.appendChild(h);
      var st = el('td'); st.appendChild(chip(e.status)); tr.appendChild(st);
      tr.appendChild(el('td', 'num', String(regsFor(e.id))));
      var act = el('td', 'cell-actions');
      var noteFor = function () { return ($('evNote').value || '').trim(); };
      if (e.status === 'pending') {
        act.appendChild(button('Approve', 'btn-ghost btn-sm btn-ok', function () { done(hosting.admin.setEventStatus(e.id, 'approved', noteFor()), '“' + e.title + '” is approved and now public.'); }));
        act.appendChild(armed('Reject', 'Confirm reject', 'btn-ghost btn-sm btn-danger', function () { done(hosting.admin.setEventStatus(e.id, 'rejected', noteFor()), '“' + e.title + '” was rejected.'); }));
      } else if (e.status === 'approved') {
        var view = el('a', 'btn-ghost btn-sm', 'View');
        view.href = 'event.html?id=' + encodeURIComponent(e.id);
        act.appendChild(view);
        act.appendChild(armed('Unpublish', 'Confirm unpublish', 'btn-ghost btn-sm btn-danger', function () { done(hosting.admin.setEventStatus(e.id, 'unpublished', noteFor()), '“' + e.title + '” is no longer public.'); }));
      } else {
        act.appendChild(button('Publish', 'btn-ghost btn-sm btn-ok', function () { done(hosting.admin.setEventStatus(e.id, 'approved', noteFor()), '“' + e.title + '” is public.'); }));
      }
      tr.appendChild(act);
      tbody.appendChild(tr);
    });

    var cbody = $('catalogueBody');
    cbody.textContent = '';
    cat.catalogue().forEach(function (e) {
      var tr = el('tr');
      var t = el('td');
      t.appendChild(el('div', 'cell-strong', e.title));
      t.appendChild(el('div', 'cell-sub', e.category + ' · ' + e.date));
      tr.appendChild(t);
      tr.appendChild(el('td', 'cell-sub', 'EVENTORA (built-in)'));
      tr.appendChild(el('td', 'num', String(regsFor(e.id))));
      cbody.appendChild(tr);
    });
  }

  function renderAll() { renderUsers(); renderApps(); renderEvents(); }

  /* ---------- tabs ---------- */
  function select(name, focus) {
    tab = name;
    ['users', 'apps', 'events'].forEach(function (n) {
      var t = $('tab-' + n), p = $('panel-' + n), on = n === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      p.hidden = !on;
    });
    if (focus) $('tab-' + name).focus();
  }
  function bindTabs() {
    var order = ['users', 'apps', 'events'];
    order.forEach(function (n, i) {
      var t = $('tab-' + n);
      t.addEventListener('click', function () { select(n); });
      t.addEventListener('keydown', function (e) {
        var j = e.key === 'ArrowRight' ? (i + 1) % 3 : e.key === 'ArrowLeft' ? (i + 2) % 3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : -1;
        if (j < 0) return;
        e.preventDefault();
        select(order[j], true);
      });
    });
  }

  function deny(u) {
    if (!u) { location.replace('login.html?next=admin.html'); return; }
    $('dashDenied').hidden = false;
    $('dashBody').hidden = true;
    var why = {
      'not-configured': 'No ADMIN_EMAIL is configured on the server, so no account is an Admin yet.',
      unavailable: 'The admin check server couldn’t be reached (start the site with tools/dev_server.py).'
    }[auth.adminCheckStatus()];
    if (why) $('deniedWhy').textContent = why;
  }

  Eventora.admin = {
    init: function () {
      if (!$('usersBody') || !Eventora.auth || !Eventora.hosting) return;
      auth = Eventora.auth; hosting = Eventora.hosting; cat = Eventora.events; F = Eventora.forms;
      if (!auth.current()) { deny(null); return; }
      auth.ready().then(function (u) {
        if (!u || !auth.can('manageUsers')) { deny(u); return; }
        $('dashBody').hidden = false;
        $('adWho').textContent = u.email;
        bindTabs();
        var h = location.hash.replace('#', '');
        select(['users', 'apps', 'events'].indexOf(h) !== -1 ? h : 'users');
        renderAll();
        window.addEventListener('storage', function () { if (auth.can('manageUsers')) renderAll(); });
      });
    }
  };
})(window.Eventora);
