const express = require('express');
const db = require('../lib/store');
const A = require('../lib/auth');
const mailer = require('../lib/mailer');
const { sha256, token } = require('../lib/crypto');
const { wrap, HttpError, clip } = require('../lib/util');

const r = express.Router();
const pub = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, disabled: !!u.disabled, createdAt: u.createdAt, lastLogin: u.lastLogin || null });
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;
const DUMMY = A.hashPassword('dummy-password-1');
const RESET_TTL = 60 * 60 * 1000;

r.get('/auth/state', (req, res) => res.json({ needsSetup: db.data.users.length === 0 }));

r.post(
  '/auth/setup',
  wrap(async (req, res) => {
    if (db.data.users.length) throw new HttpError(403, 'Setup has already been completed.');
    if (!A.hit('setup:' + req.ip, 10, 15 * 60 * 1000)) throw new HttpError(429, 'Too many attempts. Wait a few minutes.');
    const { token, email, name, password } = req.body || {};
    if (!global.SETUP_TOKEN || token !== global.SETUP_TOKEN) throw new HttpError(403, 'Invalid setup code. It is printed in the server console when the server starts.');
    const e = String(email || '').trim().toLowerCase();
    if (!emailOk(e)) throw new HttpError(400, 'Enter a valid email address.');
    A.validatePassword(password);
    const user = { id: db.id(), email: e, name: clip(name || 'Admin', 80), role: 'admin', passHash: A.hashPassword(password), createdAt: new Date().toISOString() };
    db.data.users.push(user);
    db.log(user, 'Created the first admin account');
    global.SETUP_TOKEN = null;
    A.startSession(req, res, user);
    await db.saveNow();
    res.json({ ok: true });
  })
);

r.post(
  '/auth/login',
  wrap(async (req, res) => {
    const e = String((req.body && req.body.email) || '').trim().toLowerCase();
    const pw = String((req.body && req.body.password) || '');
    if (!A.hit('login-ip:' + req.ip, 20, 15 * 60 * 1000) || !A.hit('login:' + e, 8, 15 * 60 * 1000)) throw new HttpError(429, 'Too many sign-in attempts. Please wait 15 minutes.');
    const user = db.data.users.find((u) => u.email === e);
    const ok = A.checkPassword(pw, user ? user.passHash : DUMMY); // same work either way
    if (!user || !ok || user.disabled) throw new HttpError(401, 'Incorrect email or password.');
    user.lastLogin = new Date().toISOString();
    A.startSession(req, res, user);
    res.json({ ok: true });
  })
);

r.post(
  '/auth/forgot',
  wrap(async (req, res) => {
    const e = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!A.hit('forgot-ip:' + req.ip, 8, 15 * 60 * 1000) || !A.hit('forgot:' + e, 4, 15 * 60 * 1000)) throw new HttpError(429, 'Too many attempts. Please wait 15 minutes.');
    // Always respond the same way regardless of whether the email exists or SMTP is set up,
    // so this endpoint can't be used to discover which emails have accounts.
    const user = db.data.users.find((u) => u.email === e && !u.disabled);
    if (user && mailer.isConfigured()) {
      const tok = token(32);
      db.data.resetTokens[sha256(tok)] = { uid: user.id, exp: Date.now() + RESET_TTL };
      db.save();
      const link = `${req.protocol}://${req.get('host')}/admin?reset=${tok}`;
      const site = db.data.settings.site.name;
      mailer
        .send({
          to: user.email,
          subject: `Reset your ${site} dashboard password`,
          text: `Someone asked to reset the dashboard password for ${user.email}.\n\nOpen this link within 1 hour to set a new password:\n${link}\n\nIf you didn't request this, ignore this email — your password will stay the same.`,
          html: `<p>Someone asked to reset the dashboard password for <strong>${user.email}</strong>.</p><p>Open this link within 1 hour to set a new password:</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, ignore this email — your password will stay the same.</p>`,
        })
        .catch((err) => console.error('[auth] password reset email failed:', err.message));
    }
    res.json({ ok: true });
  })
);

r.post(
  '/auth/reset',
  wrap(async (req, res) => {
    const tok = String((req.body && req.body.token) || '');
    if (!A.hit('reset:' + req.ip, 20, 15 * 60 * 1000)) throw new HttpError(429, 'Too many attempts. Please wait 15 minutes.');
    const rec = tok && db.data.resetTokens[sha256(tok)];
    const user = rec && !(rec.exp < Date.now()) && db.data.users.find((u) => u.id === rec.uid);
    if (!user) throw new HttpError(400, 'This reset link is invalid or has expired. Request a new one.');
    A.validatePassword(req.body && req.body.password);
    user.passHash = A.hashPassword(req.body.password);
    delete db.data.resetTokens[sha256(tok)];
    for (const [h, s] of Object.entries(db.data.sessions)) if (s.uid === user.id) delete db.data.sessions[h];
    db.log(user, 'Reset their password via email link');
    await db.saveNow();
    res.json({ ok: true });
  })
);

r.post('/auth/logout', (req, res) => {
  A.endSession(req, res);
  res.json({ ok: true });
});

r.get('/me', A.requireAuth, (req, res) => res.json({ user: pub(req.user), csrf: req.session.csrf }));

r.post(
  '/auth/password',
  A.requireAuth,
  wrap(async (req, res) => {
    const { current, next } = req.body || {};
    if (!A.checkPassword(String(current || ''), req.user.passHash)) throw new HttpError(400, 'Your current password is incorrect.');
    A.validatePassword(next);
    req.user.passHash = A.hashPassword(next);
    // sign out every other session of this user
    const keep = req.session;
    for (const [h, s] of Object.entries(db.data.sessions)) if (s.uid === req.user.id && s !== keep) delete db.data.sessions[h];
    db.log(req.user, 'Changed their password');
    db.save();
    res.json({ ok: true });
  })
);

// ---- user management (admin only) ----
const adminOnly = A.requireRole('admin');
const activeAdmins = () => db.data.users.filter((u) => u.role === 'admin' && !u.disabled);

r.get('/users', adminOnly, (req, res) => res.json(db.data.users.map(pub)));

r.post(
  '/users',
  adminOnly,
  wrap(async (req, res) => {
    const { email, name, role, password } = req.body || {};
    const e = String(email || '').trim().toLowerCase();
    if (!emailOk(e)) throw new HttpError(400, 'Enter a valid email address.');
    if (db.data.users.some((u) => u.email === e)) throw new HttpError(409, 'A user with that email already exists.');
    if (!['admin', 'editor'].includes(role)) throw new HttpError(400, 'Role must be admin or editor.');
    A.validatePassword(password);
    const u = { id: db.id(), email: e, name: clip(name || e.split('@')[0], 80), role, passHash: A.hashPassword(password), createdAt: new Date().toISOString() };
    db.data.users.push(u);
    db.log(req.user, `Added ${role} ${e}`);
    db.save();
    res.json(pub(u));
  })
);

r.patch(
  '/users/:id',
  adminOnly,
  wrap(async (req, res) => {
    const u = db.data.users.find((x) => x.id === req.params.id);
    if (!u) throw new HttpError(404, 'User not found.');
    const b = req.body || {};
    if (b.role !== undefined && !['admin', 'editor'].includes(b.role)) throw new HttpError(400, 'Role must be admin or editor.');
    if (b.password) A.validatePassword(b.password);

    // Validate the *resulting* state before mutating anything — a mutate-then-revert approach
    // is fragile (a shallow copy can't reliably restore a field that was previously absent/undefined).
    const nextRole = b.role !== undefined ? b.role : u.role;
    const nextDisabled = b.disabled !== undefined ? !!b.disabled : !!u.disabled;
    const isCurrentlyActiveAdmin = u.role === 'admin' && !u.disabled;
    const willStayActiveAdmin = nextRole === 'admin' && !nextDisabled;
    const otherActiveAdminExists = db.data.users.some((x) => x.id !== u.id && x.role === 'admin' && !x.disabled);
    if (isCurrentlyActiveAdmin && !willStayActiveAdmin && !otherActiveAdminExists) {
      throw new HttpError(400, 'There must be at least one active admin. Change not applied.');
    }

    if (b.name !== undefined) u.name = clip(b.name, 80);
    if (b.role !== undefined) u.role = b.role;
    if (b.disabled !== undefined) u.disabled = !!b.disabled;
    if (b.password) u.passHash = A.hashPassword(b.password);
    if (u.disabled || b.password) for (const [h, s] of Object.entries(db.data.sessions)) if (s.uid === u.id) delete db.data.sessions[h];
    db.log(req.user, `Updated user ${u.email}`);
    db.save();
    res.json(pub(u));
  })
);

r.delete(
  '/users/:id',
  adminOnly,
  wrap(async (req, res) => {
    const i = db.data.users.findIndex((x) => x.id === req.params.id);
    if (i < 0) throw new HttpError(404, 'User not found.');
    const u = db.data.users[i];
    if (u.id === req.user.id) throw new HttpError(400, "You can't delete your own account.");
    db.data.users.splice(i, 1);
    if (!activeAdmins().length) {
      db.data.users.splice(i, 0, u);
      throw new HttpError(400, 'There must be at least one active admin.');
    }
    for (const [h, s] of Object.entries(db.data.sessions)) if (s.uid === u.id) delete db.data.sessions[h];
    db.log(req.user, `Deleted user ${u.email}`);
    db.save();
    res.json({ ok: true });
  })
);

module.exports = r;
