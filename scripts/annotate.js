#!/usr/bin/env node
/**
 * One-time (re-runnable) annotator.
 *
 * Reads the original static pages from ./templates-src/*.html and writes CMS-ready templates to ./templates/*.html
 * plus ./templates/defaults.json (the original value of every editable item).
 *
 *   text runs  ->  <cms-t k="page.12">Original text</cms-t>
 *   images     ->  <img data-i="page.3" data-a="page.3a" ...>
 *   links      ->  <a data-l="page.7" ...>
 *   sections   ->  data-s="page.s2"  (so the admin can hide / reorder them)
 *
 * Shared chrome (header CTA, footer, quick-contact, chat widget) gets global keys g.h.* g.f.* g.q.* g.c.*
 * so it is edited once for the whole site.
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const SRC = path.join(__dirname, '..', 'templates-src');
const OUT = path.join(__dirname, '..', 'templates');
const PAGES = ['index', 'about', 'process', 'products', 'blog', 'contact'];

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'title', 'head']);
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

const defaults = { globals: [], pages: {} };
const globalSeen = {};

function annotatePage(page) {
  const html = fs.readFileSync(path.join(SRC, page + '.html'), 'utf8');
  const $ = cheerio.load(html);
  const items = [];
  let n = 0;

  const title = $('title').text();
  const description = $('meta[name="description"]').attr('content') || '';

  // ---- mark shared blocks ----
  const blocks = [];
  const nav = $('.site-nav-row').first();
  const footer = $('.grid-4').first().parent();
  footer.attr('data-block', 'footer');
  const qc = $('#qc-widget');
  const chat = $('#chat-widget');
  // nav links / mobile panel are generated from the Navigation manager, so they are not annotated
  nav.find('.nav-links').attr('data-nav', 'desktop');
  $('#mnav-panel').attr('data-nav', 'mobile');

  const groups = [
    { prefix: 'g.h', label: 'Header', root: nav, global: true },
    { prefix: 'g.f', label: 'Footer', root: footer, global: true },
    { prefix: 'g.q', label: 'Quick-contact button', root: qc, global: true },
    { prefix: 'g.c', label: 'Chat widget', root: chat, global: true },
  ];

  function within(node, root) {
    for (let p = node; p; p = p.parent) if (root.length && p === root[0]) return true;
    return false;
  }
  function groupFor(node) {
    for (const g of groups) if (within(node, g.root)) return g;
    return null;
  }

  // ---- sections: direct children of #page-root that are not chrome ----
  const root = $('#page-root');
  const sectionOf = new Map(); // node -> {id,label}
  let si = 0;
  root.children().each((_, el) => {
    const $el = $(el);
    if ($el.hasClass('site-nav-row') || $el.is('#mnav-panel') || $el.attr('data-block') === 'footer' || $el.is('#qc-widget') || $el.is('#chat-widget')) return;
    si++;
    const id = `${page}.s${si}`;
    $el.attr('data-s', id);
    const label =
      (($el.find('h1').length && 'Hero: ' + collapse($el.find('h1').first().text())) || '') ||
      collapse($el.find('.eyebrow').first().text()) ||
      collapse($el.find('h1,h2').first().text()) ||
      collapse($el.find('.chip').first().text()) ||
      `Section ${si}`;
    sectionOf.set(el, { id, label: label.slice(0, 60), ord: si });
  });
  function sectionFor(node) {
    for (let p = node; p; p = p.parent) if (sectionOf.has(p)) return sectionOf.get(p);
    return null;
  }

  // The blog grid is generated from the blog database; don't annotate its placeholder cards.
  if (page === 'blog') $('.grid-3.stagger-grid').first().attr('data-blog-grid', '1');
  const blogGrid = page === 'blog' ? $('[data-blog-grid]').first() : $();

  const counters = { 'g.h': 0, 'g.f': 0, 'g.q': 0, 'g.c': 0 };
  function nextKey(node) {
    const g = groupFor(node);
    if (g) {
      counters[g.prefix]++;
      return { key: `${g.prefix}.${counters[g.prefix]}`, g };
    }
    n++;
    return { key: `${page}.${n}`, g: null };
  }
  function push(entry, g, node) {
    if (g) {
      if (!globalSeen[entry.k]) {
        globalSeen[entry.k] = entry;
        entry.secLabel = g.label;
        entry.sec = g.prefix;
        defaults.globals.push(entry);
      } else if (globalSeen[entry.k].v !== entry.v) {
        console.warn(`  ! global ${entry.k} differs on ${page}: "${globalSeen[entry.k].v}" vs "${entry.v}"`);
      }
    } else {
      const s = sectionFor(node);
      entry.sec = s ? s.id : `${page}.top`;
      entry.secLabel = s ? s.label : 'Page';
      items.push(entry);
    }
  }

  // ---- traverse ----
  function walk(node) {
    if (node.type === 'tag') {
      if (SKIP_TAGS.has(node.name)) return;
      const $n = $(node);
      if ($n.attr('data-nav') || $n.attr('data-blog-grid') || $n.hasClass('hp-field')) return; // spam honeypot: never CMS-editable
      if ($n.is('#greeting-text')) return; // greeting is set from JS

      if (node.name === 'img') {
        const src = $n.attr('src');
        const { key, g } = nextKey(node);
        $n.attr('data-i', key);
        push({ k: key, t: 'img', v: src }, g, node);
        // alt text
        let alt = $n.attr('alt');
        const akey = key + 'a';
        if (alt === undefined) {
          // Prefer the tightest scope (the image's own card) over the whole section, and try real
          // heading tags before the loose style-matched div — in explicit priority order, not DOM
          // order, and always excluding #greeting-text (a runtime greeting, not an image caption).
          const scope = $n.closest('.card');
          const section = $n.closest('[data-s]');
          const tryIn = (root, sel) => (root && root.length ? collapse(root.find(sel).not('#greeting-text').first().text()) : '');
          alt =
            tryIn(scope, 'h1, h2, h3, .card-title') ||
            tryIn(scope, 'div[style*="Space Grotesk"]') ||
            tryIn(section, 'h1, h2, h3, .card-title') ||
            '';
          if (!alt) alt = 'Shakti Engineering Works rice mill machinery';
          $n.attr('alt', alt);
        }
        $n.attr('data-a', akey);
        push({ k: akey, t: 'alt', v: alt }, g, node);
        return;
      }
      if (node.name === 'a' && $n.attr('href') !== undefined) {
        const { key, g } = nextKey(node);
        $n.attr('data-l', key);
        push({ k: key, t: 'link', v: $n.attr('href') }, g, node);
      }
      (node.children || []).slice().forEach(walk);
    } else if (node.type === 'text') {
      const raw = node.data;
      const text = collapse(raw);
      if (!text) return;
      const { key, g } = nextKey(node);
      const lead = raw.match(/^\s*/)[0];
      const trail = raw.match(/\s*$/)[0];
      const wrapped = $('<cms-t></cms-t>').attr('k', key).text(text);
      $(node).replaceWith(lead + $.html(wrapped) + trail);
      push({ k: key, t: 'text', v: text }, g, node);
    }
  }
  $('body').children().each((_, el) => walk(el));

  // section metadata
  const sections = [...sectionOf.values()].map((s) => ({ id: s.id, label: s.label, ord: s.ord }));

  fs.writeFileSync(path.join(OUT, page + '.html'), $.html());
  defaults.pages[page] = { title, description, sections, items };
  console.log(`${page}: ${items.length} page items, ${sections.length} sections`);
}

fs.mkdirSync(OUT, { recursive: true });
PAGES.forEach(annotatePage);
fs.writeFileSync(path.join(OUT, 'defaults.json'), JSON.stringify(defaults, null, 1));
console.log(`globals: ${defaults.globals.length}`);
