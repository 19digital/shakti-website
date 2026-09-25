/**
 * SMTP mailer for admin notifications (e.g. "someone filled in the contact form").
 * Works with any SMTP provider — including Hostinger's own hosting email (smtp.hostinger.com,
 * port 465/SSL or 587/STARTTLS) once the admin creates a mailbox in hPanel and enters it in
 * Dashboard → Settings → Email Notifications. The password is encrypted at rest the same way
 * as the Gemini key and is never sent back to the browser.
 */
const nodemailer = require('nodemailer');
const dns = require('dns').promises;
const net = require('net');
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

/**
 * Some hosts (e.g. Render's free tier) resolve an SMTP hostname's AAAA record but have no working
 * IPv6 route out — depending on the moment, that fails instantly with ENETUNREACH or hangs until a
 * timeout. Passing `family: 4` to nodemailer/Node is not reliably enough to prevent this (Node's
 * Happy-Eyeballs dual-stack logic can still race the AAAA record). The robust fix is to resolve the
 * IPv4 address ourselves and connect to that literal IP — leaving nothing for DNS to get wrong —
 * while setting TLS's `servername` to the real hostname so certificate validation still checks it
 * against the name Hostinger's certificate actually covers.
 */
async function resolveIPv4(host) {
  if (net.isIP(host)) return host; // already an IP — nothing to resolve
  const addrs = await dns.resolve4(host).catch(() => null);
  if (!addrs || !addrs.length) throw new HttpError(400, `Could not find an IPv4 address for "${host}". Double-check the SMTP host.`);
  return addrs[0];
}

async function transportFor(cfg) {
  if (!cfg.host) throw new HttpError(400, 'SMTP host is not set.');
  if (!cfg.user || !cfg.pass) throw new HttpError(400, 'SMTP username or password is not set.');
  const ip = await resolveIPv4(cfg.host);
  return nodemailer.createTransport({
    host: ip,
    port: cfg.port,
    secure: cfg.secure, // false lets nodemailer upgrade with STARTTLS on 587 automatically
    auth: { user: cfg.user, pass: cfg.pass },
    tls: { servername: cfg.host }, // validate the cert against the real hostname, not the IP
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
    await (await transportFor(cfg)).verify();
  } catch (e) {
    throw e instanceof HttpError ? e : new HttpError(400, friendlyError(e));
  }
}

async function send({ to, subject, text, html, replyTo }) {
  const cfg = config();
  try {
    const t = await transportFor(cfg);
    await t.sendMail({ from: cfg.from, to, subject, text, html, replyTo });
  } catch (e) {
    throw e instanceof HttpError ? e : new HttpError(502, friendlyError(e));
  }
}

async function sendTest(to, overrideCfg) {
  const cfg = { ...config(overrideCfg && overrideCfg.pass), ...(overrideCfg || {}) };
  const s = db.data.settings.site;
  try {
    const t = await transportFor(cfg);
    await t.sendMail({ from: cfg.from, to, subject: `Test email from ${s.name} dashboard`, text: `This is a test email from the ${s.name} website dashboard. If you received this, email notifications are working.` });
  } catch (e) {
    throw e instanceof HttpError ? e : new HttpError(400, friendlyError(e));
  }
}

module.exports = { send, sendTest, verify, isConfigured, config };
