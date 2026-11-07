/* =========================================================================
   HOST DASHBOARD — host-dashboard.html, for Event Hosts and the Admin.
   Everyone sees and manages only their own events: overview stats, status
   filters, registrations per event and the create form.
   Event Host: events are saved as Pending; only an admin approval publishes
     them. Edit / delete while Pending or Rejected (an edit resubmits it).
   Admin ("Host an Event" in the admin navbar): the same page, but the
     admin's events are published straight away (the server does that), so
     they never enter Event approvals. Edit (status kept) and Remove.
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

  function myEvents() { return hosting.myEvents(); }

  var FILTERS = [['all', 'All'], ['pending', 'Pending'], ['approved', 'Published'], ['rejected', 'Rejected'],
    ['off', 'Unpublished & cancelled']];
  function inFilter(e, f) {
    if (f === 'all') return true;
    if (f === 'off') return e.status === 'unpublished' || e.status === 'cancelled';
    return e.status === f;
  }

  /** Result of an action: plain (older browser-saved events) or a Promise (server). */
  function done(res, okMsg) {
    Promise.resolve(res).then(function (r) {
      F.alert($('hdAlert'), r.ok ? 'success' : 'error', r.ok ? okMsg : r.error);
      if (r.ok && formApi && formApi.editing() && !myEvents().some(function (e) { return e.id === formApi.editing(); })) formApi.cancel();
      render();
    });
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
        : 'Create your first event below or from Host an Event. An admin reviews it before it appears on EVENTORA.'));
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
        ' · ' + (e.price ? '$' + e.price.amount : 'Free')));
      var help = isAdmin ? {
        pending: 'Not public yet. Publish it from Admin panel → All events.',
        approved: 'Live on EVENTORA.',
        rejected: 'Not public. Edit it, then publish it from Admin panel → All events.',
        unpublished: 'Unpublished. Not public; publish it again from Admin panel → All events.',
        cancelled: 'Cancelled. Not public; registrations are kept.'
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
      // the admin's own events: edit any time (status unchanged), or remove
      actions.appendChild(button('Edit', 'btn-ghost', function () { formApi.edit(e); }));
      actions.appendChild(armed('Remove', 'Confirm remove', 'btn-ghost btn-danger', function () {
        done(hosting.admin.removeEvent(e.id), t + ' was removed. Its registrations are kept.');
      }));
    } else if (e.status === 'pending' || e.status === 'rejected') {
      actions.appendChild(button('Edit', 'btn-ghost', function () { formApi.edit(e); }));
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
  function bindForm() {
    var create = isAdmin ? 'Publish event' : 'Submit for approval';
    var form = Eventora.eventForm.render($('eventForm'), { prefix: 'ev', create: create });
    formApi = Eventora.eventForm.create(form, {
      labels: { create: create, edit: isAdmin ? 'Save changes' : 'Save and resubmit',
        createTitle: 'Create a new event', editTitle: 'Edit “{title}”' },
      submit: function (v, editingId) {
        if (isAdmin) return editingId ? hosting.admin.updateEvent(editingId, v) : hosting.createEvent(v);
        return editingId ? hosting.updateEvent(editingId, v) : hosting.createEvent(v);
      },
      saved: function (res, wasEditing) {
        var t = '“' + res.event.title + '”';
        F.alert($('hdAlert'), 'success', isAdmin
          ? t + (wasEditing ? ' was updated.' : ' is published on EVENTORA.')
          : t + ' was ' + (wasEditing ? 'updated and resubmitted' : 'submitted') + '. It’s Pending until an admin approves it.');
        render();
        $('hdAlert').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  function deny(u) {
    if (!u) { location.replace('login.html?next=host-dashboard.html'); return; }
    $('dashDenied').hidden = false;
    $('dashBody').hidden = true;
  }

  Eventora.hostDashboard = {
    init: function () {
      if (!$('hdList') || !Eventora.auth || !Eventora.hosting) return;
      auth = Eventora.auth; hosting = Eventora.hosting; cat = Eventora.events; F = Eventora.forms;
      if (!auth.current()) { deny(null); return; }
      auth.ready().then(function (u) {
        if (!u || !auth.can('manageOwnEvents')) { deny(u); return; }
        isAdmin = u.role === 'admin';
        if (isAdmin) {
          $('hdEyebrow').textContent = 'Admin';
          $('hdLead').textContent = 'Create events, see them live straight away and see who registered.';
          $('hdFormHint').textContent = 'Your events are published on EVENTORA as soon as you create them.';
        }
        $('dashBody').hidden = false;
        $('hdWho').textContent = u.name;
        bindForm();
        render();
        hosting.sync().then(render);                       // the host's events saved on the server
        if (location.hash === '#create') $('create').scrollIntoView({ block: 'start' });
        $('regsDialog').querySelector('[data-close]').addEventListener('click', function () { $('regsDialog').close(); });
        auth.onChange(function (x) { if (!x || !auth.can('manageOwnEvents') || (x.role === 'admin') !== isAdmin) location.reload(); });
      });
    }
  };
})(window.Eventora);
