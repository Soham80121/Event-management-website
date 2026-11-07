/* =========================================================================
   HOSTING — Event Host applications and host-created events (Phase 8).

   PROTOTYPE, NOT SECURE: data lives in localStorage and every permission
   check below runs in the browser, so it only shapes the UI. In Phase 11
   the same functions become backend endpoints that enforce them.

   HOST APPLICATIONS live on the dev server (tools/eventdata.py), which
     enforces the rules: one pending application per user, only an admin
     decides, approving makes the user an Event Host, rejecting needs a reason.
     sync() loads them; the getters below read that copy. A pending
     application from before (saved only in eventora:host-applications in
     this browser) is moved to the server once, keeping its ID.

   EVENTS SUBMITTED NOW are saved on the dev server (tools/eventdata.py):
     always Pending, owned by the signed-in host or admin; only an admin
     approval publishes them. sync() loads the signed-in person's (admins:
     all) server events; loadPublic() loads the published ones for the
     public pages before they render. Every function below works on both
     kinds and sends each action to wherever the event lives.

   eventora:hosted-events  (events created before server saving; unchanged)
     { version, events: [{ ...catalogue event fields, id: 'h-<slug>-<4>',
       hostId, status: 'pending'|'approved'|'rejected'|'unpublished',
       createdAt, updatedAt, submittedAt, decidedAt?, note? }] }
     - only 'approved' events are public (they join Eventora.events)
     - hosts edit/delete their own events while pending or rejected;
       an edit (re)submits the event for approval
     - admins create events directly (no host application), edit any event,
       publish / unpublish / cancel / delete (admin.* below; rules on the server)

   Built-in event overrides: { <built-in event id>: { status?: 'unpublished'|'cancelled',
       fields?: {title, category, date, time, venue, image, description, price},
       updatedAt, note? } }
     - stored on the server (.data/overrides.json) and loaded with the public
       events; the built-in catalogue stays frozen in js/events.js and the
       overrides are applied on read. The old browser key
       eventora:catalogue-overrides is moved to the server once (admin).
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var APPS = 'eventora:host-applications';
  var EVENTS_KEY = 'eventora:hosted-events';
  var OVERRIDES = 'eventora:catalogue-overrides';
  var APP_ID = /^APP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
  var APP_STATUS = { pending: true, approved: true, rejected: true };
  var EV_STATUS = { pending: true, approved: true, rejected: true, unpublished: true, cancelled: true };

  var auth = function () { return Eventora.auth; };
  var cat = function () { return Eventora.events; };
  var V = function () { return Eventora.validate; };

  /* ---------- storage ---------- */
  function read(key, field) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return [];
      var data = JSON.parse(raw);
      return data && Array.isArray(data[field]) ? data[field] : [];
    } catch (err) { return []; }
  }
  function write(key, field, list) {
    try {
      var o = { version: 1 }; o[field] = list;
      window.localStorage.setItem(key, JSON.stringify(o));
      return true;
    } catch (err) { return false; }
  }
  function str(v, max) { return typeof v === 'string' && v.length <= max; }

  /* Built-in event overrides (unpublished / cancelled status, admin edits)
     live on the server (.data/overrides.json). ovCache is the copy from
     /api/events/public (everyone) or /api/admin/events (admin, with notes).
     The old browser-only copy (OVERRIDES key) is only read once, to move it
     to the server. */
  var ovCache = {};
  function readOverrides() { return ovCache; }
  function readLocalOverrides() {
    try {
      var data = JSON.parse(window.localStorage.getItem(OVERRIDES) || 'null');
      return data && data.overrides && typeof data.overrides === 'object' ? data.overrides : {};
    } catch (err) { return {}; }
  }
  /** Admin: move built-in event changes saved only in this browser to the server, once. */
  function carryOverOverrides() {
    var local = readLocalOverrides();
    if (!Object.keys(local).length) return Promise.resolve();
    return auth().request('/api/admin/import', { data: { overrides: local } }).then(function (res) {
      if (res.httpStatus === 200) { try { window.localStorage.removeItem(OVERRIDES); } catch (err) { /* ignore */ } }
    });
  }

  function validApp(a) {
    return !!a && APP_ID.test(a.id) && typeof a.userId === 'string' && APP_STATUS[a.status] &&
      str(a.name, 80) && str(a.email, 254) && str(a.phone, 16) && str(a.reason, 1000) &&
      (a.organization === undefined || str(a.organization, 100)) && (a.info === undefined || str(a.info, 1000)) &&
      !isNaN(Date.parse(a.createdAt));
  }
  function readApps() { return read(APPS, 'applications').filter(validApp); }

  function validHosted(e) {
    return !!e && typeof e.id === 'string' && /^h-[a-z0-9-]+$/.test(e.id) && typeof e.hostId === 'string' &&
      EV_STATUS[e.status] && !isNaN(Date.parse(e.createdAt)) && cat().check(publicShape(e)).length === 0;
  }
  function readHosted() { return read(EVENTS_KEY, 'events').filter(validHosted); }

  /** The catalogue-shaped, public view of a hosted event (no host/admin fields). */
  function publicShape(e) {
    var o = {
      id: e.id, title: e.title, category: e.category, date: e.date, time: e.time,
      venue: { name: e.venue && e.venue.name, city: e.venue && e.venue.city },
      image: { src: e.image && e.image.src, alt: e.image && e.image.alt },
      description: e.description, featured: false,
      registration: { status: 'open' },
      hostedBy: e.hostName || ''
    };
    if (e.price && e.price.amount > 0) o.price = { amount: e.price.amount, currency: 'USD' };
    return o;
  }

  /* ---------- host applications: server copy ---------- */
  var appCache = { mine: [], all: [], loaded: false };
  function byNewest(a, b) { return a.createdAt < b.createdAt ? 1 : -1; }
  function putApp(app) {
    ['mine', 'all'].forEach(function (k) {
      var list = appCache[k], at = -1;
      list.forEach(function (x, i) { if (x.id === app.id) at = i; });
      if (at !== -1) list[at] = app;
      else if (k === 'all' || app.userId === (me() && me().id)) list.push(app);
      list.sort(byNewest);
    });
  }
  function serverError(res, fallback) {
    if (res.httpStatus === 0) return deny(auth().SERVER_DOWN);
    if (res.httpStatus === 401) return deny('Your session has ended. Sign in again.');
    if (res.errors) return { ok: false, errors: res.errors };
    return { ok: false, field: res.field, error: res.message || res.error || fallback };
  }
  /** Move this user's own pending application(s) from browser storage to the server, once. */
  function carryOver(u) {
    var local = readApps().filter(function (a) { return a.userId === u.id && a.status === 'pending'; });
    return local.reduce(function (p, a) {
      return p.then(function () {
        return auth().request('/api/me/applications/carry-over', { application: a }).then(function (res) {
          if (res.httpStatus === 200) {
            write(APPS, 'applications', read(APPS, 'applications').filter(function (x) { return x.id !== a.id; }));
          }
        });
      });
    }, Promise.resolve());
  }

  /* ---------- events on the server ---------- */
  var PUBLIC_CACHE = 'eventora:public-events-cache';     // last published list (offline fallback only)
  var evCache = { mine: [], all: [], pub: [] };
  try {
    var cached = JSON.parse(window.localStorage.getItem(PUBLIC_CACHE) || 'null') || {};
    evCache.pub = cached.events || [];
    ovCache = cached.overrides && typeof cached.overrides === 'object' ? cached.overrides : {};
  } catch (err) { evCache.pub = []; }
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time < b.time ? -1 : a.time > b.time ? 1 : 0); }
  function serverEvent(id) {
    return evCache.mine.concat(evCache.all).filter(function (e) { return e.id === id; })[0] || null;
  }
  function putEvent(ev) {
    var u = me();
    [['mine', u && ev.hostId === u.id], ['all', auth().can('reviewEvents')]].forEach(function (k) {
      var list = evCache[k[0]], at = -1;
      list.forEach(function (x, i) { if (x.id === ev.id) at = i; });
      if (at !== -1) list[at] = ev; else if (k[1]) list.push(ev);
    });
    // keep this tab's public list in step with a status change (only Published is public)
    evCache.pub = evCache.pub.filter(function (e) { return e.id !== ev.id; });
    if (ev.status === 'approved') evCache.pub.push(publicShape(ev));
  }
  function dropEvent(id) {
    ['mine', 'all', 'pub'].forEach(function (k) { evCache[k] = evCache[k].filter(function (e) { return e.id !== id; }); });
  }
  /** After a permanent delete: drop the event and re-read registrations (its bookings are gone too). */
  function deleted(id) {
    return function (res) {
      if (res.httpStatus !== 200) return serverError(res, 'The event couldn’t be deleted.');
      dropEvent(id);
      var regs = Eventora.registrations;
      var done = { ok: true, deletedRegistrations: res.deletedRegistrations || 0 };
      return regs && regs.sync ? Promise.resolve(regs.sync()).then(function () { return done; }, function () { return done; }) : done;
    };
  }
  function eventCall(path, body, fallback) {
    return auth().request(path, body).then(function (res) {
      if (res.httpStatus === 200 && res.event) { putEvent(res.event); return { ok: true, event: res.event }; }
      if (res.httpStatus === 200) return { ok: true };
      return serverError(res, fallback);
    });
  }

  /**
   * Move the signed-in host's own PENDING submissions that were saved only in
   * this browser (before events lived on the server) to the server, keeping
   * their IDs. Each one is removed from browser storage once the server has it.
   */
  function carryOverEvents(u) {
    if (!auth().can('manageOwnEvents')) return Promise.resolve();
    var local = readHosted().filter(function (e) { return e.hostId === u.id && e.status === 'pending'; });
    return local.reduce(function (p, e) {
      return p.then(function () {
        return auth().request('/api/me/events/carry-over', { event: e }).then(function (res) {
          if (res.httpStatus === 200) {
            write(EVENTS_KEY, 'events', read(EVENTS_KEY, 'events').filter(function (x) { return x.id !== e.id; }));
          }
        });
      });
    }, Promise.resolve());
  }

  /* ---------- ids ---------- */
  var ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function rand(n) {
    var b = new Uint8Array(n), s = '';
    window.crypto.getRandomValues(b);
    for (var i = 0; i < n; i++) s += ALPHABET[b[i] % 32];
    return s;
  }
  function slug(title) {
    return String(title).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'event';
  }

  function me() { return auth() && auth().current(); }
  function deny(msg) { return { ok: false, error: msg || 'You don’t have permission to do that.' }; }

  /* ---------- host event fields ---------- */
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** Validate host-entered fields. Returns { errors, value }. */
  function checkEvent(f, opts) {
    opts = opts || {};
    var v = V(), errs = {};
    var title = String(f.title || '').trim().replace(/\s+/g, ' ');
    errs.title = v.required(title, 'an event title', 3, 80);
    errs.category = cat().categories.indexOf(f.category) === -1 ? 'Choose a category.' : '';
    errs.date = !/^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? 'Choose a date.'
      : (!opts.allowPast && f.date < todayISO() ? 'Choose today or a future date.' : '');
    errs.time = !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.time || '') ? 'Choose a start time.' : '';
    errs.venue = v.required(f.venue, 'the venue name', 2, 60);
    errs.city = v.required(f.city, 'the city', 2, 60);
    errs.description = v.required(f.description, 'a short description', 20, 400);
    var price = String(f.price === undefined ? '' : f.price).trim();
    var amount = price === '' ? 0 : Number(price);
    errs.price = (isNaN(amount) || amount < 0 || amount > 10000 || Math.round(amount) !== amount)
      ? 'Enter a whole-dollar price from 0 (free) to 10000.' : '';
    var image = Eventora.hosting.coverImages().filter(function (i) { return i.src === f.image; })[0];
    errs.image = image ? '' : 'Choose a cover image.';
    Object.keys(errs).forEach(function (k) { if (!errs[k]) delete errs[k]; });
    return {
      errors: errs,
      value: {
        title: title, category: f.category, date: f.date, time: f.time,
        venue: { name: String(f.venue || '').trim(), city: String(f.city || '').trim() },
        image: image ? { src: image.src, alt: image.alt } : null,
        description: String(f.description || '').trim(),
        price: amount > 0 ? { amount: amount, currency: 'USD' } : null
      }
    };
  }

  Eventora.hosting = {
    KEYS: { applications: APPS, events: EVENTS_KEY },
    /** Application statuses read Approved; event statuses read Published. */
    statusLabel: function (s, kind) {
      if (kind === 'event' && s === 'approved') return 'Published';
      return { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', unpublished: 'Unpublished', cancelled: 'Cancelled' }[s] || s;
    },

    /** Cover photos a host can choose (the catalogue's own photography). */
    coverImages: function () {
      var seen = {};
      return cat().catalogue().filter(function (e) {
        if (seen[e.image.src]) return false;
        seen[e.image.src] = true;
        return true;
      }).map(function (e) { return { src: e.image.src, alt: e.image.alt, category: e.category }; });
    },

    /* ----- applications (signed-in user) ----- */
    /** Load applications from the server (own; admins also every one). Resolves when done. */
    sync: function () {
      var u = me();
      if (!u) { appCache = { mine: [], all: [], loaded: false }; return Promise.resolve(); }
      var hostish = auth().can('manageOwnEvents'), admin = auth().can('reviewApplications');
      return carryOver(u).then(function () { return carryOverEvents(u); }).then(function () {
        return admin ? carryOverOverrides() : null;
      }).then(function () {
        return Promise.all([
          auth().request('/api/me/applications', {}),
          admin ? auth().request('/api/admin/applications', {}) : null,
          hostish ? auth().request('/api/me/events', {}) : null,
          admin ? auth().request('/api/admin/events', {}) : null,
          Eventora.registrations && Eventora.registrations.sync ? Eventora.registrations.sync() : null
        ]);
      }).then(function (res) {
        if (res[0].httpStatus === 200) appCache.mine = res[0].applications.sort(byNewest);
        if (res[1] && res[1].httpStatus === 200) appCache.all = res[1].applications.sort(byNewest);
        appCache.loaded = res[0].httpStatus === 200;
        appCache.status = res[0].httpStatus;
        evCache.mine = res[2] && res[2].httpStatus === 200 ? res[2].events : [];
        evCache.all = res[3] && res[3].httpStatus === 200 ? res[3].events : [];
        if (res[3] && res[3].httpStatus === 200 && res[3].overrides) ovCache = res[3].overrides;
      });
    },
    /**
     * Published events from the server, for the public pages. main.js waits
     * for this (briefly) before rendering; if the server can't be reached the
     * last list this browser saw is used.
     */
    loadPublic: function (timeoutMs) {
      var req = fetch('/api/events/public', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: '{}', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; });
      var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, timeoutMs || 2500); });
      return Promise.race([req, timeout]).then(function (data) {
        if (data && Array.isArray(data.events)) {
          evCache.pub = data.events;
          ovCache = data.overrides && typeof data.overrides === 'object' ? data.overrides : {};
          try { window.localStorage.setItem(PUBLIC_CACHE, JSON.stringify({ events: data.events, overrides: ovCache })); } catch (err) { /* ignore */ }
        }
      }, function () { /* offline: keep the cached list */ });
    },
    isServerEvent: function (id) { return !!serverEvent(id); },

    /** Whether the last sync reached the server (false: show "couldn't load"). */
    applicationsLoaded: function () { return appCache.loaded; },

    myApplications: function () { return appCache.mine.slice(); },
    latestApplication: function () { return this.myApplications()[0] || null; },

    /** Apply to become an Event Host. Resolves to { ok, application } or { ok:false, errors|error }. */
    apply: function (f) {
      var u = me();
      if (!u) return Promise.resolve(deny('Sign in to apply.'));
      var v = V();
      var errs = {
        organization: v.optional(f.organization, 100),
        reason: v.required(f.reason, 'why you want to host events', 30, 1000),
        info: v.optional(f.info, 1000)
      };
      if (errs.organization || errs.reason || errs.info) return Promise.resolve({ ok: false, errors: errs });
      return auth().request('/api/me/applications/apply', {
        organization: String(f.organization || ''), reason: String(f.reason || ''), info: String(f.info || '')
      }).then(function (res) {
        if (res.httpStatus === 200 && res.application) { putApp(res.application); return { ok: true, application: res.application }; }
        return serverError(res, 'Your application couldn’t be sent. Please try again.');
      });
    },

    /* ----- hosted events (host) ----- */
    /** The signed-in host's events: server-saved ones plus older browser-saved ones. */
    myEvents: function () {
      var u = me();
      if (!u) return [];
      var server = evCache.mine.slice();
      var ids = {}; server.forEach(function (e) { ids[e.id] = true; });
      return server.concat(readHosted().filter(function (e) { return e.hostId === u.id && !ids[e.id]; })).sort(byDate);
    },

    checkEvent: checkEvent,

    /**
     * Submit an event (Event Host or Admin). Saved on the server, always
     * Pending, owned by the signed-in account. Resolves to { ok, event } or
     * { ok:false, errors|error }.
     */
    createEvent: function (f) {
      var u = me();
      if (!u || !auth().can('manageOwnEvents')) return Promise.resolve(deny('Only Event Hosts and admins can submit events.'));
      var c = checkEvent(f);
      if (Object.keys(c.errors).length) return Promise.resolve({ ok: false, errors: c.errors });
      return eventCall('/api/me/events/submit', { event: c.value }, 'The event couldn’t be submitted. Please try again.');
    },

    /** Hosts edit their own events while pending or rejected (re-submits it). */
    updateEvent: function (id, f) {
      var u = me();
      var c = checkEvent(f);
      if (serverEvent(id)) {
        if (Object.keys(c.errors).length) return Promise.resolve({ ok: false, errors: c.errors });
        return eventCall('/api/me/events/update', { id: id, event: c.value }, 'Your changes couldn’t be saved.');
      }
      var list = readHosted();
      var ev = list.filter(function (e) { return e.id === id; })[0];
      if (!u || !ev || ev.hostId !== u.id) return deny('You can only edit your own events.');
      if (ev.status !== 'pending' && ev.status !== 'rejected') {
        return deny('Approved and unpublished events are locked. Ask an admin if something needs to change.');
      }
      if (Object.keys(c.errors).length) return { ok: false, errors: c.errors };
      Object.assign(ev, c.value);
      if (!c.value.price) delete ev.price;
      var now = new Date().toISOString();
      ev.status = 'pending'; ev.updatedAt = now; ev.submittedAt = now;
      delete ev.decidedAt; delete ev.note;
      write(EVENTS_KEY, 'events', list);
      return { ok: true, event: ev };
    },

    deleteEvent: function (id) {
      if (serverEvent(id)) {
        return auth().request('/api/me/events/delete', { id: id }).then(deleted(id));
      }
      var u = me();
      var list = readHosted();
      var ev = list.filter(function (e) { return e.id === id; })[0];
      if (!u || !ev || ev.hostId !== u.id) return deny('You can only delete your own events.');
      if (ev.status !== 'pending' && ev.status !== 'rejected') return deny('Only pending or rejected events can be deleted.');
      write(EVENTS_KEY, 'events', list.filter(function (e) { return e.id !== id; }));
      return { ok: true };
    },

    /** Registrations for an event — its host or an admin only. */
    registrationsFor: function (eventId) {
      var u = me();
      if (!u) return null;
      var ev = serverEvent(eventId) || readHosted().filter(function (e) { return e.id === eventId; })[0];
      var allowed = auth().can('viewAllRegistrations') || (ev && ev.hostId === u.id);
      if (!allowed || !Eventora.registrations) return null;
      return Eventora.registrations.all().filter(function (r) { return r.eventId === eventId; });
    },

    /** Public events: approved browser-saved ones plus the server's published list. */
    /** Published hosted events for the public pages: the server's list only,
     *  so Guests, Users, Hosts and the Admin all see the same catalogue
     *  (events still saved only in one browser are never public). */
    publicEvents: function () { return evCache.pub.slice(); },

    /* ----- admin review ----- */
    admin: {
      _require: function (perm) { if (!auth().can(perm)) throw new Error('Admin only'); },

      applications: function () {
        this._require('reviewApplications');
        return appCache.all.slice();
      },
      /** Approve or reject on the server (a reason is required to reject). Resolves to { ok, error? }. */
      decideApplication: function (id, decision, note) {
        this._require('reviewApplications');
        return auth().request('/api/admin/applications/decide', { id: id, decision: decision, note: String(note || '') })
          .then(function (res) {
            if (res.httpStatus === 200 && res.application) {
              putApp(res.application);
              if (res.user) auth().remember(res.user);          // the applicant is now an Event Host
              return { ok: true, application: res.application };
            }
            return serverError(res, 'That decision couldn’t be saved.');
          });
      },

      events: function () {
        this._require('reviewEvents');
        var ids = {}; evCache.all.forEach(function (e) { ids[e.id] = true; });
        return evCache.all.concat(readHosted().filter(function (e) { return !ids[e.id]; }))
          .sort(function (a, b) { return a.submittedAt < b.submittedAt ? 1 : -1; });
      },

      /**
       * Every event in one list, for the admin Events table:
       * { id, source: 'catalogue'|'host'|'admin', status, event (catalogue-shaped,
       *   edits applied), hostId, hostName, submittedAt, note }
       */
      allEvents: function () {
        this._require('reviewEvents');
        var ov = readOverrides();
        var rows = cat().catalogue().map(function (orig) {
          var o = ov[orig.id] || {};
          var view = o.fields ? Object.assign({}, orig, o.fields) : orig;   // edits shown whatever the status
          return { id: orig.id, source: 'catalogue', status: o.status || 'approved', event: view,
            hostId: null, hostName: 'EVENTORA (built-in)', submittedAt: '', note: o.note || '' };
        });
        this.events().forEach(function (e) {
          rows.push({ id: e.id, source: e.createdBy === 'admin' ? 'admin' : 'host', status: e.status,
            event: publicShape(e), raw: e, hostId: e.hostId, hostName: e.hostName || '',
            submittedAt: e.submittedAt || e.createdAt, note: e.note || '' });
        });
        return rows;
      },

      /** Admin creates an event directly: no host application needed. */
      createEvent: function (f, publish) {
        this._require('reviewEvents');
        var u = me();
        var c = checkEvent(f);
        if (Object.keys(c.errors).length) return { ok: false, errors: c.errors };
        var list = readHosted();
        var id; do { id = 'h-' + slug(c.value.title) + '-' + rand(4).toLowerCase(); }
        while (cat().isCatalogue(id) || list.some(function (e) { return e.id === id; }));
        var now = new Date().toISOString();
        var ev = Object.assign({ id: id, hostId: u.id, hostName: 'EVENTORA', createdBy: 'admin',
          status: publish ? 'approved' : 'pending', createdAt: now, updatedAt: now, submittedAt: now }, c.value);
        if (publish) ev.decidedAt = now;
        if (!ev.price) delete ev.price;
        list.push(ev);
        if (!write(EVENTS_KEY, 'events', list)) return deny('The event couldn’t be saved in this browser.');
        return { ok: true, event: ev };
      },

      /** Admin edits any event in place (status unchanged). */
      updateEvent: function (id, f) {
        this._require('reviewEvents');
        var c = checkEvent(f, { allowPast: true });
        if (serverEvent(id)) {
          if (Object.keys(c.errors).length) return Promise.resolve({ ok: false, errors: c.errors });
          return eventCall('/api/admin/events/update', { id: id, event: c.value }, 'The event couldn’t be saved.');
        }
        if (Object.keys(c.errors).length) return { ok: false, errors: c.errors };
        if (cat().isCatalogue(id)) {
          return auth().request('/api/admin/events/update', { id: id, event: c.value }).then(function (res) {
            if (res.httpStatus !== 200) return serverError(res, 'The event couldn’t be saved.');
            ovCache[id] = res.override;
            return { ok: true, event: Object.assign({ id: id }, c.value) };
          });
        }
        var list = readHosted();
        var ev = list.filter(function (e) { return e.id === id; })[0];
        if (!ev) return deny('Event not found.');
        Object.assign(ev, c.value);
        if (!c.value.price) delete ev.price;
        ev.updatedAt = new Date().toISOString();
        write(EVENTS_KEY, 'events', list);
        return { ok: true, event: ev };
      },

      /** approved (= published) · rejected · unpublished · cancelled. The server
       *  decides which changes are allowed (tools/eventdata.py TRANSITIONS). */
      setEventStatus: function (id, status, note) {
        this._require('reviewEvents');
        if (!EV_STATUS[status] || status === 'pending') return deny('Unknown status.');
        if (serverEvent(id)) {
          return eventCall('/api/admin/events/status', { id: id, status: status, note: String(note || '') },
            'That change couldn’t be saved.');
        }
        if (cat().isCatalogue(id)) {
          return auth().request('/api/admin/events/status', { id: id, status: status, note: String(note || '') })
            .then(function (res) {
              if (res.httpStatus !== 200) return serverError(res, 'That change couldn’t be saved.');
              ovCache[id] = res.override;
              return { ok: true };
            });
        }
        var list = readHosted();
        var ev = list.filter(function (e) { return e.id === id; })[0];
        if (!ev) return deny('Event not found.');
        ev.status = status;
        ev.decidedAt = new Date().toISOString();
        if (note && String(note).trim()) ev.note = String(note).trim().slice(0, 500); else delete ev.note;
        write(EVENTS_KEY, 'events', list);
        return { ok: true, event: ev };
      },

      /** Permanently delete a hosted event and all its registrations (built-in events can't be deleted). */
      deleteEvent: function (id) {
        this._require('reviewEvents');
        if (cat().isCatalogue(id)) return deny('Built-in events can’t be deleted. Unpublish or cancel them instead.');
        if (serverEvent(id)) return auth().request('/api/admin/events/delete', { id: id }).then(deleted(id));
        var list = readHosted();
        if (!list.some(function (e) { return e.id === id; })) return deny('Event not found.');
        write(EVENTS_KEY, 'events', list.filter(function (e) { return e.id !== id; }));
        return { ok: true, deletedRegistrations: 0 };
      },

      /** Every registration, for the admin Registrations section. */
      registrations: function () {
        this._require('viewAllRegistrations');
        return Eventora.registrations ? Eventora.registrations.all() : [];
      },

      /** Title for any event id, including hidden or deleted ones. */
      eventTitle: function (id) {
        var e = cat().byId(id);
        if (e) return e.title;
        var h = serverEvent(id) || readHosted().filter(function (x) { return x.id === id; })[0];
        if (h) return h.title;
        var c = cat().catalogue().filter(function (x) { return x.id === id; })[0];
        return c ? c.title : 'Event no longer listed (' + id + ')';
      }
    }
  };

  // Approved host events join the public programme.
  if (cat() && cat().addSource) cat().addSource(function () { return Eventora.hosting.publicEvents(); });
  if (cat() && cat().setOverrides) cat().setOverrides(function (id) { return readOverrides()[id] || null; });
})(window.Eventora);
