// Shakti CMS dashboard — vanilla JS, no build step. Everything talks to /api/*.
'use strict';

const CORE_PAGES = ['index', 'about', 'process', 'products', 'blog', 'contact'];
const PAGE_LABEL = { index: 'Home', about: 'About', process: 'Process', products: 'Products', blog: 'Blog (article list page)', contact: 'Contact' };
const state = { user: null, csrf: null, mediaCache: null };
const $app = document.getElementById('app');

// ---------------------------------------------------------------- api ----
async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (state.csrf) opts.headers['x-csrf-token'] = state.csrf;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch (e) {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {}
  if (res.status === 401 && state.user) {
    state.user = null;
    renderLogin('Your session has expired — please sign in again.');
    throw new Error('Session expired.');
  }
  if (!res.ok) throw new Error((data && data.error) || res.statusText || 'Request failed.');
  return data;
}

function apiUpload(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media');
    if (state.csrf) xhr.setRequestHeader('x-csrf-token', state.csrf);
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error((data && data.error) || 'Upload failed.'));
    };
    xhr.onerror = () => reject(new Error('Upload failed — check your connection.'));
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

// ------------------------------------------------------------- helpers ----
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = (s) => esc(s).replace(/`/g, '&#96;');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtBytes = (n) => (n == null ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function nav(hash) {
  location.hash = hash;
}

// ----------------------------------------------------------- toast/UI ----
let toastWrap = null;
function toast(msg, kind) {
  if (!toastWrap) {
    toastWrap = document.createElement('div');
    toastWrap.className = 'toast-wrap';
    document.body.appendChild(toastWrap);
  }
  const t = document.createElement('div');
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.textContent = msg;
  toastWrap.appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3200);
}
function errText(e) {
  return e && e.message ? e.message : 'Something went wrong.';
}
function openModal(innerHtml, wide) {
  const bg = h(`<div class="modal-bg"><div class="modal${wide ? ' wide' : ''}">${innerHtml}</div></div>`);
  bg.addEventListener('mousedown', (e) => {
    if (e.target === bg) closeModal();
  });
  document.body.appendChild(bg);
  document.addEventListener('keydown', escCloseModal);
  return bg;
}
function escCloseModal(e) {
  if (e.key === 'Escape') closeModal();
}
function closeModal() {
  document.querySelectorAll('.modal-bg').forEach((m) => m.remove());
  document.removeEventListener('keydown', escCloseModal);
}

// --------------------------------------------------------------- boot ----
async function boot() {
  try {
    const s = await api('GET', '/auth/state');
    if (s.needsSetup) return renderSetup();
  } catch (e) {}
  try {
    const me = await api('GET', '/me');
    state.user = me.user;
    state.csrf = me.csrf;
    window.addEventListener('hashchange', route);
    route();
  } catch (e) {
    renderLogin();
  }
}
boot();

// ------------------------------------------------------------- routes ----
const ADMIN_ONLY_ROUTES = new Set(['theme', 'site', 'email', 'ai', 'nav', 'users', 'backup']);
function route() {
  if (!state.user) return renderLogin();
  const parts = (location.hash.slice(1) || 'dashboard').split('/').filter(Boolean);
  const key = parts[0];
  if (ADMIN_ONLY_ROUTES.has(key) && state.user.role !== 'admin') {
    shell(key, `<div class="banner err">Only an admin can open this page.</div>`);
    return;
  }
  if (CORE_PAGES.includes(key)) return viewContent(key);
  switch (key) {
    case 'dashboard': return viewDashboard();
    case 'globals': return viewContent('globals');
    case 'pages': return parts[1] ? viewPageEditor(parts[1]) : viewPagesList();
    case 'blog': return parts[1] ? viewPostEditor(parts[1]) : viewPostsList();
    case 'media': return viewMedia();
    case 'nav': return viewNav();
    case 'theme': return viewTheme();
    case 'site': return viewSite();
    case 'email': return viewEmail();
    case 'ai': return viewAi();
    case 'leads': return viewLeads();
    case 'users': return viewUsers();
    case 'backup': return viewBackup();
    case 'account': return viewAccount();
    default: return viewDashboard();
  }
}

// -------------------------------------------------------------- shell ----
function sidebarHtml(active) {
  const admin = state.user.role === 'admin';
  const item = (key, label, icon) => `<div class="nav-link${active === key ? ' active' : ''}" data-nav="${key}">${icon || ''}<span>${label}</span></div>`;
  return `
  <div class="sidebar-head">
    <div class="site-name">Shakti Dashboard</div>
    <div class="role">${esc(state.user.name)} &middot; <span class="pill ${state.user.role}">${state.user.role}</span></div>
  </div>
  <div class="nav-group">
    ${item('dashboard', 'Dashboard')}
  </div>
  <div class="nav-group">
    <div class="nav-group-label">Website content</div>
    ${CORE_PAGES.map((p) => item(p, PAGE_LABEL[p])).join('')}
    ${item('globals', 'Header, footer & widgets')}
    ${item('pages', 'Custom pages')}
    ${admin ? item('nav', 'Navigation menu') : ''}
  </div>
  <div class="nav-group">
    <div class="nav-group-label">Blog</div>
    ${item('blog-list', 'Articles').replace('data-nav="blog-list"', 'data-nav="blog"')}
  </div>
  <div class="nav-group">
    <div class="nav-group-label">Media &amp; leads</div>
    ${item('media', 'Media library')}
    ${item('leads', 'Enquiries')}
  </div>
  ${admin ? `<div class="nav-group">
    <div class="nav-group-label">Site setup</div>
    ${item('theme', 'Theme &amp; colours')}
    ${item('site', 'Site settings')}
    ${item('email', 'Email notifications')}
    ${item('ai', 'AI &amp; chatbot')}
  </div>` : ''}
  ${admin ? `<div class="nav-group">
    <div class="nav-group-label">Administration</div>
    ${item('users', 'Users')}
    ${item('backup', 'Backup')}
  </div>` : ''}
  <div class="sidebar-foot">
    ${item('account', 'My account')}
    <div class="nav-link" id="nav-logout">Sign out</div>
    <div style="padding:8px 10px;"><a href="/" target="_blank" rel="noopener">View live site &#8599;</a></div>
  </div>`;
}

function shell(active, contentHtml, title) {
  $app.innerHTML = `<div class="shell">
    <div class="sidebar">${sidebarHtml(active)}</div>
    <div class="main">
      <div class="topbar"><h1>${title || navTitle(active)}</h1><div class="spacer"></div></div>
      <div class="content">${contentHtml}</div>
    </div>
  </div>`;
  $app.querySelectorAll('[data-nav]').forEach((el) => el.addEventListener('click', () => nav('#' + el.getAttribute('data-nav'))));
  const lo = document.getElementById('nav-logout');
  if (lo) lo.addEventListener('click', doLogout);
  return $app.querySelector('.content');
}
function navTitle(key) {
  if (CORE_PAGES.includes(key)) return PAGE_LABEL[key] + ' page';
  return { dashboard: 'Dashboard', globals: 'Header, footer & widgets', pages: 'Custom pages', blog: 'Blog articles', media: 'Media library', nav: 'Navigation menu', theme: 'Theme & colours', site: 'Site settings', email: 'Email notifications', ai: 'AI & chatbot', leads: 'Enquiries', users: 'Users', backup: 'Backup', account: 'My account' }[key] || 'Dashboard';
}
async function doLogout() {
  try {
    await api('POST', '/auth/logout');
  } catch (e) {}
  state.user = null;
  renderLogin();
}

// ================================================================
//  AUTH SCREENS
// ================================================================
function renderSetup() {
  $app.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-logo">S</div>
    <h1>Set up your dashboard</h1>
    <div class="sub">This is a one-time step. The setup code was printed in the server's console/log when it started.</div>
    <div id="setup-err"></div>
    <form id="setup-form">
      <div class="field"><label>Setup code</label><input class="input mono" name="token" required autocomplete="off"></div>
      <div class="field"><label>Your name</label><input class="input" name="name" required></div>
      <div class="field"><label>Email</label><input class="input" type="email" name="email" required autocomplete="username"></div>
      <div class="field"><label>Password</label><input class="input" type="password" name="password" required minlength="10" autocomplete="new-password"><div class="hint">At least 10 characters, with letters and numbers.</div></div>
      <button class="btn primary" type="submit" style="width:100%;justify-content:center;">Create admin account</button>
    </form>
  </div></div>`;
  document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const box = document.getElementById('setup-err');
    box.innerHTML = '';
    try {
      await api('POST', '/auth/setup', { token: f.get('token').trim(), name: f.get('name'), email: f.get('email'), password: f.get('password') });
      boot();
    } catch (err) {
      box.innerHTML = `<div class="banner err">${esc(errText(err))}</div>`;
    }
  });
}

function renderLogin(notice) {
  $app.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-logo">S</div>
    <h1>Sign in</h1>
    <div class="sub">Shakti Engineering Works — dashboard</div>
    ${notice ? `<div class="banner warn">${esc(notice)}</div>` : ''}
    <div id="login-err"></div>
    <form id="login-form">
      <div class="field"><label>Email</label><input class="input" type="email" name="email" required autocomplete="username" autofocus></div>
      <div class="field"><label>Password</label><input class="input" type="password" name="password" required autocomplete="current-password"></div>
      <button class="btn primary" type="submit" style="width:100%;justify-content:center;">Sign in</button>
    </form>
  </div></div>`;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const box = document.getElementById('login-err');
    box.innerHTML = '';
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await api('POST', '/auth/login', { email: f.get('email'), password: f.get('password') });
      await boot();
    } catch (err) {
      box.innerHTML = `<div class="banner err">${esc(errText(err))}</div>`;
      btn.disabled = false;
    }
  });
}

// ================================================================
//  DASHBOARD
// ================================================================
async function viewDashboard() {
  const c = shell('dashboard', `<div class="muted">Loading…</div>`);
  let d;
  try {
    d = await api('GET', '/dashboard');
  } catch (e) {
    c.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
    return;
  }
  c.innerHTML = `
    <div class="grid-cards">
      <div class="stat"><div class="n">${d.counts.published}</div><div class="l">Published articles</div></div>
      <div class="stat"><div class="n">${d.counts.drafts}</div><div class="l">Drafts</div></div>
      <div class="stat"><div class="n">${d.counts.pages}</div><div class="l">Custom pages</div></div>
      <div class="stat"><div class="n">${d.counts.media}</div><div class="l">Media files</div></div>
      <div class="stat"><div class="n">${d.counts.edits}</div><div class="l">Content edits made</div></div>
    </div>
    <div class="card">
      <h2>AI (Gemini)</h2>
      <div class="desc">${d.ai.hasKey ? `Connected &middot; model <span class="mono">${esc(d.ai.model)}</span>` : 'No API key saved yet.'}</div>
      <div class="row">
        <div class="field"><label>Chatbot replies today</label><div style="font-size:20px;font-weight:800;">${d.ai.chatToday}</div></div>
        <div class="field"><label>AI blog generations today</label><div style="font-size:20px;font-weight:800;">${d.ai.blogToday}</div></div>
      </div>
      ${!d.ai.hasKey ? `<button class="btn primary" id="go-ai">Add your Gemini API key</button>` : `<button class="btn" id="go-ai">Open AI settings</button>`}
    </div>
    <div class="card">
      <h2>Recent activity</h2>
      ${d.activity.length ? `<table class="list"><tbody>${d.activity.map((a) => `<tr><td style="white-space:nowrap;color:var(--text-dimmer);">${fmtDateTime(a.at)}</td><td>${esc(a.by)}</td><td>${esc(a.text)}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">Nothing yet.</div>`}
    </div>`;
  const goAi = document.getElementById('go-ai');
  if (goAi) goAi.addEventListener('click', () => nav('#ai'));
}

// ================================================================
//  CONTENT EDITOR (core pages + globals)
// ================================================================
async function viewContent(page) {
  const c = shell(page, `<div class="muted">Loading…</div>`);
  let d;
  try {
    d = await api('GET', '/content/' + page);
  } catch (e) {
    c.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
    return;
  }
  const pending = {}; // key -> new value (only when changed by the user this session)
  const pendingSections = {}; // sectionId -> {hidden}
  let order = (d.sections || []).map((s) => s.id);
  const orderChanged = () => JSON.stringify(order) !== JSON.stringify((d.sections || []).map((s) => s.id));

  const bySec = {};
  for (const it of d.items) (bySec[it.sec] = bySec[it.sec] || []).push(it);

  function itemRow(it) {
    const val = pending[it.k] !== undefined ? pending[it.k] : it.v;
    const isChanged = pending[it.k] !== undefined ? pending[it.k] !== it.d : it.changed;
    let field = '';
    if (it.t === 'text') {
      field = val.length > 70 ? `<textarea class="input" data-k="${it.k}" rows="2">${esc(val)}</textarea>` : `<input class="input" data-k="${it.k}" value="${attr(val)}">`;
    } else if (it.t === 'alt') {
      field = `<input class="input" data-k="${it.k}" value="${attr(val)}" placeholder="Describe the image for screen readers">`;
    } else if (it.t === 'link') {
      field = `<input class="input" data-k="${it.k}" value="${attr(val)}" placeholder="https:// or page.html">`;
    } else if (it.t === 'img') {
      field = `<div class="img-preview"><img data-img-preview="${it.k}" src="/${attr(val)}" onerror="this.style.visibility='hidden'"><div style="flex:1;"><input class="input mono" data-k="${it.k}" value="${attr(val)}" style="margin-bottom:6px;"><button class="btn small" data-pick-img="${it.k}" type="button">Choose from media library</button></div></div>`;
    }
    return `<div class="item-row${isChanged ? ' changed' : ''}" data-row="${it.k}">
      <div class="meta"><span class="kind">${it.t}</span>${isChanged ? `<button class="icon-btn" data-reset="${it.k}" title="Reset to original" type="button">&#8635; reset</button>` : ''}</div>
      ${field}
    </div>`;
  }

  function sectionsHtml() {
    if (!d.sections || !d.sections.length) {
      return `<div class="sec-block open"><div class="sec-body" style="display:block;">${(bySec[page + '.top'] || []).map(itemRow).join('') || `<div class="empty">Nothing editable on this section.</div>`}</div></div>`;
    }
    return order
      .map((secId, idx) => {
        const meta = d.sections.find((s) => s.id === secId);
        const hidden = pendingSections[secId] ? pendingSections[secId].hidden : meta.hidden;
        const items = bySec[secId] || [];
        return `<div class="sec-block${idx === 0 ? ' open' : ''}" data-sec="${secId}">
          <div class="sec-head">
            <button class="icon-btn drag-up" data-up="${secId}" title="Move up" type="button" ${idx === 0 ? 'disabled' : ''}>&#8593;</button>
            <button class="icon-btn drag-down" data-down="${secId}" title="Move down" type="button" ${idx === order.length - 1 ? 'disabled' : ''}>&#8595;</button>
            <span class="t">${esc(meta.label)}${hidden ? ' <span class="pill hidden">hidden</span>' : ''}</span>
            <label class="check" style="margin-right:6px;" title="Hide this section on the live site"><input type="checkbox" data-hide="${secId}" ${hidden ? 'checked' : ''}> Hide</label>
            <span class="sec-toggle">${items.length} item${items.length === 1 ? '' : 's'} &#9662;</span>
          </div>
          <div class="sec-body">${items.length ? items.map(itemRow).join('') : `<div class="empty">No text/image/link content in this section.</div>`}</div>
        </div>`;
      })
      .join('');
  }

  function seoHtml() {
    if (page === 'globals') return '';
    const seo = d.seo;
    return `<div class="card">
      <h2>Search / social preview (SEO)</h2>
      <div class="desc">Leave blank to use the site default.</div>
      <div class="field"><label>Page title <span class="muted">(default: ${esc(seo.defaultTitle)})</span></label><input class="input" id="seo-title" value="${attr(seo.title)}" maxlength="120"></div>
      <div class="field"><label>Meta description <span class="muted">(default: ${esc((seo.defaultDescription || '').slice(0, 60))}…)</span></label><textarea class="input" id="seo-desc" rows="2" maxlength="300">${esc(seo.description)}</textarea></div>
    </div>`;
  }

  function render() {
    const dirty = Object.keys(pending).length || Object.keys(pendingSections).length || orderChanged() || seoTouched;
    c.innerHTML = `
      ${page === 'globals' ? `<div class="banner ok" style="background:var(--panel-2);color:var(--text-dim);">These items appear on every page (header, footer, quick-contact button, chat widget) — edit once here.</div>` : `<div class="toolbar"><div class="spacer"></div><a class="btn small" href="/${attr(page)}.html" target="_blank" rel="noopener">View live &#8599;</a></div>`}
      ${sectionsHtml()}
      ${seoHtml()}
      <div class="save-bar">
        <button class="btn primary" id="save-btn" ${dirty ? '' : 'disabled'}>Save changes${dirty ? '' : ' — no changes'}</button>
        <span class="muted" id="save-status"></span>
      </div>`;
    wire();
  }
  let seoTouched = false;

  function wire() {
    c.querySelectorAll('.sec-head').forEach((head) => {
      head.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('label')) return;
        head.closest('.sec-block').classList.toggle('open');
      });
    });
    c.querySelectorAll('[data-k]').forEach((el) => {
      el.addEventListener('input', () => {
        pending[el.getAttribute('data-k')] = el.value;
        const row = el.closest('.item-row');
        row.classList.add('changed');
        if (!row.querySelector('[data-reset]')) {
          row.querySelector('.meta').insertAdjacentHTML('beforeend', `<button class="icon-btn" data-reset="${el.getAttribute('data-k')}" title="Reset to original" type="button">&#8635; reset</button>`);
          row.querySelector('[data-reset]').addEventListener('click', () => resetItem(el.getAttribute('data-k')));
        }
        const prev = el.parentElement.querySelector(`[data-img-preview="${el.getAttribute('data-k')}"]`);
        if (prev) {
          prev.style.visibility = '';
          prev.src = '/' + el.value;
        }
        updateSaveBtn();
      });
    });
    c.querySelectorAll('[data-reset]').forEach((btn) => btn.addEventListener('click', () => resetItem(btn.getAttribute('data-reset'))));
    c.querySelectorAll('[data-pick-img]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const k = btn.getAttribute('data-pick-img');
        openMediaPicker('image', (m) => {
          pending[k] = m.url;
          render();
        });
      })
    );
    c.querySelectorAll('[data-hide]').forEach((cb) =>
      cb.addEventListener('change', () => {
        const id = cb.getAttribute('data-hide');
        pendingSections[id] = { hidden: cb.checked };
        render();
        c.querySelector(`[data-sec="${id}"]`).classList.add('open');
      })
    );
    c.querySelectorAll('[data-up]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-up');
        const i = order.indexOf(id);
        if (i > 0) {
          [order[i - 1], order[i]] = [order[i], order[i - 1]];
          render();
        }
      })
    );
    c.querySelectorAll('[data-down]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-down');
        const i = order.indexOf(id);
        if (i < order.length - 1) {
          [order[i + 1], order[i]] = [order[i], order[i + 1]];
          render();
        }
      })
    );
    const st = document.getElementById('seo-title'),
      sd = document.getElementById('seo-desc');
    if (st) st.addEventListener('input', () => (seoTouched = true, updateSaveBtn()));
    if (sd) sd.addEventListener('input', () => (seoTouched = true, updateSaveBtn()));
    document.getElementById('save-btn').addEventListener('click', save);
  }
  function updateSaveBtn() {
    const dirty = Object.keys(pending).length || Object.keys(pendingSections).length || orderChanged() || seoTouched;
    const btn = document.getElementById('save-btn');
    btn.disabled = !dirty;
    btn.textContent = dirty ? 'Save changes' : 'Save changes — no changes';
  }
  function resetItem(k) {
    delete pending[k];
    render();
  }
  async function save() {
    const btn = document.getElementById('save-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const body = { content: pending, sections: pendingSections };
    if (orderChanged()) body.order = { [page]: order };
    if (seoTouched) {
      const st = document.getElementById('seo-title'),
        sd = document.getElementById('seo-desc');
      body.seo = { [page]: { title: st.value, description: sd.value } };
    }
    try {
      await api('PUT', '/content', body);
      toast('Saved.', 'ok');
      viewContent(page);
    } catch (e) {
      toast(errText(e), 'err');
      btn.disabled = false;
      btn.textContent = 'Save changes';
    }
  }
  render();
}

// ================================================================
//  MEDIA LIBRARY (+ reusable picker)
// ================================================================
async function loadMedia(kind) {
  const q = kind ? '?kind=' + kind : '';
  const list = await api('GET', '/media' + q);
  return list;
}
function mediaTile(m, onClick) {
  const tile = h(`<div class="media-tile" data-id="${attr(m.id)}">
    ${m.kind === 'image' ? `<img src="/${attr(m.url)}" loading="lazy">` : `<div class="pdf-icon">PDF</div>`}
    <div class="name" title="${attr(m.name)}">${esc(m.name)}</div>
  </div>`);
  tile.addEventListener('click', () => onClick(m, tile));
  return tile;
}
function openMediaPicker(kind, onPick) {
  const modal = openModal(`
    <div class="mhead"><h2>${kind === 'pdf' ? 'Choose a document' : 'Choose an image'}</h2><button class="icon-btn" id="m-close">&#10005;</button></div>
    <div class="dropzone" id="m-drop">Drag a file here, or <label style="color:var(--accent);cursor:pointer;text-decoration:underline;">browse<input type="file" id="m-file" accept="${kind === 'pdf' ? 'application/pdf' : 'image/*'}" style="display:none;"></label><div id="m-progress" class="muted" style="margin-top:6px;"></div></div>
    <div class="media-grid" id="m-grid"><div class="empty">Loading…</div></div>
  `, true);
  document.getElementById('m-close').addEventListener('click', closeModal);
  async function refresh() {
    const grid = document.getElementById('m-grid');
    try {
      const list = await loadMedia(kind);
      grid.innerHTML = '';
      if (!list.length) grid.innerHTML = `<div class="empty">No files yet — upload one above.</div>`;
      list.forEach((m) => grid.appendChild(mediaTile(m, (mm) => { onPick(mm); closeModal(); })));
    } catch (e) {
      grid.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
    }
  }
  const drop = document.getElementById('m-drop');
  const fileInput = document.getElementById('m-file');
  async function doUpload(file) {
    document.getElementById('m-progress').textContent = 'Uploading…';
    try {
      const m = await apiUpload(file, (p) => (document.getElementById('m-progress').textContent = 'Uploading… ' + p + '%'));
      document.getElementById('m-progress').textContent = '';
      toast('Uploaded.', 'ok');
      refresh();
    } catch (e) {
      document.getElementById('m-progress').textContent = '';
      toast(errText(e), 'err');
    }
  }
  fileInput.addEventListener('change', () => fileInput.files[0] && doUpload(fileInput.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && doUpload(e.dataTransfer.files[0]));
  refresh();
}

async function viewMedia() {
  const c = shell('media', `<div class="muted">Loading…</div>`);
  let filter = 'all';
  async function refresh() {
    let list;
    try {
      list = await loadMedia(filter === 'all' ? undefined : filter);
    } catch (e) {
      c.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
      return;
    }
    c.innerHTML = `
      <div class="toolbar">
        <button class="btn ${filter === 'all' ? 'primary' : ''}" data-f="all">All</button>
        <button class="btn ${filter === 'image' ? 'primary' : ''}" data-f="image">Images</button>
        <button class="btn ${filter === 'pdf' ? 'primary' : ''}" data-f="pdf">PDFs</button>
        <div class="spacer"></div>
        <label class="btn primary">Upload<input type="file" id="up-file" style="display:none;" accept="image/*,application/pdf"></label>
      </div>
      <div class="dropzone" id="md-drop">Drag &amp; drop a file here to upload<div id="md-progress" class="muted"></div></div>
      <div class="media-grid" id="md-grid">${list.length ? '' : `<div class="empty">No files yet.</div>`}</div>`;
    const grid = document.getElementById('md-grid');
    list.forEach((m) =>
      grid.appendChild(
        mediaTile(m, (mm) => {
          openModal(`
          <div class="mhead"><h2>${esc(mm.name)}</h2><button class="icon-btn" id="mi-close">&#10005;</button></div>
          ${mm.kind === 'image' ? `<img src="/${attr(mm.url)}" style="width:100%;border-radius:10px;max-height:340px;object-fit:contain;background:var(--panel-2);">` : `<div class="pdf-icon" style="height:140px;font-size:14px;">PDF document</div>`}
          <div class="field" style="margin-top:14px;"><label>File path</label><input class="input mono" readonly value="${attr(mm.url)}" onclick="this.select()"></div>
          <div class="row" style="margin-top:6px;color:var(--text-dimmer);font-size:12.5px;">${mm.w ? `${mm.w}×${mm.h}px &middot; ` : ''}${fmtBytes(mm.size)} ${mm.builtin ? '&middot; built-in file' : ''}</div>
          <div class="divider"></div>
          <div class="row"><a class="btn" href="/${attr(mm.url)}" target="_blank" rel="noopener">Open</a>${mm.builtin ? '' : `<button class="btn danger" id="mi-delete">Delete</button>`}</div>
        `);
          document.getElementById('mi-close').addEventListener('click', closeModal);
          const del = document.getElementById('mi-delete');
          if (del)
            del.addEventListener('click', async () => {
              if (!confirm('Delete "' + mm.name + '"? This cannot be undone.')) return;
              try {
                await api('DELETE', '/media/' + mm.id);
                closeModal();
                toast('Deleted.', 'ok');
                refresh();
              } catch (e) {
                if (/in use/i.test(errText(e)) && confirm(errText(e))) {
                  try {
                    await api('DELETE', '/media/' + mm.id + '?force=1');
                    closeModal();
                    toast('Deleted.', 'ok');
                    refresh();
                  } catch (e2) {
                    toast(errText(e2), 'err');
                  }
                } else toast(errText(e), 'err');
              }
            });
        })
      )
    );
    c.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.getAttribute('data-f'); refresh(); }));
    const fileInput = document.getElementById('up-file');
    const drop = document.getElementById('md-drop');
    async function doUpload(file) {
      document.getElementById('md-progress').textContent = 'Uploading…';
      try {
        await apiUpload(file, (p) => (document.getElementById('md-progress').textContent = 'Uploading… ' + p + '%'));
        toast('Uploaded.', 'ok');
        refresh();
      } catch (e) {
        toast(errText(e), 'err');
        document.getElementById('md-progress').textContent = '';
      }
    }
    fileInput.addEventListener('change', () => fileInput.files[0] && doUpload(fileInput.files[0]));
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && doUpload(e.dataTransfer.files[0]));
  }
  refresh();
}

// ================================================================
//  RICH TEXT EDITOR (shared by blog posts + custom pages)
// ================================================================
function mountRTE(container, initialHtml) {
  container.innerHTML = `
    <div class="rte-toolbar">
      <button type="button" data-cmd="bold"><b>B</b></button>
      <button type="button" data-cmd="italic"><i>I</i></button>
      <button type="button" data-block="H2">H2</button>
      <button type="button" data-block="H3">H3</button>
      <button type="button" data-block="P">¶</button>
      <button type="button" data-cmd="insertUnorderedList">&#8226; List</button>
      <button type="button" data-cmd="insertOrderedList">1. List</button>
      <button type="button" data-cmd="blockquote">&#10077; Quote</button>
      <button type="button" data-cmd="link">Link</button>
      <button type="button" data-cmd="removeFormat">Clear</button>
    </div>
    <div class="rte-body" contenteditable="true">${initialHtml || '<p></p>'}</div>`;
  const body = container.querySelector('.rte-body');
  container.querySelectorAll('[data-cmd]').forEach((btn) =>
    btn.addEventListener('click', () => {
      body.focus();
      const cmd = btn.getAttribute('data-cmd');
      if (cmd === 'link') {
        const url = prompt('Link URL (https://, mailto:, tel:, or a page like about.html):');
        if (url) document.execCommand('createLink', false, url);
      } else if (cmd === 'blockquote') {
        document.execCommand('formatBlock', false, 'blockquote');
      } else {
        document.execCommand(cmd, false, null);
      }
    })
  );
  container.querySelectorAll('[data-block]').forEach((btn) =>
    btn.addEventListener('click', () => {
      body.focus();
      document.execCommand('formatBlock', false, btn.getAttribute('data-block'));
    })
  );
  return { getHtml: () => body.innerHTML, focus: () => body.focus(), body };
}

function aiAssistBar(getSelectionOrAll, applyResult, format) {
  const wrap = h(`<div class="row" style="margin-top:8px;align-items:center;">
    <span class="muted" style="font-size:12.5px;">AI assist:</span>
    <button type="button" class="btn small" data-act="rewrite">Rewrite</button>
    <button type="button" class="btn small" data-act="shorten">Shorten</button>
    <button type="button" class="btn small" data-act="expand">Expand</button>
    <button type="button" class="btn small" data-act="proofread">Proofread</button>
    <span class="muted" id="ai-assist-status" style="font-size:12px;"></span>
  </div>`);
  wrap.querySelectorAll('[data-act]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const text = getSelectionOrAll();
      if (!text || !text.trim()) return toast('Select some text first, or write a draft to improve.', 'err');
      const status = wrap.querySelector('#ai-assist-status');
      status.textContent = 'Working…';
      wrap.querySelectorAll('button').forEach((b) => (b.disabled = true));
      try {
        const r = await api('POST', '/ai/assist', { action: btn.getAttribute('data-act'), text, format });
        applyResult(r.text);
        status.textContent = 'Done.';
        setTimeout(() => (status.textContent = ''), 2000);
      } catch (e) {
        toast(errText(e), 'err');
        status.textContent = '';
      } finally {
        wrap.querySelectorAll('button').forEach((b) => (b.disabled = false));
      }
    })
  );
  return wrap;
}

// ================================================================
//  BLOG
// ================================================================
async function viewPostsList() {
  const c = shell('blog', `<div class="muted">Loading…</div>`);
  let list;
  try {
    list = await api('GET', '/posts');
  } catch (e) {
    c.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
    return;
  }
  c.innerHTML = `
    <div class="toolbar">
      <button class="btn primary" id="new-post">+ Write article</button>
      <button class="btn" id="ai-post">&#10024; Write with AI</button>
      <div class="spacer"></div>
      <span class="muted">${list.length} article${list.length === 1 ? '' : 's'}</span>
    </div>
    ${list.length ? `<table class="list"><thead><tr><th>Title</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>
      ${list.map((p) => `<tr data-open="${p.id}" style="cursor:pointer;"><td><strong>${esc(p.title)}</strong>${p.aiGenerated ? ' <span class="pill" style="background:var(--panel-2);color:var(--text-dimmer);">AI</span>' : ''}<div class="muted" style="font-size:12px;">/blog/${esc(p.slug)}</div></td><td><span class="pill ${p.status}">${p.status}</span></td><td>${fmtDate(p.updatedAt)}</td><td><button class="icon-btn" data-del="${p.id}" title="Delete">&#128465;</button></td></tr>`).join('')}
    </tbody></table>` : `<div class="empty">No articles yet. Write one, or let AI draft one for you.</div>`}
  `;
  c.querySelectorAll('[data-open]').forEach((tr) =>
    tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      nav('#blog/' + tr.getAttribute('data-open'));
    })
  );
  c.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this article? This cannot be undone.')) return;
      try {
        await api('DELETE', '/posts/' + btn.getAttribute('data-del'));
        toast('Deleted.', 'ok');
        viewPostsList();
      } catch (err) {
        toast(errText(err), 'err');
      }
    })
  );
  document.getElementById('new-post').addEventListener('click', () => nav('#blog/new'));
  document.getElementById('ai-post').addEventListener('click', openAiBlogModal);
}

function openAiBlogModal() {
  const modal = openModal(`
    <div class="mhead"><h2>&#10024; Write an article with AI</h2><button class="icon-btn" id="ai-close">&#10005;</button></div>
    <div id="ai-err"></div>
    <div class="field"><label>Topic *</label><textarea class="input" id="ai-topic" rows="2" placeholder="e.g. How to choose the right bucket elevator capacity for a 20-ton mill"></textarea></div>
    <div class="row">
      <div class="field"><label>Length</label><select class="input" id="ai-length"><option value="short">Short (~450 words)</option><option value="medium" selected>Medium (~850 words)</option><option value="long">Long (~1400 words)</option></select></div>
      <div class="field"><label>Audience (optional)</label><input class="input" id="ai-audience" placeholder="e.g. rice mill owners in West Bengal"></div>
    </div>
    <div class="field"><label>Keywords to include (optional)</label><input class="input" id="ai-keywords" placeholder="paddy dryer, moisture content, 32 ton"></div>
    <div class="field"><label>Notes for the writer (optional)</label><textarea class="input" id="ai-notes" rows="2"></textarea></div>
    <button class="btn primary" id="ai-generate" style="width:100%;justify-content:center;">Generate draft</button>
  `);
  document.getElementById('ai-close').addEventListener('click', closeModal);
  document.getElementById('ai-generate').addEventListener('click', async () => {
    const topic = document.getElementById('ai-topic').value.trim();
    const errBox = document.getElementById('ai-err');
    errBox.innerHTML = '';
    if (!topic) return (errBox.innerHTML = `<div class="banner err">Describe the topic first.</div>`);
    const btn = document.getElementById('ai-generate');
    btn.disabled = true;
    btn.textContent = 'Writing… (this can take up to a minute)';
    try {
      const draft = await api('POST', '/ai/blog', {
        topic,
        length: document.getElementById('ai-length').value,
        audience: document.getElementById('ai-audience').value.trim(),
        keywords: document.getElementById('ai-keywords').value.trim(),
        notes: document.getElementById('ai-notes').value.trim(),
      });
      closeModal();
      sessionStorage.setItem('cms-ai-draft', JSON.stringify(draft));
      nav('#blog/new');
    } catch (e) {
      errBox.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
      btn.disabled = false;
      btn.textContent = 'Generate draft';
    }
  });
}

async function viewPostEditor(id) {
  const isNew = id === 'new';
  const c = shell('blog', `<div class="muted">Loading…</div>`);
  let post = { title: '', slug: '', excerpt: '', bodyHtml: '', cover: '', coverAlt: '', status: 'draft', tags: [], seoTitle: '', seoDescription: '' };
  if (!isNew) {
    try {
      post = await api('GET', '/posts/' + id);
    } catch (e) {
      c.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
      return;
    }
  } else {
    const draft = sessionStorage.getItem('cms-ai-draft');
    if (draft) {
      try {
        Object.assign(post, JSON.parse(draft), { aiGenerated: true });
      } catch (e) {}
      sessionStorage.removeItem('cms-ai-draft');
    }
  }
  c.innerHTML = `
    <div class="toolbar"><button class="btn ghost" id="back">&larr; All articles</button><div class="spacer"></div>${!isNew ? `<a class="btn" href="/blog/${attr(post.slug)}" target="_blank" rel="noopener">View live</a>` : ''}</div>
    <div class="card">
      <div class="field"><label>Title *</label><input class="input" id="p-title" value="${attr(post.title)}" style="font-size:17px;font-weight:700;"></div>
      <div class="row">
        <div class="field"><label>URL slug</label><input class="input mono" id="p-slug" value="${attr(post.slug)}" placeholder="auto from title"></div>
        <div class="field"><label>Status</label><select class="input" id="p-status"><option value="draft"${post.status === 'draft' ? ' selected' : ''}>Draft</option><option value="published"${post.status === 'published' ? ' selected' : ''}>Published</option></select></div>
      </div>
      <div class="field"><label>Excerpt (shown on the blog list)</label><textarea class="input" id="p-excerpt" rows="2" maxlength="300">${esc(post.excerpt)}</textarea></div>
      <div class="field"><label>Tags</label><input class="input" id="p-tags" value="${attr((post.tags || []).join(', '))}" placeholder="comma, separated, tags"></div>
      <div class="field"><label>Cover image</label><div class="img-preview"><img id="cover-preview" src="${post.cover ? '/' + attr(post.cover) : ''}" style="${post.cover ? '' : 'visibility:hidden;'}"><button class="btn small" id="pick-cover" type="button">Choose image</button>${post.cover ? `<button class="btn small ghost" id="clear-cover" type="button">Remove</button>` : ''}</div></div>
    </div>
    <div class="card">
      <h2>Article content</h2>
      <div id="rte-wrap"></div>
      <div id="assist-wrap"></div>
    </div>
    <div class="card">
      <h2>SEO (optional)</h2>
      <div class="field"><label>SEO title override</label><input class="input" id="p-seo-title" value="${attr(post.seoTitle)}"></div>
      <div class="field"><label>Meta description</label><textarea class="input" id="p-seo-desc" rows="2" maxlength="300">${esc(post.seoDescription)}</textarea></div>
    </div>
    <div class="save-bar">
      <button class="btn primary" id="save-post">${isNew ? 'Create article' : 'Save changes'}</button>
      ${!isNew ? `<button class="btn danger" id="del-post">Delete</button>` : ''}
      <span class="muted" id="save-status"></span>
    </div>`;
  document.getElementById('back').addEventListener('click', () => nav('#blog'));
  const rte = mountRTE(document.getElementById('rte-wrap'), post.bodyHtml);
  document.getElementById('assist-wrap').appendChild(
    aiAssistBar(
      () => {
        const sel = window.getSelection();
        const inBody = sel && sel.rangeCount && rte.body.contains(sel.anchorNode);
        return inBody && sel.toString().trim() ? sel.toString() : rte.body.innerText;
      },
      (text) => {
        const sel = window.getSelection();
        const inBody = sel && sel.rangeCount && rte.body.contains(sel.anchorNode) && sel.toString().trim();
        if (inBody) {
          document.execCommand('insertHTML', false, text.replace(/</g, '&lt;').replace(/\n/g, '<br>'));
        } else {
          rte.body.innerHTML = text;
        }
      },
      'html'
    )
  );
  document.getElementById('pick-cover').addEventListener('click', () =>
    openMediaPicker('image', (m) => {
      post.cover = m.url;
      document.getElementById('cover-preview').src = '/' + m.url;
      document.getElementById('cover-preview').style.visibility = '';
    })
  );
  const clearCover = document.getElementById('clear-cover');
  if (clearCover)
    clearCover.addEventListener('click', () => {
      post.cover = '';
      document.getElementById('cover-preview').style.visibility = 'hidden';
    });

  async function doSave(publish) {
    const status = document.getElementById('save-status');
    const title = document.getElementById('p-title').value.trim();
    if (!title) return toast('Give the article a title.', 'err');
    const body = {
      title,
      slug: document.getElementById('p-slug').value.trim(),
      excerpt: document.getElementById('p-excerpt').value.trim(),
      bodyHtml: rte.getHtml(),
      tags: document.getElementById('p-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      cover: post.cover || '',
      coverAlt: title,
      status: publish || document.getElementById('p-status').value,
      seoTitle: document.getElementById('p-seo-title').value.trim(),
      seoDescription: document.getElementById('p-seo-desc').value.trim(),
      aiGenerated: !!post.aiGenerated,
    };
    status.textContent = 'Saving…';
    try {
      const saved = isNew ? await api('POST', '/posts', body) : await api('PUT', '/posts/' + id, body);
      toast('Saved.', 'ok');
      nav('#blog/' + saved.id);
      if (!isNew) viewPostEditor(id);
    } catch (e) {
      toast(errText(e), 'err');
      status.textContent = '';
    }
  }
  document.getElementById('save-post').addEventListener('click', () => doSave());
  const del = document.getElementById('del-post');
  if (del)
    del.addEventListener('click', async () => {
      if (!confirm('Delete this article? This cannot be undone.')) return;
      try {
        await api('DELETE', '/posts/' + id);
        toast('Deleted.', 'ok');
        nav('#blog');
      } catch (e) {
        toast(errText(e), 'err');
      }
    });
}

// ================================================================
//  CUSTOM PAGES
// ================================================================
async function viewPagesList() {
  const c = shell('pages', `<div class="muted">Loading…</div>`);
  let list;
  try {
    list = await api('GET', '/pages');
  } catch (e) {
    c.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
    return;
  }
  c.innerHTML = `
    <div class="toolbar"><button class="btn primary" id="new-page">+ New page</button><div class="spacer"></div><span class="muted">${list.length} page${list.length === 1 ? '' : 's'}</span></div>
    ${list.length ? `<table class="list"><thead><tr><th>Title</th><th>Status</th><th>In menu</th><th>Updated</th><th></th></tr></thead><tbody>
      ${list.map((p) => `<tr data-open="${p.id}" style="cursor:pointer;"><td><strong>${esc(p.title)}</strong><div class="muted" style="font-size:12px;">/${esc(p.slug)}.html</div></td><td><span class="pill ${p.status}">${p.status}</span></td><td>${p.inNav ? 'Yes' : '—'}</td><td>${fmtDate(p.updatedAt)}</td><td><button class="icon-btn" data-del="${p.id}" title="Delete">&#128465;</button></td></tr>`).join('')}
    </tbody></table>` : `<div class="empty">No custom pages yet. Use this for things like "Careers", "FAQ" or "Warranty" that don't fit the existing pages.</div>`}
  `;
  c.querySelectorAll('[data-open]').forEach((tr) =>
    tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      nav('#pages/' + tr.getAttribute('data-open'));
    })
  );
  c.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this page? This cannot be undone.')) return;
      try {
        await api('DELETE', '/pages/' + btn.getAttribute('data-del'));
        toast('Deleted.', 'ok');
        viewPagesList();
      } catch (err) {
        toast(errText(err), 'err');
      }
    })
  );
  document.getElementById('new-page').addEventListener('click', () => nav('#pages/new'));
}

async function viewPageEditor(id) {
  const isNew = id === 'new';
  const c = shell('pages', `<div class="muted">Loading…</div>`);
  let page = { title: '', slug: '', description: '', bodyHtml: '', status: 'draft', hero: true, inNav: false };
  if (!isNew) {
    try {
      page = await api('GET', '/pages/' + id);
    } catch (e) {
      c.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
      return;
    }
  }
  c.innerHTML = `
    <div class="toolbar"><button class="btn ghost" id="back">&larr; All pages</button><div class="spacer"></div>${!isNew ? `<a class="btn" href="/${attr(page.slug)}.html" target="_blank" rel="noopener">View live</a>` : ''}</div>
    <div class="card">
      <div class="field"><label>Page title *</label><input class="input" id="pg-title" value="${attr(page.title)}" style="font-size:17px;font-weight:700;"></div>
      <div class="row">
        <div class="field"><label>URL slug</label><input class="input mono" id="pg-slug" value="${attr(page.slug)}" placeholder="auto from title"></div>
        <div class="field"><label>Status</label><select class="input" id="pg-status"><option value="draft"${page.status === 'draft' ? ' selected' : ''}>Draft</option><option value="published"${page.status === 'published' ? ' selected' : ''}>Published</option></select></div>
      </div>
      <div class="field"><label>Intro text under the title (optional)</label><textarea class="input" id="pg-desc" rows="2">${esc(page.description)}</textarea></div>
      <label class="check"><input type="checkbox" id="pg-hero" ${page.hero !== false ? 'checked' : ''}> Show the title banner at the top of the page</label>
      ${state.user.role === 'admin' ? `<label class="check" style="margin-top:8px;"><input type="checkbox" id="pg-innav" ${page.inNav ? 'checked' : ''}> Show this page in the navigation menu</label>` : ''}
    </div>
    <div class="card">
      <h2>Page content</h2>
      <div id="rte-wrap"></div>
      <div id="assist-wrap"></div>
    </div>
    <div class="save-bar">
      <button class="btn primary" id="save-page">${isNew ? 'Create page' : 'Save changes'}</button>
      ${!isNew ? `<button class="btn danger" id="del-page">Delete</button>` : ''}
    </div>`;
  document.getElementById('back').addEventListener('click', () => nav('#pages'));
  const rte = mountRTE(document.getElementById('rte-wrap'), page.bodyHtml);
  document.getElementById('assist-wrap').appendChild(
    aiAssistBar(
      () => {
        const sel = window.getSelection();
        return sel && rte.body.contains(sel.anchorNode) && sel.toString().trim() ? sel.toString() : rte.body.innerText;
      },
      (text) => {
        const sel = window.getSelection();
        if (sel && rte.body.contains(sel.anchorNode) && sel.toString().trim()) document.execCommand('insertHTML', false, text.replace(/</g, '&lt;').replace(/\n/g, '<br>'));
        else rte.body.innerHTML = text;
      },
      'html'
    )
  );
  async function doSave() {
    const title = document.getElementById('pg-title').value.trim();
    if (!title) return toast('Give the page a title.', 'err');
    const body = {
      title,
      slug: document.getElementById('pg-slug').value.trim(),
      description: document.getElementById('pg-desc').value.trim(),
      bodyHtml: rte.getHtml(),
      status: document.getElementById('pg-status').value,
      hero: document.getElementById('pg-hero').checked,
      inNav: state.user.role === 'admin' ? document.getElementById('pg-innav').checked : undefined,
    };
    try {
      const saved = isNew ? await api('POST', '/pages', body) : await api('PUT', '/pages/' + id, body);
      toast('Saved.', 'ok');
      nav('#pages/' + saved.id);
      if (!isNew) viewPageEditor(id);
    } catch (e) {
      toast(errText(e), 'err');
    }
  }
  document.getElementById('save-page').addEventListener('click', doSave);
  const del = document.getElementById('del-page');
  if (del)
    del.addEventListener('click', async () => {
      if (!confirm('Delete this page? This cannot be undone.')) return;
      try {
        await api('DELETE', '/pages/' + id);
        toast('Deleted.', 'ok');
        nav('#pages');
      } catch (e) {
        toast(errText(e), 'err');
      }
    });
}

// ================================================================
//  NAVIGATION MENU
// ================================================================
async function viewNav() {
  const c = shell('nav', `<div class="muted">Loading…</div>`);
  let s;
  try {
    s = await api('GET', '/settings');
  } catch (e) {
    c.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
    return;
  }
  let items = s.nav.map((n) => ({ ...n }));
  function render() {
    c.innerHTML = `
      <div class="card">
        <h2>Menu items</h2>
        <div class="desc">Shown in this order in the header and mobile menu. Links can be a page like <span class="mono">about.html</span> or a full <span class="mono">https://</span> address.</div>
        <div id="nav-rows"></div>
        <button class="btn" id="nav-add" type="button" style="margin-top:10px;">+ Add item</button>
      </div>
      <div class="save-bar"><button class="btn primary" id="nav-save">Save menu</button></div>`;
    const rows = document.getElementById('nav-rows');
    items.forEach((it, i) => {
      const row = h(`<div class="row" style="align-items:center;margin-bottom:8px;">
        <div class="field" style="flex:0 0 30px;color:var(--text-dimmer);text-align:center;">${i + 1}</div>
        <div class="field"><input class="input" data-f="label" placeholder="Label" value="${attr(it.label)}"></div>
        <div class="field" style="flex:2;"><input class="input" data-f="url" placeholder="page.html or https://…" value="${attr(it.url)}"></div>
        <button class="icon-btn" data-up type="button" ${i === 0 ? 'disabled' : ''}>&#8593;</button>
        <button class="icon-btn" data-down type="button" ${i === items.length - 1 ? 'disabled' : ''}>&#8595;</button>
        <button class="icon-btn" data-del type="button">&#128465;</button>
      </div>`);
      row.querySelector('[data-f="label"]').addEventListener('input', (e) => (it.label = e.target.value));
      row.querySelector('[data-f="url"]').addEventListener('input', (e) => (it.url = e.target.value));
      row.querySelector('[data-del]').addEventListener('click', () => { items.splice(i, 1); render(); });
      const up = row.querySelector('[data-up]');
      if (!up.disabled) up.addEventListener('click', () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; render(); });
      const down = row.querySelector('[data-down]');
      if (!down.disabled) down.addEventListener('click', () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; render(); });
      rows.appendChild(row);
    });
    document.getElementById('nav-add').addEventListener('click', () => { items.push({ label: '', url: '' }); render(); });
    document.getElementById('nav-save').addEventListener('click', async () => {
      const clean = items.filter((it) => it.label.trim() && it.url.trim());
      try {
        await api('PUT', '/settings/nav', { nav: clean });
        toast('Menu saved.', 'ok');
        viewNav();
      } catch (e) {
        toast(errText(e), 'err');
      }
    });
  }
  render();
}

// ================================================================
//  THEME & COLOURS
// ================================================================
async function viewTheme() {
  const c = shell('theme', `<div class="muted">Loading…</div>`);
  let meta, settings;
  try {
    [meta, settings] = await Promise.all([api('GET', '/theme/meta'), api('GET', '/settings')]);
  } catch (e) {
    c.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
    return;
  }
  const t = { preset: settings.theme.preset, vars: { ...settings.theme.vars }, fontHeading: settings.theme.fontHeading, fontBody: settings.theme.fontBody, radiusCard: settings.theme.radiusCard, radiusButton: settings.theme.radiusButton };
  function currentVars() {
    return { ...meta.presets[t.preset].vars, ...t.vars };
  }
  function render() {
    const vars = currentVars();
    c.innerHTML = `
      <div class="card">
        <h2>Starting point</h2>
        <div class="desc">Pick a preset, then fine-tune the two main colours below if you like.</div>
        <div class="grid-cards">
          ${Object.entries(meta.presets)
            .map(
              ([k, p]) => `<div class="theme-preset${t.preset === k ? ' active' : ''}" data-preset="${k}">
              <div class="theme-swatch">${['--bg', '--accent', '--teal', '--text'].map((v) => `<span style="background:${p.vars[v]}"></span>`).join('')}</div>
              <div class="label">${esc(p.label)}</div>
            </div>`
            )
            .join('')}
        </div>
      </div>
      <div class="card">
        <h2>Colours</h2>
        <div class="row">
          ${['--accent', '--teal'].map((k) => `<div class="field"><label>${esc(meta.labels[k])}</label><div class="color-row"><input type="color" data-var="${k}" value="${vars[k]}"><input class="input mono" data-var-text="${k}" value="${vars[k]}"></div></div>`).join('')}
        </div>
        <details style="margin-top:6px;"><summary class="muted" style="cursor:pointer;font-size:13px;">More colours (background, text)</summary>
          <div class="row" style="margin-top:12px;">
            ${['--bg', '--surface', '--text', '--text-dim'].map((k) => `<div class="field"><label>${esc(meta.labels[k])}</label><div class="color-row"><input type="color" data-var="${k}" value="${vars[k]}"><input class="input mono" data-var-text="${k}" value="${vars[k]}"></div></div>`).join('')}
          </div>
        </details>
        <div id="contrast-warn"></div>
      </div>
      <div class="card">
        <h2>Fonts &amp; shape</h2>
        <div class="row">
          <div class="field"><label>Heading font</label><select class="input" id="font-head">${meta.fonts.map((f) => `<option value="${attr(f)}"${t.fontHeading === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></div>
          <div class="field"><label>Body font</label><select class="input" id="font-body">${meta.fonts.map((f) => `<option value="${attr(f)}"${t.fontBody === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></div>
        </div>
        <div class="row">
          <div class="field"><label>Card corner roundness: <span id="rc-val">${t.radiusCard}</span>px</label><input type="range" min="0" max="32" id="radius-card" value="${t.radiusCard}" style="width:100%;"></div>
          <div class="field"><label>Button corner roundness: <span id="rb-val">${t.radiusButton}</span>px</label><input type="range" min="0" max="32" id="radius-btn" value="${t.radiusButton}" style="width:100%;"></div>
        </div>
      </div>
      <div class="save-bar"><button class="btn primary" id="theme-save">Save theme</button><a class="btn" href="/" target="_blank" rel="noopener">Preview site</a></div>`;

    c.querySelectorAll('[data-preset]').forEach((el) =>
      el.addEventListener('click', () => {
        t.preset = el.getAttribute('data-preset');
        t.vars = {};
        render();
      })
    );
    c.querySelectorAll('[data-var]').forEach((el) =>
      el.addEventListener('input', () => {
        t.vars[el.getAttribute('data-var')] = el.value.toUpperCase();
        const twin = c.querySelector(`[data-var-text="${el.getAttribute('data-var')}"]`);
        if (twin) twin.value = el.value.toUpperCase();
        checkContrast();
      })
    );
    c.querySelectorAll('[data-var-text]').forEach((el) =>
      el.addEventListener('change', () => {
        if (/^#[0-9a-f]{6}$/i.test(el.value)) {
          t.vars[el.getAttribute('data-var-text')] = el.value.toUpperCase();
          const twin = c.querySelector(`[data-var="${el.getAttribute('data-var-text')}"]`);
          if (twin) twin.value = el.value;
          checkContrast();
        } else {
          toast('Enter a colour like #E8672B', 'err');
        }
      })
    );
    document.getElementById('font-head').addEventListener('change', (e) => (t.fontHeading = e.target.value));
    document.getElementById('font-body').addEventListener('change', (e) => (t.fontBody = e.target.value));
    document.getElementById('radius-card').addEventListener('input', (e) => { t.radiusCard = +e.target.value; document.getElementById('rc-val').textContent = e.target.value; });
    document.getElementById('radius-btn').addEventListener('input', (e) => { t.radiusButton = +e.target.value; document.getElementById('rb-val').textContent = e.target.value; });
    document.getElementById('theme-save').addEventListener('click', async () => {
      try {
        const r = await api('PUT', '/settings/theme', t);
        toast('Theme saved — refresh the live site to see it.', 'ok');
        if (r.warnings && r.warnings.length) toast(r.warnings.join(' '), 'err');
      } catch (e) {
        toast(errText(e), 'err');
      }
    });
    checkContrast();
  }
  function checkContrast() {
    // client-side heads-up only; the server has the authoritative check on save
    const vars = currentVars();
    const box = document.getElementById('contrast-warn');
    if (!box) return;
    const l = (hex) => {
      const n = parseInt(hex.slice(1), 16),
        cs = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ((v /= 255), v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
      return 0.2126 * cs[0] + 0.7152 * cs[1] + 0.0722 * cs[2];
    };
    const ratio = (a, b) => {
      const [x, y] = [l(a), l(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    box.innerHTML = ratio(vars['--text'], vars['--bg']) < 4.5 ? `<div class="banner warn">Main text may be hard to read on this background — consider a darker text colour or lighter background.</div>` : '';
  }
  render();
}

// ================================================================
//  SITE SETTINGS
// ================================================================
async function viewSite() {
  const c = shell('site', `<div class="muted">Loading…</div>`);
  let s;
  try {
    s = await api('GET', '/settings');
  } catch (e) {
    c.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
    return;
  }
  const site = { ...s.site };
  function render() {
    c.innerHTML = `
      <div class="card">
        <h2>Business details</h2>
        <div class="row">
          <div class="field"><label>Business name</label><input class="input" id="s-name" value="${attr(site.name)}"></div>
          <div class="field"><label>Live website address</label><input class="input" id="s-url" value="${attr(site.url)}" placeholder="https://shaktiew.in"></div>
        </div>
        <div class="row">
          <div class="field"><label>Phone (shown on site)</label><input class="input" id="s-phone" value="${attr(site.phone)}"></div>
          <div class="field"><label>WhatsApp number</label><input class="input" id="s-wa" value="${attr(site.whatsapp)}" placeholder="digits with country code, e.g. 919876543210"></div>
        </div>
        <div class="row">
          <div class="field"><label>Contact email</label><input class="input" id="s-email" value="${attr(site.email)}"></div>
          <div class="field"><label>Address</label><input class="input" id="s-address" value="${attr(site.address)}"></div>
        </div>
      </div>
      <div class="card">
        <h2>Social links</h2>
        <div class="desc">Leave blank to hide the icon in the footer.</div>
        <div class="row">
          <div class="field"><label>Facebook URL</label><input class="input" id="s-fb" value="${attr(site.facebook)}"></div>
          <div class="field"><label>Instagram URL</label><input class="input" id="s-ig" value="${attr(site.instagram)}"></div>
        </div>
      </div>
      <div class="card">
        <h2>Branding</h2>
        <div class="row">
          <div class="field"><label>Favicon</label><div class="img-preview"><img src="${site.favicon ? '/' + attr(site.favicon) : '/images/logo-shakti.png'}" onerror="this.style.visibility='hidden'"><button class="btn small" id="pick-fav" type="button">Choose</button></div></div>
          <div class="field"><label>Default social-share image</label><div class="img-preview"><img src="${site.ogImage ? '/' + attr(site.ogImage) : ''}" style="${site.ogImage ? '' : 'visibility:hidden'}"><button class="btn small" id="pick-og" type="button">Choose</button></div></div>
        </div>
      </div>
      <div class="save-bar"><button class="btn primary" id="site-save">Save settings</button></div>`;
    document.getElementById('pick-fav').addEventListener('click', () => openMediaPicker('image', (m) => { site.favicon = m.url; render(); }));
    document.getElementById('pick-og').addEventListener('click', () => openMediaPicker('image', (m) => { site.ogImage = m.url; render(); }));
    document.getElementById('site-save').addEventListener('click', async () => {
      const body = {
        name: document.getElementById('s-name').value.trim(),
        url: document.getElementById('s-url').value.trim(),
        phone: document.getElementById('s-phone').value.trim(),
        whatsapp: document.getElementById('s-wa').value.trim(),
        email: document.getElementById('s-email').value.trim(),
        address: document.getElementById('s-address').value.trim(),
        facebook: document.getElementById('s-fb').value.trim(),
        instagram: document.getElementById('s-ig').value.trim(),
        favicon: site.favicon || '',
        ogImage: site.ogImage || '',
      };
      try {
        await api('PUT', '/settings/site', body);
        toast('Saved.', 'ok');
      } catch (e) {
        toast(errText(e), 'err');
      }
    });
  }
  render();
}

// ================================================================
//  EMAIL NOTIFICATIONS (SMTP)
// ================================================================
async function viewEmail() {
  const c = shell('email', `<div class="muted">Loading…</div>`);
  let s;
  try {
    s = await api('GET', '/settings/smtp');
  } catch (e) {
    c.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
    return;
  }
  c.innerHTML = `
    <div class="banner" style="background:var(--panel-2);color:var(--text-dim);">When someone submits the contact form, we can email your team automatically. Every enquiry is also saved under <a href="#leads">Enquiries</a> even if email isn't set up.</div>
    <div class="card">
      <h2>Notify by email</h2>
      <label class="check"><input type="checkbox" id="e-on" ${s.emailOnSubmit ? 'checked' : ''}> Email us when the contact form is submitted</label>
      <div class="field" style="margin-top:12px;"><label>Send notifications to</label><input class="input" id="e-to" value="${attr(s.notifyTo)}" placeholder="defaults to your contact email"></div>
    </div>
    <div class="card">
      <h2>Outgoing mail server (SMTP)</h2>
      <div class="desc">On Hostinger: create a mailbox in hPanel → Emails, then use host <span class="mono">smtp.hostinger.com</span>, port <span class="mono">465</span> with SSL on (or port <span class="mono">587</span> with SSL off), and that mailbox's address and password.</div>
      <div class="row">
        <div class="field"><label>SMTP host</label><input class="input" id="e-host" value="${attr(s.host)}" placeholder="smtp.hostinger.com"></div>
        <div class="field" style="max-width:140px;"><label>Port</label><input class="input" id="e-port" type="number" value="${s.port}"></div>
        <div class="field" style="max-width:160px;"><label>&nbsp;</label><label class="check"><input type="checkbox" id="e-secure" ${s.secure ? 'checked' : ''}> Use SSL</label></div>
      </div>
      <div class="row">
        <div class="field"><label>Username (usually the mailbox address)</label><input class="input" id="e-user" value="${attr(s.user)}" autocomplete="off"></div>
        <div class="field"><label>Password ${s.hasPassword ? `<span class="muted">(saved, ${esc(s.passHint)})</span>` : ''}</label><input class="input" id="e-pass" type="password" placeholder="${s.hasPassword ? 'Leave blank to keep the saved password' : ''}" autocomplete="new-password"></div>
      </div>
      <div class="field"><label>From address</label><input class="input" id="e-from" value="${attr(s.from)}" placeholder='e.g. "Shakti Website" <notify@shaktiew.in>'></div>
      <div class="row" style="align-items:center;">
        <button class="btn" id="e-test" type="button">Send test email</button>
        <button class="btn ghost danger" id="e-clear" type="button" style="${s.hasPassword ? '' : 'display:none;'}">Remove saved password</button>
        <span class="muted" id="e-test-status"></span>
      </div>
    </div>
    <div class="save-bar"><button class="btn primary" id="e-save">Save</button></div>`;
  function fields() {
    return {
      host: document.getElementById('e-host').value.trim(),
      port: +document.getElementById('e-port').value,
      secure: document.getElementById('e-secure').checked,
      user: document.getElementById('e-user').value.trim(),
      password: document.getElementById('e-pass').value,
      from: document.getElementById('e-from').value.trim(),
    };
  }
  document.getElementById('e-test').addEventListener('click', async () => {
    const status = document.getElementById('e-test-status');
    status.textContent = 'Sending…';
    try {
      const r = await api('POST', '/settings/smtp/test', fields());
      status.textContent = 'Sent to ' + r.sentTo + ' — check that inbox (and spam folder).';
    } catch (e) {
      status.textContent = '';
      toast(errText(e), 'err');
    }
  });
  document.getElementById('e-clear').addEventListener('click', async () => {
    if (!confirm('Remove the saved SMTP password?')) return;
    try {
      await api('PUT', '/settings/smtp', { clearPassword: true });
      toast('Removed.', 'ok');
      viewEmail();
    } catch (e) {
      toast(errText(e), 'err');
    }
  });
  document.getElementById('e-save').addEventListener('click', async () => {
    try {
      await api('PUT', '/settings/smtp', { ...fields(), emailOnSubmit: document.getElementById('e-on').checked, notifyTo: document.getElementById('e-to').value.trim() });
      toast('Saved.', 'ok');
      viewEmail();
    } catch (e) {
      toast(errText(e), 'err');
    }
  });
}

// ================================================================
//  AI & CHATBOT (Gemini)
// ================================================================
async function viewAi() {
  const c = shell('ai', `<div class="muted">Loading…</div>`);
  let s;
  try {
    s = await api('GET', '/ai/settings');
  } catch (e) {
    c.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
    return;
  }
  c.innerHTML = `
    <div class="card">
      <h2>Gemini API key</h2>
      <div class="desc">Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. It's stored encrypted on the server and never shown again after saving.</div>
      ${s.hasKey ? `<div class="banner ok">Key saved (${esc(s.keyHint)}).</div>` : `<div class="banner warn">No key saved yet — the chatbot and AI blog writer are disabled.</div>`}
      <div class="row" style="align-items:end;">
        <div class="field" style="flex:2;"><label>${s.hasKey ? 'Replace API key' : 'API key'}</label><input class="input mono" id="a-key" type="password" placeholder="AIza…" autocomplete="off"></div>
        <div class="field"><button class="btn" id="a-test" type="button">Test connection</button></div>
      </div>
      <div id="a-test-result"></div>
      ${s.hasKey ? `<button class="btn ghost danger" id="a-clear-key" type="button">Remove saved key</button>` : ''}
      <div class="field" style="margin-top:14px;"><label>Model</label><select class="input" id="a-model"><option value="${attr(s.model)}" selected>${esc(s.model)}</option></select><div class="hint">Click "Test connection" to list the models your key can use.</div></div>
    </div>
    <div class="card">
      <h2>Website chatbot</h2>
      <label class="check"><input type="checkbox" id="a-chat-on" ${s.chatEnabled ? 'checked' : ''}> Enable the AI chatbot on the website</label>
      <div class="row" style="margin-top:12px;">
        <div class="field"><label>Assistant name</label><input class="input" id="a-name" value="${attr(s.chatName)}"></div>
      </div>
      <div class="field"><label>Greeting message</label><input class="input" id="a-greet" value="${attr(s.greeting)}"></div>
      <div class="field"><label>Extra instructions (optional)</label><textarea class="input" id="a-instr" rows="2" placeholder="e.g. always mention our 20-year warranty">${esc(s.chatInstructions)}</textarea></div>
      <div class="field"><label>Extra knowledge the bot should know (optional)</label><textarea class="input" id="a-know" rows="4" placeholder="FAQs, policies, delivery times… one point per line">${esc(s.knowledge)}</textarea></div>
      <label class="check"><input type="checkbox" id="a-usesite" ${s.useSiteText ? 'checked' : ''}> Let it read the website's own text (products, process, about) to answer questions</label>
      <div class="field" style="margin-top:12px;max-width:200px;"><label>Daily reply limit</label><input class="input" type="number" id="a-limit" value="${s.dailyLimit}"><div class="hint">Stops runaway API costs. 0 = unlimited.</div></div>
    </div>
    <div class="card">
      <h2>AI blog writer defaults</h2>
      <div class="row">
        <div class="field"><label>Default tone</label><input class="input" id="a-tone" value="${attr(s.blogTone)}"></div>
        <div class="field"><label>Language</label><input class="input" id="a-lang" value="${attr(s.blogLanguage)}"></div>
      </div>
    </div>
    <div class="save-bar"><button class="btn primary" id="a-save">Save AI settings</button></div>`;

  document.getElementById('a-test').addEventListener('click', async () => {
    const box = document.getElementById('a-test-result');
    box.innerHTML = `<div class="muted">Testing…</div>`;
    try {
      const r = await api('POST', '/ai/test', { apiKey: document.getElementById('a-key').value.trim() || undefined, model: document.getElementById('a-model').value });
      const sel = document.getElementById('a-model');
      sel.innerHTML = r.models.map((m) => `<option value="${attr(m.id)}"${m.id === r.model ? ' selected' : ''}>${esc(m.label)} (${esc(m.id)})</option>`).join('') || `<option>${esc(r.model)}</option>`;
      box.innerHTML = r.modelOk ? `<div class="banner ok">Connected — the key works and "${esc(r.model)}" replied: "${esc(r.sample)}"</div>` : `<div class="banner warn">Key is valid, but that model didn't respond as expected: ${esc(r.sample)}. Try a different model above.</div>`;
    } catch (e) {
      box.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
    }
  });
  const clearKey = document.getElementById('a-clear-key');
  if (clearKey)
    clearKey.addEventListener('click', async () => {
      if (!confirm('Remove the saved Gemini key? The chatbot and AI blog writer will stop working.')) return;
      try {
        await api('PUT', '/ai/settings', { clearKey: true });
        toast('Removed.', 'ok');
        viewAi();
      } catch (e) {
        toast(errText(e), 'err');
      }
    });
  document.getElementById('a-save').addEventListener('click', async () => {
    const key = document.getElementById('a-key').value.trim();
    try {
      await api('PUT', '/ai/settings', {
        apiKey: key || undefined,
        model: document.getElementById('a-model').value,
        chatEnabled: document.getElementById('a-chat-on').checked,
        chatName: document.getElementById('a-name').value.trim(),
        greeting: document.getElementById('a-greet').value.trim(),
        chatInstructions: document.getElementById('a-instr').value.trim(),
        knowledge: document.getElementById('a-know').value.trim(),
        useSiteText: document.getElementById('a-usesite').checked,
        dailyLimit: +document.getElementById('a-limit').value,
        blogTone: document.getElementById('a-tone').value.trim(),
        blogLanguage: document.getElementById('a-lang').value.trim(),
      });
      toast('Saved.', 'ok');
      viewAi();
    } catch (e) {
      toast(errText(e), 'err');
    }
  });
}

// ================================================================
//  LEADS / ENQUIRIES
// ================================================================
async function viewLeads() {
  const c = shell('leads', `<div class="muted">Loading…</div>`);
  let page = 1;
  async function render() {
    let d;
    try {
      d = await api('GET', `/submissions?page=${page}&size=25`);
    } catch (e) {
      c.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
      return;
    }
    const pages = Math.max(1, Math.ceil(d.total / d.size));
    c.innerHTML = `
      <div class="toolbar"><span class="muted">${d.total} enquir${d.total === 1 ? 'y' : 'ies'} &middot; ${d.unread} unread</span><div class="spacer"></div><a class="btn" href="/api/submissions.csv" target="_blank">Export CSV</a></div>
      ${d.items.length ? `<table class="list"><thead><tr><th></th><th>Name</th><th>Phone</th><th>Email</th><th>Message</th><th>Received</th><th></th></tr></thead><tbody>
        ${d.items
          .map(
            (s) => `<tr data-id="${s.id}" style="${s.read ? '' : 'font-weight:700;'}"><td>${s.read ? '' : '<span class="pill" style="background:var(--accent);color:#fff;">new</span>'}</td><td>${esc(s.name)}</td><td><a href="tel:${attr(s.phone)}">${esc(s.phone)}</a></td><td>${s.email ? `<a href="mailto:${attr(s.email)}">${esc(s.email)}</a>` : '—'}</td><td style="max-width:280px;white-space:pre-wrap;font-weight:400;">${esc(s.message || '—')}</td><td style="white-space:nowrap;font-weight:400;color:var(--text-dimmer);">${fmtDateTime(s.at)}</td><td><button class="icon-btn" data-toggle="${s.id}" data-read="${s.read}" title="${s.read ? 'Mark unread' : 'Mark read'}">${s.read ? '&#9711;' : '&#10003;'}</button><button class="icon-btn" data-del="${s.id}" title="Delete">&#128465;</button></td></tr>`
          )
          .join('')}
      </tbody></table>` : `<div class="empty">No enquiries yet.</div>`}
      ${pages > 1 ? `<div class="toolbar" style="margin-top:14px;"><button class="btn small" id="p-prev" ${page <= 1 ? 'disabled' : ''}>&larr; Prev</button><span class="muted">Page ${page} of ${pages}</span><button class="btn small" id="p-next" ${page >= pages ? 'disabled' : ''}>Next &rarr;</button></div>` : ''}
    `;
    c.querySelectorAll('[data-toggle]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          await api('PATCH', '/submissions/' + btn.getAttribute('data-toggle'), { read: btn.getAttribute('data-read') !== 'true' });
          render();
        } catch (e) {
          toast(errText(e), 'err');
        }
      })
    );
    c.querySelectorAll('[data-del]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this enquiry?')) return;
        try {
          await api('DELETE', '/submissions/' + btn.getAttribute('data-del'));
          render();
        } catch (e) {
          toast(errText(e), 'err');
        }
      })
    );
    const prev = document.getElementById('p-prev');
    if (prev) prev.addEventListener('click', () => { page--; render(); });
    const next = document.getElementById('p-next');
    if (next) next.addEventListener('click', () => { page++; render(); });
  }
  render();
}

// ================================================================
//  USERS (admin)
// ================================================================
async function viewUsers() {
  const c = shell('users', `<div class="muted">Loading…</div>`);
  let list;
  try {
    list = await api('GET', '/users');
  } catch (e) {
    c.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
    return;
  }
  c.innerHTML = `
    <div class="toolbar"><button class="btn primary" id="new-user">+ Add user</button></div>
    <table class="list"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>
      ${list.map((u) => `<tr><td>${esc(u.name)}${u.id === state.user.id ? ' <span class="muted">(you)</span>' : ''}</td><td>${esc(u.email)}</td><td><span class="pill ${u.role}">${u.role}</span></td><td>${u.disabled ? '<span class="pill disabled">disabled</span>' : '<span class="pill published">active</span>'}</td><td>${fmtDateTime(u.lastLogin)}</td><td><button class="icon-btn" data-edit="${u.id}">&#9998;</button>${u.id === state.user.id ? '' : `<button class="icon-btn" data-del="${u.id}">&#128465;</button>`}</td></tr>`).join('')}
    </tbody></table>`;
  document.getElementById('new-user').addEventListener('click', () => openUserModal(null));
  c.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openUserModal(list.find((u) => u.id === b.getAttribute('data-edit')))));
  c.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const u = list.find((x) => x.id === b.getAttribute('data-del'));
      if (!confirm(`Delete the user "${u.email}"? This cannot be undone.`)) return;
      try {
        await api('DELETE', '/users/' + u.id);
        toast('Deleted.', 'ok');
        viewUsers();
      } catch (e) {
        toast(errText(e), 'err');
      }
    })
  );
}
function openUserModal(u) {
  const isNew = !u;
  openModal(`
    <div class="mhead"><h2>${isNew ? 'Add user' : 'Edit ' + esc(u.email)}</h2><button class="icon-btn" id="u-close">&#10005;</button></div>
    <div id="u-err"></div>
    ${isNew ? `<div class="field"><label>Email</label><input class="input" id="u-email" type="email"></div>` : ''}
    <div class="field"><label>Name</label><input class="input" id="u-name" value="${attr(u ? u.name : '')}"></div>
    <div class="field"><label>Role</label><select class="input" id="u-role"><option value="editor"${!u || u.role === 'editor' ? ' selected' : ''}>Editor — can edit content, blog, media, pages</option><option value="admin"${u && u.role === 'admin' ? ' selected' : ''}>Admin — full access incl. theme, settings, users</option></select></div>
    <div class="field"><label>${isNew ? 'Password' : 'New password (leave blank to keep current)'}</label><input class="input" id="u-pass" type="password" autocomplete="new-password"></div>
    ${!isNew ? `<label class="check"><input type="checkbox" id="u-disabled" ${u.disabled ? 'checked' : ''}> Account disabled (cannot sign in)</label>` : ''}
    <button class="btn primary" id="u-save" style="width:100%;margin-top:14px;justify-content:center;">${isNew ? 'Create user' : 'Save changes'}</button>
  `);
  document.getElementById('u-close').addEventListener('click', closeModal);
  document.getElementById('u-save').addEventListener('click', async () => {
    const box = document.getElementById('u-err');
    box.innerHTML = '';
    const body = { name: document.getElementById('u-name').value.trim(), role: document.getElementById('u-role').value };
    const pass = document.getElementById('u-pass').value;
    if (pass) body.password = pass;
    try {
      if (isNew) {
        body.email = document.getElementById('u-email').value.trim();
        if (!pass) throw new Error('Set a password for the new user.');
        await api('POST', '/users', body);
      } else {
        body.disabled = document.getElementById('u-disabled').checked;
        await api('PATCH', '/users/' + u.id, body);
      }
      closeModal();
      toast('Saved.', 'ok');
      viewUsers();
    } catch (e) {
      box.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
    }
  });
}

// ================================================================
//  BACKUP (admin)
// ================================================================
function viewBackup() {
  const c = shell('backup', '');
  c.innerHTML = `
    <div class="card">
      <h2>Download a backup</h2>
      <div class="desc">A JSON file with all your content, pages, blog posts, settings and users (passwords stay hashed, API keys are not included). Uploaded images/PDFs are not included — back those up separately from the Media library or your hosting file manager.</div>
      <a class="btn primary" href="/api/backup" target="_blank">Download backup.json</a>
    </div>`;
}

// ================================================================
//  MY ACCOUNT
// ================================================================
function viewAccount() {
  const c = shell('account', '');
  c.innerHTML = `
    <div class="card">
      <h2>${esc(state.user.name)}</h2>
      <div class="desc">${esc(state.user.email)} &middot; ${state.user.role}</div>
    </div>
    <div class="card">
      <h2>Change password</h2>
      <div id="pw-err"></div>
      <div class="field"><label>Current password</label><input class="input" type="password" id="pw-cur" autocomplete="current-password"></div>
      <div class="field"><label>New password</label><input class="input" type="password" id="pw-new" autocomplete="new-password"><div class="hint">At least 10 characters, with letters and numbers.</div></div>
      <button class="btn primary" id="pw-save">Update password</button>
    </div>`;
  document.getElementById('pw-save').addEventListener('click', async () => {
    const box = document.getElementById('pw-err');
    box.innerHTML = '';
    try {
      await api('POST', '/auth/password', { current: document.getElementById('pw-cur').value, next: document.getElementById('pw-new').value });
      toast('Password updated.', 'ok');
      document.getElementById('pw-cur').value = '';
      document.getElementById('pw-new').value = '';
    } catch (e) {
      box.innerHTML = `<div class="banner err">${esc(errText(e))}</div>`;
    }
  });
}
