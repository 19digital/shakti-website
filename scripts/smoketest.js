#!/usr/bin/env node
/**
 * End-to-end smoke test against a running instance (see run-smoketest.sh).
 * Exercises the real HTTP surface: setup, auth, roles/permissions, CSRF, content editing,
 * media upload, blog + custom pages + nav sync, SMTP settings, AI settings + public chat
 * fallback, the contact form (incl. honeypot), sitemap/robots/rss, 404 handling, and that
 * edits actually show up in the rendered public HTML.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const SETUP_TOKEN = process.env.SETUP_TOKEN;
if (!SETUP_TOKEN) { console.error('SETUP_TOKEN env var required'); process.exit(2); }

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + label + (detail ? ' — ' + detail : '')); }
}

function jar() {
  const cookies = {};
  return {
    apply(headers) { const s = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '); if (s) headers.cookie = s; },
    capture(res) {
      const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
      for (const c of raw) { const [pair] = c.split(';'); const i = pair.indexOf('='); if (i > 0) cookies[pair.slice(0, i)] = pair.slice(i + 1); }
    },
  };
}

async function req(cj, method, path, body, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  cj.apply(headers);
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  cj.capture(res);
  const ct = res.headers.get('content-type') || '';
  let data = null, text = null;
  if (ct.includes('application/json')) { try { data = await res.json(); } catch (e) {} }
  else { try { text = await res.text(); } catch (e) {} }
  return { status: res.status, data, text, headers: res.headers };
}

async function main() {
  const admin = jar();
  console.log('\n== Setup & auth ==');
  let r = await req(admin, 'GET', '/api/auth/state');
  ok(r.status === 200 && r.data.needsSetup === true, 'fresh install needs setup');

  r = await req(admin, 'POST', '/api/auth/setup', { token: 'wrong-code', email: 'a@a.com', name: 'A', password: 'password1234' });
  ok(r.status === 403, 'setup rejects wrong code', 'status=' + r.status);

  r = await req(admin, 'POST', '/api/auth/setup', { token: SETUP_TOKEN, email: 'owner@shaktiew.in', name: 'Owner Admin', password: 'CorrectHorse1' });
  ok(r.status === 200 && r.data.ok, 'setup with correct code creates admin + logs in', JSON.stringify(r.data));

  r = await req(admin, 'GET', '/api/me');
  ok(r.status === 200 && r.data.user && r.data.user.role === 'admin', 'session cookie authenticates /api/me');
  const csrf = r.data.csrf;
  ok(!!csrf, 'csrf token issued');

  r = await req(admin, 'GET', '/api/auth/state');
  ok(r.status === 200 && r.data.needsSetup === false, 'setup route now closed');
  r = await req(admin, 'POST', '/api/auth/setup', { token: SETUP_TOKEN, email: 'x@x.com', name: 'X', password: 'password1234' });
  ok(r.status === 403, 'cannot run setup a second time');

  console.log('\n== CSRF protection ==');
  r = await req(admin, 'PUT', '/api/content', { content: {} }); // no csrf header
  ok(r.status === 403, 'mutating call without csrf token is rejected');
  r = await req(admin, 'PUT', '/api/content', { content: {} }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200, 'mutating call with csrf token succeeds');

  console.log('\n== Session auth ==');
  const anon = jar();
  r = await req(anon, 'GET', '/api/me');
  ok(r.status === 401, 'anonymous /api/me is rejected');
  r = await req(anon, 'GET', '/api/dashboard');
  ok(r.status === 401, 'anonymous cannot read dashboard');

  console.log('\n== Content editing reaches the public page ==');
  r = await req(admin, 'GET', '/api/content/index');
  ok(r.status === 200 && Array.isArray(r.data.items) && r.data.items.length > 50, 'index content list loads', 'items=' + (r.data.items || []).length);
  const heroItem = r.data.items.find((i) => i.t === 'text' && /Engineering the/.test(i.v));
  ok(!!heroItem, 'hero heading text found in content list');
  const marker = 'SMOKETEST-' + Date.now();
  r = await req(admin, 'PUT', '/api/content', { content: { [heroItem.k]: marker } }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200 && r.data.changes === 1, 'saved a text edit');
  r = await req(admin, 'GET', '/index.html');
  ok(r.status === 200 && r.text.includes(marker), 'edited text appears on the live homepage');
  r = await req(admin, 'DELETE', '/api/content/' + encodeURIComponent(heroItem.k), undefined, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200, 'reset item back to default');
  r = await req(admin, 'GET', '/index.html');
  ok(r.status === 200 && !r.text.includes(marker), 'reset removed the edit from the live page');

  console.log('\n== Section hide/reorder ==');
  r = await req(admin, 'GET', '/api/content/products');
  const sec = r.data.sections[0];
  r = await req(admin, 'PUT', '/api/content', { sections: { [sec.id]: { hidden: true } } }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200, 'hid a section');
  r = await req(admin, 'GET', '/products.html');
  ok(r.status === 200, 'products page still renders with a section hidden');
  r = await req(admin, 'PUT', '/api/content', { sections: { [sec.id]: { hidden: false } } }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200, 'unhid the section again');

  console.log('\n== SEO overrides ==');
  r = await req(admin, 'PUT', '/api/content', { seo: { about: { title: 'SMOKETEST TITLE', description: 'SMOKETEST DESC' } } }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200, 'saved SEO override');
  r = await req(admin, 'GET', '/about.html');
  ok(r.text.includes('<title>SMOKETEST TITLE') && r.text.includes('SMOKETEST DESC'), 'SEO override reflected in <title>/<meta description>');
  await req(admin, 'PUT', '/api/content', { seo: { about: { title: '', description: '' } } }, { headers: { 'x-csrf-token': csrf } });

  console.log('\n== Theme ==');
  r = await req(admin, 'GET', '/api/theme/meta');
  ok(r.status === 200 && r.data.presets && r.data.presets.ocean, 'theme presets available');
  r = await req(admin, 'PUT', '/api/settings/theme', { preset: 'ocean', vars: { '--accent': '#123ABC' }, fontHeading: 'Poppins', fontBody: 'Inter', radiusCard: 20, radiusButton: 8 }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200, 'theme saved', JSON.stringify(r.data));
  r = await req(admin, 'GET', '/theme.css');
  ok(r.status === 200 && r.text.includes('#123ABC'), 'theme.css reflects the new accent colour');
  r = await req(admin, 'PUT', '/api/settings/theme', { preset: 'classic', vars: {}, fontHeading: 'not-a-real-font', fontBody: 'Manrope', radiusCard: 18, radiusButton: 10 }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 400, 'rejects an unlisted font name');
  await req(admin, 'PUT', '/api/settings/theme', { preset: 'classic', vars: {}, fontHeading: 'Space Grotesk', fontBody: 'Manrope', radiusCard: 18, radiusButton: 10 }, { headers: { 'x-csrf-token': csrf } });

  console.log('\n== Site settings & navigation ==');
  r = await req(admin, 'PUT', '/api/settings/site', { whatsapp: '9198', phone: '123' }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 400, 'rejects too-short whatsapp number');
  r = await req(admin, 'PUT', '/api/settings/nav', { nav: [{ label: 'Home', url: 'index.html' }] }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200, 'nav updated to a single item');
  r = await req(admin, 'GET', '/index.html');
  ok(!r.text.includes('>Contact</a>') || !/class="navlink"[^>]*>Contact/.test(r.text), 'trimmed nav is reflected on the live page');
  r = await req(admin, 'PUT', '/api/settings/nav', { nav: [{ label: 'Home', url: 'index.html' }, { label: 'About', url: 'about.html' }, { label: 'Process', url: 'process.html' }, { label: 'Products', url: 'products.html' }, { label: 'Blog', url: 'blog.html' }, { label: 'Contact', url: 'contact.html' }] }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200, 'nav restored');

  console.log('\n== Media upload ==');
  const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const boundary = '----smoke' + Date.now();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`),
    png1x1,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const headers = { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-csrf-token': csrf };
  admin.apply(headers);
  let res = await fetch(BASE + '/api/media', { method: 'POST', headers, body });
  admin.capture(res);
  let up = await res.json();
  ok(res.status === 200 && up.url, 'image upload accepted', JSON.stringify(up));
  r = await req(admin, 'GET', '/' + up.url);
  ok(r.status === 200, 'uploaded file is servable at ' + up.url);

  // reject a file that lies about its type (magic-byte sniffing)
  const fakeBody = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evil.png"\r\nContent-Type: image/png\r\n\r\n`),
    Buffer.from('<script>alert(1)</script>'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const h2 = { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-csrf-token': csrf };
  admin.apply(h2);
  res = await fetch(BASE + '/api/media', { method: 'POST', headers: h2, body: fakeBody });
  admin.capture(res);
  ok(res.status === 400, 'a mislabelled non-image file is rejected by content sniffing', 'status=' + res.status);

  console.log('\n== Blog post + rendering + RSS/sitemap ==');
  r = await req(admin, 'POST', '/api/posts', { title: 'Smoketest Article', bodyHtml: '<p>Hello <script>alert(1)</script>world</p>', status: 'published', cover: up.url }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200 && r.data.slug, 'post created', JSON.stringify(r.data));
  const post = r.data;
  ok(!post.bodyHtml.includes('<script'), 'script tag stripped from post body by sanitizer', post.bodyHtml);
  r = await req(admin, 'GET', '/blog/' + post.slug);
  ok(r.status === 200 && r.text.includes('Smoketest Article'), 'published post renders at /blog/:slug');
  r = await req(admin, 'GET', '/blog.html');
  ok(r.status === 200 && r.text.includes('Smoketest Article'), 'post appears in the blog listing');
  r = await req(admin, 'GET', '/sitemap.xml');
  ok(r.status === 200 && r.text.includes('/blog/' + post.slug), 'post listed in sitemap.xml');
  r = await req(admin, 'GET', '/rss.xml');
  ok(r.status === 200 && r.text.includes(post.title), 'post listed in rss.xml');
  r = await req(admin, 'PUT', '/api/posts/' + post.id, { title: post.title, bodyHtml: post.bodyHtml, status: 'draft' }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200, 'post set back to draft');
  r = await req(admin, 'GET', '/blog/' + post.slug);
  ok(r.status === 200, 'a signed-in editor can still preview a draft post');
  r = await req(anon, 'GET', '/blog/' + post.slug);
  ok(r.status === 404, 'draft post 404s for a signed-out visitor');
  r = await req(admin, 'DELETE', '/api/posts/' + post.id, undefined, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200, 'post deleted');

  console.log('\n== Custom page + nav sync ==');
  r = await req(admin, 'POST', '/api/pages', { title: 'Warranty', bodyHtml: '<p>Terms</p>', status: 'published', inNav: true }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200 && r.data.slug === 'warranty', 'custom page created with expected slug', JSON.stringify(r.data));
  const cpage = r.data;
  r = await req(admin, 'GET', '/warranty.html');
  ok(r.status === 200 && r.text.includes('Warranty'), 'custom page renders');
  r = await req(admin, 'GET', '/index.html');
  ok(r.text.includes('warranty.html'), 'custom page auto-added to the nav menu on the live page');
  r = await req(admin, 'DELETE', '/api/pages/' + cpage.id, undefined, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200, 'custom page deleted');
  r = await req(admin, 'GET', '/index.html');
  ok(!r.text.includes('warranty.html'), 'nav menu link removed after page deletion');
  r = await req(admin, 'GET', '/warranty.html');
  ok(r.status === 404, 'deleted custom page now 404s');

  console.log('\n== Reserved slugs ==');
  r = await req(admin, 'POST', '/api/pages', { title: 'admin', bodyHtml: '<p>x</p>', status: 'draft' }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200 && r.data.slug !== 'admin', 'a page titled "admin" is not allowed to shadow the dashboard route', r.data.slug);
  await req(admin, 'DELETE', '/api/pages/' + r.data.id, undefined, { headers: { 'x-csrf-token': csrf } });

  console.log('\n== AI settings (no real key expected to work, testing error handling) ==');
  r = await req(admin, 'PUT', '/api/ai/settings', { apiKey: 'not valid!!' }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 400, 'rejects a garbage-shaped API key');
  r = await req(admin, 'PUT', '/api/ai/settings', { apiKey: 'AIzaFAKEKEYFORSMOKETESTONLY1234', model: 'gemini-2.5-flash', chatEnabled: true }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200 && r.data.hasKey, 'a key-shaped string is accepted and saved (encrypted)');
  r = await req(admin, 'POST', '/api/ai/test', {}, { headers: { 'x-csrf-token': csrf } });
  ok(r.status >= 400 && r.status < 500 && r.data && r.data.error, 'testing a fake key fails cleanly (no crash, friendly error)', JSON.stringify(r.data));
  r = await req(anon, 'POST', '/api/chat', { message: 'hello' });
  ok(r.status !== 500 && r.data && r.data.fallback === true, 'public chat endpoint fails over gracefully with a fake key (no 500)', JSON.stringify(r.data) + ' status=' + r.status);
  r = await req(admin, 'GET', '/site-config.js');
  ok(r.status === 200 && /"chat":true/.test(r.text), 'site-config.js reports chat enabled to the frontend', r.text);
  r = await req(admin, 'GET', '/index.html');
  ok(r.text.includes('src="site-config.js'), 'index.html loads site-config.js before main.js');
  await req(admin, 'PUT', '/api/ai/settings', { clearKey: true }, { headers: { 'x-csrf-token': csrf } });
  r = await req(admin, 'GET', '/site-config.js');
  ok(/"chat":false/.test(r.text), 'site-config.js reports chat disabled once the key is removed', r.text);

  console.log('\n== SMTP settings ==');
  r = await req(admin, 'PUT', '/api/settings/smtp', { host: 'smtp.invalid.example', port: 465, secure: true, user: 'a@b.com', password: 'x' }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200, 'smtp settings saved');
  r = await req(admin, 'POST', '/api/settings/smtp/test', { to: 'owner@shaktiew.in' }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 400 && r.data && r.data.error, 'testing an unreachable SMTP host fails with a friendly error (no crash)', JSON.stringify(r.data));

  console.log('\n== Contact form (public, unauthenticated) ==');
  r = await req(anon, 'POST', '/api/contact', { name: 'Test Visitor', phone: '9876543210', email: 'visitor@example.com', message: 'Need a 32 ton dryer', ts: String(Date.now() - 5000) });
  ok(r.status === 200 && r.data.ok, 'valid submission accepted', JSON.stringify(r.data));
  ok(r.data.emailed === false, 'reports emailed:false since SMTP host is unreachable (submission still saved)');
  r = await req(anon, 'POST', '/api/contact', { name: 'Bot', phone: '9876543210', company: 'I am a bot', ts: String(Date.now() - 5000) });
  ok(r.status === 200, 'honeypot-triggering submission still returns ok (bot is not tipped off)');
  r = await req(anon, 'POST', '/api/contact', { name: 'Fast Bot', phone: '9876543210', ts: String(Date.now()) });
  ok(r.status === 200, 'too-fast submission returns ok (silently dropped)');
  r = await req(anon, 'POST', '/api/contact', { name: '', phone: '12' });
  ok(r.status === 400, 'missing name / bad phone rejected with a real error');
  // a visitor who *also* has an active dashboard session in the same browser (e.g. an admin
  // testing their own site) must still be able to submit the public form — it has no CSRF token
  // to send, since the page that calls this endpoint is the public site, not the dashboard.
  r = await req(admin, 'POST', '/api/contact', { name: 'Admin Browsing Publicly', phone: '9876543211', ts: String(Date.now() - 5000) }); // deliberately no x-csrf-token header
  ok(r.status === 200 && r.data.ok, 'a signed-in admin can still submit the public contact form without a CSRF token', 'status=' + r.status + ' body=' + JSON.stringify(r.data));
  r = await req(admin, 'POST', '/api/chat', { message: 'hello' }); // deliberately no x-csrf-token header
  ok(r.status !== 403, 'a signed-in admin is not CSRF-blocked from the public chat endpoint either', 'status=' + r.status);

  r = await req(admin, 'GET', '/api/submissions');
  ok(r.status === 200 && r.data.total === 2, 'both submissions stored (honeypot + too-fast were silently dropped)', 'total=' + (r.data && r.data.total));
  const subId = r.data.items.find((s) => s.name === 'Test Visitor').id;
  const subId2 = r.data.items.find((s) => s.name === 'Admin Browsing Publicly').id;
  r = await req(admin, 'PATCH', '/api/submissions/' + subId, { read: true }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200 && r.data.read === true, 'submission marked read');
  r = await req(admin, 'GET', '/api/submissions.csv');
  ok(r.status === 200 && r.text.includes('Test Visitor'), 'CSV export includes the submission', 'status=' + r.status + ' body=' + JSON.stringify((r.text || '').slice(0, 300)));
  r = await req(admin, 'DELETE', '/api/submissions/' + subId, undefined, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200, 'submission deleted');
  r = await req(admin, 'DELETE', '/api/submissions/' + subId2, undefined, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200, 'second submission deleted');

  console.log('\n== Roles: editor vs admin ==');
  r = await req(admin, 'POST', '/api/users', { email: 'ed@shaktiew.in', name: 'Ed Editor', role: 'editor', password: 'EditorPass123' }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200, 'admin can create an editor account', JSON.stringify(r.data));
  const editor = jar();
  r = await req(editor, 'POST', '/api/auth/login', { email: 'ed@shaktiew.in', password: 'EditorPass123' });
  ok(r.status === 200, 'editor can sign in');
  r = await req(editor, 'GET', '/api/me');
  const ecsrf = r.data.csrf;
  r = await req(editor, 'GET', '/api/content/index');
  ok(r.status === 200, 'editor can read content');
  r = await req(editor, 'PUT', '/api/settings/theme', { preset: 'classic', vars: {}, fontHeading: 'Manrope', fontBody: 'Manrope', radiusCard: 10, radiusButton: 10 }, { headers: { 'x-csrf-token': ecsrf } });
  ok(r.status === 403, 'editor is blocked from changing the theme (admin-only)');
  r = await req(editor, 'GET', '/api/users');
  ok(r.status === 403, 'editor is blocked from listing users (admin-only)');
  r = await req(editor, 'GET', '/api/submissions');
  ok(r.status === 200, 'editor CAN read enquiries (intended: editor+admin)');

  console.log('\n== Account safety ==');
  r = await req(admin, 'GET', '/api/users');
  const me = r.data.find((u) => u.email === 'owner@shaktiew.in');
  r = await req(admin, 'PATCH', '/api/users/' + me.id, { disabled: true }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 400, 'cannot disable the only admin account (own account, sole admin)', JSON.stringify(r.data));
  r = await req(admin, 'DELETE', '/api/users/' + me.id, undefined, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 400, "cannot delete one's own account", 'status=' + r.status + ' body=' + JSON.stringify(r.data));
  r = await req(admin, 'GET', '/api/users');
  ok(r.status === 200 && Array.isArray(r.data), 'admin session/account still intact after the rejected self-delete', 'status=' + r.status + ' body=' + JSON.stringify(r.data));
  if (Array.isArray(r.data)) {
    const edUser = r.data.find((u) => u.email === 'ed@shaktiew.in');
    if (edUser) {
      r = await req(admin, 'DELETE', '/api/users/' + edUser.id, undefined, { headers: { 'x-csrf-token': csrf } });
      ok(r.status === 200, 'admin can delete the editor account');
    } else {
      ok(false, 'admin can delete the editor account', 'editor account not found in user list');
    }
  }

  console.log('\n== Well-known files & 404 ==');
  r = await req(admin, 'GET', '/robots.txt');
  ok(r.status === 200 && r.text.includes('Sitemap:'), 'robots.txt served');
  r = await req(admin, 'GET', '/this-page-does-not-exist.html');
  ok(r.status === 404 && r.text.includes("couldn't find"), 'unknown page renders a themed 404 (not a raw crash)');
  r = await req(admin, 'GET', '/admin');
  ok(r.status === 200 && r.text.includes('id="app"'), 'dashboard shell loads at /admin');
  r = await req(admin, 'GET', '/api/nope');
  ok(r.status === 404, 'unknown API route 404s cleanly');

  console.log('\n== Password change & re-login ==');
  // sign in a second, independent session as the same admin first, to prove the *other* session
  // gets signed out while the session that made the change does not (intentional: you shouldn't
  // have to re-log-in in the tab where you just changed your own password).
  const otherTab = jar();
  r = await req(otherTab, 'POST', '/api/auth/login', { email: 'owner@shaktiew.in', password: 'CorrectHorse1' });
  ok(r.status === 200, 'second session logs in with the current password (setup for the next checks)');

  r = await req(admin, 'POST', '/api/auth/password', { current: 'wrong-current-password', next: 'NewPassword99' }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 400, 'rejects a wrong current password');

  r = await req(admin, 'POST', '/api/auth/password', { current: 'CorrectHorse1', next: 'NewPassword99' }, { headers: { 'x-csrf-token': csrf } });
  ok(r.status === 200, 'password changed', 'status=' + r.status + ' body=' + JSON.stringify(r.data));
  r = await req(admin, 'GET', '/api/me');
  ok(r.status === 200, 'the session that made the change stays signed in', 'status=' + r.status);
  r = await req(otherTab, 'GET', '/api/me');
  ok(r.status === 401, 'a DIFFERENT session for the same user is signed out (security: other devices are logged out)', 'status=' + r.status);
  const relog = jar();
  r = await req(relog, 'POST', '/api/auth/login', { email: 'owner@shaktiew.in', password: 'CorrectHorse1' });
  ok(r.status === 401, 'the old password no longer works');
  r = await req(relog, 'POST', '/api/auth/login', { email: 'owner@shaktiew.in', password: 'NewPassword99' });
  ok(r.status === 200, 'can log in with the new password');

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (failures.length) { console.log('\nFAILURES:'); failures.forEach((f) => console.log(' - ' + f)); }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('SMOKETEST CRASHED:', e); process.exit(2); });
