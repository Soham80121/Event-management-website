/* =========================================================================
   HOST DASHBOARD — host-dashboard.html, for Event Hosts and the Admin.

   Event Host: their own events (hostId = their user id). New and edited
     events are "Pending" until an admin approves them; only approved events
     are public. Edit / delete while pending or rejected.
   Admin ("Host an Event" in the admin navbar): the events the admin created
     (createdBy: 'admin', hostId = the admin's id), using the existing admin
     permissions: create (optionally "Publish immediately", unticked by
     default), edit, publish / unpublish / cancel, remove. Approving OTHER
     hosts' events stays in the Admin Panel.

   Both: overview stats, status filters, registrations per event.
   (Events are still browser-stored until the events phase — js/hosting.js.)
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var auth, hosting, cat, F;
  var isAdmin = false;
  var filter = 'all';
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  var fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  function dateLabel(e) { var p = e.date.split('-').map(Number); return fmt.format(new Date(p[0], p[1] - 1, p[2])) + ' · ' + e.time; }

  function chip(status) {
    var s = el('span', 'app-status app-status--' + status);
    s.appendChild(el('span', 'app-status__dot'));
    s.appendChild(document.createTextNode(hosting.statusLabel(status, 'event')));
    return s;
  }

  /** Two-click confirm for destructive actions. */
  function armed(label, confirmLabel, cls, run) {
    var b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', function () {
      if (b.getAttribute('data-armed') !== 'true') {
        b.setAttribute('data-armed', 'true');
        b.textContent = confirmLabel;
        setTimeout(function () { if (document.contains(b)) { b.removeAttribute('data-armed'); b.textContent = label; } }, 4000);
        return;
      }
      run();
    });
    return b;
  }
  function button(label, cls, run) {
    var b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', run);
    return b;
  }

  /* ---------- whose events ---------- */
  function myEvents() {
    if (!isAdmin) return hosting.myEvents();
    var me = auth.current();
    // the admin's own events: created through the admin path, owned by this admin
    return hosting.admin.events().filter(function (e) { return e.hostId === me.id; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  var FILTERS = [['all', 'All'], ['pending', 'Pending'], ['approved', 'Published'], ['rejected', 'Rejected'],
    ['off', 'Unpublished & cancelled']];
  function inFilter(e, f) {
    if (f === 'all') return true;
    if (f === 'off') return e.status === 'unpublished' || e.status === 'cancelled';
    return e.status === f;
  }

  function done(res, okMsg) {
    F.alert($('hdAlert'), res.ok ? 'success' : 'error', res.ok ? okMsg : res.error);
    if (res.ok && formApi && formApi.editing() && !myEvents().some(function (e) { return e.id === formApi.editing(); })) formApi.cancel();
    render();
  }

  /* ---------- list ---------- */
  function render() {
    var events = myEvents();
    var regs = function (id) { var r = hosting.registrationsFor(id); return r ? r.filter(function (x) { return x.status !== 'cancelled'; }).length : 0; };
    $('hdTotal').textContent = events.length;
    $('hdPending').textContent = events.filter(function (e) { return e.status === 'pending'; }).length;
    $('hdLive').textContent = events.filter(function (e) { return e.status === 'approved'; }).length;
    $('hdRegs').textContent = events.reduce(function (n, e) { return n + regs(e.id); }, 0);

    var chips = $('hdFilters');
    chips.textContent = '';
    FILTERS.forEach(function (f) {
      var b = el('button', 'chip');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(f[0] === filter));
      b.appendChild(document.createTextNode(f[1] + ' '));
      b.appendChild(el('span', 'chip__count', String(events.filter(function (e) { return inFilter(e, f[0]); }).length)));
      b.addEventListener('click', function () { filter = f[0]; render(); });
      chips.appendChild(b);
    });
    chips.hidden = events.length === 0;

    var list = $('hdList');
    list.textContent = '';
    var shown = events.filter(function (e) { return inFilter(e, filter); });
    if (!shown.length) {
      var empty = el('li', 'dash-empty');
      empty.appendChild(el('p', 'heading-3', events.length ? 'No events with this status' : 'No events yet'));
      empty.appendChild(el('p', 'dash-empty__text', events.length ? 'Choose another filter above.'
        : isAdmin ? 'Create your first event below. Publish it straight away, or keep it Pending.'
        : 'Create your first event below. An admin reviews it before it appears on EVENTORA.'));
      list.appendChild(empty);
      return;
    }
    shown.forEach(function (e) {
      var li = el('li', 'host-event host-event--' + e.status);
      var fig = el('figure', 'host-event__poster');
      var img = new Image(); img.alt = ''; img.loading = 'lazy'; img.src = cat.imageUrl(e, 160, 240);
      fig.appendChild(img);
      li.appendChild(fig);
      var body = el('div', 'host-event__body');
      body.appendChild(chip(e.status));
      body.appendChild(el('h3', 'host-event__title', e.title));
      body.appendChild(el('p', 'host-event__meta', e.category + ' · ' + dateLabel(e)));
      body.appendChild(el('p', 'host-event__meta host-event__meta--muted', e.venue.name + ', ' + e.venue.city +
        ' · ' + (e.price ? '$' + e.price.amount : 'Free') + (isAdmin ? ' · ' + e.id : '')));
      var help = isAdmin ? {
        pending: 'Pending: not public. Publish it here, or review it with other submissions in the Admin panel.',
        approved: 'Published on EVENTORA.',
        rejected: 'Rejected: not public.',
        unpublished: 'Unpublished: hidden from the public. Registrations are kept.',
        cancelled: 'Cancelled: hidden from the public. Registrations and QR codes are kept.'
      }[e.status] : {
        pending: 'Waiting for admin approval. Not public yet.',
        approved: 'Live on EVENTORA. Approved events are locked; ask an admin for changes.',
        rejected: 'Not approved. Edit it to resubmit.',
        unpublished: 'Taken down by an admin. Not public.',
        cancelled: 'Cancelled by an admin. Not public; registrations are kept.'
      }[e.status];
      body.appendChild(el('p', 'host-event__help', help));
      if (e.note) body.appendChild(el('p', 'host-event__note', 'Admin note: “' + e.note + '”'));
      li.appendChild(body);
      li.appendChild(actionsFor(e, regs(e.id)));
      list.appendChild(li);
    });
  }

  function actionsFor(e, n) {
    var actions = el('div', 'host-event__actions');
    actions.appendChild(button('Registrations (' + n + ')', 'btn-ghost', function () { openRegs(e); }));
    if (e.status === 'approved') {
      var pub = el('a', 'btn-ghost', 'View public page');
      pub.href = cat.detailUrl(e);
      actions.appendChild(pub);
    }
    var t = '“' + e.title + '”';
    if (isAdmin) {
      // the existing admin permissions, applied to the admin's own events
      actions.appendChild(button('Edit', 'btn-ghost', function () { openEdit(e); }));
      if (e.status !== 'approved' && e.status !== 'cancelled') {
        actions.appendChild(button('Publish', 'btn-ghost btn-ok', function () {
          done(hosting.admin.setEventStatus(e.id, 'approved', ''), t + ' is published.');
        }));
      }
      if (e.status === 'approved') {
        actions.appendChild(armed('Unpublish', 'Confirm unpublish', 'btn-ghost', function () {
          done(hosting.admin.setEventStatus(e.id, 'unpublished', ''), t + ' is unpublished. Registrations are kept.');
        }));
      }
      if (e.status !== 'cancelled') {
        actions.appendChild(armed('Cancel event', 'Confirm cancel', 'btn-ghost btn-danger', function () {
          done(hosting.admin.setEventStatus(e.id, 'cancelled', ''), t + ' is cancelled. Registrations and QR codes are kept.');
        }));
      }
      actions.appendChild(armed('Remove', 'Confirm remove', 'btn-ghost btn-danger', function () {
        done(hosting.admin.removeEvent(e.id), t + ' was removed. Its registrations are kept.');
      }));
    } else if (e.status === 'pending' || e.status === 'rejected') {
      actions.appendChild(button('Edit', 'btn-ghost', function () { openEdit(e); }));
      actions.appendChild(armed('Delete', 'Confirm delete', 'btn-ghost btn-danger', function () {
        done(hosting.deleteEvent(e.id), t + ' was deleted.');
      }));
    }
    return actions;
  }

  /* ---------- registrations dialog ---------- */
  function openRegs(e) {
    var dlg = $('regsDialog');
    var rows = hosting.registrationsFor(e.id) || [];
    $('regsTitle').textContent = e.title;
    $('regsMeta').textContent = rows.length === 1 ? '1 registration' : rows.length + ' registrations';
    var tbody = $('regsBody');
    tbody.textContent = '';
    $('regsEmpty').hidden = rows.length > 0;
    $('regsTable').hidden = rows.length === 0;
    rows.forEach(function (r) {
      var tr = el('tr');
      [r.name, r.email, r.phone, r.status === 'cancelled' ? 'Cancelled' : 'Confirmed', r.id].forEach(function (v, i) {
        var td = el('td', i === 4 ? 'mono' : '', v);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    dlg.showModal();
    dlg.querySelector('[data-close]').focus();
  }

  /* ---------- create / edit (shared component: js/event-form.js) ---------- */
  var formApi = null;
  var publishRow = null;
  function showPublish(on) { if (publishRow) publishRow.hidden = !on; }
  function openEdit(e) {
    formApi.edit(e);
    showPublish(false);                         // an edit keeps the event's status
  }

  function bindForm() {
    var form = Eventora.eventForm.render($('eventForm'), {
      prefix: 'ev', publish: isAdmin, create: isAdmin ? 'Create event' : 'Submit for approval'
    });
    publishRow = form.querySelector('[data-publish-row]');
    formApi = Eventora.eventForm.create(form, {
      labels: isAdmin
        ? { create: 'Create event', edit: 'Save changes', createTitle: 'Create a new event', editTitle: 'Edit “{title}”' }
        : { create: 'Submit for approval', edit: 'Save and resubmit', createTitle: 'Create a new event', editTitle: 'Edit “{title}”' },
      submit: function (v, editingId) {
        if (isAdmin) {
          return editingId ? hosting.admin.updateEvent(editingId, v)
            : hosting.admin.createEvent(v, !!(form.elements.publish && form.elements.publish.checked));
        }
        return editingId ? hosting.updateEvent(editingId, v) : hosting.createEvent(v);
      },
      saved: function (res, wasEditing) {
        var t = '“' + res.event.title + '”';
        var msg = isAdmin
          ? (wasEditing ? t + ' was updated. Its status didn’t change.'
            : res.event.status === 'approved' ? t + ' was created and published.'
            : t + ' was created as Pending. Publish it from the list when it’s ready.')
          : t + ' was ' + (wasEditing ? 'updated and resubmitted' : 'submitted') + '. It’s Pending until an admin approves it.';
        F.alert($('hdAlert'), 'success', msg);
        showPublish(true);
        render();
        $('hdAlert').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    var cancel = form.querySelector('[data-cancel]');
    if (cancel) cancel.addEventListener('click', function () { showPublish(true); });
  }

  function deny(u) {
    if (!u) { location.replace('login.html?next=host-dashboard.html'); return; }
    $('dashDenied').hidden = false;
    $('dashBody').hidden = true;
  }

  function adminCopy() {
    $('hdEyebrow').textContent = 'Admin';
    $('hdHeading').textContent = 'Admin events';
    $('hdLead').textContent = 'Create and manage the events you host as EVENTORA. Other hosts’ submissions are reviewed in the Admin panel.';
    $('hdListTitle').textContent = 'My events';
    $('hdFormHint').textContent = 'Leave “Publish immediately” unticked to keep the event Pending (not public) until you publish it.';
    document.title = 'Admin events — EVENTORA';
    var back = document.querySelector('.back-link');
    if (back) { back.href = 'admin.html'; back.lastChild.textContent = ' Admin panel'; }
  }

  Eventora.hostDashboard = {
    init: function () {
      if (!$('hdList') || !Eventora.auth || !Eventora.hosting) return;
      auth = Eventora.auth; hosting = Eventora.hosting; cat = Eventora.events; F = Eventora.forms;
      if (!auth.current()) { deny(null); return; }
      auth.ready().then(function (u) {
        if (!u || !auth.can('manageOwnEvents')) { deny(u); return; }
        isAdmin = u.role === 'admin';
        if (isAdmin) adminCopy();
        $('dashBody').hidden = false;
        $('hdWho').textContent = u.name;
        bindForm();
        render();
        if (location.hash === '#create') $('create').scrollIntoView({ block: 'start' });
        $('regsDialog').querySelector('[data-close]').addEventListener('click', function () { $('regsDialog').close(); });
        auth.onChange(function (x) { if (!x || !auth.can('manageOwnEvents') || (x.role === 'admin') !== isAdmin) location.reload(); });
      });
    }
  };
})(window.Eventora);
