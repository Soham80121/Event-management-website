/* =========================================================================
   AUTH — accounts, sessions, roles (Phase 8).

   ┌───────────────────────────────────────────────────────────────────────┐
   │ PROTOTYPE, NOT SECURE. Everything here runs in the browser and stores │
   │ data in localStorage, which any visitor can read and edit in DevTools.│
   │ Role checks in this file shape the UI; they are NOT authorization.    │
   │ Phase 11 moves every function below behind a real backend with the   │
   │ same shapes (see README → "Authentication & roles").                  │
   └───────────────────────────────────────────────────────────────────────┘

   What IS done properly even in the prototype:
   - Passwords are never stored: PBKDF2-SHA256 (600,000 iterations, 16-byte
     random salt) via Web Crypto; only salt + hash are kept.
   - The Admin role is never stored and never comes from browser state. The
     dev server (tools/dev_server.py) verifies the admin EMAIL AND PASSWORD
     against its own configuration (ADMIN_EMAIL + a PBKDF2 ADMIN_PASSWORD_HASH)
     and issues a short-lived admin token it tracks in memory. Every page load
     asks the server whether that token is still valid. Editing localStorage
     or forging a session can't grant Admin without the password.
   - The password goes to the server only on the admin path: when a local
     sign-in fails (so the server can recognise the admin), or when the
     account was created by the server-verified admin sign-in. Ordinary
     users' successful sign-ins never send their password anywhere.
   - New accounts always get the "user" role. Only an admin operation can
     set "host" (and the host-application approval uses it).

   Storage (all versioned envelopes):
     eventora:users  { version, users: [{ id, name, email, phone, createdAt,
                       updatedAt, role: 'user'|'host', status: 'active'|'suspended',
                       avatar?: data:image/jpeg (≤160px), password: {algo, iterations, salt, hash} }] }
     eventora:auth   { version, userId, createdAt, expiresAt }
                     in localStorage with "Remember me" (30 days),
                     otherwise in sessionStorage (ends with the browser session).

   Roles: visitor (signed out) · user · host · admin (server-verified).
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var USERS = 'eventora:users';
  var SESSION = 'eventora:auth';
  var LEGACY_GUEST = 'eventora:session';     // Phase 7 guest identity
  var ADMIN_TOKEN = 'eventora:admin-session'; // { email, token, expiresAt } from the dev server
  var ITERATIONS = 600000;
  var REMEMBER_MS = 30 * 24 * 3600 * 1000;
  var SESSION_MS = 12 * 3600 * 1000;
  var ID_RE = /^usr_[0-9A-HJKMNP-TV-Z]{12}$/;
  var ROLES = { user: true, host: true };

  var PERMISSIONS = {
    visitor: ['browse'],
    user: ['browse', 'register', 'manageOwnRegistrations', 'applyHost'],
    host: ['browse', 'register', 'manageOwnRegistrations', 'manageOwnEvents'],
    admin: ['browse', 'register', 'manageOwnRegistrations', 'manageOwnEvents',
      'manageUsers', 'reviewApplications', 'reviewEvents', 'viewAllRegistrations']
  };
  var ROLE_LABELS = { visitor: 'Visitor', user: 'User', host: 'Event Host', admin: 'Admin' };

  var listeners = [];
  var adminState = { userId: null, email: null, verified: false, status: 'unknown', promise: null };

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

  function validUser(u) {
    return !!u && typeof u === 'object' &&
      typeof u.id === 'string' && ID_RE.test(u.id) &&
      typeof u.name === 'string' && u.name.length > 0 && u.name.length <= 80 &&
      typeof u.email === 'string' && u.email.length > 0 && u.email.length <= 254 &&
      typeof u.phone === 'string' && u.phone.length <= 16 &&
      typeof u.createdAt === 'string' && !isNaN(Date.parse(u.createdAt)) &&
      ROLES[u.role] === true &&
      (u.status === 'active' || u.status === 'suspended') &&
      (u.adminAccount === undefined || u.adminAccount === true) &&
      (u.avatar === undefined || (typeof u.avatar === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(u.avatar) && u.avatar.length < 250000)) &&
      !!u.password && typeof u.password.salt === 'string' && typeof u.password.hash === 'string' &&
      typeof u.password.iterations === 'number';
  }

  function readUsers() {
    var data = readJSON(storageOf('localStorage'), USERS);
    if (!data || !Array.isArray(data.users)) return [];
    return data.users.filter(validUser);
  }
  function writeUsers(list) {
    return writeJSON(storageOf('localStorage'), USERS, { version: 1, users: list });
  }

  /* ---------- crypto ---------- */
  var ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function randomId(prefix, n) {
    var bytes = new Uint8Array(n), out = '';
    window.crypto.getRandomValues(bytes);
    for (var i = 0; i < n; i++) out += ALPHABET[bytes[i] % 32];
    return prefix + out;
  }
  function b64(buf) {
    var s = '', bytes = new Uint8Array(buf);
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(str) {
    var s = atob(str), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function derive(password, saltBytes, iterations) {
    var enc = new TextEncoder();
    return window.crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
      .then(function (key) {
        return window.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: iterations }, key, 256);
      })
      .then(b64);
  }
  function hashPassword(password) {
    var salt = new Uint8Array(16);
    window.crypto.getRandomValues(salt);
    return derive(password, salt, ITERATIONS).then(function (hash) {
      return { algo: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt), hash: hash };
    });
  }
  function verifyPassword(password, rec) {
    return derive(password, unb64(rec.salt), rec.iterations).then(function (hash) {
      // compare full strings; timing isn't meaningful for a local prototype
      return hash === rec.hash;
    });
  }

  /* ---------- session ---------- */
  function readSession() {
    var stores = [storageOf('localStorage'), storageOf('sessionStorage')];
    for (var i = 0; i < stores.length; i++) {
      var s = readJSON(stores[i], SESSION);
      if (s && typeof s.userId === 'string' && Date.parse(s.expiresAt) > Date.now()) return s;
    }
    return null;
  }
  function writeSession(userId, remember) {
    clearSession();
    var now = Date.now();
    var s = { version: 1, userId: userId, createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (remember ? REMEMBER_MS : SESSION_MS)).toISOString() };
    return writeJSON(storageOf(remember ? 'localStorage' : 'sessionStorage'), SESSION, s);
  }
  function clearSession() {
    ['localStorage', 'sessionStorage'].forEach(function (k) {
      var s = storageOf(k);
      if (s) try { s.removeItem(SESSION); s.removeItem(ADMIN_TOKEN); } catch (err) { /* ignore */ }
    });
  }

  /* ---------- admin token (issued by the dev server after a password check) ---------- */
  function readAdminToken() {
    var stores = [storageOf('localStorage'), storageOf('sessionStorage')];
    for (var i = 0; i < stores.length; i++) {
      var t = readJSON(stores[i], ADMIN_TOKEN);
      if (t && typeof t.token === 'string' && Date.parse(t.expiresAt) > Date.now()) return t;
    }
    return null;
  }
  function writeAdminToken(email, data, remember) {
    writeJSON(storageOf(remember ? 'localStorage' : 'sessionStorage'), ADMIN_TOKEN,
      { email: email, token: data.token, expiresAt: data.expiresAt });
  }

  function api(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store'
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { data.httpStatus = res.status; return data; });
    }, function () { return { httpStatus: 0 }; });       // server not reachable
  }

  /** Ask the dev server to verify admin email + password. */
  function serverAdminLogin(email, password) {
    return api('/api/auth/admin-login', { email: email, password: password });
  }

  function userRecord() {
    var s = readSession();
    if (!s) return null;
    var u = readUsers().filter(function (x) { return x.id === s.userId; })[0];
    if (!u || u.status !== 'active') return null;
    return u;
  }

  /** The public view of a user (never includes the password record). */
  function publicUser(u) {
    if (!u) return null;
    var admin = adminState.verified && adminState.userId === u.id && adminState.email === u.email;
    return {
      id: u.id, name: u.name, email: u.email, phone: u.phone,
      createdAt: u.createdAt, updatedAt: u.updatedAt || u.createdAt,
      avatar: u.avatar || '', status: u.status,
      baseRole: u.role,
      adminAccount: !!u.adminAccount,
      role: admin ? 'admin' : u.role
    };
  }

  /* ---------- trusted admin check (dev server; Phase 11 backend) ----------
     Admin = the server still holds a live token for this email, issued after
     it verified the admin password. No token → not admin. */
  function checkAdmin(u) {
    if (!u) {
      adminState = { userId: null, email: null, verified: false, status: 'signed-out', promise: Promise.resolve(false) };
      return adminState.promise;
    }
    if (adminState.userId === u.id && adminState.email === u.email && adminState.promise) return adminState.promise;
    var state = { userId: u.id, email: u.email, verified: false, status: 'checking', promise: null };
    adminState = state;
    var t = readAdminToken();
    var token = t && t.email === u.email ? t.token : '';
    state.promise = api('/api/auth/admin-check', { email: u.email, token: token }).then(function (data) {
      if (data.httpStatus !== 200) {
        state.verified = false;           // no server → no admin
        state.status = 'unavailable';
        return false;
      }
      state.verified = data.isAdmin === true;
      state.status = !data.configured ? 'not-configured'
        : (!state.verified && u.adminAccount ? 'admin-relogin' : 'ok');
      return state.verified;
    }).then(function (v) { emit(); return v; });
    return state.promise;
  }

  /* ---------- events ---------- */
  function emit() {
    var u = Eventora.auth.current();
    listeners.slice().forEach(function (fn) { try { fn(u); } catch (err) { /* isolate */ } });
  }

  function normEmail(v) { return String(v || '').trim().toLowerCase(); }
  function normName(v) { return String(v || '').trim().replace(/\s+/g, ' '); }
  function normPhone(v) {
    var s = String(v || '').trim();
    return (s.charAt(0) === '+' ? '+' : '') + s.replace(/\D/g, '');
  }

  function claimRegistrations(u) {
    if (Eventora.registrations && Eventora.registrations.claim) Eventora.registrations.claim(u.email, u.id);
  }

  function fail(field, error) { return { ok: false, field: field, error: error }; }

  /**
   * Controlled initialisation of the development admin account. Runs ONLY
   * after the server has verified the admin email and password. Creates the
   * browser-side account record on first sign-in, or takes over an existing
   * record with that email (e.g. one created through public sign-up) and
   * re-hashes the server-verified password into it. The stored role stays
   * 'user': Admin is never stored, it comes from the live server token.
   */
  function adoptAdmin(existing, email, password) {
    return hashPassword(password).then(function (pw) {
      var list = readUsers();
      var now = new Date().toISOString();
      var rec = existing ? list.filter(function (x) { return x.id === existing.id; })[0] : null;
      if (!rec) {
        var taken = {};
        list.forEach(function (x) { taken[x.id] = true; });
        var id; do { id = randomId('usr_', 12); } while (taken[id]);
        rec = { id: id, name: 'EVENTORA Admin', email: email, phone: '', createdAt: now, role: 'user', status: 'active' };
        list.push(rec);
      }
      rec.password = pw;
      rec.adminAccount = true;
      rec.status = 'active';
      rec.updatedAt = now;
      writeUsers(list);
      return rec;
    });
  }

  var V = function () { return Eventora.validate; };

  Eventora.auth = {
    ROLE_LABELS: ROLE_LABELS,
    PERMISSIONS: PERMISSIONS,
    KEYS: { users: USERS, session: SESSION },

    /** Signed-in user (public fields), or null for a visitor. Sync. */
    current: function () { return publicUser(userRecord()); },

    /** Resolves once the server-side admin check for the current user is done. */
    ready: function () {
      var u = userRecord();
      return checkAdmin(u).then(function () { return publicUser(u); });
    },

    /** 'visitor' | 'user' | 'host' | 'admin' (admin only once verified). */
    role: function () { var u = this.current(); return u ? u.role : 'visitor'; },

    /** UI permission check — NOT authorization (see header). */
    can: function (permission) {
      return (PERMISSIONS[this.role()] || []).indexOf(permission) !== -1;
    },

    /** How the last admin check went: ok | not-configured | unavailable | checking | signed-out. */
    adminCheckStatus: function () { return adminState.status; },

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
      if (readUsers().some(function (u) { return u.email === email; })) {
        return Promise.resolve(fail('email', 'An account with this email already exists. Sign in instead.'));
      }
      return hashPassword(input.password).then(function (pw) {
        var list = readUsers();
        if (list.some(function (u) { return u.email === email; })) {      // re-check after the slow hash
          return fail('email', 'An account with this email already exists. Sign in instead.');
        }
        var taken = {};
        list.forEach(function (u) { taken[u.id] = true; });
        var id; do { id = randomId('usr_', 12); } while (taken[id]);
        var now = new Date().toISOString();
        var user = { id: id, name: normName(input.name), email: email, phone: normPhone(input.phone),
          createdAt: now, updatedAt: now, role: 'user', status: 'active', password: pw };
        list.push(user);
        if (!writeUsers(list)) return fail('form', 'This browser isn’t allowing storage, so the account couldn’t be saved.');
        writeSession(user.id, input.remember !== false);
        claimRegistrations(user);
        return checkAdmin(user).then(function () { emit(); return { ok: true, user: publicUser(user) }; });
      });
    },

    signIn: function (email, password, remember) {
      var e = normEmail(email);
      var generic = fail('form', 'That email and password don’t match an account. Check them and try again.');
      if (!e || !password) return Promise.resolve(generic);
      var u = readUsers().filter(function (x) { return x.email === e; })[0];
      // still run the hash for unknown emails so both paths take similar time
      var rec = u ? u.password : { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', hash: '', iterations: ITERATIONS };
      return verifyPassword(password, rec).then(function (match) {
        if (u && match && u.status === 'suspended') return fail('form', 'This account is suspended. Contact an EVENTORA admin.');

        // Ordinary account, password matches locally: done. Its password never
        // leaves the browser.
        if (u && match && !u.adminAccount) return finish(u, null);

        // Admin path: the server verifies email + password against its own
        // configuration. Asked when the local check failed (the server may
        // know this account) or for the server-initialised admin account.
        return serverAdminLogin(e, password).then(function (res) {
          if (res.httpStatus === 200 && res.ok && res.token) {
            return adoptAdmin(u, e, password).then(function (rec) { return finish(rec, res); });
          }
          if (u && match) return finish(u, null);          // admin account, server says no / unreachable
          if (res.httpStatus === 429) {
            return fail('form', 'Too many sign-in attempts. Wait ' + (res.retryAfter || 60) + ' seconds and try again.');
          }
          return generic;
        });
      });

      function finish(rec, adminLogin) {
        writeSession(rec.id, !!remember);
        if (adminLogin) writeAdminToken(rec.email, adminLogin, !!remember);
        claimRegistrations(rec);
        adminState.promise = null;
        return checkAdmin(rec).then(function () { emit(); return { ok: true, user: publicUser(rec) }; });
      }
    },

    signOut: function () {
      var t = readAdminToken();
      if (t) api('/api/auth/admin-logout', { token: t.token });   // the server forgets the token
      clearSession();
      checkAdmin(null);
      emit();
    },

    updateProfile: function (changes) {
      var u = userRecord();
      if (!u) return Promise.resolve(fail('form', 'Sign in again to edit your profile.'));
      var v = V();
      var errs = { name: v.name(changes.name), email: v.email(changes.email), phone: v.phone(changes.phone) };
      if (errs.name || errs.email || errs.phone) return Promise.resolve({ ok: false, errors: errs });
      var email = normEmail(changes.email);
      var list = readUsers();
      if (list.some(function (x) { return x.email === email && x.id !== u.id; })) {
        return Promise.resolve(fail('email', 'Another account already uses this email.'));
      }
      var rec = list.filter(function (x) { return x.id === u.id; })[0];
      if (rec.adminAccount && rec.email !== email) {
        return Promise.resolve(fail('email', 'The development admin’s email is set on the server (tools/init_admin.py), so it can’t be changed here.'));
      }
      var emailChanged = rec.email !== email;
      rec.name = normName(changes.name);
      rec.email = email;
      rec.phone = normPhone(changes.phone);
      if (changes.avatar === null) delete rec.avatar;
      else if (typeof changes.avatar === 'string' && changes.avatar) rec.avatar = changes.avatar;
      rec.updatedAt = new Date().toISOString();
      if (!validUser(rec)) return Promise.resolve(fail('avatar', 'That image is too large. Try a smaller one.'));
      if (!writeUsers(list)) return Promise.resolve(fail('form', 'Your changes couldn’t be saved in this browser.'));
      if (emailChanged) adminState.promise = null;       // the admin answer depends on the email
      return checkAdmin(rec).then(function () { emit(); return { ok: true, user: publicUser(rec) }; });
    },

    changePassword: function (current, next, confirm) {
      var u = userRecord();
      if (!u) return Promise.resolve(fail('form', 'Sign in again to change your password.'));
      if (u.adminAccount) {
        return Promise.resolve(fail('form', 'The development admin’s password is set on the server. Change it with: python tools/init_admin.py'));
      }
      var v = V();
      var errs = { current: current ? '' : 'Enter your current password.', next: v.password(next), confirm: v.confirm(confirm, next) };
      if (!errs.next && next === current) errs.next = 'Choose a password you haven’t used for this account.';
      if (errs.current || errs.next || errs.confirm) return Promise.resolve({ ok: false, errors: errs });
      return verifyPassword(current, u.password).then(function (ok) {
        if (!ok) return { ok: false, errors: { current: 'That isn’t your current password.' } };
        return hashPassword(next).then(function (pw) {
          var list = readUsers();
          var rec = list.filter(function (x) { return x.id === u.id; })[0];
          rec.password = pw;
          rec.updatedAt = new Date().toISOString();
          return writeUsers(list) ? { ok: true } : fail('form', 'The new password couldn’t be saved.');
        });
      });
    },

    /* ---------- admin operations (UI-gated prototype; Phase 11: server-enforced) ---------- */
    admin: {
      _require: function () {
        if (!Eventora.auth.can('manageUsers')) throw new Error('Admin only');
      },
      listUsers: function () {
        this._require();
        return readUsers().map(publicUserForAdmin);
      },
      /** Grant or revoke Event Host. Admin itself is server-configured, never set here. */
      setHost: function (userId, isHost) {
        this._require();
        var list = readUsers();
        var rec = list.filter(function (x) { return x.id === userId; })[0];
        if (!rec) return { ok: false, error: 'User not found.' };
        rec.role = isHost ? 'host' : 'user';
        rec.updatedAt = new Date().toISOString();
        writeUsers(list);
        emit();
        return { ok: true };
      },
      setStatus: function (userId, status) {
        this._require();
        if (status !== 'active' && status !== 'suspended') return { ok: false, error: 'Unknown status.' };
        var me = Eventora.auth.current();
        if (me && me.id === userId) return { ok: false, error: 'You can’t suspend your own account.' };
        var list = readUsers();
        var rec = list.filter(function (x) { return x.id === userId; })[0];
        if (!rec) return { ok: false, error: 'User not found.' };
        rec.status = status;
        rec.updatedAt = new Date().toISOString();
        writeUsers(list);
        emit();
        return { ok: true };
      }
    },

    /** Look up a user's public card (name/email) — used by host & admin views. */
    userById: function (id) {
      return publicUserForAdmin(readUsers().filter(function (x) { return x.id === id; })[0]);
    }
  };

  function publicUserForAdmin(u) {
    if (!u) return null;
    var isAdmin = adminState.verified && adminState.userId === u.id && adminState.email === u.email;
    return { id: u.id, name: u.name, email: u.email, phone: u.phone, createdAt: u.createdAt,
      role: isAdmin ? 'admin' : u.role, baseRole: u.role, status: u.status, avatar: u.avatar || '' };
  }

  /* ---------- start-up ---------- */
  try { window.localStorage.removeItem(LEGACY_GUEST); } catch (err) { /* Phase 7 guest identity retired */ }
  window.addEventListener('storage', function (e) {
    if (e.key === USERS || e.key === SESSION) { adminState.promise = null; Eventora.auth.ready(); emit(); }
  });
  Eventora.auth.ready();          // start the admin check early
})(window.Eventora);
