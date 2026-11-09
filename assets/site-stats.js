/* MojoMagicTV first-party visit stats (see /privacy.html).
   Sends only: page path, coarse screen class, language, referring site name, time on site,
   which page sections were seen, and which links/buttons were clicked (label + element type).
   No cookies, no form values, no fingerprinting, no recordings. Random tab id in sessionStorage
   (gone when the tab closes). Honors Global Privacy Control and Do Not Track.
   This file contains no keys and cannot read any stored data. */
(function () {
  'use strict';
  var script = document.currentScript;
  var endpoint = script && script.getAttribute('data-endpoint');
  if (!endpoint || !window.JSON || !document.addEventListener) return;
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
  var test = script.getAttribute('data-test') === '1' || /[?&]mmtv_test=1(&|$)/.test(location.search);

  var store = (function () { try { var s = window.sessionStorage; s.setItem('mmtv_probe', '1'); s.removeItem('mmtv_probe'); return s; } catch (e) { return null; } })();
  function sget(k) { try { return store ? store.getItem(k) : null; } catch (e) { return null; } }
  function sset(k, v) { try { if (store) store.setItem(k, v); } catch (e) {} }
  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var a = new Uint8Array(16); (window.crypto || window.msCrypto).getRandomValues(a);
    var h = ''; for (var i = 0; i < a.length; i++) h += (a[i] < 16 ? '0' : '') + a[i].toString(16);
    return h;
  }
  var sid = sget('mmtv_sid');
  if (!sid || !/^[A-Za-z0-9-]{16,64}$/.test(sid)) { sid = randomId(); sset('mmtv_sid', sid); }

  var page = location.pathname.replace(/\/index\.html$/, '/') || '/';
  var prevPage = sget('mmtv_last');
  sset('mmtv_last', page);

  function screenClass() {
    var w = Math.min(window.screen && screen.width || 0, 10000) || window.innerWidth || 0;
    return w < 480 ? 'xs' : w < 768 ? 'sm' : w < 1024 ? 'md' : w < 1440 ? 'lg' : 'xl';
  }
  function refHost() {
    if (!document.referrer) return '';
    try { var u = new URL(document.referrer); return u.host === location.host ? '(internal)' : u.hostname; } catch (e) { return ''; }
  }

  // Visible time on site, summed across pages in this tab.
  var baseActive = Number(sget('mmtv_active')) || 0;
  var pageActive = 0;
  var visibleSince = document.visibilityState === 'visible' ? Date.now() : 0;
  function activeTotal() {
    return baseActive + pageActive + (visibleSince ? Date.now() - visibleSince : 0);
  }
  function pauseClock() {
    if (visibleSince) { pageActive += Date.now() - visibleSince; visibleSince = 0; }
    sset('mmtv_active', String(baseActive + pageActive));
  }

  var queue = [];
  var metaSent = false;
  function push(ev) { ev.page = page; queue.push(ev); if (queue.length >= 30) flush(false); }
  function flush(beacon) {
    if (!queue.length) return;
    var payload = { sid: sid, events: queue.splice(0, 40) };
    if (test) payload.test = true;
    if (!metaSent) { payload.meta = { ref: refHost() || null, sc: screenClass(), lang: (navigator.language || '').slice(0, 12) }; metaSent = true; }
    var body = JSON.stringify(payload);
    try {
      if (beacon && navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' }))) return;
      fetch(endpoint, { method: 'POST', body: body, keepalive: true, mode: 'cors', credentials: 'omit', headers: { 'content-type': 'text/plain' } }).catch(function () {});
    } catch (e) {}
  }

  push({ type: 'pageview', target: prevPage && prevPage !== page ? prevPage : null });
  flush(false);

  setInterval(function () {
    if (document.visibilityState === 'visible') { push({ type: 'heartbeat', ms: activeTotal() }); flush(false); }
  }, 15000);
  function leave() { pauseClock(); push({ type: 'leave', ms: activeTotal() }); flush(true); }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') leave();
    else if (!visibleSince) visibleSince = Date.now();
  });
  window.addEventListener('pagehide', leave);

  // Sections: elements with data-track-section, plus known page parts.
  var SECTIONS = [['[data-track-section]', null], ['.brand', 'brand'], ['.room-stage', 'video-scene'], ['#countdown', 'countdown'], ['.privacy-link', 'privacy-link'], ['.notice', 'privacy-notice']];
  function sectionOf(el) {
    for (var i = 0; i < SECTIONS.length; i++) {
      var hit = el && el.closest ? el.closest(SECTIONS[i][0]) : null;
      if (hit) return SECTIONS[i][1] || hit.getAttribute('data-track-section');
    }
    return 'page';
  }
  if ('IntersectionObserver' in window) {
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var name = sectionOf(en.target);
        if (seen[name]) return;
        seen[name] = 1; push({ type: 'section_view', section: name }); io.unobserve(en.target);
      });
    }, { threshold: 0.4 });
    SECTIONS.forEach(function (s) { var list = document.querySelectorAll(s[0]); for (var i = 0; i < list.length; i++) io.observe(list[i]); });
    setTimeout(function () { flush(false); }, 2500);
  }

  function shortSelector(el) {
    var parts = [];
    for (var depth = 0; el && el.nodeType === 1 && depth < 3; depth++, el = el.parentElement) {
      var p = el.tagName.toLowerCase();
      if (el.id) { parts.unshift(p + '#' + el.id); break; }
      var cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) p += '.' + cls.join('.');
      parts.unshift(p);
    }
    return parts.join('>').slice(0, 120);
  }
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var el = t.closest('a,button,[role="button"],summary,video,[data-track]') || t;
    var tag = el.tagName.toLowerCase();
    var label;
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable) label = 'form field'; // never values
    else label = el.getAttribute('data-track') || el.getAttribute('aria-label') || ((tag === 'a' || tag === 'button' || tag === 'summary') ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) : tag);
    var ev = { type: 'click', section: sectionOf(el), label: label, selector: shortSelector(el) };
    if (tag === 'a' && el.href) {
      try {
        var u = new URL(el.href, location.href);
        ev.target = u.host === location.host ? (u.pathname.replace(/\/index\.html$/, '/') || '/') : u.hostname;
        push(ev);
        push({ type: 'nav', target: ev.target });
        flush(true);
        return;
      } catch (err) {}
    }
    push(ev);
    flush(false);
  }, true);
})();
