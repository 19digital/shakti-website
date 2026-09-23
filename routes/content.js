const express = require('express');
const db = require('../lib/store');
const A = require('../lib/auth');
const theme = require('../lib/theme');
const gemini = require('../lib/gemini');
const { CORE, DEFAULTS } = require('../lib/render');
const { wrap, HttpError, safeUrl, safeImg, clip } = require('../lib/util');

const r = express.Router();
const editor = A.requireRole('admin', 'editor');
const admin = A.requireRole('admin');

// key -> default item
const ITEM = {};
for (const g of DEFAULTS.globals) ITEM[g.k] = g;
for (const p of CORE) for (const it of DEFAULTS.pages[p].items) ITEM[it.k] = it;
const SECTION_IDS = new Set(CORE.flatMap((p) => DEFAULTS.pages[p].sections.map((s) => s.id)));
const CTRL_RE = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]', 'g'); // strips control chars only, keeps spaces/tabs/newlines
const cleanText = (s) => String(s == null ? '' : s).replace(CTRL_RE, '');

function orderedSections(page) {
  const secs = DEFAULTS.pages[page].sections;
  const want = (db.data.order[page] || []).filter((id) => secs.some((s) => s.id === id));
  const rest = secs.map((s) => s.id).filter((id) => !want.includes(id));
  return [...want, ...rest].map((id) => {
    const s = secs.find((x) => x.id === id);
    return { id, label: s.label, hidden: !!(db.data.sections[id] && db.data.sections[id].hidden) };
  });
}

r.get(
  '/content/:page',
  editor,
  wrap(async (req, res) => {
    const page = req.params.page;
    const c = db.data.content;
    const cur = (it) => (Object.prototype.hasOwnProperty.call(c, it.k) ? c[it.k] : it.v);
    const mapItem = (it) => ({ k: it.k, t: it.t, v: cur(it), d: it.v, sec: it.sec, secLabel: it.secLabel, changed: Object.prototype.hasOwnProperty.call(c, it.k) });
    if (page === 'globals') {
      return res.json({ page, label: 'Site-wide (header, footer, buttons, chat)', items: DEFAULTS.globals.map(mapItem), sections: [] });
    }
    if (!CORE.includes(page)) throw new HttpError(404, 'Unknown page.');
    const d = DEFAULTS.pages[page];
    const seo = db.data.seo[page] || {};
    res.json({
      page,
      seo: { title: seo.title ?? '', description: seo.description ?? '', defaultTitle: d.title, defaultDescription: d.description },
      sections: orderedSections(page),
      items: d.items.map(mapItem),
    });
  })
);

/** batch save from the visual editor and the content list */
r.put(
  '/content',
  editor,
  wrap(async (req, res) => {
    const b = req.body || {};
    let n = 0;
    for (const [k, raw] of Object.entries(b.content || {})) {
      const it = ITEM[k];
      if (!it) throw new HttpError(400, 'Unknown content key: ' + clip(k, 40));
      let v;
      if (it.t === 'text') v = clip(cleanText(raw), 3000);
      else if (it.t === 'alt') v = clip(cleanText(raw), 300);
      else if (it.t === 'img') {
        v = safeImg(raw);
        if (!v) throw new HttpError(400, 'That image address is not allowed.');
      } else if (it.t === 'link') {
        v = safeUrl(raw);
        if (!v) throw new HttpError(400, 'That link is not allowed. Use https://, mailto:, tel: or a page address.');
      }
      if (v === it.v) delete db.data.content[k];
      else db.data.content[k] = v;
      n++;
    }
    for (const [id, s] of Object.entries(b.sections || {})) {
      if (!SECTION_IDS.has(id)) throw new HttpError(400, 'Unknown section.');
      if (s && s.hidden) db.data.sections[id] = { hidden: true };
      else delete db.data.sections[id];
      n++;
    }
    for (const [page, ids] of Object.entries(b.order || {})) {
      if (!CORE.includes(page) || !Array.isArray(ids)) throw new HttpError(400, 'Bad section order.');
      const valid = DEFAULTS.pages[page].sections.map((s) => s.id);
      const cleaned = ids.filter((id, i) => valid.includes(id) && ids.indexOf(id) === i);
      if (cleaned.join() === valid.join()) delete db.data.order[page];
      else db.data.order[page] = cleaned;
      n++;
    }
    for (const [page, s] of Object.entries(b.seo || {})) {
      if (!CORE.includes(page)) throw new HttpError(400, 'Unknown page.');
      const title = clip(cleanText(s.title), 120).trim();
      const description = clip(cleanText(s.description), 300).trim();
      if (!title && !description) delete db.data.seo[page];
      else db.data.seo[page] = { title, description };
      n++;
    }
    if (n) {
      db.log(req.user, `Edited website content (${n} change${n > 1 ? 's' : ''})`);
      db.save();
    }
    res.json({ ok: true, changes: n });
  })
);

r.delete(
  '/content/:key',
  editor,
  wrap(async (req, res) => {
    if (!ITEM[req.params.key]) throw new HttpError(404, 'Unknown key.');
    delete db.data.content[req.params.key];
    db.save();
    res.json({ ok: true });
  })
);

// ---------- settings (admin) ----------
r.get('/theme/meta', editor, (req, res) => res.json({ presets: Object.fromEntries(Object.entries(theme.PRESETS).map(([k, p]) => [k, { label: p.label, vars: p.vars, dark: p.dark }])), fonts: theme.FONTS, labels: theme.VAR_LABELS }));

r.get('/settings', admin, (req, res) => {
  const { theme: t, site, nav } = db.data.settings;
  res.json({ theme: t, site, nav });
});

r.put(
  '/settings/theme',
  admin,
  wrap(async (req, res) => {
    const b = req.body || {};
    const t = db.data.settings.theme;
    if (!theme.PRESETS[b.preset]) throw new HttpError(400, 'Unknown theme preset.');
    const vars = {};
    for (const k of theme.VAR_KEYS) {
      if (b.vars && b.vars[k] !== undefined && b.vars[k] !== '') {
        const h = theme.hex(b.vars[k]);
        if (!h) throw new HttpError(400, `${theme.VAR_LABELS[k]}: use a colour like #E8672B.`);
        vars[k] = h;
      }
    }
    if (!theme.FONTS.includes(b.fontHeading) || !theme.FONTS.includes(b.fontBody)) throw new HttpError(400, 'Pick fonts from the list.');
    const rc = Math.round(+b.radiusCard), rb = Math.round(+b.radiusButton);
    if (!(rc >= 0 && rc <= 40 && rb >= 0 && rb <= 40)) throw new HttpError(400, 'Corner radius must be between 0 and 40.');
    // warn (not block) on unreadable combos
    const merged = { ...theme.PRESETS[b.preset].vars, ...vars };
    const warnings = [];
    if (theme.ratio(merged['--text'], merged['--bg']) < 4.5) warnings.push('Main text on the page background has low contrast (below 4.5:1).');
    if (theme.ratio(merged['--text-dim'], merged['--bg']) < 3) warnings.push('Secondary text is hard to read on the page background.');
    Object.assign(t, { preset: b.preset, vars, fontHeading: b.fontHeading, fontBody: b.fontBody, radiusCard: rc, radiusButton: rb });
    db.log(req.user, 'Changed the site theme');
    db.save();
    res.json({ ok: true, warnings });
  })
);

r.put(
  '/settings/site',
  admin,
  wrap(async (req, res) => {
    const b = req.body || {};
    const s = db.data.settings.site;
    const str = (k, n) => (b[k] !== undefined ? clip(String(b[k]).trim(), n) : s[k]);
    const url = (k) => {
      if (b[k] === undefined) return s[k];
      const v = String(b[k]).trim();
      if (!v) return '';
      if (!/^https?:\/\//i.test(v)) throw new HttpError(400, `${k}: must start with https://`);
      return clip(v, 500);
    };
    const phone = str('phone', 40);
    if (phone && digits(phone).length < 8) throw new HttpError(400, 'Enter a valid phone number.');
    const wa = b.whatsapp !== undefined ? String(b.whatsapp).replace(/\D/g, '') : s.whatsapp;
    if (wa && (wa.length < 8 || wa.length > 15)) throw new HttpError(400, 'WhatsApp number: digits only with country code, e.g. 919876543210.');
    const email = str('email', 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    Object.assign(s, {
      name: str('name', 120) || s.name,
      url: url('url').replace(/\/$/, ''),
      phone,
      whatsapp: wa,
      email,
      address: str('address', 300),
      facebook: url('facebook'),
      instagram: url('instagram'),
      ogImage: b.ogImage !== undefined ? safeImg(b.ogImage) : s.ogImage,
      favicon: b.favicon !== undefined ? safeImg(b.favicon) : s.favicon,
    });
    db.log(req.user, 'Updated site settings');
    db.save();
    res.json({ ok: true });
  })
);
const digits = (s) => String(s || '').replace(/\D/g, '');

r.put(
  '/settings/nav',
  admin,
  wrap(async (req, res) => {
    const list = req.body && req.body.nav;
    if (!Array.isArray(list) || list.length > 12) throw new HttpError(400, 'The menu can have up to 12 items.');
    const clean = list.map((n) => {
      const label = clip(String((n && n.label) || '').trim(), 40);
      const url = safeUrl(n && n.url);
      if (!label || !url) throw new HttpError(400, 'Every menu item needs a label and a valid link.');
      return { label, url };
    });
    db.data.settings.nav = clean;
    db.log(req.user, 'Updated the navigation menu');
    db.save();
    res.json({ ok: true });
  })
);

// ---------- dashboard ----------
r.get('/dashboard', editor, (req, res) => {
  const day = new Date().toISOString().slice(0, 10);
  const st = db.data.stats[day] || {};
  const ai = db.data.settings.ai;
  res.json({
    counts: {
      posts: db.data.posts.length,
      published: db.data.posts.filter((p) => p.status === 'published').length,
      drafts: db.data.posts.filter((p) => p.status !== 'published').length,
      pages: db.data.pages.length,
      media: db.data.media.length,
      edits: Object.keys(db.data.content).length,
      users: db.data.users.length,
    },
    ai: { hasKey: gemini.hasKey(), model: ai.model, chatEnabled: ai.chatEnabled, chatToday: st.chat || 0, blogToday: st.blog || 0, dailyLimit: ai.dailyLimit },
    activity: db.data.activity.slice(0, 12),
  });
});

r.get('/backup', admin, (req, res) => {
  const d = JSON.parse(JSON.stringify(db.data));
  d.sessions = {};
  d.settings.ai.keyEnc = ''; // the encrypted key is useless without this server's master key; never export it
  res.setHeader('Content-Disposition', `attachment; filename="site-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(d);
});

module.exports = r;
