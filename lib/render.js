/**
 * Applies everything the admin changed (text, images, links, section visibility/order, nav, SEO, theme, contact info)
 * on top of the annotated templates, and returns the final HTML.
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const db = require('./store');
const theme = require('./theme');
const { safeUrl, safeImg, escapeHtml: esc, stripTags } = require('./util');

const TPL_DIR = path.join(__dirname, '..', 'templates');
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(TPL_DIR, 'defaults.json'), 'utf8'));
const CORE = ['index', 'about', 'process', 'products', 'blog', 'contact'];

const raw = {};
function template(name) {
  if (!raw[name]) raw[name] = fs.readFileSync(path.join(TPL_DIR, name + '.html'), 'utf8');
  return raw[name];
}

const ORIG = { phone: '+91 90999 11179', tel: '+919099911179', wa: '919099911179', email: 'info@shaktiew.in', address: 'Bardhaman, West Bengal, India' };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const digits = (s) => String(s || '').replace(/\D/g, '');

function siteUrl(origin) {
  return (db.data.settings.site.url || origin || '').replace(/\/$/, '');
}

function applyContent($, edit) {
  const c = db.data.content;
  $('cms-t[k]').each((_, el) => {
    const k = el.attribs.k;
    if (has(c, k)) $(el).text(c[k]);
  });
  $('img[data-i]').each((_, el) => {
    const k = el.attribs['data-i'];
    if (has(c, k)) {
      const s = safeImg(c[k]);
      if (s) $(el).attr('src', s);
    }
    const ka = el.attribs['data-a'];
    if (ka && has(c, ka)) $(el).attr('alt', String(c[ka]).slice(0, 300));
  });
  $('a[data-l]').each((_, el) => {
    const k = el.attribs['data-l'];
    if (has(c, k)) {
      const u = safeUrl(c[k]);
      if (u) $(el).attr('href', u);
    }
  });
  if (!edit) {
    $('cms-t').each((_, el) => {
      $(el).replaceWith($(el).contents());
    });
    $('[data-i]').removeAttr('data-i').removeAttr('data-a');
    $('[data-l]').removeAttr('data-l');
  }
}

function applySections($, page, edit) {
  const secs = db.data.sections;
  const root = $('#page-root');
  const footer = $('[data-block="footer"]').first();
  const els = {};
  $('[data-s]').each((_, el) => {
    els[el.attribs['data-s']] = $(el);
  });
  const want = (db.data.order[page] || []).filter((id) => els[id]);
  const rest = Object.keys(els).filter((id) => !want.includes(id));
  const finalOrder = [...want, ...rest];
  if (want.length && footer.length) finalOrder.forEach((id) => footer.before(els[id]));
  for (const id of Object.keys(els)) {
    if (secs[id] && secs[id].hidden) {
      if (edit) els[id].attr('data-hidden', '1');
      else els[id].remove();
    }
  }
}

function navHtml(activeUrl) {
  const items = (db.data.settings.nav || []).filter((n) => n && n.label && safeUrl(n.url));
  const same = (u) => {
    u = safeUrl(u).replace(/^\//, '');
    if (u === '' || u === '/') u = 'index.html';
    return u === activeUrl;
  };
  return {
    desktop: items.map((n) => `<a class="navlink${same(n.url) ? ' active' : ''}" href="${esc(safeUrl(n.url))}" data-internal>${esc(n.label)}</a>`).join('\n      '),
    mobile: items.map((n) => `<a class="mnav-link${same(n.url) ? ' active' : ''}" href="${esc(safeUrl(n.url))}" data-internal>${esc(n.label)}</a>`).join('\n      '),
  };
}

function applyNav($, activeUrl) {
  const h = navHtml(activeUrl);
  $('[data-nav="desktop"]').html(h.desktop);
  $('#mnav-panel').html(h.mobile);
}

function applySocial($) {
  const s = db.data.settings.site;
  $('a.social-btn').each((_, el) => {
    const label = (el.attribs['aria-label'] || '').toLowerCase();
    const url = safeUrl(s[label] || '');
    if (url) $(el).attr('href', url).attr('target', '_blank').attr('rel', 'noopener');
    else $(el).remove();
  });
  $('a.social-btn').removeAttr('data-l');
  // if the whole social row is now empty, drop it
  $('[data-block="footer"] div[style*="margin-top:20px"]').each((_, el) => {
    if (!$(el).children().length) $(el).remove();
  });
}

function applyHead($, o) {
  const s = db.data.settings.site;
  const base = siteUrl(o.origin);
  const pageSeo = db.data.seo[o.page] || {};
  const def = DEFAULTS.pages[o.page];
  const title = o.title || pageSeo.title || (def && def.title) || s.name;
  const desc = o.description != null ? o.description : pageSeo.description || (def && def.description) || '';
  const canonical = base + '/' + (o.path || o.page + '.html').replace(/^\//, '');
  const og = safeImg(o.image || s.ogImage || '');
  const ogAbs = og ? (/^https?:/.test(og) ? og : base + '/' + og.replace(/^\//, '')) : '';

  $('head').prepend('<base href="/">');
  $('title').text(title);
  $('meta[name="description"]').attr('content', desc);
  $('link[rel="canonical"]').attr('href', canonical);
  $('meta[property="og:title"]').attr('content', title);
  $('meta[property="og:description"]').attr('content', desc);
  $('meta[property="og:url"]').attr('content', canonical);
  $('meta[property="og:site_name"]').attr('content', s.name);
  const extra = [];
  if (ogAbs) extra.push(`<meta property="og:image" content="${esc(ogAbs)}">`, `<meta name="twitter:image" content="${esc(ogAbs)}">`);
  if (o.noindex) $('meta[name="robots"]').attr('content', 'noindex, nofollow');
  const fav = safeImg(s.favicon) || 'images/logo-shakti.png';
  extra.push(`<link rel="icon" href="${esc(fav)}">`);
  extra.push(`<meta name="theme-color" content="${esc(theme.resolved().vars['--accent'])}">`);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: s.name,
    url: base || undefined,
    logo: base ? base + '/images/logo-shakti.png' : undefined,
    telephone: s.phone,
    email: s.email,
    address: { '@type': 'PostalAddress', streetAddress: s.address },
  };
  extra.push(`<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`);
  $('link[href*="fonts.googleapis.com"]').attr('href', theme.fontsUrl());
  $('link[href="css/style.css"]').after(`<link rel="stylesheet" href="theme.css?v=${db.data.version}">`);
  $('head').append(extra.join('\n'));
  if (o.ldExtra) $('head').append(`<script type="application/ld+json">${JSON.stringify(o.ldExtra).replace(/</g, '\\u003c')}</script>`);
  // site config before main.js
  $('script[src="js/main.js"]').before(`<script src="site-config.js?v=${db.data.version}"></script>`);
}

function replaceContact(html) {
  const s = db.data.settings.site;
  const tel = (String(s.phone).trim().startsWith('+') ? '+' : '') + digits(s.phone);
  if (tel && tel !== ORIG.tel) html = html.split('tel:' + ORIG.tel).join('tel:' + tel);
  const wa = digits(s.whatsapp);
  if (wa && wa !== ORIG.wa) html = html.split('wa.me/' + ORIG.wa).join('wa.me/' + wa);
  if (s.phone && s.phone !== ORIG.phone) html = html.split(ORIG.phone).join(esc(s.phone));
  if (s.email && s.email !== ORIG.email) html = html.split(ORIG.email).join(esc(s.email));
  if (s.address && s.address !== ORIG.address) html = html.split(ORIG.address).join(esc(s.address));
  return html;
}

const readMinutes = (html) => Math.max(1, Math.round(stripTags(html).split(/\s+/).length / 200));
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });

function blogCards() {
  const posts = db.data.posts.filter((p) => p.status === 'published').sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 60);
  if (!posts.length) return '<p style="grid-column:1/-1;text-align:center;color:var(--text-dim);padding:40px 0;">No articles have been published yet — check back soon.</p>';
  return posts
    .map(
      (p) => `
      <a href="blog/${esc(p.slug)}" data-internal class="card reveal tilt-card" style="overflow:hidden;padding:0;display:block;">
        <div style="height:200px;overflow:hidden;"><img src="${esc(safeImg(p.cover) || 'images/machine-05.jpg')}" alt="${esc(p.coverAlt || p.title)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;"></div>
        <div style="padding:26px;">
          <div style="font-size:12px;color:var(--text-dimmer);margin-bottom:10px;font-weight:600;">${esc(fmtDate(p.publishedAt))} &middot; ${readMinutes(p.bodyHtml)} min read</div>
          <h3 style="font-size:19px;font-weight:700;margin-bottom:12px;line-height:1.3;">${esc(p.title)}</h3>
          <p style="font-size:14.5px;color:var(--text-dim);line-height:1.7;margin-bottom:14px;">${esc(p.excerpt)}</p>
          <span style="font-size:13.5px;font-weight:700;color:var(--accent);">Read article &rarr;</span>
        </div>
      </a>`
    )
    .join('');
}

const cache = new Map();
let cacheVersion = -1;

/**
 * @param {string} name  core page name (index, about, ...)
 * @param {{origin?:string, edit?:boolean}} o
 */
function renderCore(name, o = {}) {
  if (!CORE.includes(name)) return null;
  const key = name + '|' + (o.origin || '');
  if (!o.edit) {
    if (cacheVersion !== db.data.version) {
      cache.clear();
      cacheVersion = db.data.version;
    }
    if (cache.has(key)) return cache.get(key);
  }
  const $ = cheerio.load(template(name));
  applyContent($, o.edit);
  applySections($, name, o.edit);
  applyNav($, name + '.html');
  applySocial($);
  if (name === 'blog') $('[data-blog-grid]').html(blogCards()).removeAttr('data-blog-grid');
  applyHead($, { page: name, origin: o.origin });
  if (o.edit) {
    $('body').attr('data-cms-edit', '1').attr('data-cms-page', name);
    $('body').append('<script src="admin-assets/editor.js"></script>');
  }
  let html = theme.tintHtml(replaceContact($.html()));
  if (!o.edit) cache.set(key, html);
  return html;
}

/** wrap arbitrary content (blog article / custom page) in the site chrome */
function renderShell(o) {
  const $ = cheerio.load(template('blog'));
  applyContent($, false);
  $('[data-s]').remove();
  applyNav($, o.activeUrl || '');
  applySocial($);
  $('[data-block="footer"]').before(o.bodyHtml);
  applyHead($, { page: o.page || 'blog', origin: o.origin, title: o.title, description: o.description, path: o.path, image: o.image, noindex: o.noindex, ldExtra: o.ldExtra });
  $('head').append('<link rel="stylesheet" href="css/prose.css">');
  return theme.tintHtml(replaceContact($.html()));
}

module.exports = { renderCore, renderShell, CORE, DEFAULTS, siteUrl, readMinutes, fmtDate };
