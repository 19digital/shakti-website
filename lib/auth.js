const bcrypt = require('bcryptjs');
const db = require('./store');
const { sha256, token } = require('./crypto');
const { HttpError } = require('./util');

const SESSION_TTL = 7 * 24 * 3600 * 1000;
const IDLE_TTL = 12 * 3600 * 1000;

/** tiny in-memory sliding-window limiter */
const buckets = new Map();
function hit(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (!v.some((t) => now - t < 3600 * 1000)) buckets.delete(k);
  for (const [h, s] of Object.entries(db.data.sessions)) if (s.exp < now) delete db.data.sessions[h];
}, 10 * 60 * 1000).unref();

const hashPassword = (pw) => bcrypt.hashSync(pw, 11);
const checkPassword = (pw, hash) => bcrypt.compareSync(pw, hash);

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Password must be at least 10 characters.');
  if (pw.length > 200) throw new HttpError(400, 'Password is too long.');
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) throw new HttpError(400, 'Password must contain letters and numbers.');
}

function cookieOpts(req) {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure: req.secure || process.env.COOKIE_SECURE === 'true', maxAge: SESSION_TTL };
}

function startSession(req, res, user) {
  const tok = token(32);
  db.data.sessions[sha256(tok)] = { uid: user.id, csrf: token(18), exp: Date.now() + SESSION_TTL, seen: Date.now() };
  db.save();
  res.cookie('sid', tok, cookieOpts(req));
}
function endSession(req, res) {
  const tok = req.cookies && req.cookies.sid;
  if (tok) {
    delete db.data.sessions[sha256(tok)];
    db.save();
  }
  res.clearCookie('sid', { path: '/' });
}

/** attaches req.user / req.session when a valid cookie is present */
function attachUser(req, res, next) {
  const tok = req.cookies && req.cookies.sid;
  if (tok) {
    const h = sha256(tok);
    const s = db.data.sessions[h];
    const now = Date.now();
    if (s && s.exp > now && now - s.seen < IDLE_TTL) {
      const user = db.data.users.find((u) => u.id === s.uid && !u.disabled);
      if (user) {
        s.seen = now;
        req.user = user;
        req.session = s;
      }
    } else if (s) {
      delete db.data.sessions[h];
    }
  }
  next();
}

const requireAuth = (req, res, next) => (req.user ? next() : next(new HttpError(401, 'Please sign in.')));
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in.'));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have permission to do that.'));
  next();
};

/** state-changing API calls from a signed-in session must carry the CSRF token */
// Routes any visitor can call with no session at all, and that never act on session/user identity.
// They must stay reachable even for a visitor who *also* happens to be signed into the dashboard
// in the same browser (e.g. an admin testing their own contact form) — that visitor still has no
// CSRF token to send here, since the page that calls this endpoint is the public site, not the
// dashboard, so the token was never handed to it.
const CSRF_EXEMPT = new Set(['POST /contact', 'POST /chat']);
function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.session) return next();
  if (CSRF_EXEMPT.has(req.method + ' ' + req.path)) return next();
  if (req.get('x-csrf-token') !== req.session.csrf) return next(new HttpError(403, 'Security check failed — reload the page and try again.'));
  next();
}

module.exports = { hit, hashPassword, checkPassword, validatePassword, startSession, endSession, attachUser, requireAuth, requireRole, csrf };
