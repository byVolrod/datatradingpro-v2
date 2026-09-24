/* ═══ DTP V3 · BRIEFING DU MATIN SOURCÉ : l'écran (comptes admin, derrière « Aperçu V2 ») ═══════════
   Le briefing est rédigé côté serveur à partir d'une FICHE DE FAITS, puis vérifié (briefing.js) : ici,
   on l'affiche en rendant chaque citation CLIQUABLE. Un clic sur « F3 » montre le fait exact, sa
   source et son heure : le lecteur n'a jamais à croire le texte sur parole.
   Deux entrées : sur grand écran, un bouton « Briefing » dans l'en-tête du Fil ; dans l'app mobile,
   une carte en tête de l'écran Marchés. Lecture seule ; un bouton « Rédiger maintenant » pour l'admin. */
(function () {
  'use strict';
  if (window._v2aBrief) return;
  window._v2aBrief = true;

  var data = null, lu = 0;
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function heure(ts) { try { return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function charger(force) {
    if (!force && data && Date.now() - lu < 120000) return Promise.resolve(data);
    return fetch('/api/v2/briefing', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j) { data = j; lu = Date.now(); } return data; })
      .catch(function () { return data; });
  }
  function faitDe(id) { return ((data && data.faits) || []).filter(function (f) { return f.id === id; })[0]; }
  function point(p) {
    return '<li>' + esc(p.txt) + ' ' + (p.cites || []).map(function (c) { return '<button type="button" class="v2a-bf-cite" data-f="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</li>';
  }
  function corps(d) {
    if (!d || d.vide) {
      return '<p class="v2a-bf-vide">' + esc((d && d.raison) || 'Pas encore rédigé.') + '</p>';
    }
    var m = d.motifs || {};
    return '<div class="v2a-bf-meta">' + (d.aujourdhui === false ? '<b class="v2a-bf-ancien">Édition du ' + esc(d.jour) + '</b> · ' : '')
      + 'rédigé à ' + esc(heure(d.genereA)) + ' · ' + ((d.faits || []).length) + ' faits sourcés · '
      + '<span title="Points écartés par la vérification : sans source ' + (m.sansSource || 0) + ', chiffre absent des faits ' + (m.chiffre || 0) + ', consigne de trading ' + (m.consigne || 0) + '">'
      + (d.ecartes || 0) + ' point' + ((d.ecartes || 0) > 1 ? 's' : '') + ' écarté' + ((d.ecartes || 0) > 1 ? 's' : '') + ' à la vérification</span></div>'
      + '<h2 class="v2a-bf-titre">' + esc(d.titre) + '</h2>'
      + ((d.synthese || []).length ? '<ul class="v2a-bf-synth">' + d.synthese.map(point).join('') + '</ul>' : '')
      + (d.sections || []).map(function (s) { return '<section><h3>' + esc(s.titre) + '</h3><ul>' + s.points.map(point).join('') + '</ul></section>'; }).join('')
      + '<details class="v2a-bf-fiche"><summary>Fiche de faits (' + ((d.faits || []).length) + ')</summary><ol>'
      + (d.faits || []).map(function (f) { return '<li id="v2a-bf-' + esc(f.id) + '"><b>' + esc(f.id) + '</b> ' + esc(f.txt) + '<span>' + esc(f.source) + (f.at ? ' · ' + esc(heure(f.at)) : '') + '</span></li>'; }).join('')
      + '</ol></details>';
  }
  function bulle(btn) {
    var old = document.getElementById('v2a-bf-bulle'); if (old) old.remove();
    var f = faitDe(btn.dataset.f); if (!f) return;
    var b = document.createElement('div');
    b.id = 'v2a-bf-bulle'; b.className = 'v2a-bf-bulle';
    b.innerHTML = '<b>' + esc(f.id) + '</b> ' + esc(f.txt) + '<span>' + esc(f.source) + (f.at ? ' · ' + esc(heure(f.at)) : '') + '</span>';
    document.body.appendChild(b);
    var r = btn.getBoundingClientRect();
    b.style.top = Math.round(Math.min(window.innerHeight - b.offsetHeight - 8, r.bottom + 6)) + 'px';
    b.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - b.offsetWidth - 8, r.left - 20))) + 'px';
  }
  function fermer() { var o = document.getElementById('v2a-bf'); if (o) o.remove(); var b = document.getElementById('v2a-bf-bulle'); if (b) b.remove(); }
  function ouvrir() {
    fermer();
    var o = document.createElement('div');
    o.id = 'v2a-bf'; o.className = 'v2a-bf';
    o.innerHTML = '<div class="v2a-bf-fond"></div><article class="v2a-bf-carte" role="dialog" aria-label="Briefing du matin">'
      + '<header><span>Briefing du matin <small>sourcé</small></span><span class="v2a-bf-act"><button type="button" class="v2a-bf-regen">Rédiger maintenant</button>'
      + '<button type="button" class="v2a-bf-x" aria-label="Fermer">×</button></span></header><div class="v2a-bf-corps"><p class="v2a-bf-vide">Chargement…</p></div></article>';
    document.body.appendChild(o);
    o.querySelector('.v2a-bf-fond').onclick = fermer;
    o.querySelector('.v2a-bf-x').onclick = fermer;
    var zone = o.querySelector('.v2a-bf-corps');
    o.querySelector('.v2a-bf-regen').onclick = function (e) {
      var b = e.currentTarget; b.disabled = true; b.textContent = 'Rédaction…';
      fetch('/api/v2/briefing/regen', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j) { data = j; lu = Date.now(); } zone.innerHTML = corps(data); b.disabled = false; b.textContent = 'Rédiger maintenant'; majCarte(); })
        .catch(function () { b.disabled = false; b.textContent = 'Rédiger maintenant'; });
    };
    zone.addEventListener('click', function (e) { var c = e.target.closest('.v2a-bf-cite'); if (c) { e.stopPropagation(); bulle(c); } });
    charger(true).then(function (d) { zone.innerHTML = corps(d); });
  }
  document.addEventListener('click', function (e) { var b = document.getElementById('v2a-bf-bulle'); if (b && !e.target.closest('.v2a-bf-cite')) b.remove(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fermer(); });

  // Grand écran : bouton dans l'en-tête du Fil.
  function poserBouton() {
    var tete = document.querySelector('#view-news .panel-header');
    if (!tete || tete.querySelector('.v2a-bf-btn')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'v2a-bf-btn'; b.title = 'Briefing du matin sourcé';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><span>Briefing</span>';
    b.addEventListener('click', function (e) { e.stopPropagation(); ouvrir(); });
    var ctl = tete.querySelector('.panel-header-controls');
    if (ctl) ctl.insertBefore(b, ctl.firstChild); else tete.appendChild(b);
  }
  // App mobile : carte en tête de l'écran Marchés (créé par app-mobile.js).
  function majCarte() {
    var ecran = document.querySelector('.v2a-ecran');
    if (!ecran) return;
    var c = document.getElementById('v2a-bf-carte');
    if (!c) {
      c = document.createElement('section'); c.id = 'v2a-bf-carte'; c.className = 'v2a-bf-mini';
      ecran.insertBefore(c, ecran.firstChild);
      c.addEventListener('click', ouvrir);
    }
    charger().then(function (d) {
      var ok = d && !d.vide;
      c.innerHTML = '<div class="v2a-bf-mini-t">Briefing du matin <small>sourcé</small></div>'
        + (ok ? '<p>' + esc(d.titre) + '</p><span class="v2a-bf-mini-l">Lire · ' + ((d.faits || []).length) + ' faits sourcés</span>'
              : '<p class="v2a-bf-vide">' + esc((d && d.raison) || 'Pas encore rédigé.') + '</p>');
    });
  }
  function demarrer() { poserBouton(); majCarte(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
  // L'écran Marchés est créé à la première visite de l'onglet : on repasse à chaque navigation.
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.v2a-onglet')) setTimeout(majCarte, 250); });
  setInterval(function () { if (document.querySelector('.v2a-ecran') && !document.getElementById('v2a-bf-carte')) majCarte(); }, 2000);
  window._v2aBriefing = { ouvrir: ouvrir, charger: charger };
})();
