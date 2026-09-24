/* ═══ DTP V3 · TRAÇABILITÉ EN DIRECT (comptes admin, derrière l'interrupteur « Aperçu V2 ») ════════
   Feuille de route, UX n°1 : « l'aide de chaque panneau dit ce qu'il montre, SA SOURCE ET SA
   FRAÎCHEUR : c'est la traçabilité rendue visible ». L'aide des widgets disait déjà d'où vient la
   donnée, mais en texte fixe : une source en panne se présentait exactement comme une source à jour.
   Ce module branche cette aide, et les grandes vues du desk, sur la Santé des données
   (/api/admin/data-health) :
     · l'aide d'un widget gagne une section « État de la source, en direct » (🟢 à jour, 🟠 en retard,
       🔴 indisponible, avec l'âge réel de la dernière donnée et le détail) ;
     · les vues Fil, Taux, Biais et Semaine à venir gagnent une pastille « Sources » dans leur
       en-tête, de la couleur de leur source la plus en retard, qui ouvre le même détail.
   RIEN n'est inventé : un widget dont la source n'est pas suivie par la Santé des données n'affiche
   pas de section (jamais un vert de complaisance). Lecture seule, une requête par minute au plus. */
(function () {
  'use strict';
  if (window._v2aTrace) return;
  window._v2aTrace = true;

  // Widget ou vue → préfixes des sources de /api/admin/data-health qui l'alimentent RÉELLEMENT.
  var TAUX = ['rateprobability', 'WatchTower', 'CME FedWatch', 'ASX IB'];
  var SOURCES = {
    'force-devises': ['Force des devises'], 'barometre': ['Force des devises'],
    'risque-jauge': ['Sentiment de risque'], 'risque-historique': ['Sentiment de risque'],
    'calendrier-jour': ['Calendrier économique'], 'evenement-rebours': ['Calendrier économique'],
    'ecart-consensus': ['Calendrier économique'], 'serie-indicateur': ['Calendrier économique'],
    'scenario-desk': ['Calendrier économique'],
    'taux-cb': TAUX, 'reunion-bc': TAUX, 'taux-diff': TAUX,
    'cot-inst': ['COT'], 'cot-devise': ['COT'],
    'dmx-paire': ['DMX'], 'dmx-stats': ['DMX'], 'dmx-retail': ['DMX'],
    'fil-news': ['Fil d’actualité'],
    'radar-biais': ['COT', 'Calendrier économique'].concat(TAUX),
    // grandes vues du desk (en-têtes .panel-header)
    'view-news': ['Fil d’actualité'], 'view-taux': TAUX,
    'view-bias': ['COT', 'Calendrier économique'].concat(TAUX), 'view-weekahead': ['Calendrier économique'],
  };
  var ETAT = { ok: ['À jour', '#22c55e'], degrade: ['En retard', '#ffb300'], panne: ['Indisponible', '#ef4444'] };
  var RANG = { ok: 0, degrade: 1, panne: 2 };

  var cache = null, cacheAt = 0, enCours = null;
  function sante() {
    if (cache && Date.now() - cacheAt < 60000) return Promise.resolve(cache);
    if (enCours) return enCours;
    enCours = fetch('/api/admin/data-health', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && Array.isArray(j.sources)) { cache = j; cacheAt = Date.now(); } enCours = null; return cache; })
      .catch(function () { enCours = null; return cache; });
    return enCours;
  }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function age(ms) {
    if (ms == null) return 'jamais lue';
    var m = Math.round(ms / 60000);
    if (m < 1) return 'à l’instant';
    if (m < 60) return 'il y a ' + m + ' min';
    var h = Math.round(m / 60);
    return h < 48 ? 'il y a ' + h + ' h' : 'il y a ' + Math.round(h / 24) + ' j';
  }
  function lignes(j, cle) {
    var p = SOURCES[cle]; if (!p || !j) return [];
    return j.sources.filter(function (s) { return p.some(function (x) { return String(s.nom).indexOf(x) === 0; }); });
  }
  function pire(ls) { return ls.reduce(function (a, s) { return RANG[s.etat] > RANG[a] ? s.etat : a; }, 'ok'); }
  function htmlLignes(ls) {
    return ls.map(function (s) {
      var e = ETAT[s.etat] || ETAT.panne;
      return '<div class="v2a-src-l"><i style="background:' + e[1] + '"></i><b>' + esc(s.nom) + '</b>'
        + '<span class="v2a-src-e" style="color:' + e[1] + '">' + e[0] + ' · ' + esc(age(s.age)) + '</span>'
        + (s.detail ? '<span class="v2a-src-d">' + esc(s.detail) + '</span>' : '') + '</div>';
    }).join('');
  }

  // 1) Aide des widgets : section « État de la source, en direct ».
  document.addEventListener('dtp:aide', function (ev) {
    var id = ev && ev.detail && ev.detail.id;
    if (!SOURCES[id]) return;
    var d = document.getElementById('wdg-aide');
    var corps = d && d.querySelector('.wdg-aide-corps');
    if (!corps) return;
    var sec = document.createElement('section');
    sec.className = 'v2a-src';
    sec.innerHTML = '<h4>État de la source, en direct</h4><p class="v2a-src-att">Lecture de la santé des données…</p>';
    corps.insertBefore(sec, corps.children[1] || null);
    sante().then(function (j) {
      var ls = lignes(j, id);
      if (!ls.length) { sec.remove(); return; }   // source non suivie : on n'affiche rien plutôt qu'un faux vert
      sec.innerHTML = '<h4>État de la source, en direct</h4>' + htmlLignes(ls);
    });
  });

  // 2) Grandes vues : pastille « Sources » dans l'en-tête, couleur de la source la plus en retard.
  function poserPastilles() {
    ['view-news', 'view-taux', 'view-bias', 'view-weekahead'].forEach(function (v) {
      var vue = document.getElementById(v);
      var tete = vue && vue.querySelector('.panel-header');
      if (!tete || tete.querySelector('.v2a-src-pill')) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'v2a-src-pill'; b.dataset.vue = v;
      b.title = 'Sources de cette vue et leur fraîcheur';
      b.innerHTML = '<i></i><span>Sources</span>';
      b.addEventListener('click', function (e) { e.stopPropagation(); ouvrir(b); });
      var ctl = tete.querySelector('.panel-header-controls');
      if (ctl) ctl.insertBefore(b, ctl.firstChild); else tete.appendChild(b);
    });
    teinter();
  }
  function teinter() {
    sante().then(function (j) {
      document.querySelectorAll('.v2a-src-pill').forEach(function (b) {
        var ls = lignes(j, b.dataset.vue);
        var e = ETAT[ls.length ? pire(ls) : 'ok'];
        b.querySelector('i').style.background = ls.length ? e[1] : '#6b7280';
        b.setAttribute('aria-label', 'Sources : ' + (ls.length ? e[0] : 'non suivies'));
      });
    });
  }
  function fermer() { var p = document.getElementById('v2a-src-pop'); if (p) p.remove(); }
  function ouvrir(b) {
    fermer();
    var p = document.createElement('div');
    p.id = 'v2a-src-pop'; p.className = 'v2a-src-pop';
    p.innerHTML = '<div class="v2a-src-h">Sources de cette vue <button type="button" aria-label="Fermer">×</button></div><p class="v2a-src-att">Lecture…</p>';
    document.body.appendChild(p);
    var r = b.getBoundingClientRect();
    p.style.top = Math.round(r.bottom + 6) + 'px';
    p.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - p.offsetWidth - 8, r.right - p.offsetWidth))) + 'px';
    p.querySelector('button').onclick = fermer;
    sante().then(function (j) {
      var ls = lignes(j, b.dataset.vue);
      var att = p.querySelector('.v2a-src-att');
      if (att) att.outerHTML = ls.length ? htmlLignes(ls) : '<p class="v2a-src-att">Aucune source suivie pour cette vue.</p>';
    });
  }
  document.addEventListener('click', function (e) { var p = document.getElementById('v2a-src-pop'); if (p && !p.contains(e.target)) fermer(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fermer(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', poserPastilles); else poserPastilles();
  setInterval(teinter, 60000);
})();
