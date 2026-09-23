const express = require('express');
const db = require('../lib/store');
const theme = require('../lib/theme');
const R = require('../lib/render');
const { escapeHtml: esc, safeImg, stripTags } = require('../lib/util');

const r = express.Router();
const origin = (req) => req.protocol + '://' + req.get('host');
const isEditor = (req) => req.user && ['admin', 'editor'].includes(req.user.role);

r.get('/theme.css', (req, res) => {
  res.type('text/css').set('Cache-Control', 'no-cache').send(theme.css());
});

r.get('/site-config.js', (req, res) => {
  const s = db.data.settings.site;
  const a = db.data.settings.ai;
  const cfg = {
    phone: s.phone,
    phoneRaw: String(s.whatsapp || '').replace(/\D/g, ''),
    email: s.email,
    address: s.address,
    ai: { chat: !!a.chatEnabled && !!require('../lib/gemini').hasKey(), name: a.chatName, greeting: a.greeting },
  };
  res.type('application/javascript').set('Cache-Control', 'no-cache').send('window.SITE_CONFIG=' + JSON.stringify(cfg).replace(/</g, '\\u003c') + ';');
});

r.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${R.siteUrl(origin(req))}/sitemap.xml\n`);
});

r.get('/sitemap.xml', (req, res) => {
  const base = R.siteUrl(origin(req));
  const urls = [
    ...R.CORE.map((p) => ({ loc: `${base}/${p}.html` })),
    ...db.data.pages.filter((p) => p.status === 'published').map((p) => ({ loc: `${base}/${p.slug}.html`, lastmod: p.updatedAt })),
    ...db.data.posts.filter((p) => p.status === 'published').map((p) => ({ loc: `${base}/blog/${p.slug}`, lastmod: p.updatedAt })),
  ];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod.slice(0, 10)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`);
});

r.get('/rss.xml', (req, res) => {
  const base = R.siteUrl(origin(req));
  const s = db.data.settings.site;
  const posts = db.data.posts.filter((p) => p.status === 'published').sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 30);
  res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(s.name)} — Blog</title><link>${esc(base)}/blog.html</link><description>${esc(s.name)} articles</description>\n${posts.map((p) => `<item><title>${esc(p.title)}</title><link>${esc(base)}/blog/${esc(p.slug)}</link><guid>${esc(base)}/blog/${esc(p.slug)}</guid><pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate><description>${esc(p.excerpt)}</description></item>`).join('\n')}\n</channel></rss>`);
});

// ---------- HTML pages ----------
function articleHtml(p) {
  const cover = safeImg(p.cover);
  const author = p.author ? ` &middot; by ${esc(p.author)}` : '';
  return `
  <div class="grid-lines section-pad" style="padding-top:56px;padding-bottom:36px;">
    <div style="max-width:820px;margin:0 auto;">
      <a class="chip" href="blog.html" data-internal>&larr; All articles</a>
      <h1 style="font-size:clamp(30px,4.6vw,44px);line-height:1.12;font-weight:700;margin:22px 0 16px;">${esc(p.title)}</h1>
      <div style="font-size:14px;color:var(--text-dim);font-weight:600;">${esc(R.fmtDate(p.publishedAt || p.updatedAt))} &middot; ${R.readMinutes(p.bodyHtml)} min read${author}</div>
    </div>
  </div>
  <div class="section-pad" style="padding-top:8px;">
    <article class="prose" style="max-width:820px;margin:0 auto;">
      ${cover ? `<img class="prose-cover" src="${esc(cover)}" alt="${esc(p.coverAlt || p.title)}">` : ''}
      ${p.bodyHtml}
    </article>
    ${ctaHtml()}
  </div>`;
}
function ctaHtml() {
  const s = db.data.settings.site;
  const wa = String(s.whatsapp || '').replace(/\D/g, '');
  return `<div style="max-width:820px;margin:48px auto 0;border:1px solid var(--border-strong);border-radius:20px;padding:32px;text-align:center;background:var(--surface);">
      <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:22px;margin-bottom:8px;">Need help sizing your line?</div>
      <p style="color:var(--text-dim);margin-bottom:20px;">Tell us your capacity and site details and our engineers will recommend the right machines.</p>
      <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap;">${wa ? `<a class="btn-primary" href="https://wa.me/${wa}" target="_blank" rel="noopener">Chat on WhatsApp</a>` : ''}<a class="btn-ghost" href="contact.html" data-internal>Contact us</a></div>
    </div>`;
}
function customPageHtml(p) {
  return `
  ${p.hero !== false ? `<div class="grid-lines section-pad" style="padding-top:56px;padding-bottom:36px;"><div style="max-width:900px;margin:0 auto;"><h1 style="font-size:clamp(30px,4.6vw,46px);line-height:1.1;font-weight:700;margin-bottom:${p.description ? 16 : 0}px;">${esc(p.title)}</h1>${p.description ? `<p style="font-size:17px;line-height:1.7;color:var(--text-dim);">${esc(p.description)}</p>` : ''}</div></div>` : ''}
  <div class="section-pad" style="padding-top:${p.hero !== false ? 8 : 56}px;"><article class="prose" style="max-width:900px;margin:0 auto;">${p.bodyHtml}</article></div>`;
}

function notFound(req, res) {
  const html = R.renderShell({
    origin: origin(req),
    title: 'Page not found | ' + db.data.settings.site.name,
    description: '',
    noindex: true,
    path: req.path.replace(/^\//, ''),
    bodyHtml: `<div class="section-pad" style="text-align:center;padding-top:120px;padding-bottom:120px;"><div class="eyebrow" style="margin-bottom:12px;">Error 404</div><h1 style="font-size:40px;margin-bottom:14px;">We couldn't find that page</h1><p style="color:var(--text-dim);margin-bottom:28px;">It may have moved or no longer exists.</p><a class="btn-primary" href="index.html" data-internal>Back to home</a></div>`,
  });
  res.status(404).send(html);
}

function servePage(req, res, next) {
  const file = req.params.file || 'index.html';
  if (!file.endsWith('.html')) return next();
  const name = file.slice(0, -5);
  const edit = req.query['cms-edit'] === '1' && isEditor(req);
  if (R.CORE.includes(name)) {
    if (edit) res.set('Cache-Control', 'no-store');
    return res.send(R.renderCore(name, { origin: origin(req), edit }));
  }
  const page = db.data.pages.find((p) => p.slug === name);
  if (!page || (page.status !== 'published' && !isEditor(req))) return notFound(req, res);
  res.send(
    R.renderShell({
      origin: origin(req),
      title: page.title + ' | ' + db.data.settings.site.name,
      description: page.description,
      path: page.slug + '.html',
      activeUrl: page.slug + '.html',
      noindex: page.status !== 'published',
      bodyHtml: customPageHtml(page),
    })
  );
}
r.get('/', (req, res, next) => {
  req.params.file = 'index.html';
  servePage(req, res, next);
});
r.get('/:file', servePage);

r.get('/blog/:slug', (req, res) => {
  const p = db.data.posts.find((x) => x.slug === req.params.slug);
  if (!p || (p.status !== 'published' && !isEditor(req))) return notFound(req, res);
  const base = R.siteUrl(origin(req));
  const cover = safeImg(p.cover);
  res.send(
    R.renderShell({
      origin: origin(req),
      title: (p.seoTitle || p.title) + ' | ' + db.data.settings.site.name,
      description: p.seoDescription || p.excerpt,
      path: 'blog/' + p.slug,
      activeUrl: 'blog.html',
      image: cover,
      noindex: p.status !== 'published',
      ldExtra: {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: p.title,
        description: p.excerpt,
        datePublished: p.publishedAt || undefined,
        dateModified: p.updatedAt,
        image: cover ? (/^https?:/.test(cover) ? cover : base + '/' + cover) : undefined,
        author: { '@type': 'Person', name: p.author || db.data.settings.site.name },
        publisher: { '@type': 'Organization', name: db.data.settings.site.name },
      },
      bodyHtml: articleHtml(p),
    })
  );
});

r.notFound = notFound;
module.exports = r;
