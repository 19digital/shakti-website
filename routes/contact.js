const express = require('express');
const db = require('../lib/store');
const A = require('../lib/auth');
const mailer = require('../lib/mailer');
const { encrypt } = require('../lib/crypto');
const { wrap, HttpError, escapeHtml: esc, clip } = require('../lib/util');

const r = express.Router();
const editor = A.requireRole('admin', 'editor');
const admin = A.requireRole('admin');
// strips control characters only (keeps tab/newline/CR and all normal spaces/punctuation)
const CTRL_RE = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]', 'g');
const ctrl = (s) => String(s == null ? '' : s).replace(CTRL_RE, '');
const digits = (s) => String(s || '').replace(/\D/g, '');

// ---------------- public: receive the contact form ----------------
r.post(
  '/contact',
  wrap(async (req, res) => {
    const b = req.body || {};

    // Honeypot: a field real visitors never see or fill. A bot that fills every field trips it.
    // We answer 200 either way so a bot can't tell it was dropped.
    const honeypot = String(b.company || b.website || '').trim();
    // Anti-speed-bot: the form stamps `ts` (ms epoch) when it loads; a real human takes >1.5s to fill it in.
    const ts = +b.ts || 0;
    const tooFast = ts && Date.now() - ts < 1500 && Date.now() - ts > -60000;
    if (honeypot || tooFast) return res.json({ ok: true });

    if (!A.hit('contact-ip:' + req.ip, 6, 10 * 60 * 1000) || !A.hit('contact-ip-day:' + req.ip, 20, 24 * 3600 * 1000)) {
      throw new HttpError(429, "You've sent several messages recently. Please wait a bit, or call/WhatsApp us directly.");
    }

    const name = clip(ctrl(b.name).trim(), 120);
    const phone = clip(ctrl(b.phone).trim(), 40);
    const email = clip(ctrl(b.email).trim(), 200);
    const message = clip(ctrl(b.message).trim(), 2000);
    if (!name) throw new HttpError(400, 'Please enter your name.');
    const d = digits(phone);
    if (d.length < 10 || d.length > 13) throw new HttpError(400, 'Please enter a valid phone number.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Please enter a valid email address.');

    const sub = { id: db.id(), name, phone, email, message, source: clip(ctrl(b.source).trim(), 60) || 'contact page', read: false, at: new Date().toISOString() };
    db.data.submissions.unshift(sub);
    if (db.data.submissions.length > 1000) db.data.submissions.length = 1000;

    const n = db.data.settings.notifications;
    let emailed = false, emailError = null;
    if (n.emailOnSubmit && mailer.isConfigured()) {
      const to = n.notifyTo || db.data.settings.site.email;
      if (to) {
        const s = db.data.settings.site;
        try {
          await mailer.send({
            to,
            replyTo: email || undefined,
            subject: `New enquiry from ${name} — ${s.name} website`,
            text: `New contact-form enquiry from the ${s.name} website\n\nName: ${name}\nPhone: ${phone}\nEmail: ${email || '(not given)'}\n\nMessage:\n${message || '(none)'}\n\nSubmitted: ${new Date(sub.at).toLocaleString('en-IN')}\nView all enquiries in the dashboard: Dashboard → Enquiries.`,
            html: `<p>New contact-form enquiry from the <strong>${esc(s.name)}</strong> website.</p><table cellpadding="6" style="border-collapse:collapse"><tr><td><strong>Name</strong></td><td>${esc(name)}</td></tr><tr><td><strong>Phone</strong></td><td><a href="tel:${esc(phone)}">${esc(phone)}</a></td></tr><tr><td><strong>Email</strong></td><td>${email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : '(not given)'}</td></tr><tr><td valign="top"><strong>Message</strong></td><td>${esc(message || '(none)').replace(/\n/g, '<br>')}</td></tr></table>`,
          });
          emailed = true;
        } catch (e) {
          emailError = e.message;
          console.error('[contact] email notification failed:', e.message);
        }
      }
    }
    sub.emailed = emailed;
    if (emailError) db.log(null, `Contact-form email notification failed: ${emailError}`);
    db.save();
    res.json({ ok: true, emailed });
  })
);

// ---------------- dashboard: enquiries list ----------------
const summary = (s) => s;
r.get('/submissions', editor, (req, res) => {
  const page = Math.max(1, +req.query.page || 1);
  const size = Math.min(100, Math.max(1, +req.query.size || 25));
  const all = db.data.submissions;
  res.json({ total: all.length, unread: all.filter((s) => !s.read).length, page, size, items: all.slice((page - 1) * size, page * size).map(summary) });
});

r.patch(
  '/submissions/:id',
  editor,
  wrap(async (req, res) => {
    const s = db.data.submissions.find((x) => x.id === req.params.id);
    if (!s) throw new HttpError(404, 'Not found.');
    if (req.body && req.body.read !== undefined) s.read = !!req.body.read;
    db.save();
    res.json(s);
  })
);

r.delete(
  '/submissions/:id',
  editor,
  wrap(async (req, res) => {
    const i = db.data.submissions.findIndex((x) => x.id === req.params.id);
    if (i < 0) throw new HttpError(404, 'Not found.');
    db.data.submissions.splice(i, 1);
    db.save();
    res.json({ ok: true });
  })
);

r.get('/submissions.csv', editor, (req, res) => {
  const esc2 = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['Date', 'Name', 'Phone', 'Email', 'Message', 'Emailed'].map(esc2).join(',')];
  for (const s of db.data.submissions) rows.push([s.at, s.name, s.phone, s.email, s.message, s.emailed ? 'yes' : 'no'].map(esc2).join(','));
  res.set('Content-Disposition', `attachment; filename="enquiries-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.type('text/csv').send(rows.join('\r\n'));
});

// ---------------- admin: SMTP + notification settings ----------------
r.get('/settings/smtp', admin, (req, res) => {
  const s = db.data.settings.smtp;
  const n = db.data.settings.notifications;
  res.json({ host: s.host, port: s.port, secure: s.secure, user: s.user, from: s.from, hasPassword: !!s.passEnc, passHint: s.passHint, emailOnSubmit: n.emailOnSubmit, notifyTo: n.notifyTo, configured: mailer.isConfigured() });
});

r.put(
  '/settings/smtp',
  admin,
  wrap(async (req, res) => {
    const b = req.body || {};
    const s = db.data.settings.smtp;
    const n = db.data.settings.notifications;
    if (b.clearPassword) {
      s.passEnc = '';
      s.passHint = '';
    } else if (typeof b.password === 'string' && b.password) {
      s.passEnc = encrypt(b.password);
      s.passHint = '•'.repeat(Math.min(10, b.password.length));
    }
    if (b.host !== undefined) s.host = clip(String(b.host).trim(), 200);
    if (b.port !== undefined) {
      const p = Math.round(+b.port);
      if (!(p > 0 && p < 65536)) throw new HttpError(400, 'Invalid port.');
      s.port = p;
    }
    if (b.secure !== undefined) s.secure = !!b.secure;
    if (b.user !== undefined) s.user = clip(String(b.user).trim(), 200);
    if (b.from !== undefined) {
      const f = clip(String(b.from).trim(), 200);
      if (f && !/^[^<>]*<?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/.test(f)) throw new HttpError(400, 'From address looks invalid, e.g. "Shakti Engineering Works <notify@shaktiew.in>".');
      s.from = f;
    }
    if (b.emailOnSubmit !== undefined) n.emailOnSubmit = !!b.emailOnSubmit;
    if (b.notifyTo !== undefined) {
      const to = clip(String(b.notifyTo).trim(), 200);
      if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new HttpError(400, 'Enter a valid notification email address.');
      n.notifyTo = to;
    }
    db.log(req.user, 'Updated email notification settings');
    db.save();
    res.json({ ok: true });
  })
);

r.post(
  '/settings/smtp/test',
  admin,
  wrap(async (req, res) => {
    if (!A.hit('smtp-test:' + req.user.id, 8, 10 * 60 * 1000)) throw new HttpError(429, 'Please wait a few minutes before testing again.');
    const b = req.body || {};
    const override = {};
    if (b.host) override.host = clip(String(b.host).trim(), 200);
    if (b.port) override.port = Math.round(+b.port);
    if (b.secure !== undefined) override.secure = !!b.secure;
    if (b.user) override.user = clip(String(b.user).trim(), 200);
    if (b.password) override.pass = b.password;
    if (b.from) override.from = clip(String(b.from).trim(), 200);
    const to = clip(String(b.to || db.data.settings.notifications.notifyTo || db.data.settings.site.email || '').trim(), 200);
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new HttpError(400, 'Enter a valid "send test to" address.');
    await mailer.sendTest(to, override);
    res.json({ ok: true, sentTo: to });
  })
);

module.exports = r;
