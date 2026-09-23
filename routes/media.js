const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../lib/store');
const A = require('../lib/auth');
const { wrap, HttpError, clip } = require('../lib/util');

const r = express.Router();
const editor = A.requireRole('admin', 'editor');
const UPLOADS = path.join(db.DATA_DIR, 'uploads');
const PUBLIC = path.join(__dirname, '..', 'public');
const MAX_BYTES = 15 * 1024 * 1024;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

/** decide the real type from the file's bytes — filename and client mime are ignored */
function sniff(b) {
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', ext: 'jpg', mime: 'image/jpeg' };
  if (b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', ext: 'png', mime: 'image/png' };
  if (b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return { kind: 'image', ext: 'webp', mime: 'image/webp' };
  if (b.length > 6 && b.slice(0, 4).toString() === 'GIF8') return { kind: 'image', ext: 'gif', mime: 'image/gif' };
  if (b.length > 5 && b.slice(0, 5).toString() === '%PDF-') return { kind: 'pdf', ext: 'pdf', mime: 'application/pdf' };
  return null;
}

function builtin() {
  const out = [];
  for (const [dir, kind] of [['images', 'image'], ['docs', 'pdf']]) {
    const d = path.join(PUBLIC, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      const st = fs.statSync(path.join(d, f));
      out.push({ id: 'b:' + dir + '/' + f, name: f, url: dir + '/' + f, kind, size: st.size, builtin: true, at: st.mtime.toISOString() });
    }
  }
  return out;
}

r.get('/media', editor, (req, res) => {
  const kind = req.query.kind;
  let list = [...db.data.media.map((m) => ({ id: m.id, name: m.name, url: m.url, kind: m.kind, size: m.size, w: m.w, h: m.h, at: m.at, builtin: false })), ...builtin()];
  if (kind === 'image' || kind === 'pdf') list = list.filter((m) => m.kind === kind);
  res.json(list);
});

r.post(
  '/media',
  editor,
  (req, res, next) =>
    upload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'File is too large (max 15 MB).'));
      next(new HttpError(400, 'Upload failed: ' + err.message));
    }),
  wrap(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
    const buf = req.file.buffer;
    const type = sniff(buf);
    if (!type) throw new HttpError(400, 'Unsupported file. Upload a JPG, PNG, WebP, GIF or PDF.');
    let out = buf, w, h;
    if (type.kind === 'image') {
      try {
        const img = sharp(buf, { failOn: 'error', animated: type.ext === 'gif' });
        const meta = await img.metadata();
        if (type.ext !== 'gif') {
          let p = img.rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true });
          if (type.ext === 'jpg') p = p.jpeg({ quality: 82, mozjpeg: true });
          else if (type.ext === 'png') p = p.png({ compressionLevel: 9 });
          else p = p.webp({ quality: 82 });
          out = await p.toBuffer();
        }
        const m2 = await sharp(out).metadata();
        w = m2.width;
        h = m2.pageHeight || m2.height;
        if (!w || !h) w = meta.width, h = meta.height;
      } catch (e) {
        throw new HttpError(400, 'That image could not be read — it may be corrupted.');
      }
    }
    const file = crypto.randomBytes(9).toString('hex') + '.' + type.ext;
    fs.writeFileSync(path.join(UPLOADS, file), out);
    const base = path.basename(req.file.originalname || 'file', path.extname(req.file.originalname || ''));
    const rec = { id: db.id(), name: clip(base.replace(/[^\w\- .()]+/g, '_'), 80) + '.' + type.ext, file, url: 'uploads/' + file, kind: type.kind, mime: type.mime, size: out.length, w, h, by: req.user.email, at: new Date().toISOString() };
    db.data.media.unshift(rec);
    db.log(req.user, 'Uploaded ' + rec.name);
    db.save();
    res.json({ id: rec.id, name: rec.name, url: rec.url, kind: rec.kind, size: rec.size, w, h, builtin: false, savedBytes: type.kind === 'image' ? Math.max(0, buf.length - out.length) : 0 });
  })
);

function usage(url) {
  const hits = [];
  for (const [k, v] of Object.entries(db.data.content)) if (v === url) hits.push('page content');
  for (const p of db.data.posts) if (p.cover === url || (p.bodyHtml || '').includes(url)) hits.push('blog: ' + p.title);
  for (const p of db.data.pages) if ((p.bodyHtml || '').includes(url)) hits.push('page: ' + p.title);
  const s = db.data.settings.site;
  if (s.ogImage === url || s.favicon === url) hits.push('site settings');
  return [...new Set(hits)];
}

r.delete(
  '/media/:id',
  editor,
  wrap(async (req, res) => {
    const i = db.data.media.findIndex((m) => m.id === req.params.id);
    if (i < 0) throw new HttpError(404, 'File not found (built-in files cannot be deleted).');
    const m = db.data.media[i];
    const used = usage(m.url);
    if (used.length && req.query.force !== '1') throw new HttpError(409, 'This file is in use: ' + used.slice(0, 4).join(', ') + '. Deleting it will break those. Delete anyway?');
    db.data.media.splice(i, 1);
    try {
      fs.unlinkSync(path.join(UPLOADS, path.basename(m.file)));
    } catch (_) {}
    db.log(req.user, 'Deleted ' + m.name);
    db.save();
    res.json({ ok: true });
  })
);

module.exports = r;
