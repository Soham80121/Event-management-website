/* =========================================================================
   HOST DASHBOARD — host-dashboard.html (Event Hosts and Admins).
   A host sees and manages only events whose hostId is their own user id.
   New and edited events are "Pending" until an admin approves them; only
   approved events are public. (UI-enforced prototype — see js/hosting.js.)
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var auth, hosting, cat, F;
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

  /* ---------- list ---------- */
  function render() {
    var events = hosting.myEvents();
    var regs = function (id) { var r = hosting.registrationsFor(id); return r ? r.filter(function (x) { return x.status !== 'cancelled'; }).length : 0; };
    $('hdTotal').textContent = events.length;
    $('hdPending').textContent = events.filter(function (e) { return e.status === 'pending'; }).length;
    $('hdLive').textContent = events.filter(function (e) { return e.status === 'approved'; }).length;
    $('hdRegs').textContent = events.reduce(function (n, e) { return n + regs(e.id); }, 0);

    var list = $('hdList');
    list.textContent = '';
    if (!events.length) {
      var empty = el('li', 'dash-empty');
      empty.appendChild(el('p', 'heading-3', 'No events yet'));
      empty.appendChild(el('p', 'dash-empty__text', 'Create your first event below. An admin reviews it before it appears on EVENTORA.'));
      list.appendChild(empty);
      return;
    }
    events.forEach(function (e) {
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
      var help = {
        pending: 'Waiting for admin approval. Not public yet.',
        approved: 'Live on EVENTORA. Approved events are locked; ask an admin for changes.',
        rejected: 'Not approved. Edit it to resubmit.',
        unpublished: 'Taken down by an admin. Not public.',
        cancelled: 'Cancelled by an admin. Not public; registrations are kept.'
      }[e.status];
      body.appendChild(el('p', 'host-event__help', help));
      if (e.note) body.appendChild(el('p', 'host-event__note', 'Admin note: “' + e.note + '”'));
      li.appendChild(body);

      var actions = el('div', 'host-event__actions');
      var n = regs(e.id);
      var view = el('button', 'btn-ghost', 'Registrations (' + n + ')');
      view.type = 'button';
      view.addEventListener('click', function () { openRegs(e); });
      actions.appendChild(view);
      if (e.status === 'approved') {
        var pub = el('a', 'btn-ghost', 'View public page');
        pub.href = cat.detailUrl(e);
        actions.appendChild(pub);
      }
      if (e.status === 'pending' || e.status === 'rejected') {
        var edit = el('button', 'btn-ghost', 'Edit');
        edit.type = 'button';
        edit.addEventListener('click', function () { formApi.edit(e); });
        actions.appendChild(edit);
        var del = el('button', 'btn-ghost btn-danger', 'Delete');
        del.type = 'button';
        del.addEventListener('click', function () {
          if (del.getAttribute('data-armed') !== 'true') {      // two-step confirm
            del.setAttribute('data-armed', 'true');
            del.textContent = 'Confirm delete';
            setTimeout(function () { if (document.contains(del)) { del.removeAttribute('data-armed'); del.textContent = 'Delete'; } }, 4000);
            return;
          }
          var r = hosting.deleteEvent(e.id);
          F.alert($('hdAlert'), r.ok ? 'success' : 'error', r.ok ? '“' + e.title + '” was deleted.' : r.error);
          if (formApi && formApi.editing() === e.id) formApi.cancel();
          render();
        });
        actions.appendChild(del);
      }
      li.appendChild(actions);
      list.appendChild(li);
    });
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
    formApi = Eventora.eventForm.create($('eventForm'), {
      labels: { create: 'Submit for approval', edit: 'Save and resubmit',
        createTitle: 'Create a new event', editTitle: 'Edit “{title}”' },
      submit: function (v, editingId) {
        return editingId ? hosting.updateEvent(editingId, v) : hosting.createEvent(v);
      },
      saved: function (res, wasEditing) {
        F.alert($('hdAlert'), 'success', '“' + res.event.title + '” was ' + (wasEditing ? 'updated and resubmitted' : 'submitted') +
          '. It’s Pending until an admin approves it.');
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
        if (u && u.role === 'admin') { location.replace('admin.html#events'); return; }
        if (!u || !auth.can('manageOwnEvents')) { deny(u); return; }
        $('dashBody').hidden = false;
        $('hdWho').textContent = u.name;
        bindForm();
        render();
        if (location.hash === '#create') $('create').scrollIntoView({ block: 'start' });
        $('regsDialog').querySelector('[data-close]').addEventListener('click', function () { $('regsDialog').close(); });
        auth.onChange(function (x) { if (!x || !auth.can('manageOwnEvents')) location.reload(); });
      });
    }
  };
})(window.Eventora);
