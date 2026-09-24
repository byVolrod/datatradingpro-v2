/* ═══ DTP V2 · CHARGEUR (comptes admin uniquement) ════════════════════════════════════════════════
   Servi SEULEMENT à un compte admin (garde serveur avant le service statique : 404 pour tout autre
   compte), et chargé par index.html seulement si /api/auth/me répond `v2: true`.
   Rôle : poser l'interrupteur « Aperçu V2 » dans le volet Profil, et, s'il est activé, charger
   l'interface V2. Désactivé, RIEN d'autre n'est chargé : l'admin retrouve exactement le desk des
   clients. Le choix suit le COMPTE (préférence `v2`), d'un appareil à l'autre.
   Basculer recharge la page : c'est le seul moyen de garantir qu'aucun état V2 ne survit au retour. */
(function () {
  'use strict';
  if (window._dtpV2Boot) return;
  window._dtpV2Boot = true;

  var src = (document.currentScript && document.currentScript.src) || '';
  var VER = src.split('?v=')[1] || '';
  function actif() { try { return window.DTPPref && DTPPref.get('v2', '') === 'on'; } catch (e) { return false; } }

  function chargerInterface() {
    if (window._dtpV2Charge) return;
    window._dtpV2Charge = true;
    document.documentElement.classList.add('dtp-v2');
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = '/css/v2/app.css?v=' + VER;
    document.head.appendChild(l);
    var s = document.createElement('script');
    s.src = '/js/v2/app-mobile.js?v=' + VER; s.defer = true;
    document.head.appendChild(s);
  }

  function poserInterrupteur() {
    var corps = document.querySelector('#pd-drawer .pd-body');
    if (!corps || document.getElementById('v2-interrupteur')) return;
    var on = actif();
    var row = document.createElement('div');
    row.id = 'v2-interrupteur';
    row.setAttribute('style', 'display:flex;align-items:center;gap:12px;margin:10px 14px 6px;padding:12px 14px;'
      + 'border:1px solid rgba(227,178,58,.35);border-radius:8px;background:rgba(227,178,58,.06)');
    row.innerHTML = '<div style="flex:1;min-width:0">'
      + '<div style="font-weight:700;color:#e3b23a;letter-spacing:.02em">Aperçu V2 <span style="font-weight:500;color:#8b8b93">· admin</span></div>'
      + '<div style="font-size:11px;color:#8b8b93;margin-top:2px">Nouvelle interface en validation. Désactivé : le desk des clients, à l’identique.</div>'
      + '</div>'
      + '<button type="button" role="switch" aria-checked="' + on + '" aria-label="Aperçu V2" '
      + 'style="flex:0 0 auto;width:44px;height:26px;border-radius:13px;border:0;cursor:pointer;position:relative;'
      + 'background:' + (on ? '#e3b23a' : '#2a2a30') + ';transition:background .2s">'
      + '<span style="position:absolute;top:3px;left:' + (on ? '21px' : '3px') + ';width:20px;height:20px;border-radius:50%;'
      + 'background:#0c0c0e;transition:left .2s"></span></button>';
    row.querySelector('button').addEventListener('click', function () {
      var suivant = !actif();
      try { DTPPref.set('v2', suivant ? 'on' : ''); } catch (e) {}
      // Laisser partir l'écriture vers le compte avant de recharger.
      setTimeout(function () { location.reload(); }, 350);
    });
    corps.insertBefore(row, corps.firstChild);
  }

  function demarrer() {
    poserInterrupteur();
    if (actif()) chargerInterface();
  }
  /* ⚠️ CE FICHIER PEUT S'EXÉCUTER AVANT charts.js, qui définit le magasin de préférences : il est
     injecté dès la réponse de /api/auth/me, et un script injecté n'attend personne. Décider sans le
     magasin, c'est lire « désactivé » à coup sûr (mesuré au banc : l'admin qui avait activé la V2 ne
     la voyait jamais). On attend donc le magasin (20 s au plus), puis :
     le cache local du compte décide tout de suite (pas de flash de l'ancienne interface) et la
     réponse du compte confirme ensuite. */
  var essais = 0;
  (function attendre() {
    if (!(window.DTPPref && DTPPref.get)) { if (++essais < 200) setTimeout(attendre, 100); return; }
    if (actif()) chargerInterface();
    try { if (DTPPref.charger) DTPPref.charger(demarrer); else demarrer(); } catch (e) { demarrer(); }
  })();
})();
