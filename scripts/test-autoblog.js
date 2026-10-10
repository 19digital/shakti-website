#!/usr/bin/env node
/**
 * Tests the automatic AI blog writer (lib/autoblog.js) against a fake Gemini server — no real key or network needed.
 *   node scripts/test-autoblog.js
 */
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
const ok = (cond, label, detail) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? ' — ' + detail : '')); }
};

(async () => {
  // ---- fake Gemini
  const calls = [];
  let mode = 'ok'; // 'ok' | 'error'
  let n = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (mode === 'error') { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'boom' } })); }
      const j = JSON.parse(body || '{}');
      const prompt = j.contents && j.contents[0] && j.contents[0].parts[0].text;
      calls.push(prompt);
      n++;
      const article = {
        title: 'Fake article number ' + n,
        excerpt: 'A short excerpt.',
        metaDescription: 'Meta description.',
        tags: ['Drying', 'storage'],
        bodyHtml: '<h2>Heading</h2><p>Useful text.</p><script>alert(1)</script><img src=x onerror=alert(2)>',
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(article) }] } }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.GEMINI_BASE_URL = 'http://127.0.0.1:' + server.address().port;
  process.env.GEMINI_API_KEY = 'AIzaFAKEKEYFORAUTOBLOGTEST123456';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autoblog-'));

  const db = require('../lib/store');
  const ab = require('../lib/autoblog');
  const cfg = db.data.settings.ai.autoBlog;
  const DAY = 24 * 3600 * 1000;
  const ago = (ms) => new Date(Date.now() - ms).toISOString();

  console.log('\n== Scheduling ==');
  ok(ab.nextRunAt() === null, 'nothing is scheduled while automatic writing is off');
  ok(ab.clampDays(0) === 7 && ab.clampDays(500) === 90 && ab.clampDays(3) === 3, 'the frequency is kept between 1 and 90 days (junk falls back to weekly)');
  cfg.enabled = true; cfg.everyDays = 2; cfg.enabledAt = new Date().toISOString();
  const due = ab.nextRunAt();
  ok(Math.abs(due - (Date.now() + 2 * DAY)) < 5000, 'the first article is due one interval after switching on');
  await ab.tick();
  ok(db.data.posts.length === 0 && calls.length === 0, 'nothing is written before it is due');

  console.log('\n== Writing when due ==');
  cfg.enabledAt = ago(3 * DAY);
  await ab.tick();
  const p1 = db.data.posts[0];
  ok(db.data.posts.length === 1 && p1, 'an article is written once it is due');
  ok(p1 && p1.status === 'draft' && p1.publishedAt === null && p1.aiGenerated === true, 'it is saved as a draft by default and marked AI-written');
  ok(p1 && !/script|onerror/i.test(p1.bodyHtml) && /<h2>Heading<\/h2>/.test(p1.bodyHtml), 'dangerous HTML from the AI is stripped, safe formatting kept');
  ok(p1 && p1.tags.join() === 'drying,storage', 'tags are cleaned');
  ok(cfg.lastRunAt && cfg.lastError === '' && /draft/.test(cfg.lastResult) && cfg.lastPostId === p1.id, 'the result is recorded for the dashboard');
  ok(/avoid|overlap|fresh/i.test(calls[0]) && !/existing articles/.test(calls[0]), 'with no topics set, the AI is asked to choose a fresh topic');
  ok(Math.abs(ab.nextRunAt() - (Date.now() + 2 * DAY)) < 5000, 'the next run moves out by one interval');
  await ab.tick();
  ok(db.data.posts.length === 1, 'it does not write again until the next interval');

  console.log('\n== Topics and publishing ==');
  cfg.topics = 'Choosing a paddy dryer size\nKeeping silos dry in monsoon';
  cfg.mode = 'publish';
  cfg.lastRunAt = ago(3 * DAY);
  await ab.tick();
  const p2 = db.data.posts[1];
  ok(p2 && p2.status === 'published' && p2.publishedAt, 'publish mode makes the article live straight away');
  ok(/Topic: Choosing a paddy dryer size/.test(calls[calls.length - 1]), 'it uses the first topic from your list');
  ok(/existing articles|Fake article number 1/.test(calls[calls.length - 1]) === false, 'a listed topic is used as written');
  cfg.lastRunAt = ago(3 * DAY);
  await ab.tick();
  ok(/Topic: Keeping silos dry in monsoon/.test(calls[calls.length - 1]), 'the next article uses the next topic');
  cfg.topics = '';
  cfg.lastRunAt = ago(3 * DAY);
  await ab.tick();
  ok(/Fake article number 1/.test(calls[calls.length - 1]), 'with AI-chosen topics, existing article titles are passed so it avoids repeating them');
  const slugs = db.data.posts.map((p) => p.slug);
  ok(new Set(slugs).size === slugs.length, 'every article gets a unique web address');

  console.log('\n== Failures and limits ==');
  mode = 'error';
  const before = db.data.posts.length;
  cfg.lastRunAt = ago(3 * DAY);
  await ab.tick();
  ok(db.data.posts.length === before && cfg.lastError, 'a failed attempt writes nothing and records why');
  const retryAt = ab.nextRunAt();
  ok(retryAt - Date.now() > 5 * 3600 * 1000, 'after a failure it waits hours before trying again, not minutes');
  const callsBefore = calls.length;
  await ab.tick();
  ok(calls.length === callsBefore, 'it does not hammer the AI while waiting to retry');
  mode = 'ok';
  let threw = null;
  db.data.stats[new Date().toISOString().slice(0, 10)] = { blog: 100 };
  try { await ab.runOnce(); } catch (e) { threw = e; }
  ok(threw && threw.status === 429, 'the daily article limit is respected');

  console.log('\n' + pass + ' passed, ' + fail + ' failed.');
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST CRASHED:', e); process.exit(2); });
