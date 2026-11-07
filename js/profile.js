/* =========================================================================
   PROFILE — profile.html (signed-in users only).
   Details + avatar, role, links to registrations and the
   role dashboards, and the "Become an Event Host" application.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var auth, F, V;
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  var fmtDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  function day(iso) { var d = new Date(iso); return isNaN(d) ? '—' : fmtDate.format(d); }

  var pendingAvatar;          // undefined = unchanged, null = remove, string = new data URL

  /* ---------- header + links ---------- */
  /** Admin account (server-verified admin, or the account its sign-in created). */
  function isAdmin(u) { return u.role === 'admin' || !!u.adminAccount; }

  function avatarInto(node, u) {
    node.textContent = '';
    if (u.avatar) { var img = new Image(); img.alt = ''; img.src = u.avatar; node.appendChild(img); }
    else node.textContent = u.name.trim().charAt(0).toUpperCase();
  }

  function renderHeader(u) {
    avatarInto($('pfAvatar'), u);
    $('pfName').textContent = u.name;
    $('pfEmail').textContent = u.email;
    var role = $('pfRole');
    // the admin account shows "Admin" from the start (the server re-confirms it a moment later)
    var shown = isAdmin(u) ? 'admin' : u.role;
    role.className = 'role-badge role-badge--' + shown;
    role.textContent = auth.ROLE_LABELS[shown];
    $('pfSince').textContent = day(u.createdAt);
    $('pfId').textContent = u.id;

    var regs = Eventora.registrations ? Eventora.registrations.forUser(u.id).filter(function (r) { return r.status !== 'cancelled'; }).length : 0;
    $('pfRegCount').textContent = regs === 1 ? '1 active booking' : regs + ' active bookings';
    // No Host Dashboard card for anyone: hosts reach it from the navbar.
    // Admin account page: profile only (no host application, no event form);
    // the Admin Panel and "Host an Event" are their own navbar destinations.
    var admin = isAdmin(u);
    // "Become an Event Host" is for Users; an approved host's only link from it
    // was "Open host dashboard", which the navbar already provides
    $('host-application').hidden = admin || u.role === 'host';

    var check = auth.adminCheckStatus();
    $('pfAdminCheck').textContent = {
      ok: u.role === 'admin'
        ? 'Admin role confirmed by the server for this session (ADMIN_EMAIL account, password checked on sign-in).'
        : 'Your account and role are confirmed by the server.',
      'not-configured': 'The server has no admin account yet (run python tools/init_admin.py), so no account is Admin.',
      unavailable: 'The EvAtlas server couldn’t be reached, so your role couldn’t be confirmed and Admin features are off.',
      checking: 'Checking with the server…'
    }[check] || '';
  }

  /* ---------- profile form ---------- */
  function fillProfileForm(u) {
    var f = $('profileForm');
    f.elements.name.value = u.name;
    f.elements.email.value = u.email;
    f.elements.phone.value = u.phone;
    pendingAvatar = undefined;
    avatarInto($('pfAvatarPreview'), u);
    $('pfAvatarRemove').hidden = !u.avatar;
  }

  /** Square-crop and downscale to 160px JPEG so it fits comfortably in storage. */
  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { reject(new Error('Choose a JPG, PNG, WebP or GIF image.')); return; }
      if (file.size > 8 * 1024 * 1024) { reject(new Error('Choose an image under 8 MB.')); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(img.naturalWidth, img.naturalHeight);
        var c = document.createElement('canvas');
        c.width = c.height = 160;
        c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 160, 160);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file couldn’t be read as an image.')); };
      img.src = url;
    });
  }

  function bindProfileForm() {
    var f = $('profileForm'), alertEl = $('profileAlert');
    var v = F.bind(f, { name: V.name, email: V.email, phone: V.phone });
    $('pfAvatarInput').addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      F.alert(alertEl, 'error', '');
      resizeImage(file).then(function (data) {
        pendingAvatar = data;
        var prev = $('pfAvatarPreview');
        prev.textContent = '';
        var img = new Image(); img.alt = ''; img.src = data; prev.appendChild(img);
        $('pfAvatarRemove').hidden = false;
        F.alert(alertEl, 'success', 'New photo ready. Save changes to keep it.');
      }, function (err) { F.alert(alertEl, 'error', err.message); });
      this.value = '';
    });
    $('pfAvatarRemove').addEventListener('click', function () {
      pendingAvatar = null;
      var u = auth.current();
      $('pfAvatarPreview').textContent = u.name.trim().charAt(0).toUpperCase();
      this.hidden = true;
      F.alert(alertEl, 'success', 'Photo will be removed when you save.');
    });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      F.alert(alertEl, 'error', '');
      if (v.check().length) return;
      var restore = F.busy(f.querySelector('[type="submit"]'), 'Saving…');
      auth.updateProfile({ name: f.elements.name.value, email: f.elements.email.value, phone: f.elements.phone.value, avatar: pendingAvatar })
        .then(function (res) {
          restore();
          if (!res.ok) {
            if (res.errors) Object.keys(res.errors).forEach(function (k) { if (res.errors[k]) v.show(k, res.errors[k]); });
            else if (res.field && f.elements[res.field]) v.show(res.field, res.error);
            else F.alert(alertEl, 'error', res.error);
            return;
          }
          v.reset();
          fillProfileForm(res.user);
          renderAll();
          F.alert(alertEl, 'success', 'Your profile is saved.');
        });
    });
  }

  /* ---------- Become an Event Host ---------- */
  function statusChip(status) {
    var s = el('span', 'app-status app-status--' + status);
    s.appendChild(el('span', 'app-status__dot'));
    s.appendChild(document.createTextNode(Eventora.hosting.statusLabel(status)));
    return s;
  }

  function renderHost(u) {
    var box = $('hostState'), form = $('hostForm');
    box.textContent = '';
    form.hidden = true;
    var latest = Eventora.hosting.latestApplication();

    if (isAdmin(u)) return;                              // panel hidden for admins
    if (u.role !== 'host' && !Eventora.hosting.applicationsLoaded()) {
      box.appendChild(el('p', 'host-state__text', 'Loading your application status from the server…'));
      return;
    }
    if (u.role === 'host') {
      box.appendChild(el('p', 'host-state__title', 'You’re an Event Host.'));
      box.appendChild(el('p', 'host-state__text', 'Create events, follow their approval and see who registered, all from your host dashboard.'));
      var a = el('a', 'btn btn--md');
      a.href = 'host-dashboard.html';
      a.appendChild(el('span', '', 'Open host dashboard'));
      box.appendChild(a);
    } else if (latest && latest.status === 'pending') {
      var row = el('div', 'host-state__row');
      row.appendChild(statusChip('pending'));
      row.appendChild(el('span', 'host-state__meta', 'Submitted ' + day(latest.createdAt) + ' · ' + latest.id));
      box.appendChild(row);
      box.appendChild(el('p', 'host-state__text', 'An admin will review your application. You’ll keep the User role until it’s approved, and you can’t send another one while this is pending.'));
    } else {
      if (latest && latest.status === 'rejected') {
        var r2 = el('div', 'host-state__row');
        r2.appendChild(statusChip('rejected'));
        r2.appendChild(el('span', 'host-state__meta', 'Reviewed ' + day(latest.decidedAt) + ' · ' + latest.id));
        box.appendChild(r2);
        if (latest.note) box.appendChild(el('p', 'host-state__note', '“' + latest.note + '”'));
        box.appendChild(el('p', 'host-state__text', 'Your application wasn’t approved this time. You can apply again with more detail.'));
      } else {
        box.appendChild(el('p', 'host-state__text', 'Run concerts, talks, workshops or food nights on EvAtlas. Tell us a little about what you’d host and an admin will review it.'));
      }
      var open = el('button', 'btn btn--md');
      open.type = 'button';
      open.appendChild(el('span', '', latest ? 'Apply again' : 'Apply to become an Event Host'));
      open.addEventListener('click', function () {
        open.hidden = true;
        form.hidden = false;
        form.elements.reason.focus();
      });
      box.appendChild(open);
    }

    var history = Eventora.hosting.myApplications();
    var list = $('hostHistory');
    list.textContent = '';
    list.hidden = history.length < 2 && !(history.length === 1 && history[0].status === 'approved');
    history.forEach(function (a) {
      var li = el('li', 'host-history__item');
      li.appendChild(statusChip(a.status));
      li.appendChild(el('span', '', day(a.createdAt) + ' · ' + a.id));
      list.appendChild(li);
    });

    // prefilled, read-only applicant details
    form.elements.appName.value = u.name;
    form.elements.appEmail.value = u.email;
    form.elements.appPhone.value = u.phone;
  }

  function bindHostForm() {
    var f = $('hostForm'), alertEl = $('hostAlert');
    var v = F.bind(f, {
      organization: function (x) { return V.optional(x, 100); },
      reason: function (x) { return V.required(x, 'why you want to host events', 30, 1000); },
      info: function (x) { return V.optional(x, 1000); }
    });
    var sending = false;
    var counter = $('reasonCount');
    f.elements.reason.addEventListener('input', function () { counter.textContent = f.elements.reason.value.trim().length + ' / 1000'; });
    $('hostCancel').addEventListener('click', function () { f.reset(); v.reset(); renderHost(auth.current()); });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      F.alert(alertEl, 'error', '');
      if (v.check().length || sending) return;
      sending = true;
      var restore = F.busy(f.querySelector('[type="submit"]'), 'Sending application…');
      Eventora.hosting.apply({ organization: f.elements.organization.value, reason: f.elements.reason.value, info: f.elements.info.value })
        .then(function (res) {
          sending = false;
          restore();
          if (!res.ok) {
            if (res.errors) Object.keys(res.errors).forEach(function (k) { if (res.errors[k]) v.show(k, res.errors[k]); });
            else F.alert(alertEl, 'error', res.error);
            return;
          }
          f.reset(); v.reset();
          renderHost(auth.current());
          F.alert($('hostStatusMsg'), 'success', 'Application ' + res.application.id + ' sent to the admins. Its status is Pending.');
          $('hostState').focus();
        });
    });
  }

  /* ---------- Applied events (Event Hosts): their submissions and the admin's decision ---------- */
  function renderApplied(u) {
    var sec = $('applied-events');
    sec.hidden = u.role !== 'host';
    if (sec.hidden) return;
    var list = $('aeList'), hosting = Eventora.hosting;
    list.textContent = '';
    if (!hosting.applicationsLoaded()) {
      list.appendChild(el('li', 'dash-empty dash-empty--small', 'Loading your submissions from the server…'));
      return;
    }
    var events = hosting.myEvents().slice().sort(function (a, b) {
      return (a.submittedAt || a.createdAt) < (b.submittedAt || b.createdAt) ? 1 : -1;
    });
    if (!events.length) {
      var empty = el('li', 'dash-empty dash-empty--small');
      empty.appendChild(document.createTextNode('No submissions yet. '));
      var go = el('a', 'auth-link', 'Host an Event');
      go.href = 'host.html';
      empty.appendChild(go);
      list.appendChild(empty);
      return;
    }
    var help = {
      pending: 'Waiting for an admin to review it. Not public yet.',
      approved: 'Approved and published on EvAtlas.',
      rejected: 'Not approved. You can edit it and resubmit from the Host Dashboard (in the navbar).',
      unpublished: 'Unpublished by an admin. Not public for now; it can be published again.',
      cancelled: 'Cancelled by an admin. It won’t take place; registrations are kept.'
    };
    events.forEach(function (e) {
      var li = el('li', 'host-event host-event--' + e.status);
      var fig = el('figure', 'host-event__poster');
      var img = new Image(); img.alt = ''; img.loading = 'lazy'; img.src = Eventora.events.imageUrl(e, 160, 240);
      fig.appendChild(img);
      li.appendChild(fig);
      var body = el('div', 'host-event__body');
      var chip = el('span', 'app-status app-status--' + e.status);
      chip.appendChild(el('span', 'app-status__dot'));
      chip.appendChild(document.createTextNode(hosting.statusLabel(e.status, 'event')));
      body.appendChild(chip);
      body.appendChild(el('h3', 'host-event__title', e.title));
      body.appendChild(el('p', 'host-event__meta', 'Submitted ' + day(e.submittedAt || e.createdAt) + ' · ' + e.id));
      body.appendChild(el('p', 'host-event__help', help[e.status] || ''));
      if (e.note) body.appendChild(el('p', 'host-event__note', (e.status === 'rejected' ? 'Reason: ' : 'Admin feedback: ') + '“' + e.note + '”'));
      li.appendChild(body);
      list.appendChild(li);
    });
  }

  function renderAll() {
    var u = auth.current();
    if (!u) { location.replace('login.html?next=profile.html'); return; }
    renderHeader(u);
    renderHost(u);
    renderApplied(u);
  }

  Eventora.profile = {
    init: function () {
      if (!$('profileForm') || !Eventora.auth) return;
      auth = Eventora.auth; F = Eventora.forms; V = Eventora.validate;
      var u = auth.current();
      if (!u) { location.replace('login.html?next=profile.html'); return; }
      // old link: an admin's event form is now Host an Event (host.html)
      if (location.hash === '#create-event' && isAdmin(u)) { location.replace('host.html'); return; }
      document.getElementById('main').hidden = false;
      fillProfileForm(u);
      bindProfileForm();
      bindHostForm();
      $('pfSignOut').addEventListener('click', function () { auth.signOut(); location.href = 'index.html'; });
      renderAll();
      // the session (and role) is confirmed by the server, then applications are loaded from it
      auth.ready().then(function () { renderAll(); return Eventora.hosting.sync(); }).then(renderAll);
      auth.onChange(function (x) { if (x) renderAll(); });
      if (location.hash === '#host-application') {
        var sec = $('host-application');
        if (sec) sec.scrollIntoView({ block: 'start' });
      }
    }
  };
})(window.Eventora);
