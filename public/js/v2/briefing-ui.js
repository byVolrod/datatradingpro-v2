/* ═══ DTP V3 · BRIEFING DU MATIN SOURCÉ : l'écran (comptes admin, derrière « Aperçu V2 ») ═══════════
   Le briefing est rédigé côté serveur à partir d'une FICHE DE FAITS, puis vérifié (briefing.js) :
   aucun chiffre ne passe s'il n'est pas dans la fiche. L'écran, lui, ne montre que le texte
   (25/09, « enlève les F[X] et la fiche de faits ») : les repères F1, F2… et la fiche dépliable
   encombraient la lecture. La vérification reste entière, côté serveur ; elle ne s'affiche plus.
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
  function point(p) { return '<li>' + esc(p.txt) + '</li>'; }
  function corps(d) {
    if (!d || d.vide) {
      return '<p class="v2a-bf-vide">' + esc((d && d.raison) || 'Pas encore rédigé.') + '</p>';
    }
    return '<div class="v2a-bf-meta">' + (d.aujourdhui === false ? '<b class="v2a-bf-ancien">Édition du ' + esc(d.jour) + '</b> · ' : '')
      + 'Rédigé à ' + esc(heure(d.genereA)) + '</div>'
      + '<h2 class="v2a-bf-titre">' + esc(d.titre) + '</h2>'
      + ((d.synthese || []).length ? '<ul class="v2a-bf-synth">' + d.synthese.map(point).join('') + '</ul>' : '')
      + (d.sections || []).map(function (s) { return '<section><h3>' + esc(s.titre) + '</h3><ul>' + s.points.map(point).join('') + '</ul></section>'; }).join('');
  }
  function fermer() { var o = document.getElementById('v2a-bf'); if (o) o.remove(); }
  function ouvrir() {
    fermer();
    var o = document.createElement('div');
    o.id = 'v2a-bf'; o.className = 'v2a-bf';
    o.innerHTML = '<div class="v2a-bf-fond"></div><article class="v2a-bf-carte" role="dialog" aria-label="Briefing du matin">'
      + '<header><span>Briefing du matin</span><span class="v2a-bf-act"><button type="button" class="v2a-bf-regen">Rédiger maintenant</button>'
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
    charger(true).then(function (d) { zone.innerHTML = corps(d); });
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fermer(); });

  // Grand écran : bouton dans l'en-tête du Fil.
  function poserBouton() {
    var tete = document.querySelector('#view-news .panel-header');
    if (!tete || tete.querySelector('.v2a-bf-btn')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'v2a-bf-btn'; b.title = 'Briefing du matin';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><span>Briefing</span>';
    b.addEventListener('click', function (e) { e.stopPropagation(); ouvrir(); });
    var ctl = tete.querySelector('.panel-header-controls');
    if (ctl) ctl.insertBefore(b, ctl.firstChild); else tete.appendChild(b);
  }
  // App mobile : carte en tête du PREMIER écran natif, le Fil depuis le 25/09 (créé par app-mobile.js).
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
      c.innerHTML = '<div class="v2a-bf-mini-t">Briefing du matin</div>'
        + (ok ? '<p>' + esc(d.titre) + '</p><span class="v2a-bf-mini-l">Lire le briefing</span>'
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
