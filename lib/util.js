const sanitizeHtml = require('sanitize-html');

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/** Accept only relative URLs, #anchors, http(s), mailto and tel. Returns '' when unsafe. */
function safeUrl(u) {
  u = String(u == null ? '' : u).trim();
  if (!u) return '';
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u.slice(0, 2000);
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return ''; // javascript:, data:, vbscript: ...
  if (u.startsWith('//')) return '';
  return u.slice(0, 2000);
}

/** Image src: relative path, /uploads/..., or https URL. */
function safeImg(u) {
  u = String(u == null ? '' : u).trim();
  if (/^https?:\/\//i.test(u)) return u.slice(0, 2000);
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//')) return '';
  return u.slice(0, 500);
}

const RICH = {
  allowedTags: ['h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre', 'span'],
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title', 'width', 'height', 'loading'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  transformTags: {
    a: (tag, attribs) => {
      const out = { ...attribs };
      if (out.target === '_blank') out.rel = 'noopener noreferrer';
      else delete out.target;
      return { tagName: 'a', attribs: out };
    },
    img: (tag, attribs) => ({ tagName: 'img', attribs: { ...attribs, loading: 'lazy' } }),
  },
};
const cleanRich = (html) => sanitizeHtml(String(html || ''), RICH);
const stripTags = (html) => sanitizeHtml(String(html || ''), { allowedTags: [], allowedAttributes: {} });
const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

/** wrap async express handlers so rejections reach the error middleware */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { slugify, safeUrl, safeImg, cleanRich, stripTags, escapeHtml, clip, wrap, HttpError };
