/**
 * SMTP mailer for admin notifications (e.g. "someone filled in the contact form").
 * Works with any SMTP provider — including Hostinger's own hosting email (smtp.hostinger.com,
 * port 465/SSL or 587/STARTTLS) once the admin creates a mailbox in hPanel and enters it in
 * Dashboard → Settings → Email Notifications. The password is encrypted at rest the same way
 * as the Gemini key and is never sent back to the browser.
 */
const nodemailer = require('nodemailer');
const db = require('./store');
const { decrypt } = require('./crypto');
const { HttpError } = require('./util');

function config(overridePass) {
  const s = db.data.settings.smtp;
  const pass = overridePass !== undefined ? overridePass : decrypt(s.passEnc);
  return { host: s.host, port: +s.port || 587, secure: !!s.secure, user: s.user, pass, from: s.from || db.data.settings.site.email };
}
const isConfigured = () => {
  const s = db.data.settings.smtp;
  return !!(s.host && s.user && s.passEnc);
};

function transportFor(cfg) {
  if (!cfg.host) throw new HttpError(400, 'SMTP host is not set.');
  if (!cfg.user || !cfg.pass) throw new HttpError(400, 'SMTP username or password is not set.');
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure, // false lets nodemailer upgrade with STARTTLS on 587 automatically
    auth: { user: cfg.user, pass: cfg.pass },
    // Some hosts (e.g. Render's free tier) resolve an SMTP host's AAAA record but have no IPv6 route,
    // which fails instantly with ENETUNREACH instead of falling back to IPv4 — force IPv4 to avoid that.
    family: 4,
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 15000,
  });
}

function friendlyError(e) {
  const m = e && e.message ? e.message : String(e);
  if (/EAUTH|Invalid login|auth/i.test(m)) return 'The mail server rejected the username/password.';
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(m)) return "Could not reach the mail server — check the host and port (Hostinger uses smtp.hostinger.com, port 465 with SSL on, or 587 with SSL off).";
  if (/self signed|certificate/i.test(m)) return 'The mail server certificate could not be verified.';
  return 'Could not send the email (' + m + ').';
}

async function verify(overrideCfg) {
  const cfg = { ...config(overrideCfg && overrideCfg.pass), ...(overrideCfg || {}) };
  try {
    await transportFor(cfg).verify();
  } catch (e) {
    throw new HttpError(400, friendlyError(e));
  }
}

async function send({ to, subject, text, html, replyTo }) {
  const cfg = config();
  const t = transportFor(cfg);
  try {
    await t.sendMail({ from: cfg.from, to, subject, text, html, replyTo });
  } catch (e) {
    throw new HttpError(502, friendlyError(e));
  }
}

async function sendTest(to, overrideCfg) {
  const cfg = { ...config(overrideCfg && overrideCfg.pass), ...(overrideCfg || {}) };
  const t = transportFor(cfg);
  const s = db.data.settings.site;
  try {
    await t.sendMail({ from: cfg.from, to, subject: `Test email from ${s.name} dashboard`, text: `This is a test email from the ${s.name} website dashboard. If you received this, email notifications are working.` });
  } catch (e) {
    throw new HttpError(400, friendlyError(e));
  }
}

module.exports = { send, sendTest, verify, isConfigured, config };
