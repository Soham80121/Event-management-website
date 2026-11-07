/* =========================================================================
   ADMIN PANEL — admin.html, the central administrative interface, reached
   from the "Admin Panel" item in the navbar. It is separate from the Admin's
   account page (profile.html), which is where admins create events.

   A. Overview         live counts from the real data + the two review queues
   B. Host apps        all applications, filter by status, review, approve/reject
   C. Event approvals  submitted events with submission + host details,
                       approve / reject
   D. All events       every event (built-in + host + admin-created), filter by
                       status, review, edit (shared js/event-form.js),
                       publish/unpublish, cancel, remove
   E. Users            all accounts, details, host role, suspend; the initial
                       Admin account is protected
   F. Registrations    every booking, filter by event and status, QR check-in

   Shown only when the dev server confirms the admin session (js/auth.js).
   Every action re-checks the role, but it is still browser code: a
   DEVELOPMENT PROTOTYPE, not authorization. Phase 11's backend enforces it.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var auth, hosting, cat, F, store;
  var formApi = null;
  var appFilter = 'pending', eventFilter = 'all';
  var TABS = ['overview', 'apps', 'approvals', 'events', 'users', 'regs'];

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  var fmtDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  function day(iso) { var d = new Date(iso); return iso && !isNaN(d) ? fmtDay.format(d) : '—'; }
  function eventDay(e) { var p = e.date.split('-').map(Number); return fmtDay.format(new Date(p[0], p[1] - 1, p[2])) + ' · ' + e.time; }
  function chip(status, label) {
    var s = el('span', 'app-status app-status--' + status);
    s.appendChild(el('span', 'app-status__dot'));
    s.appendChild(document.createTextNode(label));
    return s;
  }
  function eventChip(status) { return chip(status === 'approved' ? 'published' : status, hosting.statusLabel(status, 'event')); }
  function roleBadge(role) { return el('span', 'role-badge role-badge--' + role, auth.ROLE_LABELS[role]); }
  function button(label, cls, fn) {
    var b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', fn); return b;
  }
  /** Needs a second click within 4 s — confirmation without a blocking dialog. */
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
  function done(res, okMsg) {
    F.alert($('adAlert'), res.ok ? 'success' : 'error', res.ok ? okMsg : res.error);
    renderAll();
    if (res.ok && $('adDialog').open) $('adDialog').close();
  }

  /* ---------- registration helpers ---------- */
  function regState(r) {
    if (r.status === 'cancelled') return 'cancelled';
    var e = cat.byId(r.eventId) || cat.catalogue().filter(function (x) { return x.id === r.eventId; })[0];
    if (e) {
      var p = e.date.split('-').map(Number), now = new Date();
      if (new Date(p[0], p[1] - 1, p[2]) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) return 'completed';
    }
    return 'confirmed';
  }
  function activeRegs(eventId) {
    return store.all().filter(function (r) { return r.eventId === eventId && r.status !== 'cancelled'; }).length;
  }

  /* =========================================================================
     A. OVERVIEW
     ========================================================================= */
  function renderOverview() {
    var users = auth.admin.listUsers();
    var apps = hosting.admin.applications();
    var events = hosting.admin.allEvents();
    var regs = store.all();
    var pendingApps = apps.filter(function (a) { return a.status === 'pending'; });
    var pendingEvents = events.filter(function (e) { return e.status === 'pending'; });
    var stats = [
      ['Total users', users.length, 'users', null],
      ['Total events', events.length, 'events', 'all'],
      ['Pending host applications', pendingApps.length, 'apps', 'pending'],
      ['Pending event approvals', pendingEvents.length, 'approvals', null],
      ['Published events', events.filter(function (e) { return e.status === 'approved'; }).length, 'events', 'approved'],
      ['Total registrations', regs.length, 'regs', null]
    ];
    var box = $('ovStats');
    box.textContent = '';
    stats.forEach(function (s) {
      var b = el('button', 'stat stat--link');
      b.type = 'button';
      b.appendChild(el('span', 'stat__label', s[0]));
      b.appendChild(el('span', 'stat__value', String(s[1])));
      if ((s[0].indexOf('Pending') === 0) && s[1] > 0) b.classList.add('stat--attention');
      b.addEventListener('click', function () {
        if (s[2] === 'apps' && s[3]) appFilter = s[3];
        if (s[2] === 'events' && s[3]) eventFilter = s[3];
        renderAll();
        select(s[2], true);
      });
      box.appendChild(b);
    });

    var la = $('ovApps');
    la.textContent = '';
    if (!pendingApps.length) la.appendChild(el('li', 'ov-empty', 'Nothing waiting.'));
    pendingApps.slice(0, 5).forEach(function (a) {
      var li = el('li', 'ov-item');
      var t = el('div');
      t.appendChild(el('p', 'cell-strong', a.name));
      t.appendChild(el('p', 'cell-sub', (a.organization || 'No organization') + ' · ' + day(a.createdAt)));
      li.appendChild(t);
      li.appendChild(button('Review', 'btn-ghost btn-sm', function () { reviewApp(a); }));
      la.appendChild(li);
    });

    var le = $('ovEvents');
    le.textContent = '';
    if (!pendingEvents.length) le.appendChild(el('li', 'ov-empty', 'Nothing waiting.'));
    pendingEvents.slice(0, 5).forEach(function (row) {
      var li = el('li', 'ov-item');
      var t = el('div');
      t.appendChild(el('p', 'cell-strong', row.event.title));
      t.appendChild(el('p', 'cell-sub', row.hostName + ' · ' + eventDay(row.event)));
      li.appendChild(t);
      li.appendChild(button('Review', 'btn-ghost btn-sm', function () { reviewEvent(row); }));
      le.appendChild(li);
    });
  }

  /* =========================================================================
     B. HOST APPLICATIONS
     ========================================================================= */
  function filterChips(boxId, options, current, onPick) {
    var box = $(boxId);
    box.textContent = '';
    options.forEach(function (o) {
      var b = el('button', 'chip');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(o[0] === current));
      b.appendChild(document.createTextNode(o[1] + ' '));
      b.appendChild(el('span', 'chip__count', String(o[2])));
      b.addEventListener('click', function () { onPick(o[0]); });
      box.appendChild(b);
    });
  }

  function renderApps() {
    var apps = hosting.admin.applications();
    var count = function (s) { return apps.filter(function (a) { return s === 'all' || a.status === s; }).length; };
    document.querySelector('[data-count="apps"]').textContent = count('pending');
    filterChips('appFilters', [['pending', 'Pending', count('pending')], ['approved', 'Approved', count('approved')],
      ['rejected', 'Rejected', count('rejected')], ['all', 'All', count('all')]], appFilter,
      function (v) { appFilter = v; renderApps(); });

    var rows = apps.filter(function (a) { return appFilter === 'all' || a.status === appFilter; });
    var tbody = $('appsBody');
    tbody.textContent = '';
    $('appsEmpty').hidden = rows.length > 0;
    rows.forEach(function (a) {
      var tr = el('tr');
      var who = el('td');
      who.appendChild(el('div', 'cell-strong', a.name));
      who.appendChild(el('div', 'cell-sub', a.email));
      tr.appendChild(who);
      tr.appendChild(el('td', '', a.organization || '—'));
      tr.appendChild(el('td', 'cell-sub', day(a.createdAt)));
      var st = el('td'); st.appendChild(chip(a.status, hosting.statusLabel(a.status))); tr.appendChild(st);
      var act = el('td', 'cell-actions');
      act.appendChild(button(a.status === 'pending' ? 'Review' : 'View', 'btn-ghost btn-sm', function () { reviewApp(a); }));
      if (a.status === 'pending') {
        act.appendChild(button('Approve', 'btn-ghost btn-sm btn-ok', function () { decideApp(a, 'approved', ''); }));
        act.appendChild(armed('Reject', 'Confirm reject', 'btn-ghost btn-sm btn-danger', function () { decideApp(a, 'rejected', ''); }));
      }
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  }

  function decideApp(a, decision, note) {
    done(hosting.admin.decideApplication(a.id, decision, note),
      decision === 'approved' ? a.name + ' is approved and is now an Event Host.' : a.name + '’s application was rejected. They keep the User role.');
  }

  function reviewApp(a) {
    var body = openDialog('Host application', a.name);
    var current = auth.userById(a.userId);
    body.appendChild(facts([
      ['Status', hosting.statusLabel(a.status)], ['Application', a.id], ['Email', a.email], ['Phone', a.phone],
      ['Organization', a.organization || '—'], ['Applied', day(a.createdAt)],
      ['Current role', current ? auth.ROLE_LABELS[current.role] : 'Account removed'],
      ['Decided', a.decidedAt ? day(a.decidedAt) : '—']
    ]));
    body.appendChild(el('p', 'app-card__label', 'Why they want to host'));
    body.appendChild(el('p', 'app-card__text', a.reason));
    if (a.info) { body.appendChild(el('p', 'app-card__label', 'Additional information')); body.appendChild(el('p', 'app-card__text', a.info)); }
    if (a.note) { body.appendChild(el('p', 'app-card__label', 'Admin note')); body.appendChild(el('p', 'app-card__text', a.note)); }
    if (a.status === 'pending') {
      var note = noteField(body, 'Note to the applicant (optional)');
      var row = el('div', 'cluster');
      var ok = button('', 'btn btn--md', function () { decideApp(a, 'approved', note.value); });
      ok.appendChild(el('span', '', 'Approve'));
      row.appendChild(ok);
      row.appendChild(armed('Reject', 'Confirm reject', 'btn-ghost btn-danger', function () { decideApp(a, 'rejected', note.value); }));
      body.appendChild(row);
    }
  }

  /* =========================================================================
     C. EVENT MANAGEMENT
     ========================================================================= */
  var EVENT_FILTERS = [['all', 'All'], ['pending', 'Pending'], ['approved', 'Published'], ['unpublished', 'Unpublished'],
    ['rejected', 'Rejected'], ['cancelled', 'Cancelled']];

  function sourceLabel(row) { return { catalogue: 'Built-in', host: 'Host event', admin: 'Admin event' }[row.source]; }

  function renderEvents() {
    var rows = hosting.admin.allEvents();
    var count = function (s) { return rows.filter(function (r) { return s === 'all' || r.status === s; }).length; };
    document.querySelector('[data-count="events"]').textContent = count('all');
    filterChips('eventFilters', EVENT_FILTERS.map(function (f) { return [f[0], f[1], count(f[0])]; }), eventFilter,
      function (v) { eventFilter = v; renderEvents(); });
    var shown = rows.filter(function (r) { return eventFilter === 'all' || r.status === eventFilter; })
      .sort(function (a, b) {
        var p = (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1);
        return p || (a.event.date < b.event.date ? -1 : a.event.date > b.event.date ? 1 : 0);
      });
    var tbody = $('eventsBody');
    tbody.textContent = '';
    $('eventsEmpty').hidden = shown.length > 0;
    shown.forEach(function (row) {
      var e = row.event;
      var tr = el('tr');
      var t = el('td');
      t.appendChild(el('div', 'cell-strong', e.title));
      t.appendChild(el('div', 'cell-sub', e.category + ' · ' + eventDay(e) + ' · ' + e.venue.city));
      t.appendChild(el('span', 'src-tag src-tag--' + row.source, sourceLabel(row)));
      tr.appendChild(t);
      var host = row.hostId ? auth.userById(row.hostId) : null;
      var h = el('td');
      h.appendChild(el('div', '', host ? host.name : row.hostName));
      if (host) h.appendChild(el('div', 'cell-sub', host.email));
      tr.appendChild(h);
      var st = el('td'); st.appendChild(eventChip(row.status)); tr.appendChild(st);
      tr.appendChild(el('td', 'num', String(activeRegs(row.id))));
      var act = el('td', 'cell-actions');
      act.appendChild(button('Review', 'btn-ghost btn-sm', function () { reviewEvent(row); }));
      act.appendChild(button('Edit', 'btn-ghost btn-sm', function () { openForm(row); }));
      eventActions(row).forEach(function (b) { act.appendChild(b); });
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  }

  /* ----- Event approvals: submitted events with submission + host details ----- */
  function renderApprovals() {
    var rows = hosting.admin.allEvents().filter(function (r) { return r.status === 'pending'; })
      .sort(function (a, b) { return a.submittedAt < b.submittedAt ? -1 : 1; });
    document.querySelector('[data-count="approvals"]').textContent = rows.length;
    var list = $('approvalsList');
    list.textContent = '';
    if (!rows.length) {
      list.appendChild(el('li', 'dash-empty dash-empty--small', 'No events are waiting for approval.'));
      return;
    }
    rows.forEach(function (row) {
      var e = row.event, host = row.hostId ? auth.userById(row.hostId) : null;
      var li = el('li', 'app-card approval-card');
      var fig = el('figure', 'approval-card__poster');
      var img = new Image(); img.alt = e.image.alt; img.loading = 'lazy'; img.src = cat.imageUrl(e, 200, 300);
      fig.appendChild(img);
      li.appendChild(fig);
      var body = el('div', 'approval-card__body');
      var head = el('div', 'app-card__head');
      var t = el('div');
      t.appendChild(el('p', 'cell-strong', e.title));
      t.appendChild(el('p', 'cell-sub', e.category + ' · ' + eventDay(e) + ' · ' + e.venue.name + ', ' + e.venue.city));
      head.appendChild(t);
      head.appendChild(eventChip(row.status));
      body.appendChild(head);
      body.appendChild(el('p', 'app-card__label', 'Submission'));
      body.appendChild(facts([
        ['Submitted', day(row.submittedAt)], ['Source', sourceLabel(row)], ['Price', e.price ? '$' + e.price.amount : 'Free'], ['Event ID', row.id]
      ]));
      body.appendChild(el('p', 'app-card__label', 'Host'));
      body.appendChild(facts(host ? [
        ['Name', host.name], ['Email', host.email], ['Role', auth.ROLE_LABELS[host.role]], ['Member since', day(host.createdAt)]
      ] : [['Host', row.hostName]]));
      body.appendChild(el('p', 'app-card__label', 'Description'));
      body.appendChild(el('p', 'app-card__text', e.description));
      var note = noteField(body, 'Note to the host (optional)');
      var actions = el('div', 'cluster');
      var ok = button('', 'btn btn--md', function () {
        done(hosting.admin.setEventStatus(row.id, 'approved', note.value), '“' + e.title + '” is approved and now published.');
      });
      ok.appendChild(el('span', '', 'Approve'));
      actions.appendChild(ok);
      if (row.source !== 'catalogue') {
        actions.appendChild(armed('Reject', 'Confirm reject', 'btn-ghost btn-danger', function () {
          done(hosting.admin.setEventStatus(row.id, 'rejected', note.value), '“' + e.title + '” was rejected.');
        }));
      }
      actions.appendChild(button('Edit details', 'btn-ghost', function () { openForm(row); }));
      body.appendChild(actions);
      li.appendChild(body);
      list.appendChild(li);
    });
  }

  /** Status buttons for one event (used in the table and the review dialog). */
  function eventActions(row, note) {
    var title = row.event.title, out = [];
    var n = function () { return note ? note.value : ''; };
    var set = function (status, msg) { return function () { done(hosting.admin.setEventStatus(row.id, status, n()), '“' + title + '” ' + msg); }; };
    if (row.status === 'pending') {
      out.push(button('Approve', 'btn-ghost btn-sm btn-ok', set('approved', 'is approved and now published.')));
      if (row.source !== 'catalogue') out.push(armed('Reject', 'Confirm reject', 'btn-ghost btn-sm btn-danger', set('rejected', 'was rejected.')));
    } else if (row.status === 'approved') {
      out.push(armed('Unpublish', 'Confirm unpublish', 'btn-ghost btn-sm', set('unpublished', 'is no longer public.')));
      out.push(armed('Cancel event', 'Confirm cancel', 'btn-ghost btn-sm btn-danger', set('cancelled', 'is cancelled. Its registrations are kept.')));
    } else {
      out.push(button('Publish', 'btn-ghost btn-sm btn-ok', set('approved', 'is published.')));
      if (row.status !== 'cancelled') out.push(armed('Cancel event', 'Confirm cancel', 'btn-ghost btn-sm btn-danger', set('cancelled', 'is cancelled. Its registrations are kept.')));
    }
    if (row.source !== 'catalogue') {
      out.push(armed('Remove', 'Confirm remove', 'btn-ghost btn-sm btn-danger', function () {
        if (formApi && formApi.editing() === row.id) formApi.cancel();
        done(hosting.admin.removeEvent(row.id), '“' + title + '” was removed. Its registrations are kept.');
      }));
    }
    return out;
  }

  function reviewEvent(row) {
    var e = row.event;
    var body = openDialog(sourceLabel(row) + ' · ' + hosting.statusLabel(row.status, 'event'), e.title);
    var wrap = el('div', 'ad-review');
    var fig = el('figure', 'ad-review__poster');
    var img = new Image(); img.alt = e.image.alt; img.src = cat.imageUrl(e, 300, 450);
    fig.appendChild(img);
    wrap.appendChild(fig);
    var info = el('div');
    info.appendChild(facts([
      ['Category', e.category], ['Date', eventDay(e)], ['Venue', e.venue.name + ', ' + e.venue.city],
      ['Price', e.price ? '$' + e.price.amount : 'Free'], ['Host', row.hostName],
      ['Submitted', day(row.submittedAt)], ['Bookings', String(activeRegs(row.id))], ['Event ID', row.id]
    ]));
    info.appendChild(el('p', 'app-card__label', 'Description'));
    info.appendChild(el('p', 'app-card__text', e.description));
    if (row.note) { info.appendChild(el('p', 'app-card__label', 'Admin note')); info.appendChild(el('p', 'app-card__text', row.note)); }
    wrap.appendChild(info);
    body.appendChild(wrap);
    var note = noteField(body, 'Note for this decision (optional, shown to the host)');
    var actions = el('div', 'cluster ad-review__actions');
    actions.appendChild(button('Edit details', 'btn-ghost btn-sm', function () { $('adDialog').close(); openForm(row); }));
    if (row.status === 'approved') {
      var view = el('a', 'btn-ghost btn-sm', 'View public page');
      view.href = cat.detailUrl({ id: row.id });
      actions.appendChild(view);
    }
    eventActions(row, note).forEach(function (b) { actions.appendChild(b); });
    body.appendChild(actions);
  }

  /* ----- edit: shared form component (creating events happens on the account page) ----- */
  function openForm(row) {
    var sec = $('editEvent');
    sec.hidden = false;
    select('events');
    formApi.edit(row.event);
  }

  function bindForm() {
    var form = Eventora.eventForm.render($('adEventForm'), { prefix: 'ae', create: 'Save changes', close: true });
    formApi = Eventora.eventForm.create(form, {
      titleEl: $('adFormTitle'),
      labels: { create: 'Save changes', edit: 'Save changes', createTitle: 'Edit event', editTitle: 'Edit “{title}”' },
      submit: function (v, editingId) {
        if (!editingId) return { ok: false, error: 'Choose an event to edit from the list (create events from your account page).' };
        return hosting.admin.updateEvent(editingId, v);
      },
      saved: function (res) {
        F.alert($('adAlert'), 'success', '“' + res.event.title + '” was updated.');
        $('editEvent').hidden = true;
        renderAll();
        $('adAlert').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    form.querySelector('[data-close-form]').addEventListener('click', function () { formApi.cancel(); $('editEvent').hidden = true; });
  }

  /* =========================================================================
     D. USER MANAGEMENT
     ========================================================================= */
  function renderUsers() {
    var users = auth.admin.listUsers().sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
    var me = auth.current();
    document.querySelector('[data-count="users"]').textContent = users.length;
    var tbody = $('usersBody');
    tbody.textContent = '';
    users.forEach(function (u) {
      var tr = el('tr', u.status === 'suspended' ? 'is-muted' : '');
      var who = el('td');
      who.appendChild(el('div', 'cell-strong', u.name + (me && me.id === u.id ? ' (you)' : '')));
      who.appendChild(el('div', 'cell-sub', u.email));
      tr.appendChild(who);
      tr.appendChild(el('td', 'mono', u.id));
      var role = el('td'); role.appendChild(roleBadge(u.role)); tr.appendChild(role);
      var st = el('td');
      st.appendChild(chip(u.status === 'active' ? 'approved' : 'rejected', u.status === 'active' ? 'Active' : 'Suspended'));
      tr.appendChild(st);
      tr.appendChild(el('td', 'cell-sub', day(u.createdAt)));
      tr.appendChild(el('td', 'num', String(store.forUser(u.id).length)));
      var act = el('td', 'cell-actions');
      act.appendChild(button('View', 'btn-ghost btn-sm', function () { viewUser(u); }));
      userActions(u).forEach(function (b) { act.appendChild(b); });
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  }

  function userActions(u) {
    if (u.protected || u.role === 'admin') return [el('span', 'protect-tag', 'Protected admin')];
    var out = [];
    out.push(u.role === 'host'
      ? armed('Revoke host', 'Confirm revoke', 'btn-ghost btn-sm', function () { done(auth.admin.setHost(u.id, false), u.name + ' is now a User.'); })
      : button('Make host', 'btn-ghost btn-sm', function () { done(auth.admin.setHost(u.id, true), u.name + ' is now an Event Host.'); }));
    out.push(u.status === 'active'
      ? armed('Suspend', 'Confirm suspend', 'btn-ghost btn-sm btn-danger', function () { done(auth.admin.setStatus(u.id, 'suspended'), u.name + '’s account is suspended.'); })
      : button('Reactivate', 'btn-ghost btn-sm', function () { done(auth.admin.setStatus(u.id, 'active'), u.name + '’s account is active again.'); }));
    return out;
  }

  function viewUser(u) {
    var body = openDialog(auth.ROLE_LABELS[u.role] + (u.protected ? ' · protected' : ''), u.name);
    body.appendChild(facts([
      ['User ID', u.id], ['Email', u.email], ['Phone', u.phone || '—'], ['Role', auth.ROLE_LABELS[u.role]],
      ['Status', u.status === 'active' ? 'Active' : 'Suspended'], ['Registered', day(u.createdAt)]
    ]));
    var regs = store.forUser(u.id);
    body.appendChild(el('p', 'app-card__label', 'Registrations (' + regs.length + ')'));
    var ul = el('ul', 'ad-mini-list');
    if (!regs.length) ul.appendChild(el('li', 'cell-sub', 'None yet.'));
    regs.forEach(function (r) {
      ul.appendChild(el('li', '', r.id + ' · ' + hosting.admin.eventTitle(r.eventId) + ' · ' + { confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' }[regState(r)]));
    });
    body.appendChild(ul);
    var apps = hosting.admin.applications().filter(function (a) { return a.userId === u.id; });
    if (apps.length) {
      body.appendChild(el('p', 'app-card__label', 'Host applications'));
      var al = el('ul', 'ad-mini-list');
      apps.forEach(function (a) { al.appendChild(el('li', '', a.id + ' · ' + hosting.statusLabel(a.status) + ' · ' + day(a.createdAt))); });
      body.appendChild(al);
    }
    var events = hosting.admin.allEvents().filter(function (r) { return r.hostId === u.id; });
    if (events.length) {
      body.appendChild(el('p', 'app-card__label', 'Events hosted'));
      var el2 = el('ul', 'ad-mini-list');
      events.forEach(function (r) { el2.appendChild(el('li', '', r.event.title + ' · ' + hosting.statusLabel(r.status, 'event'))); });
      body.appendChild(el2);
    }
    var row = el('div', 'cluster ad-review__actions');
    userActions(u).forEach(function (b) { row.appendChild(b); });
    body.appendChild(row);
  }

  /* =========================================================================
     E. REGISTRATION MANAGEMENT
     ========================================================================= */
  function renderRegs() {
    var all = hosting.admin.registrations();
    document.querySelector('[data-count="regs"]').textContent = all.length;
    var evSel = $('regEventFilter'), keep = evSel.value;
    var ids = {};
    all.forEach(function (r) { ids[r.eventId] = true; });
    evSel.length = 1;
    Object.keys(ids).map(function (id) { return [id, hosting.admin.eventTitle(id)]; })
      .sort(function (a, b) { return a[1] < b[1] ? -1 : 1; })
      .forEach(function (p) { var o = el('option', '', p[1]); o.value = p[0]; evSel.appendChild(o); });
    if (keep && ids[keep]) evSel.value = keep;
    var status = $('regStatusFilter').value;
    var rows = all.filter(function (r) { return (!evSel.value || r.eventId === evSel.value) && (!status || regState(r) === status); })
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    $('regCount').textContent = rows.length === all.length ? all.length + ' registrations' : rows.length + ' of ' + all.length + ' registrations';
    var tbody = $('regsBody');
    tbody.textContent = '';
    $('regsEmpty').hidden = rows.length > 0;
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', 'mono', r.id));
      var who = el('td');
      who.appendChild(el('div', 'cell-strong', r.name));
      who.appendChild(el('div', 'cell-sub', r.email));
      tr.appendChild(who);
      tr.appendChild(el('td', '', hosting.admin.eventTitle(r.eventId)));
      var s = regState(r);
      var st = el('td');
      st.appendChild(chip(s === 'confirmed' ? 'approved' : s === 'cancelled' ? 'rejected' : 'unpublished', { confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' }[s]));
      tr.appendChild(st);
      tr.appendChild(el('td', 'cell-sub', day(r.createdAt)));
      var act = el('td', 'cell-actions');
      act.appendChild(button('QR code', 'btn-ghost btn-sm', function () { viewReg(r); }));
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  }

  function viewReg(r) {
    var s = regState(r);
    var body = openDialog('Registration · ' + { confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' }[s], r.id);
    var wrap = el('div', 'ad-review');
    var qr = el('figure', 'register__qr ad-review__qr' + (s === 'cancelled' ? ' is-void' : ''));
    try { qr.appendChild(Eventora.qr.svg(r.id, { label: 'QR code for registration ' + r.id, dark: '#05070b' })); } catch (err) { qr.hidden = true; }
    wrap.appendChild(qr);
    var owner = r.userId ? auth.userById(r.userId) : null;
    wrap.appendChild(facts([
      ['Event', hosting.admin.eventTitle(r.eventId)], ['Attendee', r.name], ['Email', r.email], ['Phone', r.phone],
      ['Type', r.type === 'waitlist' ? 'Waitlist' : 'Registration'], ['Booked', day(r.createdAt)],
      ['Account', owner ? owner.name + ' (' + owner.email + ')' : 'Not linked to an account']
    ]));
    body.appendChild(wrap);
  }

  /* =========================================================================
     Dialog + small builders
     ========================================================================= */
  function openDialog(kicker, title) {
    var dlg = $('adDialog'), body = $('adDialogBody');
    body.textContent = '';
    body.appendChild(el('p', 'eyebrow', kicker));
    var h = el('h2', 'heading-3', title);
    h.id = 'adDialogTitle';
    body.appendChild(h);
    if (!dlg.open) dlg.showModal();
    dlg.querySelector('[data-close]').focus();
    return body;
  }
  function facts(pairs) {
    var dl = el('dl', 'ad-facts');
    pairs.forEach(function (p) {
      var d = el('div');
      d.appendChild(el('dt', '', p[0]));
      d.appendChild(el('dd', '', p[1]));
      dl.appendChild(d);
    });
    return dl;
  }
  function noteField(body, label) {
    var f = el('div', 'field ad-note');
    var id = 'adNote' + Date.now();
    var l = el('label', 'field__label', label); l.htmlFor = id;
    var t = el('textarea', 'field__input field__input--area'); t.id = id; t.rows = 2; t.maxLength = 500;
    f.appendChild(l); f.appendChild(t);
    body.appendChild(f);
    return t;
  }

  function renderAll() { renderOverview(); renderApps(); renderApprovals(); renderEvents(); renderUsers(); renderRegs(); }

  /* ---------- tabs ---------- */
  function select(name, focus) {
    TABS.forEach(function (n) {
      var t = $('tab-' + n), p = $('panel-' + n), on = n === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      p.hidden = !on;
    });
    if (focus) $('tab-' + name).focus();
    // on phones the tab row scrolls sideways: keep the selected tab in view
    var bar = $('tab-' + name).parentNode, tb = $('tab-' + name);
    if (bar.scrollWidth > bar.clientWidth) bar.scrollLeft = tb.offsetLeft - (bar.clientWidth - tb.offsetWidth) / 2;
    history.replaceState(null, '', location.pathname + '#' + name);
  }
  function bindTabs() {
    TABS.forEach(function (n, i) {
      var t = $('tab-' + n);
      t.addEventListener('click', function () { select(n); });
      t.addEventListener('keydown', function (e) {
        var L = TABS.length;
        var j = e.key === 'ArrowRight' ? (i + 1) % L : e.key === 'ArrowLeft' ? (i + L - 1) % L : e.key === 'Home' ? 0 : e.key === 'End' ? L - 1 : -1;
        if (j < 0) return;
        e.preventDefault();
        select(TABS[j], true);
      });
    });
    $('regEventFilter').addEventListener('change', renderRegs);
    $('regStatusFilter').addEventListener('change', renderRegs);
    $('adDialog').querySelector('[data-close]').addEventListener('click', function () { $('adDialog').close(); });
    $('adDialog').addEventListener('click', function (e) { if (e.target === $('adDialog')) $('adDialog').close(); });
  }

  function deny(u) {
    if (!u) { location.replace('login.html?next=admin.html'); return; }
    $('dashDenied').hidden = false;
    $('dashBody').hidden = true;
    var why = {
      'not-configured': 'No admin sign-in is configured on the server (python tools/init_admin.py), so no account is an Admin yet.',
      'admin-relogin': 'Your admin session has ended. Sign out and sign in again with the admin email and password.',
      unavailable: 'The admin check server couldn’t be reached (start the site with tools/dev_server.py).'
    }[auth.adminCheckStatus()];
    if (why) $('deniedWhy').textContent = why;
  }

  Eventora.admin = {
    init: function () {
      if (!$('usersBody') || !Eventora.auth || !Eventora.hosting) return;
      auth = Eventora.auth; hosting = Eventora.hosting; cat = Eventora.events; F = Eventora.forms; store = Eventora.registrations;
      // old links: the create form now lives on the admin's account page
      if (location.hash === '#create') { location.replace('profile.html#create-event'); return; }
      if (!auth.current()) { deny(null); return; }
      auth.ready().then(function (u) {
        if (!u || !auth.can('manageUsers')) { deny(u); return; }
        $('dashBody').hidden = false;
        $('adWho').textContent = u.email;
        bindTabs();
        bindForm();
        renderAll();
        var h = location.hash.replace('#', '');
        select(TABS.indexOf(h) !== -1 ? h : 'overview');
        window.addEventListener('storage', function () { if (auth.can('manageUsers')) renderAll(); });
      });
    }
  };
})(window.Eventora);
