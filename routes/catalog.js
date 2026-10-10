/**
 * Catalogue management (dashboard API): products and the "Our Works" photo gallery.
 * Both live in the database in display order; the public pages are rendered from them (lib/render.js).
 */
const express = require('express');
const db = require('../lib/store');
const A = require('../lib/auth');
const { wrap, HttpError, safeImg, clip, stripTags } = require('../lib/util');

const r = express.Router();
const editor = A.requireRole('admin', 'editor');

// stripTags returns entity-escaped text; the renderer escapes again on output, so store plain characters
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const text = (v, n) => clip(unescape(stripTags(String(v == null ? '' : v))).replace(/\s+/g, ' ').trim(), n);
const SHAPES = ['leaf', 'round', 'arch', 'pill'];
const MAX_PRODUCTS = 200;
const MAX_GALLERY = 120;

function readPhotos(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, 24)
    .map((p) => ({ src: safeImg(p && p.src), caption: text(p && p.caption, 140) }))
    .filter((p) => p.src);
}

function readProduct(b) {
  const name = text(b.name, 120);
  if (!name) throw new HttpError(400, 'A product name is required.');
  const image = safeImg(b.image || '');
  if (!image) throw new HttpError(400, 'Choose a main photo for the product.');
  return {
    name,
    summary: text(b.summary, 600),
    spec: text(b.spec, 160),
    image,
    imageCaption: text(b.imageCaption, 140),
    photos: readPhotos(b.photos),
    home: !!b.home,
    visible: b.visible === undefined ? true : !!b.visible,
  };
}

function reorder(list, ids) {
  if (!Array.isArray(ids)) throw new HttpError(400, 'Send the new order as a list of ids.');
  const byId = new Map(list.map((x) => [x.id, x]));
  const next = [];
  for (const id of ids) if (byId.has(id)) { next.push(byId.get(id)); byId.delete(id); }
  for (const x of list) if (byId.has(x.id)) next.push(x); // anything not mentioned keeps its relative order at the end
  list.splice(0, list.length, ...next);
}

// ---------------- products ----------------
r.get('/products', editor, (req, res) => res.json(db.data.products));

r.post(
  '/products',
  editor,
  wrap(async (req, res) => {
    if (db.data.products.length >= MAX_PRODUCTS) throw new HttpError(400, `You can have up to ${MAX_PRODUCTS} products.`);
    const p = { id: db.id(), ...readProduct(req.body || {}) };
    if (req.body && req.body.atTop) db.data.products.unshift(p);
    else db.data.products.push(p);
    db.log(req.user, `Added product: ${p.name}`);
    db.save();
    res.json(p);
  })
);

r.post(
  '/products/reorder',
  editor,
  wrap(async (req, res) => {
    reorder(db.data.products, req.body && req.body.ids);
    db.log(req.user, 'Reordered products');
    db.save();
    res.json({ ok: true });
  })
);

r.put(
  '/products/:id',
  editor,
  wrap(async (req, res) => {
    const p = db.data.products.find((x) => x.id === req.params.id);
    if (!p) throw new HttpError(404, 'Product not found.');
    Object.assign(p, readProduct(req.body || {}));
    db.log(req.user, `Updated product: ${p.name}`);
    db.save();
    res.json(p);
  })
);

r.delete(
  '/products/:id',
  editor,
  wrap(async (req, res) => {
    const i = db.data.products.findIndex((x) => x.id === req.params.id);
    if (i < 0) throw new HttpError(404, 'Product not found.');
    const [p] = db.data.products.splice(i, 1);
    db.log(req.user, `Deleted product: ${p.name}`);
    db.save();
    res.json({ ok: true });
  })
);

// ---------------- gallery ----------------
function readGalleryItem(b) {
  const src = safeImg(b.src || '');
  if (!src) throw new HttpError(400, 'Choose a photo.');
  const w = Math.round(+b.w), h = Math.round(+b.h);
  const item = { src, caption: text(b.caption, 140), shape: SHAPES.includes(b.shape) ? b.shape : 'round' };
  if (w > 0 && w < 20000 && h > 0 && h < 20000) { item.w = w; item.h = h; }
  return item;
}

r.get('/gallery', editor, (req, res) => res.json(db.data.gallery));

r.post(
  '/gallery',
  editor,
  wrap(async (req, res) => {
    const incoming = Array.isArray(req.body && req.body.items) ? req.body.items : [req.body || {}];
    if (!incoming.length) throw new HttpError(400, 'Choose at least one photo.');
    if (db.data.gallery.length + incoming.length > MAX_GALLERY) throw new HttpError(400, `The gallery can hold up to ${MAX_GALLERY} photos.`);
    const added = incoming.slice(0, 40).map((b) => ({ id: db.id(), ...readGalleryItem(b) }));
    if (req.body && req.body.atTop) db.data.gallery.unshift(...added);
    else db.data.gallery.push(...added);
    db.log(req.user, `Added ${added.length} gallery photo${added.length === 1 ? '' : 's'}`);
    db.save();
    res.json(added);
  })
);

r.post(
  '/gallery/reorder',
  editor,
  wrap(async (req, res) => {
    reorder(db.data.gallery, req.body && req.body.ids);
    db.log(req.user, 'Reordered gallery');
    db.save();
    res.json({ ok: true });
  })
);

r.put(
  '/gallery/:id',
  editor,
  wrap(async (req, res) => {
    const g = db.data.gallery.find((x) => x.id === req.params.id);
    if (!g) throw new HttpError(404, 'Photo not found.');
    const b = req.body || {};
    if (b.caption !== undefined) g.caption = text(b.caption, 140);
    if (b.shape !== undefined) {
      if (!SHAPES.includes(b.shape)) throw new HttpError(400, 'Unknown shape.');
      g.shape = b.shape;
    }
    if (b.src !== undefined) Object.assign(g, readGalleryItem({ ...g, ...b }));
    db.save();
    res.json(g);
  })
);

r.delete(
  '/gallery/:id',
  editor,
  wrap(async (req, res) => {
    const i = db.data.gallery.findIndex((x) => x.id === req.params.id);
    if (i < 0) throw new HttpError(404, 'Photo not found.');
    db.data.gallery.splice(i, 1);
    db.log(req.user, 'Removed a gallery photo');
    db.save();
    res.json({ ok: true });
  })
);


// ---------------- process steps ----------------
const MAX_STEPS = 12;
function readStep(b) {
  const title = text(b.title, 80);
  if (!title) throw new HttpError(400, 'A step title is required.');
  const image = b.image ? safeImg(b.image) : '';
  if (b.image && !image) throw new HttpError(400, 'That image address is not allowed.');
  return { title, summary: text(b.summary, 220), details: text(b.details, 700), image, visible: b.visible === undefined ? true : !!b.visible };
}

r.get('/steps', editor, (req, res) => res.json(db.data.processSteps));

r.post(
  '/steps',
  editor,
  wrap(async (req, res) => {
    if (db.data.processSteps.length >= MAX_STEPS) throw new HttpError(400, `You can have up to ${MAX_STEPS} steps.`);
    const st = { id: db.id(), ...readStep(req.body || {}) };
    db.data.processSteps.push(st);
    db.log(req.user, `Added process step: ${st.title}`);
    db.save();
    res.json(st);
  })
);

r.post(
  '/steps/reorder',
  editor,
  wrap(async (req, res) => {
    reorder(db.data.processSteps, req.body && req.body.ids);
    db.log(req.user, 'Reordered process steps');
    db.save();
    res.json({ ok: true });
  })
);

r.put(
  '/steps/:id',
  editor,
  wrap(async (req, res) => {
    const st = db.data.processSteps.find((x) => x.id === req.params.id);
    if (!st) throw new HttpError(404, 'Step not found.');
    Object.assign(st, readStep(req.body || {}));
    db.log(req.user, `Updated process step: ${st.title}`);
    db.save();
    res.json(st);
  })
);

r.delete(
  '/steps/:id',
  editor,
  wrap(async (req, res) => {
    const i = db.data.processSteps.findIndex((x) => x.id === req.params.id);
    if (i < 0) throw new HttpError(404, 'Step not found.');
    const [st] = db.data.processSteps.splice(i, 1);
    db.log(req.user, `Deleted process step: ${st.title}`);
    db.save();
    res.json({ ok: true });
  })
);

module.exports = r;
