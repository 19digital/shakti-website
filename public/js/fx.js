/* Shakti Engineering Works — immersive motion layer (progressive enhancement).
   Cursor, touch and device-tilt driven parallax / 3D. Skipped entirely for prefers-reduced-motion and the dashboard preview. */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement, body = doc.body;
  if (!body || window.__shaktiFx || body.hasAttribute('data-cms-edit')) return;
  window.__shaktiFx = true;

  var mq = function (q) { return window.matchMedia ? window.matchMedia(q).matches : false; };
  if (mq('(prefers-reduced-motion: reduce)')) return;

  var FINE = mq('(hover: hover) and (pointer: fine)');
  var conn = navigator.connection || {};
  var LOW = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) || (navigator.deviceMemory && navigator.deviceMemory <= 2) || !!conn.saveData;
  var vw = window.innerWidth, vh = window.innerHeight;
  var TAU = Math.PI * 2;

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var el = function (tag, cls) { var n = doc.createElement(tag); if (cls) n.className = cls; return n; };
  // custom-property writes that skip no-ops, so an idle frame does not invalidate styles for nothing
  var setVar = function (node, k, v) { var c = node.__v || (node.__v = {}); if (c[k] === v) return; c[k] = v; node.style.setProperty(k, v); };
  var safe = function (fn) { try { fn(); } catch (e) { if (window.console) console.warn('[fx]', e); } };
  var hasIO = 'IntersectionObserver' in window;

  /* ---------------------------------------------------------------- state */
  var ptr = { x: vw / 2, y: vh / 2, nx: 0, ny: 0, seen: false, type: 'mouse' };
  var sm = { nx: 0, ny: 0 };
  var gyro = { x: 0, y: 0, on: false };
  var scrollDirty = true, lastY = -1;
  var raf = 0, lastT = 0;
  var frameFns = [];   // each returns true while it still needs frames

  function wake() { if (!raf && !doc.hidden) raf = requestAnimationFrame(frame); }
  function frame(t) {
    raf = 0;
    var dt = clamp(t - (lastT || t), 0, 48) / 16.667;
    lastT = t;
    var more = false;
    sm.nx = lerp(sm.nx, ptr.nx, 0.08);
    sm.ny = lerp(sm.ny, ptr.ny, 0.08);
    if (Math.abs(sm.nx - ptr.nx) > 0.002 || Math.abs(sm.ny - ptr.ny) > 0.002) more = true;
    for (var i = 0; i < frameFns.length; i++) { if (frameFns[i](t, dt)) more = true; }
    if (more) raf = requestAnimationFrame(frame); else lastT = 0;
  }

  /* ---------------------------------------------------------------- input */
  window.addEventListener('pointermove', function (e) {
    ptr.x = e.clientX; ptr.y = e.clientY;
    ptr.nx = e.clientX / vw * 2 - 1; ptr.ny = e.clientY / vh * 2 - 1;
    ptr.type = e.pointerType || 'mouse'; ptr.seen = true; ptr.t = performance.now();
    wake();
  }, { passive: true });
  window.addEventListener('scroll', function () { scrollDirty = true; wake(); }, { passive: true });
  window.addEventListener('resize', function () { vw = window.innerWidth; vh = window.innerHeight; scrollDirty = true; wake(); }, { passive: true });
  doc.addEventListener('visibilitychange', function () { if (!doc.hidden) wake(); });

  // Android / non-prompting browsers: let device tilt steer the hero when there is no mouse.
  if (!FINE && 'DeviceOrientationEvent' in window && typeof window.DeviceOrientationEvent.requestPermission !== 'function') {
    window.addEventListener('deviceorientation', function (e) {
      if (e.gamma == null || e.beta == null) return;
      gyro.on = true;
      gyro.x = clamp(e.gamma / 28, -1, 1);
      gyro.y = clamp((e.beta - 50) / 28, -1, 1);
      wake();
    }, { passive: true });
  }

  /* --------------------------------------------------------- scroll bits */
  var bar, nav, docH = 1;
  function initScrollBits() {
    bar = el('div', 'fx-progress'); bar.setAttribute('aria-hidden', 'true'); body.appendChild(bar);
    nav = $('.site-nav-row');
  }
  function scrollTick() {
    var y = window.pageYOffset || 0;
    docH = Math.max(1, root.scrollHeight - vh);
    if (bar) bar.style.transform = 'scaleX(' + clamp(y / docH, 0, 1).toFixed(4) + ')';
    if (nav) nav.classList.toggle('fx-stuck', y > 6);
  }

  /* ---------------------------------------------------------------- cursor */
  function initCursor() {
    if (!FINE) return;
    var ring = el('div', 'fx-ring'), dot = el('div', 'fx-dot');
    ring.setAttribute('aria-hidden', 'true'); dot.setAttribute('aria-hidden', 'true');
    body.appendChild(ring); body.appendChild(dot);
    var c = { x: -100, y: -100, s: 1, ts: 1, shown: false, down: false };
    var interactive = 'a,button,[role="button"],summary,label,.card,select';

    function setTarget(t) {
      if (!t || !t.closest) return;
      var text = t.closest('input,textarea,[contenteditable="true"]');
      var link = !text && t.closest(interactive);
      ring.classList.toggle('is-text', !!text); dot.classList.toggle('is-text', !!text);
      ring.classList.toggle('is-link', !!link);
      c.ts = link ? 1.7 : 1;
    }
    doc.addEventListener('pointerover', function (e) { if (e.pointerType === 'mouse') setTarget(e.target); }, true);
    doc.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      if (!c.shown) { c.shown = true; c.x = e.clientX; c.y = e.clientY; ring.classList.add('on'); dot.classList.add('on'); }
    }, { passive: true });
    doc.addEventListener('pointerdown', function (e) { if (e.pointerType === 'mouse') { c.down = true; wake(); } }, true);
    doc.addEventListener('pointerup', function () { c.down = false; wake(); }, true);
    doc.documentElement.addEventListener('mouseleave', function () { ring.classList.remove('on'); dot.classList.remove('on'); c.shown = false; });

    frameFns.push(function () {
      if (!c.shown) return false;
      c.x = lerp(c.x, ptr.x, 0.2); c.y = lerp(c.y, ptr.y, 0.2);
      var target = c.ts * (c.down ? 0.72 : 1);
      c.s = lerp(c.s, target, 0.2);
      ring.style.transform = 'translate3d(' + c.x.toFixed(1) + 'px,' + c.y.toFixed(1) + 'px,0) scale(' + c.s.toFixed(3) + ')';
      dot.style.transform = 'translate3d(' + ptr.x.toFixed(1) + 'px,' + ptr.y.toFixed(1) + 'px,0)';
      return Math.abs(c.x - ptr.x) > 0.3 || Math.abs(c.y - ptr.y) > 0.3 || Math.abs(c.s - target) > 0.01;
    });
  }

  /* ------------------------------------------------------------- nav pill */
  function initNavPill() {
    var wrap = $('.nav-links');
    if (!wrap) return;
    var pill = el('span', 'fx-pill'); pill.setAttribute('aria-hidden', 'true'); wrap.appendChild(pill);
    var to = 0;
    function show(a) {
      clearTimeout(to);
      pill.style.width = a.offsetWidth + 'px';
      pill.style.transform = 'translateX(' + a.offsetLeft + 'px)';
      pill.classList.add('on');
    }
    function rest() { pill.classList.remove('on'); }
    wrap.addEventListener('pointerover', function (e) { var a = e.target.closest && e.target.closest('.navlink'); if (a) show(a); });
    wrap.addEventListener('pointerleave', function () { to = setTimeout(rest, 120); });
  }

  /* ------------------------------------------------------- magnetic buttons */
  function initMagnets() {
    if (!FINE) return;
    $$('.btn-primary,.btn-ghost,.cw-btn,.qc-btn,.social-btn').forEach(function (b) {
      var box = null;
      b.addEventListener('pointerenter', function () { box = b.getBoundingClientRect(); });
      b.addEventListener('pointermove', function (e) {
        if (!box) box = b.getBoundingClientRect();
        var dx = e.clientX - (box.left + box.width / 2), dy = e.clientY - (box.top + box.height / 2);
        b.style.setProperty('--bx', clamp(dx * 0.3, -9, 9).toFixed(1) + 'px');
        b.style.setProperty('--by', clamp(dy * 0.38, -7, 7).toFixed(1) + 'px');
      });
      b.addEventListener('pointerleave', function () { box = null; b.style.setProperty('--bx', '0px'); b.style.setProperty('--by', '0px'); });
    });
  }

  /* ------------------------------------------------------------------ hero */
  var hero = null, hs = { px: 0, py: 0, tx: 0, ty: 0, visible: true, inside: false };
  var scene = null, grains = null;

  function initHero() {
    hero = $('.grid-lines');
    if (!hero) return;
    hero.classList.add('fx-hero', 'fx-host');

    // depth layers: text drifts against the cursor at different speeds
    var seen = [];
    function depth(node, d) { if (node && seen.indexOf(node) < 0) { seen.push(node); node.classList.add('fx-depth'); node.style.setProperty('--d', d); } }
    depth($('.chip', hero), 5);
    depth($('#greeting-text', hero), 7);
    depth($('h1', hero), 13);
    depth($('h1 ~ p', hero) || $('p', hero), 8);
    var cta = $('.btn-primary', hero);
    if (cta) { depth(cta.parentElement, 10); depth(cta.parentElement.nextElementSibling, 5); }

    // the hero image becomes a 3D scene with floating layers
    var s = $('.reveal-right', hero);
    if (s && s.children.length >= 1 && $('img', s)) {
      scene = s;
      scene.classList.add('fx-scene');
      var media = s.children[0], badge = s.children[1];
      media.classList.add('fx-media');
      if (badge) badge.classList.add('fx-badge');
      var glare = el('span', 'fx-glare'); glare.setAttribute('aria-hidden', 'true'); media.appendChild(glare);
      ['fx-halo', 'fx-orbit', 'fx-orbit b'].forEach(function (cls, i) {
        var n = el('div', cls); n.setAttribute('aria-hidden', 'true'); s.insertBefore(n, s.firstChild);
      });
      var tries = 0, iv = setInterval(function () {
        tries++;
        if (scene.classList.contains('reveal-in') && +getComputedStyle(scene).opacity > 0.99) { scene.classList.add('fx-live'); clearInterval(iv); wake(); }
        else if (tries > 40) clearInterval(iv);
      }, 250);
    }

    if (hasIO) new IntersectionObserver(function (en) { hs.visible = en[0].isIntersecting; if (hs.visible) wake(); }, { rootMargin: '80px' }).observe(hero);

    hero.addEventListener('pointerdown', function (e) {
      if (!grains) return;
      var r = hero.getBoundingClientRect();
      grains.burst(e.clientX - r.left, e.clientY - r.top);
      wake();
    });

    safe(initGrains);
    frameFns.push(heroFrame);
  }

  function heroFrame(t, dt) {
    if (!hero || !hs.visible) return false;
    var r = hero.getBoundingClientRect();
    var inside = ptr.seen && ptr.type !== 'touch' && ptr.x >= r.left && ptr.x <= r.right && ptr.y >= r.top && ptr.y <= r.bottom;
    var fresh = ptr.type !== 'touch' || t - ptr.t < 1200;
    var live = ptr.seen && fresh && ptr.x >= r.left && ptr.x <= r.right && ptr.y >= r.top && ptr.y <= r.bottom;
    var tx = 0, ty = 0;
    if (live) { tx = (ptr.x - r.left) / r.width * 2 - 1; ty = (ptr.y - r.top) / r.height * 2 - 1; }
    else if (gyro.on) { tx = gyro.x; ty = gyro.y; }
    // idle sway keeps the scene alive when nobody is steering it
    var idle = !live && !gyro.on && !LOW;
    var sx = tx + (idle ? Math.sin(t / 2600) * 0.2 : 0), sy = ty + (idle ? Math.cos(t / 3200) * 0.14 : 0);
    var k = 1 - Math.pow(1 - 0.08, dt);
    hs.px = lerp(hs.px, sx, k); hs.py = lerp(hs.py, sy, k);
    hs.tx = lerp(hs.tx, tx, k); hs.ty = lerp(hs.ty, ty, k);

    setVar(hero, '--px', hs.px.toFixed(3)); setVar(hero, '--py', hs.py.toFixed(3));
    setVar(hero, '--tx', hs.tx.toFixed(3)); setVar(hero, '--ty', hs.ty.toFixed(3));
    if (live) { setVar(hero, '--mx', (ptr.x - r.left).toFixed(0) + 'px'); setVar(hero, '--my', (ptr.y - r.top).toFixed(0) + 'px'); }
    if (inside !== hs.inside) { hs.inside = inside; hero.classList.toggle('fx-hot', inside); }

    if (scene && scene.classList.contains('fx-live')) {
      setVar(scene, '--rx', (-hs.py * 9).toFixed(2) + 'deg');
      setVar(scene, '--ry', (hs.px * 13).toFixed(2) + 'deg');
      setVar(scene, '--gx', (50 + hs.px * 45).toFixed(1) + '%');
      setVar(scene, '--gy', (35 + hs.py * 45).toFixed(1) + '%');
    }
    if (grains) grains.draw(t, dt, r, live);
    return true;
  }

  /* ----------------------------------------------- floating "rice grain" field */
  function initGrains() {
    if (LOW) return;
    var cv = el('canvas', 'fx-layer fx-canvas'); cv.setAttribute('aria-hidden', 'true');
    hero.insertBefore(cv, hero.firstChild);
    var ctx = cv.getContext('2d');
    if (!ctx) return;
    var W = 0, H = 0, ps = [], ripples = [], colors = ['#E8672B', '#0E8E7E', '#8A897E'];

    function readColors() {
      var cs = getComputedStyle(root);
      var a = cs.getPropertyValue('--accent').trim(), b = cs.getPropertyValue('--teal').trim(), c = cs.getPropertyValue('--text-dimmer').trim();
      colors = [a || colors[0], b || colors[1], c || colors[2]];
    }
    function make(randomY) {
      var z = 0.25 + Math.random() * 0.75;
      return {
        x: Math.random() * W, y: randomY ? Math.random() * H : H + 20, z: z,
        len: (6 + Math.random() * 7) * (0.55 + z * 0.75), wid: (2.2 + Math.random() * 1.6) * (0.55 + z * 0.65),
        a: Math.random() * TAU, va: (Math.random() - 0.5) * 0.012, ph: Math.random() * TAU,
        vy: -(0.05 + Math.random() * 0.16) * (0.5 + z), ix: 0, iy: 0, c: (Math.random() * 3) | 0
      };
    }
    function resize() {
      var r = hero.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.round(clamp(W * H / 15000, 14, vw < 700 ? 26 : 66));
      ps = []; for (var i = 0; i < n; i++) ps.push(make(true));
      readColors();
    }
    resize();
    if ('ResizeObserver' in window) new ResizeObserver(function () { safe(resize); }).observe(hero);
    else window.addEventListener('resize', resize);

    grains = {
      burst: function (x, y) {
        ripples.push({ x: x, y: y, r: 6, a: 0.5 });
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i], dx = p.x - x, dy = p.y - y, d = Math.sqrt(dx * dx + dy * dy) || 1;
          if (d < 260) { var f = (1 - d / 260) * 9; p.ix += dx / d * f; p.iy += dy / d * f; }
        }
      },
      draw: function (t, dt, r, live) {
        if (!W) return;
        ctx.clearRect(0, 0, W, H);
        var mx = live ? ptr.x - r.left : -9999, my = live ? ptr.y - r.top : -9999, R = 150;
        var damp = Math.pow(0.9, dt);
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          p.x += (Math.sin(t / 1700 + p.ph) * 0.14) * dt + p.ix * dt;
          p.y += p.vy * dt + p.iy * dt;
          p.a += p.va * dt;
          p.ix *= damp; p.iy *= damp;
          var ox = -hs.px * 22 * p.z, oy = -hs.py * 14 * p.z - r.top * 0.1 * p.z;
          var dx = p.x + ox - mx, dy = p.y + oy - my, d2 = dx * dx + dy * dy;
          if (d2 < R * R) {
            var d = Math.sqrt(d2) || 1, f = Math.pow(1 - d / R, 2) * 1.5;
            p.ix += dx / d * f * 0.4; p.iy += dy / d * f * 0.4;
          }
          if (p.y < -24) { p.y = H + 20; p.x = Math.random() * W; }
          else if (p.y > H + 40) p.y = -10;
          if (p.x < -24) p.x = W + 20; else if (p.x > W + 24) p.x = -20;
          ctx.save();
          ctx.translate(p.x + ox, p.y + oy);
          ctx.rotate(p.a);
          ctx.globalAlpha = 0.14 + 0.4 * p.z;
          ctx.fillStyle = colors[p.c];
          ctx.beginPath(); ctx.ellipse(0, 0, p.len / 2, p.wid / 2, 0, 0, TAU); ctx.fill();
          ctx.restore();
        }
        for (var j = ripples.length - 1; j >= 0; j--) {
          var q = ripples[j];
          q.r += 5 * dt; q.a -= 0.012 * dt;
          if (q.a <= 0) { ripples.splice(j, 1); continue; }
          ctx.globalAlpha = q.a; ctx.strokeStyle = colors[0]; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    };
  }

  /* -------------------------------------------- cards: 3D tilt, glare, touch */
  var activeCards = [];
  function initCards() {
    var cards = $$('.card, .tilt-card');
    cards.forEach(function (card) {
      card.__tiltBound = true; // stops main.js' older inline tilt
      card.classList.add('fx-tilt');
      var st = card.__fx = { rx: 0, ry: 0, trx: 0, tr: 0, gx: 50, gy: 50, tgx: 50, tgy: 50, ix: 0, iy: 0, tix: 0, tiy: 0, lift: 0, tlift: 0, rect: null, on: false, busy: false };

      function engage(e, soft) {
        if (+getComputedStyle(card).opacity < 0.99) return false;
        st.rect = card.getBoundingClientRect();
        card.classList.add('fx-live', 'fx-on'); st.on = true;
        aim(e, soft);
        if (!st.busy) { st.busy = true; activeCards.push(card); }
        wake();
        return true;
      }
      function aim(e, soft) {
        if (!st.rect) st.rect = card.getBoundingClientRect();
        var r = st.rect, px = clamp((e.clientX - r.left) / r.width, 0, 1) - 0.5, py = clamp((e.clientY - r.top) / r.height, 0, 1) - 0.5;
        var m = soft ? 0.6 : 1;
        st.trx = -py * 11 * m; st.tr = px * 13 * m;
        st.tgx = (px + 0.5) * 100; st.tgy = (py + 0.5) * 100;
        st.tix = -px * 8; st.tiy = -py * 6; st.tlift = -7 * m;
      }
      function relax() {
        st.on = false; card.classList.remove('fx-on');
        st.trx = st.tr = st.tix = st.tiy = st.tlift = 0; st.rect = null;
        if (!st.busy) { st.busy = true; activeCards.push(card); }
        wake();
      }
      card.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch') engage(e, false); });
      card.addEventListener('pointermove', function (e) {
        if (e.pointerType === 'touch' && !st.on) return;
        if (!st.on && !engage(e, e.pointerType === 'touch')) return;
        aim(e, e.pointerType === 'touch'); wake();
      });
      card.addEventListener('pointerdown', function (e) { if (e.pointerType === 'touch') engage(e, true); });
      ['pointerleave', 'pointerup', 'pointercancel'].forEach(function (n) { card.addEventListener(n, relax); });
    });
    window.addEventListener('scroll', function () { activeCards.forEach(function (c) { c.__fx.rect = null; }); }, { passive: true });

    frameFns.push(function (t, dt) {
      if (!activeCards.length) return false;
      var k = 1 - Math.pow(1 - 0.16, dt);
      for (var i = activeCards.length - 1; i >= 0; i--) {
        var c = activeCards[i], s = c.__fx;
        s.rx = lerp(s.rx, s.trx, k); s.ry = lerp(s.ry, s.tr, k);
        s.gx = lerp(s.gx, s.tgx, k); s.gy = lerp(s.gy, s.tgy, k);
        s.ix = lerp(s.ix, s.tix, k); s.iy = lerp(s.iy, s.tiy, k);
        s.lift = lerp(s.lift, s.tlift, k);
        var cs = c.style;
        cs.setProperty('--rx', s.rx.toFixed(2) + 'deg'); cs.setProperty('--ry', s.ry.toFixed(2) + 'deg');
        cs.setProperty('--gx', s.gx.toFixed(1) + '%'); cs.setProperty('--gy', s.gy.toFixed(1) + '%');
        cs.setProperty('--ix', s.ix.toFixed(2) + 'px'); cs.setProperty('--iy', s.iy.toFixed(2) + 'px');
        cs.setProperty('--lift', s.lift.toFixed(2) + 'px');
        cs.setProperty('--shx', (-s.ry * 1.6).toFixed(1) + 'px'); cs.setProperty('--shy', (s.rx * 1.6).toFixed(1) + 'px');
        if (!s.on && Math.abs(s.rx) + Math.abs(s.ry) + Math.abs(s.lift) + Math.abs(s.ix) < 0.05) {
          ['--rx', '--ry', '--gx', '--gy', '--ix', '--iy', '--lift', '--shx', '--shy'].forEach(function (p) { cs.removeProperty(p); });
          c.classList.remove('fx-live'); s.busy = false; activeCards.splice(i, 1);
        }
      }
      return activeCards.length > 0;
    });
  }

  /* -------------------------------------- scroll parallax for framed images */
  var pimgs = [];
  function initImages() {
    $$('img').forEach(function (img) {
      if (img.closest('.fx-scene,.site-nav-row,.credit-badge,#chat-widget,.logo-row,.card')) return; // card photos stay fully visible (no zoom-crop)
      var host = img.parentElement;
      if (!host) return;
      var cs = getComputedStyle(host);
      if (cs.overflow !== 'hidden' && cs.overflowY !== 'hidden') return;
      img.classList.add('fx-pimg');
      pimgs.push({ img: img, host: host, vis: !hasIO });
    });
    if (hasIO) {
      var io = new IntersectionObserver(function (en) {
        en.forEach(function (x) { for (var i = 0; i < pimgs.length; i++) if (pimgs[i].host === x.target) pimgs[i].vis = x.isIntersecting; });
        scrollDirty = true; wake();
      }, { rootMargin: '120px' });
      pimgs.forEach(function (p) { io.observe(p.host); });
    }
  }
  function imagesTick() {
    for (var i = 0; i < pimgs.length; i++) {
      var p = pimgs[i];
      if (!p.vis) continue;
      var r = p.host.getBoundingClientRect();
      var prog = clamp(((r.top + r.height / 2) - vh / 2) / (vh / 2 + r.height / 2), -1, 1);
      var amp = Math.min(30, r.height * 0.045);
      p.img.style.setProperty('--py', (-prog * amp).toFixed(1) + 'px');
    }
  }

  /* ------------------------------------------------- depth orbs behind sections */
  var orbs = [];
  function initOrbs() {
    if (LOW) return;
    var hosts = $$('.section-pad').filter(function (s) { return !s.classList.contains('fx-hero'); });
    var budget = vw < 700 ? 4 : 8;
    if (hero) hosts.unshift(hero);
    hosts.forEach(function (host, i) {
      if (budget <= 0) return;
      host.classList.add('fx-host');
      var n = host === hero ? 2 : 1;
      for (var k = 0; k < n && budget > 0; k++, budget--) {
        var o = el('span', 'fx-orb fx-layer ' + ((i + k) % 2 ? 't' : 'a')); o.setAttribute('aria-hidden', 'true');
        var size = 280 + Math.random() * 260;
        o.style.width = o.style.height = size.toFixed(0) + 'px';
        o.style.left = ((i + k) % 2 ? 62 + Math.random() * 30 : -6 + Math.random() * 24).toFixed(0) + '%';
        o.style.top = (8 + Math.random() * 55).toFixed(0) + '%';
        host.insertBefore(o, host.firstChild);
        orbs.push({ o: o, host: host, d: (0.5 + Math.random()) * (k ? -1 : 1), vis: !hasIO });
      }
    });
    if (hasIO) {
      var io = new IntersectionObserver(function (en) {
        en.forEach(function (x) { orbs.forEach(function (b) { if (b.host === x.target) b.vis = x.isIntersecting; }); });
        scrollDirty = true; wake();
      }, { rootMargin: '200px' });
      var seen = [];
      orbs.forEach(function (b) { if (seen.indexOf(b.host) < 0) { seen.push(b.host); io.observe(b.host); } });
    }
  }
  function orbsTick() {
    for (var i = 0; i < orbs.length; i++) {
      var b = orbs[i];
      if (!b.vis) continue;
      var r = b.host.getBoundingClientRect();
      var prog = clamp(((r.top + r.height / 2) - vh / 2) / (vh / 2 + r.height / 2), -1.2, 1.2);
      b.o.style.transform = 'translate3d(' + (sm.nx * -46 * b.d).toFixed(1) + 'px,' + (prog * -110 * b.d + sm.ny * -26 * b.d).toFixed(1) + 'px,0)';
    }
  }

  /* ------------------------------------------------------ split-word headings */
  function initHeadings() {
    var heads = $$('#page-root h1, #page-root h2').filter(function (h) { return !h.children.length && h.textContent.trim() && !h.closest('.card'); });
    heads.forEach(function (h) {
      var txt = h.textContent.trim().replace(/\s+/g, ' ');
      var words = txt.split(' ');
      h.setAttribute('aria-label', txt);
      var frag = doc.createDocumentFragment();
      words.forEach(function (w, i) {
        var mask = el('span', 'fx-w'), inner = el('span', 'fx-wi');
        mask.setAttribute('aria-hidden', 'true');
        inner.style.setProperty('--i', i); inner.textContent = w;
        mask.appendChild(inner); frag.appendChild(mask);
        if (i < words.length - 1) frag.appendChild(doc.createTextNode(' '));
      });
      h.textContent = ''; h.appendChild(frag); h.classList.add('fx-split');
    });
    if (!heads.length) return;
    if (!hasIO) { heads.forEach(function (h) { h.classList.add('fx-in'); }); return; }
    var io = new IntersectionObserver(function (en) {
      en.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add('fx-in'); io.unobserve(x.target); } });
    }, { threshold: 0, rootMargin: '0px 0px -6% 0px' });
    heads.forEach(function (h) { io.observe(h); });
  }

  /* -------------------------------------------------------------- count-ups */
  function initCounters() {
    var re = /^\s*(\d[\d,]*)(\.\d+)?\s*([+%kKmMxX]?)\s*$/;
    var nodes = $$('#page-root div, #page-root span').filter(function (n) {
      if (n.children.length || !re.test(n.textContent) || n.closest('.fx-split')) return false;
      if (/^0\d/.test(n.textContent.trim())) return false;
      return parseFloat(getComputedStyle(n).fontSize) >= 24;
    });
    if (!nodes.length || !hasIO) return;
    var io = new IntersectionObserver(function (en) {
      en.forEach(function (x) {
        if (!x.isIntersecting) return;
        io.unobserve(x.target);
        var n = x.target, m = re.exec(n.textContent), final = n.textContent;
        var end = parseFloat(m[1].replace(/,/g, '') + (m[2] || '')), dec = m[2] ? m[2].length - 1 : 0, suffix = m[3] || '';
        if (!(end > 0)) return;
        var t0 = performance.now(), dur = 1600;
        n.classList.add('fx-num');
        (function step(now) {
          var p = clamp((now - t0) / dur, 0, 1), e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
          n.textContent = p === 1 ? final : (end * e).toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, m[1].indexOf(',') > -1 ? ',' : '') + suffix;
          if (p < 1) requestAnimationFrame(step);
        })(t0);
      });
    }, { threshold: 0.6 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  /* ---------------------------------------------------------- trust marquee */
  function initMarquee() {
    var strip = $$('#page-root > div').filter(function (d) {
      var k = d.children;
      return k.length >= 3 && Array.prototype.every.call(k, function (c) { return c.classList.contains('chip'); });
    })[0];
    if (!strip) return;
    var chips = Array.prototype.slice.call(strip.children);
    var track = el('div', 'fx-track');
    chips.forEach(function (c) { track.appendChild(c); });
    strip.classList.add('fx-marquee');
    strip.appendChild(track);
    var setW = track.scrollWidth + 16;
    var sets = Math.max(1, Math.ceil(strip.clientWidth / Math.max(1, setW)));
    for (var i = 1; i < sets; i++) chips.forEach(function (c) { track.appendChild(c.cloneNode(true)); });
    var twin = track.cloneNode(true); twin.setAttribute('aria-hidden', 'true');
    strip.appendChild(twin);
    var dur = Math.max(20, (track.scrollWidth + 16) / 55);
    strip.style.setProperty('--dur', dur.toFixed(0) + 's');
    $$('.chip', twin).forEach(function (c) { c.setAttribute('aria-hidden', 'true'); });
  }

  /* --------------------------------------------------------- page curtain */
  var curtain = null;
  function buildCurtain() {
    var c = el('div', 'fx-curtain'); c.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 6; i++) { var b = el('i'); b.style.setProperty('--i', i); c.appendChild(b); }
    body.appendChild(c);
    return c;
  }
  function initCurtain() {
    var covered = false;
    try { covered = sessionStorage.getItem('fxCurtain') === '1'; sessionStorage.removeItem('fxCurtain'); } catch (e) {}
    if (covered) {
      curtain = buildCurtain();
      curtain.classList.add('cover', 'still');
      void curtain.offsetWidth;
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        curtain.classList.remove('still'); curtain.classList.add('leave'); curtain.classList.remove('cover');
        setTimeout(function () { if (curtain) { curtain.remove(); curtain = null; } }, 1100);
      }); });
    }
    $$('a[data-internal]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { e.stopImmediatePropagation(); return; }
        var url = a.getAttribute('href');
        if (!url || url.charAt(0) === '#') return;
        e.preventDefault(); e.stopImmediatePropagation();
        try { sessionStorage.setItem('fxCurtain', '1'); } catch (err) {}
        if (!curtain) curtain = buildCurtain();
        curtain.classList.remove('leave', 'still');
        void curtain.offsetWidth;
        curtain.classList.add('cover');
        setTimeout(function () { window.location.href = url; }, 620);
      });
    });
    window.addEventListener('pageshow', function (e) {
      if (!e.persisted) return;
      var pr = $('#page-root'); if (pr) pr.classList.remove('pv-exit');
      if (curtain) { curtain.remove(); curtain = null; }
    });
  }

  /* ------------------------------------------------------------------ boot */
  function boot() {
    root.classList.add('fx');
    safe(initScrollBits);
    safe(initCursor);
    safe(initNavPill);
    safe(initMagnets);
    safe(initHero);
    safe(initCards);
    safe(initImages);
    safe(initOrbs);
    safe(initHeadings);
    safe(initCounters);
    safe(initMarquee);
    safe(initCurtain);
    frameFns.push(function () {
      if (scrollDirty || Math.abs(sm.nx - ptr.nx) > 0.002 || Math.abs(sm.ny - ptr.ny) > 0.002) {
        scrollDirty = false;
        scrollTick(); imagesTick(); orbsTick();
      }
      return false;
    });
    scrollDirty = true;
    wake();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})();
