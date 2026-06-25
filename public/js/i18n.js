/* ===================================================================
   DataTradingPro — moteur i18n runtime (FR = source -> EN au runtime)
   Piloté par localStorage.dtp_lang (choix fait au login).
   Le DOM est en français ; si lang=en, on traduit l'interface VISIBLE
   via le dictionnaire window.DTP_I18N_EN (FR->EN), au chargement ET sur
   tout contenu rendu dynamiquement (MutationObserver). Idempotent.
   N'altère NI le DOM structurel NI le JS métier (clés, data-*, logique).
=================================================================== */
(function () {
  'use strict';
  function getLang() { try { return (localStorage.getItem('dtp_lang') || 'fr').slice(0, 2).toLowerCase(); } catch (e) { return 'fr'; } }
  var LANG = getLang();
  var DICT = (window.DTP_I18N_EN || {});
  var ATTRS = ['placeholder', 'title', 'aria-label', 'data-tip', 'alt'];

  /* Sélecteur de langue FR | EN (injecté, en bas à droite) */
  function injectSwitcher() {
    if (document.getElementById('dtp-lang-switch') || !document.body) return;
    var box = document.createElement('div');
    box.id = 'dtp-lang-switch';
    box.setAttribute('data-noi18n', '1');
    box.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:99999;display:flex;gap:2px;padding:3px;border-radius:10px;background:rgba(22,23,27,.9);border:1px solid rgba(255,255,255,.1);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);font-family:system-ui,-apple-system,sans-serif;box-shadow:0 8px 22px -8px rgba(0,0,0,.7);';
    ['fr', 'en'].forEach(function (l) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = l.toUpperCase(); b.setAttribute('data-noi18n', '1');
      var on = (LANG === l);
      b.style.cssText = 'border:0;cursor:pointer;border-radius:7px;padding:4px 10px;font-size:11px;font-weight:700;letter-spacing:.02em;' + (on ? 'background:#e3b23a;color:#1a1206;' : 'background:transparent;color:#9a9aa4;');
      b.onclick = function () { if (LANG === l) return; try { localStorage.setItem('dtp_lang', l); } catch (e) {} location.reload(); };
      box.appendChild(b);
    });
    document.body.appendChild(box);
  }

  /* FR = source : rien à traduire, on ajoute juste la bascule. */
  if (LANG === 'fr' || !DICT || !Object.keys(DICT).length) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectSwitcher); else injectSwitcher();
    return;
  }

  function tr(s) { if (s == null) return s; var str = '' + s, k = str.trim(); if (!k) return s; var t = DICT[k]; return (t === undefined || t === k) ? s : str.replace(k, t); }

  function inSkip(node) {
    var el = node && node.nodeType === 1 ? node : (node ? node.parentNode : null);
    while (el && el.nodeType === 1) {
      var tag = el.nodeName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'INPUT') return true;
      if (el.getAttribute && el.getAttribute('data-noi18n') != null) return true;
      el = el.parentNode;
    }
    return false;
  }

  function translate(root) {
    if (!root) return;
    try {
      if (root.nodeType === 3) { if (!inSkip(root)) { var nv = tr(root.nodeValue); if (nv !== root.nodeValue) root.nodeValue = nv; } return; }
      if (root.nodeType !== 1 || inSkip(root)) return;
      var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), n, list = [];
      while ((n = tw.nextNode())) list.push(n);
      for (var i = 0; i < list.length; i++) { var nd = list[i]; if (inSkip(nd)) continue; var v = nd.nodeValue, v2 = tr(v); if (v2 !== v) nd.nodeValue = v2; }
      for (var a = 0; a < ATTRS.length; a++) {
        var attr = ATTRS[a];
        if (root.hasAttribute && root.hasAttribute(attr)) { var rv = root.getAttribute(attr), rt = tr(rv); if (rt !== rv) root.setAttribute(attr, rt); }
        var els = root.querySelectorAll ? root.querySelectorAll('[' + attr + ']') : [];
        for (var j = 0; j < els.length; j++) { var el = els[j]; if (inSkip(el)) continue; var ev = el.getAttribute(attr), et = tr(ev); if (et !== ev) el.setAttribute(attr, et); }
      }
    } catch (e) {}
  }

  function boot() {
    document.documentElement.setAttribute('lang', 'en');
    translate(document.body);
    injectSwitcher();
    var queue = [], pending = false;
    function flush() { pending = false; var q = queue; queue = []; for (var i = 0; i < q.length; i++) translate(q[i]); }
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'childList') { for (var k = 0; k < m.addedNodes.length; k++) queue.push(m.addedNodes[k]); }
        else if (m.type === 'characterData') queue.push(m.target);
        else if (m.type === 'attributes') queue.push(m.target);
      }
      if (!pending) { pending = true; (window.requestAnimationFrame || setTimeout)(flush); }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
