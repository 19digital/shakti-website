const express = require('express');
const db = require('../lib/store');
const A = require('../lib/auth');
const { CORE } = require('../lib/render');
const { wrap, HttpError, slugify, safeImg, cleanRich, stripTags, clip } = require('../lib/util');

const r = express.Router();
const editor = A.requireRole('admin', 'editor');

const RESERVED = new Set([...CORE, 'admin', 'api', 'blog', 'uploads', 'css', 'js', 'images', 'docs', 'theme', 'site-config', 'sitemap', 'robots', 'rss', 'admin-assets', 'index']);

function uniqueSlug(list, base, selfId) {
  let s = slugify(base) || 'untitled';
  let out = s, n = 2;
  while (list.some((x) => x.slug === out && x.id !== selfId) || (list === db.data.pages && RESERVED.has(out))) out = s + '-' + n++;
  return out;
}

// ---------------- blog posts ----------------
const summary = (p) => ({ id: p.id, title: p.title, slug: p.slug, status: p.status, excerpt: p.excerpt, cover: p.cover, tags: p.tags, aiGenerated: !!p.aiGenerated, updatedAt: p.updatedAt, publishedAt: p.publishedAt });

function readPost(b, existing) {
  const title = clip(String(b.title || '').trim(), 160);
  if (!title) throw new HttpError(400, 'A title is required.');
  const status = b.status === 'published' ? 'published' : 'draft';
  const bodyHtml = cleanRich(clip(b.bodyHtml, 300000));
  if (status === 'published' && !stripTags(bodyHtml).trim()) throw new HttpError(400, 'Write some content before publishing.');
  const tags = Array.isArray(b.tags) ? [...new Set(b.tags.map((t) => clip(String(t).trim(), 30)).filter(Boolean))].slice(0, 8) : [];
  return {
    title,
    excerpt: clip(stripTags(b.excerpt || stripTags(bodyHtml).slice(0, 200)), 300),
    bodyHtml,
    cover: b.cover ? safeImg(b.cover) : '',
    coverAlt: clip(String(b.coverAlt || ''), 200),
    status,
    tags,
    seoTitle: clip(String(b.seoTitle || ''), 120),
    seoDescription: clip(String(b.seoDescription || ''), 300),
    aiGenerated: existing ? !!existing.aiGenerated || !!b.aiGenerated : !!b.aiGenerated,
  };
}

r.get('/posts', editor, (req, res) => res.json(db.data.posts.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map(summary)));
r.get('/posts/:id', editor, (req, res) => {
  const p = db.data.posts.find((x) => x.id === req.params.id);
  if (!p) throw new HttpError(404, 'Post not found.');
  res.json(p);
});

r.post(
  '/posts',
  editor,
  wrap(async (req, res) => {
    const f = readPost(req.body || {});
    const now = new Date().toISOString();
    const p = { id: db.id(), slug: uniqueSlug(db.data.posts, (req.body && req.body.slug) || f.title), ...f, author: req.user.name, createdAt: now, updatedAt: now, publishedAt: f.status === 'published' ? now : null };
    db.data.posts.push(p);
    db.log(req.user, `${f.status === 'published' ? 'Published' : 'Saved draft'}: ${p.title}`);
    db.save();
    res.json(p);
  })
);

r.put(
  '/posts/:id',
  editor,
  wrap(async (req, res) => {
    const p = db.data.posts.find((x) => x.id === req.params.id);
    if (!p) throw new HttpError(404, 'Post not found.');
    const f = readPost(req.body || {}, p);
    const wasPublished = p.status === 'published';
    Object.assign(p, f);
    if (req.body.slug) p.slug = uniqueSlug(db.data.posts, req.body.slug, p.id);
    p.updatedAt = new Date().toISOString();
    if (p.status === 'published' && !p.publishedAt) p.publishedAt = p.updatedAt;
    if (p.status !== 'published' && wasPublished) p.publishedAt = p.publishedAt; // keep original date if re-published
    db.log(req.user, `Updated post: ${p.title}${p.status === 'published' && !wasPublished ? ' (published)' : ''}`);
    db.save();
    res.json(p);
  })
);

r.delete(
  '/posts/:id',
  editor,
  wrap(async (req, res) => {
    const i = db.data.posts.findIndex((x) => x.id === req.params.id);
    if (i < 0) throw new HttpError(404, 'Post not found.');
    const [p] = db.data.posts.splice(i, 1);
    db.log(req.user, 'Deleted post: ' + p.title);
    db.save();
    res.json({ ok: true });
  })
);

// ---------------- custom pages ----------------
const pageSummary = (p) => ({ id: p.id, title: p.title, slug: p.slug, status: p.status, updatedAt: p.updatedAt, inNav: (db.data.settings.nav || []).some((n) => n.url === p.slug + '.html') });

r.get('/pages', editor, (req, res) => res.json(db.data.pages.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map(pageSummary)));
r.get('/pages/:id', editor, (req, res) => {
  const p = db.data.pages.find((x) => x.id === req.params.id);
  if (!p) throw new HttpError(404, 'Page not found.');
  res.json({ ...p, inNav: pageSummary(p).inNav });
});

function readPage(b) {
  const title = clip(String(b.title || '').trim(), 120);
  if (!title) throw new HttpError(400, 'A page title is required.');
  return { title, description: clip(stripTags(b.description || ''), 300), bodyHtml: cleanRich(clip(b.bodyHtml, 300000)), status: b.status === 'published' ? 'published' : 'draft', hero: b.hero !== false };
}

function syncNav(user, p, oldSlug, wantNav) {
  if (user.role !== 'admin') return;
  const nav = db.data.settings.nav;
  const oldUrl = (oldSlug || p.slug) + '.html';
  const i = nav.findIndex((n) => n.url === oldUrl);
  if (wantNav && i < 0) nav.push({ label: clip(p.title, 40), url: p.slug + '.html' });
  else if (wantNav && i >= 0) nav[i].url = p.slug + '.html';
  else if (!wantNav && i >= 0) nav.splice(i, 1);
}

r.post(
  '/pages',
  editor,
  wrap(async (req, res) => {
    const f = readPage(req.body || {});
    const now = new Date().toISOString();
    const p = { id: db.id(), slug: uniqueSlug(db.data.pages, (req.body && req.body.slug) || f.title), ...f, createdAt: now, updatedAt: now };
    db.data.pages.push(p);
    syncNav(req.user, p, null, !!req.body.inNav);
    db.log(req.user, 'Created page: ' + p.title);
    db.save();
    res.json({ ...p, inNav: pageSummary(p).inNav });
  })
);

r.put(
  '/pages/:id',
  editor,
  wrap(async (req, res) => {
    const p = db.data.pages.find((x) => x.id === req.params.id);
    if (!p) throw new HttpError(404, 'Page not found.');
    const oldSlug = p.slug;
    Object.assign(p, readPage(req.body || {}));
    if (req.body.slug) p.slug = uniqueSlug(db.data.pages, req.body.slug, p.id);
    p.updatedAt = new Date().toISOString();
    const wasInNav = (db.data.settings.nav || []).some((n) => n.url === oldSlug + '.html');
    syncNav(req.user, p, oldSlug, req.user.role === 'admin' ? !!req.body.inNav : wasInNav);
    db.log(req.user, 'Updated page: ' + p.title);
    db.save();
    res.json({ ...p, inNav: pageSummary(p).inNav });
  })
);

r.delete(
  '/pages/:id',
  editor,
  wrap(async (req, res) => {
    const i = db.data.pages.findIndex((x) => x.id === req.params.id);
    if (i < 0) throw new HttpError(404, 'Page not found.');
    const [p] = db.data.pages.splice(i, 1);
    db.data.settings.nav = db.data.settings.nav.filter((n) => n.url !== p.slug + '.html'); // never leave a dead menu link
    db.log(req.user, 'Deleted page: ' + p.title);
    db.save();
    res.json({ ok: true });
  })
);

module.exports = r;
