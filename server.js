#!/usr/bin/env node
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const db = require('./lib/store');
const A = require('./lib/auth');
const { HttpError } = require('./lib/util');
const { token } = require('./lib/crypto');

const app = express();
const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
app.disable('x-powered-by');

// ---- security headers ----
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(A.attachUser);

// ---- static assets ----
const PUB = path.join(__dirname, 'public');
const staticOpts = (age) => ({ maxAge: age, setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff') });
app.use('/css', express.static(path.join(PUB, 'css'), staticOpts('5m')));
app.use('/js', express.static(path.join(PUB, 'js'), staticOpts('5m')));
app.use('/images', express.static(path.join(PUB, 'images'), staticOpts('7d')));
app.use('/docs', express.static(path.join(PUB, 'docs'), staticOpts('1d')));
app.use('/uploads', express.static(path.join(db.DATA_DIR, 'uploads'), { maxAge: '30d', immutable: true, dotfiles: 'deny', index: false, setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff') }));
app.use('/admin-assets', express.static(path.join(__dirname, 'admin'), { maxAge: 0, index: false }));
const sendAdmin = (req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(__dirname, 'admin', 'index.html'));
app.get(['/admin', '/admin/'], sendAdmin);

// ---- API ----
const api = express.Router();
api.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
api.use(A.csrf);
api.use(require('./routes/auth'));
api.use(require('./routes/content'));
api.use(require('./routes/media'));
api.use(require('./routes/blog'));
api.use(require('./routes/ai'));
api.use(require('./routes/contact'));
api.use((req, res, next) => next(new HttpError(404, 'Not found.')));
app.use('/api', api);

// ---- public site ----
const pub = require('./routes/public');
app.use(pub);
app.use((req, res) => pub.notFound(req, res));

// ---- errors ----
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') err = new HttpError(413, 'That is too large to save.');
  if (err instanceof SyntaxError && err.status === 400) err = new HttpError(400, 'Malformed request.');
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  const msg = status >= 500 && !(err instanceof HttpError) ? 'Something went wrong on the server.' : err.message;
  if (req.path.startsWith('/api')) return res.status(status).json({ error: msg });
  res.status(status).type('text/plain').send(msg);
});

app.listen(PORT, HOST, () => {
  console.log(`\nSite:       http://localhost:${PORT}/`);
  console.log(`Dashboard:  http://localhost:${PORT}/admin`);
  if (!db.data.users.length) {
    global.SETUP_TOKEN = token(9);
    console.log(`\nFIRST-TIME SETUP — open the dashboard and enter this one-time code:\n\n    ${global.SETUP_TOKEN}\n`);
  }
  if (!process.env.SECRET_KEY) console.log('(Encryption key for the Gemini API key is stored in data/secret.key — back it up with data/db.json.)');
});
