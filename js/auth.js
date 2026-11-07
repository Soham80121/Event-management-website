/* =========================================================================
   AUTH — accounts, sessions, roles. A client of the dev server's account
   API (tools/dev_server.py + tools/accounts.py).

   ┌───────────────────────────────────────────────────────────────────────┐
   │ DEVELOPMENT PROTOTYPE. Accounts, password hashes (scrypt), sessions   │
   │ and roles now live on the dev server, not in the browser. But the     │
   │ server is a local development server (one JSON file, no HTTPS), and   │
   │ events, registrations and host applications are still in browser      │
   │ storage, so the admin's actions on THOSE are not server-enforced.     │
   │ Role checks in this file shape the UI; they are NOT authorization.    │
   │ Phase 11 replaces the dev server with the production backend.         │
   └───────────────────────────────────────────────────────────────────────┘

   What the browser keeps (never a password, hash or OTP):
     eventora:auth   { version: 2, token, userId, expiresAt }
                     server session token. localStorage with "Remember me"
                     (30 days), otherwise sessionStorage.
     eventora:users  { version: 2, users: [public profiles], legacy: [...] }
                     a cache of what the server returned (your own profile;
                     for admins, every account). `legacy` holds accounts
                     from the old browser-only prototype that haven't
                     signed in since; the first sign-in moves each one to
                     the server (same user ID, creation date and role) and
                     deletes its old local password hash.

   Roles: visitor (signed out) · user · host · admin. The server decides
   them; "admin" counts only once the server confirms it on this page load.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var USERS = 'eventora:users';
  var SESSION = 'eventora:auth';
  var LEGACY_KEYS = ['eventora:session', 'eventora:admin-session'];   // retired guest identity / old admin token
  var ID_RE = /^usr_[0-9A-HJKMNP-TV-Z]{12}$/;

  var PERMISSIONS = {
    visitor: ['browse'],
    user: ['browse', 'register', 'manageOwnRegistrations', 'applyHost'],
    host: ['browse', 'register', 'manageOwnRegistrations', 'manageOwnEvents'],
    admin: ['browse', 'register', 'manageOwnRegistrations', 'manageOwnEvents',
      'manageUsers', 'reviewApplications', 'reviewEvents', 'viewAllRegistrations']
  };
  var ROLE_LABELS = { visitor: 'Visitor', user: 'User', host: 'Event Host', admin: 'Admin' };
  var SERVER_DOWN = 'The EVENTORA server can’t be reached. Start the site with: python tools/dev_server.py';

  var listeners = [];
  // status: ok | not-configured | unavailable | checking | signed-out
  var check = { userId: null, verified: false, status: 'unknown', promise: null };

  /* ---------- storage helpers ---------- */
  function storageOf(kind) {
    try {
      var s = window[kind];
      s.setItem('eventora:probe', '1'); s.removeItem('eventora:probe');
      return s;
    } catch (err) { return null; }
  }
  function readJSON(store, key) {
    if (!store) return null;
    try { var raw = store.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch (err) { return null; }
  }
  function writeJSON(store, key, value) {
    if (!store) return false;
    try { store.setItem(key, JSON.stringify(value)); return true; }
    catch (err) { return false; }
  }

  /* ---------- profile cache (public fields only) ---------- */
  function validProfile(u) {
    return !!u && typeof u === 'object' && typeof u.id === 'string' && ID_RE.test(u.id) &&
      typeof u.name === 'string' && typeof u.email === 'string' &&
      ['user', 'host', 'admin'].indexOf(u.role) !== -1;
  }
  function validLegacy(u) {
    return validProfile(u) && u.role !== 'admin' && !u.adminAccount && !!u.password &&
      typeof u.password.salt === 'string' && typeof u.password.hash === 'string' && typeof u.password.iterations === 'number';
  }
  function readCache() {
    var data = readJSON(storageOf('localStorage'), USERS);
    if (!data || !Array.isArray(data.users)) return { version: 2, users: [], legacy: [] };
    if (data.version !== 2) {
      // Old browser-only accounts: keep the ones that can move to the server
      // on their next sign-in. The old development admin is dropped: the
      // admin account is now initialised on the server (tools/init_admin.py).
      data = { version: 2, users: [], legacy: data.users.filter(validLegacy) };
      writeJSON(storageOf('localStorage'), USERS, data);
    }
    data.users = data.users.filter(validProfile);
    data.legacy = Array.isArray(data.legacy) ? data.legacy.filter(validLegacy) : [];
    return data;
  }
  function writeCache(data) {
    var store = storageOf('localStorage');
    var next = JSON.stringify(data);
    try { if (store && store.getItem(USERS) === next) return true; } catch (err) { /* write below */ }
    return writeJSON(store, USERS, data);
  }
  function cacheUsers(list, replaceAll) {
    var data = readCache();
    if (replaceAll) data.users = [];
    list.forEach(function (u) {
      if (!validProfile(u)) return;
      var rec = { id: u.id, name: u.name, email: u.email, phone: u.phone || '', createdAt: u.createdAt,
        updatedAt: u.updatedAt || u.createdAt, avatar: u.avatar || '', status: u.status || 'active', role: u.role };
      var at = -1;
      data.users.forEach(function (x, i) { if (x.id === u.id) at = i; });
      if (at === -1) data.users.push(rec); else data.users[at] = rec;
    });
    writeCache(data);
  }
  function cached(id) { return readCache().users.filter(function (x) { return x.id === id; })[0] || null; }

  /* ---------- session ---------- */
  function readSession() {
    var stores = [storageOf('localStorage'), storageOf('sessionStorage')];
    for (var i = 0; i < stores.length; i++) {
      var s = readJSON(stores[i], SESSION);
      if (s && s.version === 2 && typeof s.token === 'string' && Date.parse(s.expiresAt) > Date.now()) return s;
    }
    return null;
  }
  function writeSession(res, remember) {
    clearSession();
    writeJSON(storageOf(remember ? 'localStorage' : 'sessionStorage'), SESSION,
      { version: 2, token: res.token, userId: res.user.id, expiresAt: res.expiresAt });
    cacheUsers([res.user]);
  }
  function clearSession() {
    ['localStorage', 'sessionStorage'].forEach(function (k) {
      var s = storageOf(k);
      if (s) try { s.removeItem(SESSION); } catch (err) { /* ignore */ }
    });
  }
  function token() { var s = readSession(); return s ? s.token : ''; }

  /* ---------- server API ---------- */
  function api(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      credentials: 'same-origin',
      cache: 'no-store'
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { data.httpStatus = res.status; return data; });
    }, function () { return { httpStatus: 0 }; });       // server not reachable
  }

  /* ---------- legacy (browser-only) password check, for the one-time move ---------- */
  function unb64(str) {
    var s = atob(str), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function legacyVerify(password, rec) {
    var enc = new TextEncoder();
    return window.crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
      .then(function (key) {
        return window.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(rec.salt), iterations: rec.iterations }, key, 256);
      })
      .then(function (bits) {
        var s = '', bytes = new Uint8Array(bits);
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s) === rec.hash;
      }, function () { return false; });
  }
  function dropLegacy(email) {
    var data = readCache();
    data.legacy = data.legacy.filter(function (x) { return x.email !== email; });
    writeCache(data);
  }

  /* ---------- current user ---------- */
  function userRecord() {
    var s = readSession();
    if (!s) return null;
    var u = cached(s.userId);
    return u && u.status === 'active' ? u : null;
  }

  /** Public view. "admin" only once the server confirmed it on this page load. */
  function publicUser(u) {
    if (!u) return null;
    var serverAdmin = u.role === 'admin';
    var admin = serverAdmin && check.verified && check.userId === u.id;
    return {
      id: u.id, name: u.name, email: u.email, phone: u.phone || '',
      createdAt: u.createdAt, updatedAt: u.updatedAt || u.createdAt,
      avatar: u.avatar || '', status: u.status,
      baseRole: serverAdmin ? 'user' : u.role,
      adminAccount: serverAdmin,
      role: admin ? 'admin' : (serverAdmin ? 'user' : u.role)
    };
  }

  /** Ask the server who is signed in (and, for admins, load every account). */
  function refresh(u) {
    if (!u) {
      check = { userId: null, verified: false, status: 'signed-out', promise: Promise.resolve(false) };
      return check.promise;
    }
    if (check.userId === u.id && check.promise) return check.promise;
    var state = { userId: u.id, verified: false, status: 'checking', promise: null };
    check = state;
    state.promise = api('/api/auth/me', { token: token() }).then(function (data) {
      if (data.httpStatus === 401) {                     // session ended on the server
        clearSession();
        state.status = 'signed-out';
        return false;
      }
      if (data.httpStatus !== 200 || !data.user) { state.status = 'unavailable'; return false; }
      cacheUsers([data.user]);
      state.verified = data.user.role === 'admin';
      state.status = data.adminConfigured === false ? 'not-configured' : 'ok';
      if (!state.verified) return false;
      return api('/api/admin/users', { token: token() }).then(function (list) {
        if (list.httpStatus === 200 && Array.isArray(list.users)) cacheUsers(list.users, true);
        return true;
      });
    }).then(function (v) { emit(); return v; });
    return state.promise;
  }

  /* ---------- events ---------- */
  function emit() {
    var u = Eventora.auth.current();
    listeners.slice().forEach(function (fn) { try { fn(u); } catch (err) { /* isolate */ } });
  }

  function normEmail(v) { return String(v || '').trim().toLowerCase(); }

  function claimRegistrations(u) {
    if (Eventora.registrations && Eventora.registrations.claim) Eventora.registrations.claim(u.email, u.id);
  }

  function fail(field, error) { return { ok: false, field: field, error: error }; }

  /** After a successful server sign-in / sign-up / move. */
  function signedIn(res, remember) {
    writeSession(res, remember);
    claimRegistrations(res.user);
    check.promise = null;
    var u = cached(res.user.id);
    return refresh(u).then(function () { return { ok: true, user: publicUser(cached(res.user.id)) }; });
  }

  function serverError(res, fallback) {
    if (res.httpStatus === 0) return fail('form', SERVER_DOWN);
    if (res.errors) return { ok: false, errors: res.errors };
    return fail(res.field || 'form', res.error || fallback);
  }

  var V = function () { return Eventora.validate; };

  Eventora.auth = {
    ROLE_LABELS: ROLE_LABELS,
    PERMISSIONS: PERMISSIONS,
    KEYS: { users: USERS, session: SESSION },

    /** Signed-in user (public fields), or null for a visitor. Sync (cached). */
    current: function () { return publicUser(userRecord()); },

    /** Resolves once the server has confirmed the session (and the role). */
    ready: function () {
      var u = userRecord();
      return refresh(u).then(function () { return publicUser(userRecord()); });
    },

    /** 'visitor' | 'user' | 'host' | 'admin' (admin only once verified). */
    role: function () { var u = this.current(); return u ? u.role : 'visitor'; },

    /** UI permission check — NOT authorization (see header). */
    can: function (permission) {
      return (PERMISSIONS[this.role()] || []).indexOf(permission) !== -1;
    },

    /** How the last server check went: ok | not-configured | unavailable | checking | signed-out. */
    adminCheckStatus: function () { return check.status; },

    onChange: function (fn) { listeners.push(fn); },

    signUp: function (input) {
      var v = V();
      var errs = {
        name: v.name(input.name), email: v.email(input.email), phone: v.phone(input.phone),
        password: v.password(input.password), confirm: v.confirm(input.confirm, input.password)
      };
      var bad = Object.keys(errs).filter(function (k) { return errs[k]; });
      if (bad.length) return Promise.resolve({ ok: false, errors: errs });
      var email = normEmail(input.email);
      if (readCache().legacy.some(function (x) { return x.email === email; })) {
        return Promise.resolve(fail('email', 'An account with this email already exists. Sign in instead.'));
      }
      var remember = input.remember !== false;
      return api('/api/auth/signup', { name: input.name, email: input.email, phone: input.phone,
        password: input.password, remember: remember }).then(function (res) {
        if (res.httpStatus === 200 && res.token) return signedIn(res, remember);
        return serverError(res, 'The account couldn’t be created. Please try again.');
      });
    },

    signIn: function (email, password, remember) {
      var e = normEmail(email);
      var generic = fail('form', 'That email and password don’t match an account. Check them and try again.');
      if (!e || !password) return Promise.resolve(generic);
      return api('/api/auth/login', { email: e, password: password, remember: !!remember }).then(function (res) {
        if (res.httpStatus === 200 && res.token) return signedIn(res, !!remember);
        if (res.httpStatus !== 401) return serverError(res, generic.error);
        // Not on the server: maybe an account from the old browser-only
        // prototype. Check its old local hash, then move it to the server.
        var old = readCache().legacy.filter(function (x) { return x.email === e; })[0];
        if (!old) return fail('form', res.error || generic.error);
        return legacyVerify(password, old.password).then(function (match) {
          if (!match) return fail('form', res.error || generic.error);
          var account = { id: old.id, name: old.name, email: old.email, phone: old.phone, createdAt: old.createdAt,
            role: old.role, status: old.status, avatar: old.avatar || '' };
          return api('/api/auth/migrate', { account: account, password: password, remember: !!remember }).then(function (m) {
            if (m.httpStatus === 200 && m.token) { dropLegacy(e); return signedIn(m, !!remember); }
            if (m.httpStatus === 409) dropLegacy(e);
            return serverError(m, generic.error);
          });
        });
      });
    },

    signOut: function () {
      var t = token();
      if (t) api('/api/auth/logout', { token: t });       // the server forgets the session
      clearSession();
      refresh(null);
      emit();
    },

    updateProfile: function (changes) {
      var u = userRecord();
      if (!u) return Promise.resolve(fail('form', 'Sign in again to edit your profile.'));
      var v = V();
      var errs = { name: v.name(changes.name), email: v.email(changes.email), phone: v.phone(changes.phone) };
      if (errs.name || errs.email || errs.phone) return Promise.resolve({ ok: false, errors: errs });
      var body = { token: token(), name: changes.name, email: changes.email, phone: changes.phone,
        avatar: changes.avatar === null ? null : (changes.avatar || '') };
      return api('/api/account/update', body).then(function (res) {
        if (res.httpStatus === 200 && res.user) {
          cacheUsers([res.user]);
          emit();
          return { ok: true, user: publicUser(cached(res.user.id)) };
        }
        if (res.httpStatus === 401) { clearSession(); emit(); }
        return serverError(res, 'Your changes couldn’t be saved.');
      });
    },

    /* ---------- password recovery (forgot-password.html) ---------- */
    recovery: {
      /** Step 1: request a code. Same answer whether or not the email has an account. */
      request: function (email) { return api('/api/auth/forgot', { email: normEmail(email) }); },
      /** Step 2: check the 6-digit code; success returns a one-time reset token (kept in memory only). */
      verify: function (email, otp) { return api('/api/auth/verify-otp', { email: normEmail(email), otp: String(otp) }); },
      /** Step 3: set the new password. Signs every session of that account out. */
      reset: function (resetToken, password) { return api('/api/auth/reset-password', { resetToken: resetToken, password: password }); }
    },

    /* ---------- admin operations (server-enforced for accounts and roles) ---------- */
    admin: {
      _require: function () {
        if (!Eventora.auth.can('manageUsers')) throw new Error('Admin only');
      },
      listUsers: function () {
        this._require();
        return readCache().users.map(publicUserForAdmin);
      },
      /** Grant or revoke Event Host. Resolves to { ok, error? }. Admin itself is server-configured. */
      setHost: function (userId, isHost) {
        this._require();
        return api('/api/admin/set-role', { token: token(), userId: userId, role: isHost ? 'host' : 'user' }).then(update);
      },
      setStatus: function (userId, status) {
        this._require();
        return api('/api/admin/set-status', { token: token(), userId: userId, status: status }).then(update);
      }
    },

    /** A user's public card (name/email) from the cache — used by host & admin views. */
    userById: function (id) { return publicUserForAdmin(cached(id)); }
  };

  function update(res) {
    if (res.httpStatus === 200 && res.user) {
      cacheUsers([res.user]);
      emit();
      return { ok: true, user: publicUserForAdmin(res.user) };
    }
    return { ok: false, error: res.httpStatus === 0 ? SERVER_DOWN : (res.error || 'That change couldn’t be saved.') };
  }

  function publicUserForAdmin(u) {
    if (!u) return null;
    return { id: u.id, name: u.name, email: u.email, phone: u.phone || '', createdAt: u.createdAt,
      role: u.role, baseRole: u.role === 'admin' ? 'user' : u.role, status: u.status, avatar: u.avatar || '',
      protected: u.role === 'admin' };
  }

  /* ---------- start-up ---------- */
  LEGACY_KEYS.forEach(function (k) {
    ['localStorage', 'sessionStorage'].forEach(function (kind) {
      var s = storageOf(kind);
      if (s) try { s.removeItem(k); } catch (err) { /* ignore */ }
    });
  });
  window.addEventListener('storage', function (e) {
    // another tab signed in or out: re-check with the server. A profile-cache
    // update only needs a re-render (re-checking would bounce between tabs).
    if (e.key === SESSION) { check.promise = null; Eventora.auth.ready(); emit(); }
    else if (e.key === USERS) emit();
  });
  Eventora.auth.ready();          // confirm the session with the server early
})(window.Eventora);
