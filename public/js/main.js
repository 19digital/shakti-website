/* Shakti Engineering Works — shared site behaviour */
(function(){
  "use strict";

  // SITE_CONFIG is injected server-side (site-config.js) from whatever the admin set in the dashboard.
  // The literals below are only a fallback for opening main.js outside the CMS server (e.g. a raw static copy).
  var SC = window.SITE_CONFIG || {};
  var CONTACT = { phone: SC.phone || "+91 94750 86888", phoneRaw: SC.phoneRaw || "919475086888", email: SC.email || "info@shaktiew.in", address: SC.address || "Bardhaman, West Bengal, India" };
  var AI = SC.ai || { chat: false };

  var FAQS = [
    { keywords:["product","machine","elevator","dryer","silo","offer","make"], a:"We manufacture bucket elevators, paddy dryers, parboiling plants, storage silos, dust collectors, conveyors, blowers and more — the full pre-milling section of a rice mill. See the Products page for the full range." },
    { keywords:["capacity","ton","size","how much"], a:"Our machines are sized from small standalone units up to 56-ton dryers and 32-ton parboiling plants, with fully custom capacities on request." },
    { keywords:["where","location","export","country","bardhaman","bengal","address","based"], a:"We're based in Bardhaman, West Bengal, India, with installations pan-India and exports to Bangladesh, Myanmar and Sri Lanka." },
    { keywords:["material","steel","grade","quality","304"], a:"Every machine is built in 304-grade stainless steel with in-house fabrication and ISO 9001:2015 quality systems." },
    { keywords:["experience","year","old","since","history"], a:"Shakti Engineering Works has over 20 years of experience designing and building rice mill pre-milling machinery." },
    { keywords:["price","cost","quote","quotation"], a:"Pricing depends on capacity and specification — the fastest way to get an accurate quote is to WhatsApp or call us with your requirement." },
    { keywords:["contact","call","phone","whatsapp","email","reach"], a:"You can call or WhatsApp us at " + CONTACT.phone + ", or email " + CONTACT.email + "." },
    { keywords:["process","how","work","install","time","deliver"], a:"We design, fabricate and quality-check every machine in-house, then handle installation and commissioning at your mill site." }
  ];

  function matchFaq(text){
    var t = text.toLowerCase();
    for (var i = 0; i < FAQS.length; i++){
      for (var j = 0; j < FAQS[i].keywords.length; j++){
        if (t.indexOf(FAQS[i].keywords[j]) !== -1) return FAQS[i].a;
      }
    }
    return null;
  }

  function greetingText(){
    var h = new Date().getHours();
    var key = "shakti_visited_" + new Date().toDateString();
    var visitedToday = false;
    try { visitedToday = !!localStorage.getItem(key); localStorage.setItem(key, "1"); } catch(e){}
    if (visitedToday) return "Hello again";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }

  function initReveal(){
    var els = document.querySelectorAll(".reveal, .reveal-left, .reveal-right");
    if (!("IntersectionObserver" in window) || !els.length) { els.forEach(function(el){ el.classList.add("reveal-in"); }); return; }
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if (en.isIntersecting){ en.target.classList.add("reveal-in"); io.unobserve(en.target); }
      });
    // threshold 0 (not a % of the element): tall section wrappers can never be 12% visible on short screens
    }, { threshold: 0, rootMargin: "0px 0px -8% 0px" });
    els.forEach(function(el){ io.observe(el); });
  }

  function initContactForm(){
    var form = document.getElementById("contact-form");
    var note = document.getElementById("contact-note");
    if (!form) return;
    var original = note ? note.innerHTML : "";
    // anti-spam: stamp when the form became ready; the server rejects submits that arrive impossibly fast
    if (form.elements.ts) form.elements.ts.value = String(Date.now());

    function say(msg, ok){
      if (!note) return;
      note.textContent = msg;
      note.style.color = ok ? "var(--teal)" : "#B3261E";
    }

    form.setAttribute("novalidate", "");
    form.addEventListener("submit", function(e){
      e.preventDefault();
      var name = form.elements.name.value.trim();
      var phone = form.elements.phone.value.trim();
      var email = form.elements.email.value.trim();
      var message = form.elements.message.value.trim();
      var digits = phone.replace(/\D/g, "");

      if (!name){ say("Please enter your name.", false); form.elements.name.focus(); return; }
      if (digits.length < 10 || digits.length > 13 || !/^[+\d][\d\s\-()]*$/.test(phone)){
        say("Please enter a valid phone number (10–13 digits).", false); form.elements.phone.focus(); return;
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
        say("That email address doesn't look right.", false); form.elements.email.focus(); return;
      }

      // Log the enquiry + email the team. This never blocks WhatsApp opening below: a slow or
      // misconfigured mail server should not stop the visitor from reaching us.
      try {
        fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name, phone: phone, email: email, message: message,
            company: form.elements.company ? form.elements.company.value : "",
            ts: form.elements.ts ? form.elements.ts.value : "",
            source: "contact page"
          })
        }).then(function(res){
          // A non-2xx response (rate-limited, validation, or a server-side issue) never blocks
          // WhatsApp below — it's only logged, so a site owner can spot a systemic problem without
          // the visitor ever seeing an error for what is, to them, a successful enquiry.
          if (!res.ok && window.console) console.warn("Contact form: the enquiry could not be logged on the server (status " + res.status + "). WhatsApp will still open.");
        }).catch(function(){ /* offline or server down — WhatsApp still works below */ });
      } catch (err) { /* fetch unsupported — ignore, WhatsApp still works */ }

      var lines = ["Hello Shakti Engineering Works, I'd like to make an enquiry.", "", "Name: " + name, "Phone: " + phone];
      if (email) lines.push("Email: " + email);
      if (message) lines.push("Requirement: " + message);
      var url = "https://wa.me/" + CONTACT.phoneRaw + "?text=" + encodeURIComponent(lines.join("\n"));

      var a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      say("Opening WhatsApp with your enquiry — just press send there. If nothing opened, call " + CONTACT.phone + ".", true);
      form.reset();
      if (form.elements.ts) form.elements.ts.value = String(Date.now());
      setTimeout(function(){ if (note){ note.innerHTML = original; note.style.color = ""; } }, 12000);
    });
  }

  function bindTiltCards(){
    var cards = document.querySelectorAll(".card, .tilt-card");
    cards.forEach(function(el){
      if (el.__tiltBound) return;
      el.__tiltBound = true;
      el.classList.add("tilt-card");
      el.addEventListener("mousemove", function(e){
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = "perspective(800px) rotateX(" + (py * -7) + "deg) rotateY(" + (px * 7) + "deg) translateY(-3px)";
      });
      el.addEventListener("mouseleave", function(){ el.style.transform = ""; });
    });
  }

  function bindParallax(){
    var els = document.querySelectorAll(".parallax-blob");
    if (!els.length) return;
    var ticking = false;
    function update(){
      ticking = false;
      var vh = window.innerHeight || 800;
      els.forEach(function(el){
        var speed = parseFloat(el.getAttribute("data-parallax") || "0.12");
        var r = el.getBoundingClientRect();
        var center = r.top + r.height / 2 - vh / 2;
        var shift = Math.max(-60, Math.min(60, center * speed * -1));
        el.style.transform = "translateY(" + shift + "px)";
      });
    }
    window.addEventListener("scroll", function(){ if (!ticking){ ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  // Click-to-enlarge viewer for every product / step card that has a photo: full uncropped image, details, prev/next, quote buttons.
  function initProductCards(){
    var cards = [].slice.call(document.querySelectorAll(".card")).filter(function(c){
      return c.tagName !== "A" && c.firstElementChild && c.firstElementChild.tagName === "IMG";
    });
    if (!cards.length) return;

    var viewer = document.createElement("div");
    viewer.className = "pm";
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-modal", "true");
    viewer.setAttribute("aria-label", "Product details");
    viewer.innerHTML =
      '<div class="pm-bg"></div>' +
      '<div class="pm-card">' +
        '<button type="button" class="pm-x" aria-label="Close">&times;</button>' +
        '<div class="pm-img"><img alt=""><div class="pm-cap"></div><div class="pm-thumbs"></div></div>' +
        '<div class="pm-body">' +
          '<div class="eyebrow">Shakti Engineering Works</div>' +
          '<h3 class="pm-title"></h3>' +
          '<div class="pm-desc"></div>' +
          '<div class="pm-spec"></div>' +
          '<div class="pm-actions">' +
            '<a class="btn-primary pm-wa" target="_blank" rel="noopener">WhatsApp for quote</a>' +
            '<a class="btn-ghost pm-call">Call ' + CONTACT.phone + '</a>' +
          '</div>' +
          '<div class="pm-nav"><button type="button" class="pm-prev" aria-label="Previous">&larr;</button><span class="pm-count"></span><button type="button" class="pm-next" aria-label="Next">&rarr;</button></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(viewer);

    var $ = function(s){ return viewer.querySelector(s); };
    var imgEl = $(".pm-img img"), titleEl = $(".pm-title"), descEl = $(".pm-desc"), specEl = $(".pm-spec");
    var capEl = $(".pm-cap"), thumbsEl = $(".pm-thumbs");
    var group = [], idx = 0, lastFocus = null, photos = [];

    // Extra photos per product (keyed by the card's main image file): shown as a strip under the large photo.
    var GALLERY = {
      "dryer-24-ton.jpg": [["dryer-24-ton.jpg", "24 ton double dryer"], ["paddy-dryer-56-ton.jpg", "56 ton paddy dryer"], ["complete-dryer-parboiling-silo-set-1.jpg", "Complete dryer, parboiling and silo set"], ["complete-dryer-parboiling-silo-set-2.jpg", "Complete dryer, parboiling and silo set (another view)"]],
      "parboiling-32-ton.jpg": [["parboiling-32-ton.jpg", "32 ton parboiling plant"], ["parboiling-18-ton.jpg", "18 ton parboiling plant"], ["parboiling-dual-type.jpg", "Dual type pressure cum parboiling plant"], ["parboiling-32-ton-water-tank.jpg", "32 ton parboiling with 50 KL water tank"], ["dryer-parboiling-full-plant.jpg", "Dryer and parboiling full plant"]],
      "screw-tube-conveyor.jpg": [["screw-tube-conveyor.jpg", "Screw conveyor and tube conveyor in flour mill"], ["tube-conveyor.jpg", "Tube conveyor"], ["screw-conveyor-flour-mill.jpg", "Screw conveyor for flour mill"]],
      "paddy-silo-wall.jpg": [["paddy-silo-wall.jpg", "Paddy storage silo"], ["paddy-silo-tall.jpg", "Paddy storage silo (full height)"], ["rice-silo.jpg", "Rice storage silo"]]
    };
    function setPhoto(k){
      var p = photos[k];
      imgEl.src = p.src; imgEl.alt = p.label;
      capEl.textContent = photos.length > 1 ? p.label : "";
      [].forEach.call(thumbsEl.children, function(btn, n){ btn.classList.toggle("on", n === k); });
    }
    function setPhotos(d){
      var file = d.src.split("/").pop().split("?")[0];
      var set = GALLERY[file];
      photos = set ? set.map(function(x){ return { src: "images/" + x[0], label: x[1] }; }) : [{ src: d.src, label: d.title }];
      thumbsEl.innerHTML = "";
      if (photos.length > 1) photos.forEach(function(p, n){
        var btn = document.createElement("button");
        btn.type = "button"; btn.setAttribute("aria-label", p.label);
        var im = document.createElement("img");
        im.src = p.src; im.alt = ""; im.loading = "lazy";
        btn.appendChild(im);
        btn.addEventListener("click", function(){ setPhoto(n); });
        thumbsEl.appendChild(btn);
      });
      setPhoto(0);
    }

    function info(card){
      var leaves = [].slice.call(card.querySelectorAll("div")).filter(function(d){
        return !d.children.length && d.textContent.trim() && !/^\d{1,2}$/.test(d.textContent.trim());
      }).map(function(d){ return d.textContent.trim().replace(/\s+/g, " "); });
      var img = card.firstElementChild;
      return {
        src: img.currentSrc || img.src,
        title: leaves[0] || "Product",
        desc: leaves.length > 2 ? leaves.slice(1, -1).join(" ") : (leaves[1] || ""),
        spec: leaves.length > 2 ? leaves[leaves.length - 1] : ""
      };
    }

    function show(i){
      idx = (i + group.length) % group.length;
      var d = info(group[idx]);
      setPhotos(d);
      titleEl.textContent = d.title;
      descEl.textContent = d.desc; descEl.style.display = d.desc ? "" : "none";
      specEl.textContent = d.spec; specEl.style.display = d.spec ? "" : "none";
      $(".pm-wa").href = "https://wa.me/" + CONTACT.phoneRaw + "?text=" + encodeURIComponent("Hello Shakti Engineering Works, I'd like a quote for: " + d.title);
      $(".pm-call").href = "tel:+" + CONTACT.phoneRaw;
      $(".pm-count").textContent = (idx + 1) + " / " + group.length;
      var multi = group.length > 1;
      $(".pm-prev").style.visibility = $(".pm-next").style.visibility = multi ? "visible" : "hidden";
    }
    function open(card){
      group = [].slice.call(card.parentElement.children).filter(function(c){ return cards.indexOf(c) > -1; });
      lastFocus = document.activeElement;
      show(group.indexOf(card));
      viewer.classList.add("open");
      document.documentElement.classList.add("pm-lock");
      setTimeout(function(){ $(".pm-x").focus(); }, 50);
    }
    function close(){
      viewer.classList.remove("open");
      document.documentElement.classList.remove("pm-lock");
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    cards.forEach(function(card){
      var t = info(card).title;
      card.classList.add("pc-open");
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", "View " + t);
      var hint = document.createElement("span");
      hint.className = "pc-hint";
      hint.setAttribute("aria-hidden", "true");
      hint.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
      card.appendChild(hint);
      card.addEventListener("click", function(){ open(card); });
      card.addEventListener("keydown", function(e){
        if (e.key === "Enter" || e.key === " "){ e.preventDefault(); open(card); }
      });
    });

    $(".pm-bg").addEventListener("click", close);
    $(".pm-x").addEventListener("click", close);
    $(".pm-prev").addEventListener("click", function(){ show(idx - 1); });
    $(".pm-next").addEventListener("click", function(){ show(idx + 1); });
    document.addEventListener("keydown", function(e){
      if (!viewer.classList.contains("open")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") show(idx - 1);
      else if (e.key === "ArrowRight") show(idx + 1);
      else if (e.key === "Tab"){
        var f = [].slice.call(viewer.querySelectorAll("button, a[href]")).filter(function(n){ return n.offsetParent !== null && n.style.visibility !== "hidden"; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
      }
    });
    var sx = null, imgBox = $(".pm-img");
    imgBox.addEventListener("pointerdown", function(e){ if (e.pointerType === "touch") sx = e.clientX; });
    imgBox.addEventListener("pointerup", function(e){
      if (sx === null) return;
      var dx = e.clientX - sx; sx = null;
      if (Math.abs(dx) > 50) show(idx + (dx < 0 ? 1 : -1));
    });
  }

  function initMobileNav(){
    var btn = document.querySelector(".mobile-menu-btn");
    var panel = document.getElementById("mnav-panel");
    if (!btn || !panel) return;
    btn.addEventListener("click", function(){ panel.classList.toggle("open"); });
    panel.querySelectorAll("a").forEach(function(a){ a.addEventListener("click", function(){ panel.classList.remove("open"); }); });
  }

  function initChat(){
    var toggleBtn = document.getElementById("chat-toggle");
    var panel = document.getElementById("chat-panel");
    var scroll = document.getElementById("chat-scroll");
    var input = document.getElementById("chat-input");
    var sendBtn = document.getElementById("chat-send");
    if (!toggleBtn || !panel) return;
    var count = 0;
    var ended = false;
    var busy = false;
    var history = []; // {role:'user'|'model', text} — sent back to /api/chat for short-term memory
    var useAi = !!AI.chat; // falls back to the local keyword FAQ if AI chat is off, has no key, or errors out

    function addMsg(text, who, typing){
      var d = document.createElement("div");
      d.className = "cw-msg " + who + (typing ? " typing" : "");
      d.textContent = text;
      scroll.appendChild(d);
      scroll.scrollTop = scroll.scrollHeight;
      return d;
    }

    if (!scroll.__seeded){
      scroll.__seeded = true;
      addMsg(AI.greeting || "Hi! Ask me anything about our rice mill machinery — products, capacity, location or pricing.", "bot");
    }

    toggleBtn.addEventListener("click", function(){
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) setTimeout(function(){ input.focus(); }, 50);
    });

    function localReply(text){
      count++;
      if (count > 3){
        ended = true;
        return "For more detailed information, please call or WhatsApp us at " + CONTACT.phone + ", or email " + CONTACT.email + ".";
      }
      return matchFaq(text) || ("Thanks for asking! For specifics on that, the fastest answer comes from our team directly — call or WhatsApp " + CONTACT.phone + ".");
    }

    function send(){
      var text = input.value.trim();
      if (!text || busy || (ended && !useAi)) return;
      addMsg(text, "user");
      input.value = "";

      if (!useAi){
        setTimeout(function(){ addMsg(localReply(text), "bot"); }, 400);
        return;
      }

      busy = true;
      sendBtn.disabled = true;
      var thinking = addMsg("...", "bot", true);
      history.push({ role: "user", text: text });

      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: history.slice(0, -1) })
      }).then(function(res){
        return res.json().then(function(data){ return { ok: res.ok, data: data }; });
      }).then(function(r){
        thinking.remove();
        if (r.ok && r.data && r.data.reply){
          addMsg(r.data.reply, "bot");
          history.push({ role: "model", text: r.data.reply });
          if (history.length > 16) history = history.slice(-16);
        } else {
          // server declined (rate limit / no key / disabled) — fail over to the offline FAQ bot for this reply only
          useAi = false;
          addMsg(localReply(text), "bot");
        }
      }).catch(function(){
        thinking.remove();
        useAi = false;
        addMsg(localReply(text), "bot");
      }).then(function(){
        busy = false;
        sendBtn.disabled = false;
        input.focus();
      });
    }
    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", function(e){ if (e.key === "Enter") send(); });
  }

  function initQuickContact(){
    var btn = document.getElementById("qc-toggle");
    var items = document.getElementById("qc-items");
    if (!btn || !items) return;
    btn.addEventListener("click", function(){ items.classList.toggle("open"); });
  }

  function initPageTransition(){
    var root = document.getElementById("page-root");
    if (!root) return;
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ root.classList.remove("pv-enter"); });
    });
    document.querySelectorAll("a[data-internal]").forEach(function(a){
      a.addEventListener("click", function(e){
        var url = a.getAttribute("href");
        if (!url || url.charAt(0) === "#") return;
        e.preventDefault();
        root.classList.add("pv-exit");
        setTimeout(function(){ window.location.href = url; }, 320);
      });
    });
  }

  function setGreeting(){
    var el = document.getElementById("greeting-text");
    if (el) el.textContent = greetingText();
  }

  document.addEventListener("DOMContentLoaded", function(){
    setGreeting();
    initMobileNav();
    initChat();
    initQuickContact();
    initPageTransition();
    initReveal();
    initContactForm();
    initProductCards();
    setTimeout(function(){ bindTiltCards(); bindParallax(); }, 200);
  });
})();
