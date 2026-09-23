
  // ── Auth check ──────────────────────────────────────────────────────────────
  fetch('/api/auth/me').then(r => r.json()).then(d => {
    if (!d.loggedIn) { window.location.href = '/login'; return; }
    if (d.user.role !== 'admin') { window.location.href = '/'; return; }
    document.getElementById('admin-name').textContent = d.user.name || d.user.email;
    loadUsers();
    loadFinance();
    loadAdChat();
    loadOverview();
    // Deep-link : restaure l'onglet (et la sous-vue campagne) depuis l'URL (#users, #aimon, #campaign/stats…)
    try {
      const h = location.hash.replace(/^#/, '');
      if (h) { const parts = h.split('/'); if (document.getElementById('tab-' + parts[0])) { admTab(parts[0]); if (parts[0] === 'campaign' && parts[1]) campSub(parts[1]); } }
    } catch (e) {}
    window.addEventListener('hashchange', () => {
      try { const parts = location.hash.replace(/^#/, '').split('/'); if (parts[0] && document.getElementById('tab-' + parts[0])) { admTab(parts[0]); if (parts[0] === 'campaign' && parts[1]) campSub(parts[1]); } } catch (e) {}
    });
    // Mise à jour AUTOMATIQUE en temps réel (plus de bouton Rafraîchir) :
    setInterval(loadAdChat, 10000);                          // conversations + en ligne : 10s
    setInterval(loadOverview, 60000);                        // bandeau santé + badges : 60s
    setInterval(() => {
      // Pas de re-render de la table pendant une confirmation inline ou une saisie (le bouton « Supprimer ? »
      // disparaissait sous la souris au tick de 45 s). loadUsers() cascade déjà loadFinance() → plus de double appel.
      const busy = document.querySelector('#tab-users [data-confirming]')
        || (document.activeElement && document.activeElement.closest && document.activeElement.closest('#tab-users input, #tab-users select, .modal.open'));
      if (busy) { loadFinance(); return; }
      loadUsers();
    }, 45000);
    // IA Monitor : auto-refresh 30 s si onglet ouvert + compte à rebours VISIBLE (piloté à la seconde,
    // même source de vérité _aimNextAt → l'heure affichée correspond toujours au vrai déclenchement).
    setInterval(() => {
      const t = document.getElementById('tab-aimon');
      const active = t && t.classList.contains('tab-panel--active');
      const nx = document.getElementById('aim-next');
      if (!active) { if (nx) nx.textContent = ''; return; }
      if (_aimNextAt && Date.now() >= _aimNextAt && !_aimBusy) { loadAIMon(); return; }
      if (nx && _aimNextAt) { const s = Math.max(0, Math.ceil((_aimNextAt - Date.now()) / 1000)); nx.textContent = '· prochaine MAJ dans ' + s + ' s'; }
    }, 1000);
    _liveArm();
  });

  // ── Actualisation dynamique : plus AUCUN bouton « Actualiser » ───────────────
  //    Un panneau d'exploitation ne doit jamais laisser se demander si ce qu'on lit est frais.
  //    UNE seule horloge pilote toutes les sources restantes. Chaque source déclare :
  //      per : sa période — une campagne en cours d'envoi bouge plus vite qu'un journal d'archives ;
  //      vu  : est-elle RÉELLEMENT à l'écran ? (onglet du rail ET sous-vue campagne) — rien ne tourne
  //            dans le vide, et l'aperçu e-mail surtout : chaque rendu reconstruit le mail et ses
  //            widgets côté serveur, c'est la requête la plus chère du panel ;
  //      occ : l'admin est-il en train d'agir dessus ? Un re-render arracherait le champ sous les
  //            doigts — c'est exactement le bug vécu sur la confirmation « Supprimer ? » qui
  //            disparaissait au tick. Un tick occupé n'est pas perdu : il est simplement reporté.
  //    Onglet navigateur en arrière-plan → tout gelé, et on rattrape d'un coup au retour.
  var _LIVE_SRC = [
    { k: 'campaign', per: 30000, zone: '#tab-campaign', go: function(){ loadCampaign(true); },
      vu: function(){ return _liveTab('campaign'); } },
    { k: 'maillog',  per: 120000, zone: '#tab-campaign', go: function(){ loadMailLog(); },
      vu: function(){ return _liveTab('campaign') && _liveSub('journal'); } },
    { k: 'apercu',   per: 45000, zone: '#tab-campaign', go: function(){ _cprevLoad(); },
      vu: function(){ return _liveTab('campaign') && _liveSub('templates'); } },
    // Les campagnes ne bougent qu'à l'envoi : 90 s suffisent, et seulement quand la LISTE est à
    // l'écran — le détail d'une campagne ne doit pas se re-rendre sous les doigts pendant qu'on le lit.
    { k: 'camps',    per: 90000, zone: '#tab-campaign', go: function(){ csLoad(); },
      vu: function(){ var e = document.getElementById('cs-ecran-liste');
                      return _liveTab('campaign') && _liveSub('stats') && !!e && !e.hidden; } },
  ];
  function _liveTab(n){ var t = document.getElementById('tab-' + n); return !!(t && t.classList.contains('tab-panel--active')); }
  function _liveSub(n){ return !!document.querySelector('#tab-campaign .camp-sub[data-sub="' + n + '"].active'); }
  // Occupé = saisie en cours, confirmation inline armée, ou fenêtre modale ouverte, dans CE panneau.
  function _liveOccupe(sel){
    var a = document.activeElement;
    if (a && a.closest && a.closest(sel + ' input, ' + sel + ' select, ' + sel + ' textarea')) return true;
    if (document.querySelector(sel + ' [data-confirming]')) return true;
    if (document.querySelector('.modal.open')) return true;
    return false;
  }
  function _liveArm(){
    _LIVE_SRC.forEach(function(s){ s.next = Date.now() + s.per; });
    setInterval(function(){
      var cache = document.visibilityState === 'hidden';
      var now = Date.now();
      _LIVE_SRC.forEach(function(s){
        var vu = !cache && s.vu();
        // PASTILLE MUTUALISÉE (13/08) : les sous-vues n'ont plus leur propre pastille « En direct ».
        // Sur Templates, Journal et Statistiques on en voyait DEUX clignoter à des rythmes différents
        // — celle de l'en-tête, visible sur les cinq vues, et celle de la vue — sans savoir laquelle
        // décrivait ce qu'on regarde. Les sources de l'onglet Campagne partagent donc celle de
        // l'en-tête. Seule la source de NIVEAU ONGLET ('campaign') pilote son état éteint : sinon une
        // source MASQUÉE (le journal pendant qu'on est sur Templates) l'éteindrait à tort.
        var pill = document.querySelector('.live-pill[data-live="' + s.k + '"]');
        var partagee = false;
        if (!pill && s.zone === '#tab-campaign') {
          pill = document.querySelector('.live-pill[data-live="campaign"]');
          partagee = true;
        }
        if (pill && !partagee) pill.classList.toggle('live-pill--off', !vu);
        if (!vu) { s.next = now + s.per; return; }            // masqué : on repart d'une période pleine au retour
        if (now < s.next) return;
        if (_liveOccupe(s.zone)) { s.next = now + 4000; return; }   // reporté, pas perdu
        s.next = now + s.per;
        try { s.go(); } catch (e) {}
        if (pill) { pill.classList.remove('live-pill--tick'); void pill.offsetWidth; pill.classList.add('live-pill--tick'); }
      });
    }, 1000);
  }

  // ── Navigation (rail latéral groupé par domaine — refonte 26/07) ────────────
  //    Chargement PARESSEUX conservé : une vue ne va chercher ses données qu'à son ouverture.
  /* PARTAGE DE COMPTE : comptes vus depuis plusieurs reseaux dans la fenetre courante.
     ⚠️ A LIRE COMME UN SIGNAL, PAS UNE PREUVE. Un client legitime sur son ordinateur ET son
     telephone en 4G apparait ici avec deux reseaux. C est le nombre de reseaux, et surtout sa
     PERSISTANCE d un jour a l autre, qui distinguent le vrai partage. Rien n est deconnecte
     automatiquement : la decision reste humaine, avec le bouton Deconnecter de la fiche.
     Le bloc reste MASQUE quand il n y a rien : un encart vide en permanence finit par etre ignore. */
  async function chargerPartage() {
    var box = document.getElementById("adm-partage");
    if (!box) return;
    try {
      var d = await fetch("/api/admin/partage").then(function (r) { return r.json(); });
      var l = (d && d.comptes) || [];
      if (!l.length) { box.style.display = "none"; box.innerHTML = ""; return; }
      box.style.display = "";
      box.innerHTML = "<div class=\"adm-partage-t\">" + l.length + " compte" + (l.length > 1 ? "s" : "")
        + " vu" + (l.length > 1 ? "s" : "") + " depuis plusieurs reseaux (" + (d.fenetreMin || 12) + " dernieres minutes)"
        + "<i>signal, pas preuve : un meme client sur ordinateur et telephone apparait ici</i></div>"
        + "<div class=\"adm-partage-l\">" + l.map(function (c) {
          return "<span class=\"adm-partage-c\">" + _esc2(c.nom || ("Compte " + String(c.userId).slice(0, 8)))
            + "<b>" + c.reseaux + " reseaux</b></span>";
        }).join("") + "</div>";
    } catch (e) { box.style.display = "none"; }
  }

  function admTab(name) {
    document.querySelectorAll('.rail-item').forEach(b => b.classList.toggle('rail-item--active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('tab-panel--active', p.id === 'tab-' + name));
    try { document.querySelector('.adm-main').scrollTop = 0; window.scrollTo(0, 0); } catch (e) {}
    try { if (location.hash.replace(/^#/, '').split('/')[0] !== name) history.replaceState(null, '', '#' + name); } catch (e) {}   // deep-link : F5 / partage d'URL conservent l'onglet
    if (name === 'dash') setTimeout(() => { Object.values(_amRoots).forEach(r => { try { r && r.resize && r.resize(); } catch {} }); }, 40);
    if (name === 'aimon') { loadAIMon(); setTimeout(() => { Object.values(_amRoots).forEach(r => { try { r && r.resize && r.resize(); } catch {} }); }, 60); }
    if (name === 'campaign') loadCampaign();
    if (name === 'api') loadApiKeys();
    if (name === 'users') chargerPartage();   // signal de partage, recalcule a chaque ouverture
  }

  // ── Accès API : gestion des clés (liste, création une-seule-fois, révocation inline) ──
  async function loadApiKeys() {
    const tb = document.getElementById('apikeys-tbody');
    try {
      const d = await fetch('/api/admin/api-keys').then(r => r.json());
      const keys = d.keys || [];
      if (!keys.length) { tb.innerHTML = '<tr><td colspan="8" style="color:#6f6f79;">Aucune clé : générez la première ci-dessus.</td></tr>'; return; }
      const fd = ts => ts ? new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
      tb.innerHTML = keys.map(k => `<tr data-kid="${k.id}" style="${k.revoked ? 'opacity:.45;' : ''}">
        <td style="color:#e6e6ea;font-weight:600;">${(k.name || '').replace(/</g, '&lt;')}</td>
        <td><code style="color:#9aa3b2;">${k.prefix || ''}</code></td>
        <td style="color:#8b93a1;">${fd(k.createdAt)}</td>
        <td style="color:#8b93a1;">${fd(k.lastUsedAt)}</td>
        <td style="color:#cbd5e1;">${k.calls || 0}</td>
        <td style="color:#8b93a1;">${k.rateLimit}/min</td>
        <td>${k.revoked ? '<span style="color:#ef4444;font-weight:600;">Révoquée</span>' : '<span style="color:#00e676;font-weight:600;">Active</span>'}</td>
        <td class="apikey-actions" style="white-space:nowrap;">${k.revoked
          ? `<button class="btn btn-sm" onclick="apiKeyAction('${k.id}','delete',this)">Supprimer</button>`
          : `<button class="btn btn-sm" onclick="apiKeyAction('${k.id}','revoke',this)">Révoquer</button>`}</td>
      </tr>`).join('');
    } catch (e) { tb.innerHTML = '<tr><td colspan="8" style="color:#ef4444;">Erreur de chargement : ' + e.message + '</td></tr>'; }
  }
  // Confirmation INLINE (2 clics, jamais de dialog natif) : 1er clic → le bouton devient « Confirmer ? » 4 s.
  async function apiKeyAction(id, mode, btn) {
    if (btn.dataset.confirming !== '1') {
      btn.dataset.confirming = '1';
      btn.textContent = mode === 'delete' ? 'Supprimer définitivement ?' : 'Confirmer la révocation ?';
      btn.style.color = '#ef4444';
      setTimeout(() => { if (btn.isConnected) { btn.dataset.confirming = ''; btn.textContent = mode === 'delete' ? 'Supprimer' : 'Révoquer'; btn.style.color = ''; } }, 4000);
      return;
    }
    btn.disabled = true;
    try {
      const r = await fetch('/api/admin/api-keys/' + encodeURIComponent(id) + '/' + mode, { method: 'POST' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'échec');
    } catch (e) { btn.disabled = false; btn.textContent = 'Erreur : ' + e.message; return; }
    loadApiKeys();
  }
  async function createApiKey() {
    const inp = document.getElementById('apikey-name'), btn = document.getElementById('apikey-create-btn');
    const name = (inp.value || '').trim();
    if (!name) { inp.focus(); inp.style.borderColor = '#ef4444'; setTimeout(() => { inp.style.borderColor = ''; }, 1500); return; }
    btn.disabled = true; btn.textContent = 'Génération…';
    try {
      const r = await fetch('/api/admin/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'échec');
      document.getElementById('apikey-new-value').textContent = d.key;
      document.getElementById('apikey-new').style.display = 'block';
      document.getElementById('apikey-copy-btn').textContent = 'Copier';
      inp.value = '';
      loadApiKeys();
    } catch (e) {
      const nb = document.getElementById('apikey-new');
      nb.style.display = 'block';
      document.getElementById('apikey-new-value').textContent = 'Erreur : ' + e.message;
    }
    btn.disabled = false; btn.textContent = '+ Générer une clé';
  }
  async function copyApiKey() {
    const v = document.getElementById('apikey-new-value').textContent || '';
    const b = document.getElementById('apikey-copy-btn');
    try { await navigator.clipboard.writeText(v); b.textContent = 'Copié ✓'; }
    catch { b.textContent = 'Sélectionnez et copiez manuellement'; }
  }
  // ── Bandeau SANTÉ GLOBALE + badges d'alerte sur les onglets (poll léger 60 s) ──
  async function loadOverview() {
    try {
      const o = await fetch('/api/admin/overview').then(r => r.json());
      if (!o) return;
      const pill = (ok, okTxt, badTxt) => '<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid ' + (ok ? 'rgba(0,230,118,.35)' : 'rgba(255,61,0,.5)') + ';color:' + (ok ? '#00e676' : '#ff6b57') + ';background:' + (ok ? 'rgba(0,230,118,.06)' : 'rgba(255,61,0,.08)') + ';">' + (ok ? '●' : '▲') + '&nbsp;' + (ok ? okTxt : badTxt) + '</span>';
      const strip = document.getElementById('adm-health');
      if (strip) strip.innerHTML =
        pill(o.aiOk, 'IA opérationnelle', 'IA en backoff') +
        pill(o.mailOk, 'Mail OK', 'Mail en panne') +
        pill(!o.campCrit, 'Campagnes : aucun incident', 'Campagnes : ' + o.campCrit + ' incident(s) critiques 48 h') +
        '<span style="color:#8b93a1;font-size:12px;">Campagne : ' + ((o.dripActive || o.blastActive) ? '<span style="color:#00e676;font-weight:700;">lancée</span>' : 'en pause') + '</span>';
      const bAi = document.getElementById('adm-tab-aimon-b');
      if (bAi) bAi.style.display = (o.aiOk && o.mailOk) ? 'none' : 'inline-flex';
      const bC = document.getElementById('adm-tab-camp-b');
      if (bC) { bC.style.display = o.campCrit ? 'inline-flex' : 'none'; bC.textContent = o.campCrit; }
    } catch (e) {}
  }

  // ── Campagne e-mail marketing ──────────────────────────────────────────────
  let _campAud = null, _campArmed = false, _campArmTimer = null, _campPoll = null;
  // ── DATES DU PANNEAU : DEUX FORMATEURS, PAS CINQ (13/08) ────────────────────────────────────
  // La même notion — « quand » — s écrivait de cinq façons selon l onglet : 13/08 14:32 (Pilotage),
  // 13/08/2026 14:32 (Journal ET incidents, deux fois le même code), 13 août 26, 14:32
  // (Statistiques), 13 août (séquence). Comparer « le mail est parti le 13/08 » entre le Journal et
  // les Statistiques demandait une conversion mentale. Désormais :
  //   _dt(ts) → 13/08/2026 14:32   (date + heure, partout)
  //   _dj(ts) → 13 août            (jour seul, quand l heure n apporte rien)
  // _csHeure (heure seule) reste : c est un autre besoin, pas une 3e écriture de la date.
  function _dt(ts){ try { return ts ? new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '-'; } catch (e) { return '-'; } }
  function _dj(ts){ try { return ts ? new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : ''; } catch (e) { return ''; } }
  function _campMsg(t){ const e = document.getElementById('camp-msg'); if (e) e.textContent = t || ''; if (t && /[✅❌]/.test(t)) campToast(t, /❌/.test(t)); }
  // DEUX SYSTÈMES DE NOTIFICATION cohabitaient (13/08) : campToast, qui écrivait dans un conteneur
  // statique #camp-toasts, et showToast, qui crée le sien à la volée — positionnés EXACTEMENT au même
  // coin, donc capables de se superposer. Les styles des bulles étaient déjà mutualisés en CSS, ce qui
  // montrait que la duplication n était que structurelle. campToast devient un simple alias.
  function campToast(msg, isErr){ showToast(msg, isErr ? 'err' : ''); }   // showToast : déclaration hoistée
  // Repli du « Détail par contenu » : volatil à dessein — c est un confort d écran, pas un réglage
  // qui mérite d être mémorisé. Le détail se recharge tout seul quand il est ouvert.
  function campToggleSeq(){
    var w = document.getElementById('camp-seq-wrap'), b = document.getElementById('camp-seq-fold');
    if (!w || !b) return;
    var ouvert = w.hidden;
    w.hidden = !ouvert;
    b.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
    var ch = b.querySelector('.camp-fold-ch'); if (ch) ch.textContent = ouvert ? '▾' : '▸';
    if (ouvert) loadSequence();
  }
  function campSub(name){
    if (name === 'dashboard' || name === 'campagnes') name = 'pilotage';   // anciens onglets fusionnés dans « Pilotage »
    if (!document.querySelector('#tab-campaign .camp-sub[data-sub="' + name + '"]')) name = 'pilotage';   // deep-link inconnu → Pilotage
    document.querySelectorAll('#camp-nav .camp-nav-btn').forEach(function(b){ b.classList.toggle('active', b.dataset.sub === name); });
    document.querySelectorAll('#tab-campaign .camp-sub').forEach(function(s){ s.classList.toggle('active', s.dataset.sub === name); });
    try { history.replaceState(null, '', '#campaign/' + name); } catch (e) {}   // deep-link sous-vue campagne
    // Aperçu PARESSEUX : l'iframe ne vit QUE dans l'onglet Templates (chaque rendu = reconstruction
    // serveur du mail + de ses widgets). Hors Templates → timer coupé, iframe jamais chargée d'office.
    if (name === 'templates') { _campTplRender(); if (!window._cprevType) tplSelect('intro'); else { tplSelect(window._cprevType); } }
    else if (window._cprevTimer) { clearInterval(window._cprevTimer); window._cprevTimer = null; }
    if (name === 'journal') loadMailLog();
    if (name === 'stats') csLoad();   // sinon on attendrait le tic de 90 s de la source « camps »
  }
  // ── Bibliothèque de templates (aperçu + test par template, TOUS les templates y compris one-shot) ──
  const _CAMP_TPLS = [
    { prev:'intro',       test:'intro',       name:'Bienvenue',            when:'Intro',      desc:'Présentation du desk + la semaine type (1er mail de la séquence).' },
    { prev:'decryptage',  test:'decryptage',  name:'Comprendre le marché', when:'Mardi',      desc:'Un concept macro choisi selon l\'actualité, décodé simplement.' },
    { prev:'pointmarche', test:'pointmarche', name:'Point marché',         when:'Mercredi',   desc:'Le brief du desk : séance, chiffres éco, force des devises.' },
    { prev:'mindset',     test:'mindset',     name:'Mindset',              when:'Jeudi',      mindset:true, desc:'Psychologie et discipline de trading : 25 thèmes en rotation, un par semaine. Le sélecteur permet de tous les relire.' },
    { prev:'weekly',      test:null,          name:'Récap hebdo',          when:'Samedi',     desc:'Rétrospective de la semaine, devise par devise (rendu dispo après génération du récap).' },
    { prev:'outlook',     test:'outlook',     name:'Semaine à venir',      when:'Dimanche',   desc:'L\'agenda éco trié par le desk pour la semaine qui s\'ouvre.' },
    { prev:'invitation',  test:'invitation',  name:'Invitation',           when:'Conversion', desc:'3 variantes (pro / conviviale / performance) : aperçu par variante.', variants:true },
    { prev:'parrainage',  test:'parrainage',  broadcast:'parrainage', broadcastLabel:'Lancer maintenant à toute la liste…', broadcastTitre:'Envoi du parrainage', name:'Parrainage',   when:'Tous les 6 mois', desc:'Le programme d\'affiliation annoncé à toute la liste : 15% à vie, 1 mois offert tous les 3 filleuls. Part tout seul tous les 6 mois, le lundi 11h-14h, le compte à rebours repartant du dernier envoi. Quatre angles se succèdent dans l\'ordre — un client ne relit le même mail qu\'au bout de deux ans. L\'aperçu ci-contre montre CELUI QUI PART AU PROCHAIN ENVOI ; les quatre se relisent dans la galerie d\'aperçu des e-mails.' },
    { prev:'app-desktop', test:'app-desktop', name:'Annonce app desktop',  when:'One-shot',   oneshot:true, desc:'Annonce de l\'application Windows/macOS (campagne app-desktop-v1).' },
    { prev:'desk-widgets', test:'desk-widgets', name:'Annonce accueil & Mon Desk', when:'One-shot', oneshot:true, desc:'Les deux nouveautés : l\'écran d\'accueil « Vue d\'ensemble », et Mon Desk : widgets composables, plusieurs dispositions, enregistrées par compte (campagne desk-widgets-v1).' },
    { prev:'bibliotheque-widgets', test:'bibliotheque-widgets', broadcast:'bibliotheque-widgets', name:'Annonce bibliothèque de widgets', when:'One-shot', oneshot:true, desc:'Quatorze widgets de plus dans Mon Desk : cotations, amplitude et volatilité, macro, outils. Envoi UNIQUE à toute la liste, hors rotation hebdomadaire (campagne bibliotheque-widgets-v1). Par défaut le mail annonce une arrivée progressive : les 14 widgets sont encore en rodage interne.' },
    // ── CYCLE DE VIE (transactionnels : déclenchés par l'état du compte, pas par le calendrier).
    //    Ajoutés le 27/07 pour pouvoir les RELIRE avant de valider un rattrapage. Pas de bouton « Test »
    //    (ils s'envoient sur événement) — l'aperçu suffit à vérifier le rendu.
    { prev:'trial-upsell',   test:null, name:'Fin d\'essai gratuit',  when:'Auto · fin d\'essai',  lifecycle:'trial-upsell', desc:'Part le jour où l\'essai expire. Rattrapage possible via « Comptes sans ce mail ».' },
    { prev:'expired',        test:null, name:'Abonnement expiré',     when:'Auto · à l\'échéance', lifecycle:'expired',      desc:'Part quand l\'abonnement payant arrive à échéance.' },
    { prev:'expired-7j',     test:null, name:'Relance J+7',           when:'Auto · J+7',           lifecycle:'expired-7j',   desc:'Dernier rappel automatique, 7 jours après l\'expiration si toujours pas renouvelé.' },
    { prev:'winback',        test:null, name:'Win-back (jalons)',     when:'Auto · 1/3/6/12 mois', winback:true,             desc:'« Ça fait X que vous nous avez quittés » : 4 jalons après le départ, copy adaptée à l\'ancienneté.' },
    { prev:'temoignage',     test:null, name:'Témoignage membre',     when:'Manuel · validation',  desc:'Un avis Whop réel + l\'histoire de JustOneTrader et du terminal. Ne part JAMAIS seul : aperçu pour validation.' },
    { prev:'reengagement',   test:null, name:'Réengagement',          when:'Auto · inactif 7j',    desc:'Relance d\'un client inactif depuis ~7 jours.' },
    { prev:'renewal-failed', test:null, name:'Renouvellement échoué', when:'Auto · sur échec',     desc:'Envoyé quand un paiement échoue / le compte est suspendu.' },
    { prev:"auto-renew-off", test:null, name:"Renouvellement auto coupé", when:"Auto · à la coupure", desc:"Part quand un client désactive la reconduction côté Whop. L'accès reste actif jusqu'à l'échéance : le mail informe, une seule fois par échéance." },
    { prev:'welcome',        test:null, name:'Bienvenue (accès)',     when:'Auto · création',      desc:'Identifiants d\'accès envoyés à la création du compte.' },
  ];
  // Liste maître (gauche) : un clic sélectionne le template → l'aperçu se charge à DROITE, les
  // actions contextuelles (variantes / test / rattrapage) suivent dans la barre au-dessus du cadre.
  function _campTplRender(){
    const g = document.getElementById('camp-tpl-grid'); if (!g || g.dataset.done) return;
    g.dataset.done = '1';
    _bcCharger(function(){ try { if (window._cprevType) tplSelect(window._cprevType); } catch (e) {} });
    g.innerHTML = _CAMP_TPLS.map(function(t){
      return '<button type="button" class="tpl-item" data-tpl="' + t.prev + '" onclick="tplSelect(\'' + t.prev + '\')">'
        + '<span class="tpl-item-name">' + t.name + '</span>'
        + '<span class="tpl-when' + (t.oneshot ? ' tpl-when--oneshot' : '') + '">' + t.when + '</span></button>';
    }).join('');
  }
  /* ETAT DURABLE DES DIFFUSIONS. Le bouton « lancer a toute la liste » ne doit pas survivre a son
     envoi (04/09, demande user). On lit le journal des envois, pas un compteur en memoire : Render
     endort le service et un compteur en memoire ferait reapparaitre le bouton au reveil, sur une
     campagne deja partie.
     ⚠️ TANT QUE LA MESURE N'EST PAS REVENUE, LE BOUTON RESTE. `null` (pas encore charge, ou journal
     illisible) n'est PAS « deja envoye » : masquer sur une mesure absente cacherait un envoi qui
     n'a jamais eu lieu. Un bouton de trop se voit ; un mail jamais parti, non. */
  var _campBroadcasts = null;
  function _bcCharger(apres){
    fetch('/api/admin/campaign-broadcasts').then(function(r){ return r.json(); }).then(function(d){
      if (d && d.ok && d.etats) _campBroadcasts = d.etats;
      if (typeof apres === 'function') apres();
    }).catch(function(){ if (typeof apres === 'function') apres(); });
  }
  function _bcEtat(tpl){ return (_campBroadcasts && _campBroadcasts[tpl]) || null; }

  function tplSelect(prev){
    var t = _CAMP_TPLS.find(function(x){ return x.prev === prev; }); if (!t) return;
    var d = document.getElementById('cprev-desc'); if (d) d.textContent = t.desc || '';
    var acts = [];
    if (t.variants) acts = ['<button class="camp-btn" onclick="campPreviewInvit(0)">Pro</button>',
                            '<button class="camp-btn" onclick="campPreviewInvit(1)">Conviviale</button>',
                            '<button class="camp-btn" onclick="campPreviewInvit(2)">Perf.</button>'];
    if (t.winback) acts = ['<button class="camp-btn" onclick="campPreviewWinback(1)">1 mois</button>',
                           '<button class="camp-btn" onclick="campPreviewWinback(3)">3 mois</button>',
                           '<button class="camp-btn" onclick="campPreviewWinback(6)">6 mois</button>',
                           '<button class="camp-btn" onclick="campPreviewWinback(12)">1 an</button>',
                           '<button class="camp-btn" onclick="lifecycleOpen(\'winback-\' + (window._cprevMonths || 3) + \'m\')">Comptes sans ce jalon</button>'];
    // Mindset : un menu déroulant des 25 thèmes — chacun doit pouvoir être relu avant de partir.
    if (t.mindset) acts.push('<select class="camp-btn" id="cprev-mindset" onchange="campPreviewMindset(this.value)" style="max-width:280px;"><option value="">Thème de la semaine</option></select>');
    if (t.test) acts.push('<button class="camp-btn" onclick="campDripTest(\'' + t.test + '\')">🧪 Test sur ma boîte</button>');
    if (t.lifecycle) acts.push('<button class="camp-btn" onclick="lifecycleOpen(\'' + t.lifecycle + '\')">Comptes sans ce mail</button>');
    // Envoi UNIQUE : le bouton vit SOUS l'aperçu — on ne peut pas déclencher sans avoir le mail
    // sous les yeux. Il ouvre le MODE BLANC, jamais l'envoi directement.
    /* Le libelle dit ce que fait le bouton POUR CE TEMPLATE. « Envoi unique » est juste pour une
       annonce, faux pour le parrainage, qui revient tous les six mois : lu sur une campagne
       recurrente, il laisse croire qu'un clic brule l'unique occasion de l'envoyer. */
    if (t.broadcast) {
      var _bc = _bcEtat(t.broadcast);
      /* RIEN A LA PLACE DU BOUTON (04/09, demande user : « tu peux le faire disparaitre maintenant,
         vu que c'est dans la boucle programmee »). J'avais mis un bandeau « deja parti le … » en
         me disant qu'un bouton qui s'efface sans un mot se lit comme une panne. C'etait vrai le
         temps de le decouvrir ; ca ne l'est plus une fois la campagne partie et la cadence en
         route. Et l'explication n'a pas disparu pour autant : la fiche du template porte, en
         permanence, « Part tout seul tous les 6 mois, le lundi 11h-14h ». C'est la qu'elle a sa
         place — dans la description du contenu, pas en bandeau de succes qui survit a l'evenement
         qu'il annonce. */
      if (_bc && _bc.envoye) {
        /* rien : la fiche dit deja que ce contenu part tout seul */
      } else {
        acts.push('<button class="camp-btn" onclick="oneshotOpen(\'' + t.broadcast + '\')">' + (t.broadcastLabel || 'Envoi unique à toute la liste…') + '</button>');
      }
    }
    var a = document.getElementById('cprev-actions'); if (a) a.innerHTML = acts.join('');
    if (t.mindset) _msFill();
    if (t.variants) campPreviewInvit(0);
    else if (t.winback) campPreviewWinback(3);
    else { window._cprevConcept = null; campPreview(t.prev); }
  }
  // ── ENVOI UNIQUE (20/08) : mode blanc PUIS confirmation inline PUIS envoi + suivi. ──
  // Le mode blanc (?plan=1) répond contact par contact : à envoyer / déjà servi / désabonné.
  // Si le journal d'envois est inaccessible, le serveur répond 503 « mesure indisponible » et
  // AUCUN bouton d'envoi n'est affiché : on n'envoie pas en masse à l'aveugle.
  var _osTpl = null;
  function oneshotOpen(tpl){
    _osTpl = tpl;
    var m = document.getElementById('oneshot-modal'); if (!m) return;
    m.classList.add('open');
    var _osT = _CAMP_TPLS.find(function (x) { return x.broadcast === tpl; });
    document.getElementById('os-title').textContent = ((_osT && _osT.broadcastTitre) || 'Envoi unique') + ' : ' + tpl;
    document.getElementById('os-body').innerHTML = '<div class="skel" style="height:120px"></div>';
    document.getElementById('os-actions').innerHTML = '';
    fetch('/api/admin/campaign-send?plan=1&tpl=' + encodeURIComponent(tpl))
      .then(function(r){
        // r.ok AVANT r.json : un 403/409/503 porte un message qu'il faut MONTRER, pas avaler.
        return r.json().then(function(j){ return { ok: r.ok, j: j }; });
      })
      .then(function(x){
        var b = document.getElementById('os-body'), a = document.getElementById('os-actions');
        if (!b) return;
        var j = x.j || {};
        if (!x.ok || j.mesure === 'indisponible') {
          b.innerHTML = '<p class="hint" style="color:var(--red,#ef4444)">' + (j.error || 'Mode blanc indisponible.') + '</p>';
          a.innerHTML = '<button class="camp-btn" onclick="oneshotClose()">Fermer</button>';
          return;
        }
        var c = j.compte || {};
        b.innerHTML = '<p class="hint">Campagne <b>' + (j.campaign || '') + '</b> : ' + (j.total || 0) + ' contact(s).'
          + ' À envoyer : <b>' + (c['a-envoyer'] || 0) + '</b> · Déjà servis : <b>' + (c['deja-servi'] || 0) + '</b>'
          + ' · Désabonnés : <b>' + (c['desabonne'] || 0) + '</b>.</p>'
          + '<p class="hint">Le drip hebdo sera mis en pause pendant la diffusion, puis remis dans son état d\'avant.</p>'
          + '<div style="max-height:320px;overflow:auto;border:1px solid var(--line,#26262c);border-radius:6px">'
          + '<table class="admin-table"><thead><tr><th>E-mail</th><th>Source</th><th>État</th></tr></thead><tbody>'
          + (j.contacts || []).map(function(ct){
              var col = ct.etat === 'a-envoyer' ? 'var(--green,#22c55e)' : ct.etat === 'desabonne' ? 'var(--red,#ef4444)' : 'var(--muted,#9ca3af)';
              return '<tr><td>' + ct.email + '</td><td>' + (ct.src || '') + '</td><td style="color:' + col + '">' + ct.etat + '</td></tr>';
            }).join('')
          + '</tbody></table></div>';
        var n = c['a-envoyer'] || 0;
        a.innerHTML = '<button class="camp-btn" onclick="oneshotClose()">Annuler</button>'
          + (n > 0 ? '<button class="camp-btn camp-btn--danger" onclick="oneshotArm(this,' + n + ')">Envoyer à ' + n + ' contact(s)…</button>' : '');
      })
      .catch(function(e){
        var b = document.getElementById('os-body');
        if (b) b.innerHTML = '<p class="hint" style="color:var(--red,#ef4444)">Erreur réseau : ' + e.message + '</p>';
      });
  }
  // Confirmation INLINE en deux temps (jamais de dialog natif) : le 1er clic arme, le 2e envoie.
  function oneshotArm(btn, n){
    btn.textContent = 'Confirmer l\'envoi RÉEL à ' + n + ' contact(s)';
    btn.onclick = function(){ oneshotSend(); };
  }
  function oneshotSend(){
    if (!_osTpl) return;
    var a = document.getElementById('os-actions');
    if (a) a.innerHTML = '<span class="hint">Lancement…</span>';
    fetch('/api/admin/campaign-send?send=1&tpl=' + encodeURIComponent(_osTpl))
      .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
      .then(function(x){
        var b = document.getElementById('os-body'), a2 = document.getElementById('os-actions');
        if (!x.ok) {
          if (b) b.innerHTML = '<p class="hint" style="color:var(--red,#ef4444)">' + ((x.j || {}).error || 'Refusé.') + '</p>';
          if (a2) a2.innerHTML = '<button class="camp-btn" onclick="oneshotClose()">Fermer</button>';
          return;
        }
        if (b) b.innerHTML = '<p class="hint">Diffusion lancée en arrière-plan (' + ((x.j || {}).eligible || '?') + ' cible(s)).</p><div id="os-suivi" class="hint"></div>';
        if (a2) a2.innerHTML = '<button class="camp-btn" onclick="oneshotClose()">Fermer</button>';
        var t = setInterval(function(){
          var s = document.getElementById('os-suivi');
          if (!s) { clearInterval(t); return; }
          fetch('/api/admin/campaign-send?status=1&tpl=' + encodeURIComponent(_osTpl)).then(function(r){ return r.json(); }).then(function(j){
            var st = j.state || j;
            s.textContent = 'Envoyés : ' + (st.sent || 0) + ' · Déjà servis : ' + (st.skipped || 0)
              + ' · Désabonnés : ' + (st.unsub || 0) + ' · Échecs : ' + (st.failed || 0)
              + (st.running ? ' · en cours…' : ' · terminé.');
            if (!st.running) {
              clearInterval(t);
              // La diffusion est finie : on relit le journal et on redessine la barre d'actions,
              // pour que le bouton s'efface sans avoir a recharger le panneau.
              _bcCharger(function(){ try { if (window._cprevType) tplSelect(window._cprevType); } catch (e) {} });
            }
          }).catch(function(){});
        }, 2500);
      })
      .catch(function(){});
  }
  function oneshotClose(){ var m = document.getElementById('oneshot-modal'); if (m) m.classList.remove('open'); _osTpl = null; }
  window.oneshotOpen = oneshotOpen; window.oneshotSend = oneshotSend; window.oneshotClose = oneshotClose; window.oneshotArm = oneshotArm;

  // Mindset : prévisualise un thème précis. La liste est chargée une fois puis gardée.
  var _msList = null;
  function campPreviewMindset(k){
    window._cprevType = 'mindset'; window._cprevVariant = null; window._cprevMonths = null;
    window._cprevConcept = k || null; window._cprevRetryCount = 0;
    _cprevLoad(); _cprevMark(); _cprevArm();
  }
  function _msFill(){
    var sel = document.getElementById('cprev-mindset'); if (!sel) return;
    var pose = function(items){
      sel.innerHTML = '<option value="">Thème de la semaine</option>'
        + items.map(function(i){ return '<option value="' + i.key + '">' + (i.ia ? '✦ ' : '') + (i.subject || i.key).replace(/</g,'&lt;') + '</option>'; }).join('');
      if (window._cprevConcept) sel.value = window._cprevConcept;
    };
    if (_msList) { pose(_msList); return; }
    fetch('/api/admin/mindset-concepts').then(function(r){ return r.json(); }).then(function(j){
      _msList = (j && j.items) || []; pose(_msList);
    }).catch(function(){});
  }
  // Win-back : prévisualise un jalon précis (1/3/6/12 mois après le départ).
  function campPreviewWinback(m){
    window._cprevType = 'winback'; window._cprevVariant = null; window._cprevMonths = m;
    window._cprevRetryCount = 0;
    _cprevLoad(); _cprevMark(); _cprevArm();
  }
  // ══ RATTRAPAGE CYCLE DE VIE (demande user 27/07 « je valide l'envoi aux comptes qui n'ont pas reçu ») ══
  // Les mails de cycle de vie ne partent automatiquement que DANS leur fenêtre (48 h / 24 h) : les comptes
  // sortis de cette fenêtre ne sont jamais relancés tout seuls. Cet écran les liste et laisse l'admin
  // choisir, compte par compte. Rien n'est envoyé sans (1) une sélection explicite, (2) une confirmation.
  let _lcType = null, _lcRows = [], _lcArmed = false, _lcTimer = null;
  async function lifecycleOpen(type){
    _lcType = type; _lcArmed = false; clearTimeout(_lcTimer);
    const m = document.getElementById('lifecycle-modal');
    const body = document.getElementById('lc-body');
    if (!m || !body) return;
    m.classList.add('open');
    body.innerHTML = '<div class="skel" style="height:120px"></div>';
    document.getElementById('lc-actions').innerHTML = '';
    try {
      const d = await fetch('/api/admin/lifecycle-pending?type=' + encodeURIComponent(type)).then(r => r.json());
      if (!d.ok) throw new Error(d.error || 'erreur');
      _lcRows = d.pending || [];
      document.getElementById('lc-title').textContent = d.label + ' : comptes sans ce mail';
      if (!_lcRows.length) {
        body.innerHTML = '<div class="empty-state">Aucun compte en attente : tous ceux dont l\'échéance est passée ont déjà reçu ce mail (' + d.alreadySent + ' au total).</div>';
        return;
      }
      body.innerHTML =
        '<p class="hint" style="margin-bottom:10px">' + _lcRows.length + ' compte(s) dont l\'échéance est passée n\'ont jamais reçu ce mail'
        + (d.alreadySent ? ' · ' + d.alreadySent + ' déjà servi(s)' : '')
        + '. Coche ceux à relancer : un envoi par compte, jamais de doublon.</p>'
        + '<div class="row-inline" style="margin-bottom:8px"><button class="btn" onclick="lifecycleAll(1)">Tout cocher</button>'
        + '<button class="btn" onclick="lifecycleAll(0)">Tout décocher</button></div>'
        + '<div class="table-wrap"><table class="users-table"><thead><tr><th style="width:34px"></th><th>E-mail</th><th>Échéance</th><th>Ancienneté</th><th>État</th></tr></thead><tbody>'
        + _lcRows.map(function(u, i){
            const vieux = u.joursDepuis > 30;
            return '<tr><td><input type="checkbox" class="lc-ck" data-email="' + _escH(u.email) + '"'
              + (vieux || u.donneeIncoherente ? '' : ' checked') + ' style="width:auto"></td>'
              + '<td>' + _escH(u.email) + '</td>'
              + '<td>' + (u.expiresAt ? String(u.expiresAt).slice(0, 10) : '-') + '</td>'
              + '<td>' + u.joursDepuis + ' j</td>'
              + '<td>' + (u.donneeIncoherente ? '<span class="badge badge-expired">date incohérente</span>'
                        : vieux ? '<span class="badge badge-soon">ancien</span>'
                        : '<span class="badge badge-active">récent</span>')
              + (u.actif ? '' : ' <span class="badge badge-suspended">suspendu</span>') + '</td></tr>';
          }).join('')
        + '</tbody></table></div>'
        + '<p class="hint" style="margin-top:8px">Les comptes de plus de 30 jours et ceux aux dates incohérentes (import) sont <strong>décochés par défaut</strong> : un « votre abonnement a expiré » reçu longtemps après coup fait mauvais effet.</p>';
      document.getElementById('lc-actions').innerHTML =
        '<button class="btn" onclick="lifecycleClose()">Annuler</button>'
        + '<button class="btn btn-primary" id="lc-send" onclick="lifecycleSend()">Envoyer aux comptes cochés</button>';
    } catch (e) {
      body.innerHTML = '<div class="empty-state">Erreur : ' + _escH(e.message) + '</div>';
    }
  }
  function lifecycleAll(on){ document.querySelectorAll('.lc-ck').forEach(function(c){ c.checked = !!on; }); }
  function lifecycleClose(){ const m = document.getElementById('lifecycle-modal'); if (m) m.classList.remove('open'); _lcArmed = false; clearTimeout(_lcTimer); }
  async function lifecycleSend(){
    const emails = Array.from(document.querySelectorAll('.lc-ck')).filter(c => c.checked).map(c => c.dataset.email);
    const btn = document.getElementById('lc-send');
    if (!emails.length) { btn.textContent = 'Aucun compte coché'; setTimeout(function(){ btn.textContent = 'Envoyer aux comptes cochés'; }, 1600); return; }
    // Confirmation en 2 temps (même garde que le lancement de campagne) : envoi RÉEL à des clients.
    if (!_lcArmed) {
      _lcArmed = true;
      btn.textContent = 'Confirmer l\'envoi à ' + emails.length + ' compte(s) ?';
      btn.classList.add('camp-btn--armed');
      clearTimeout(_lcTimer);
      _lcTimer = setTimeout(function(){ _lcArmed = false; btn.textContent = 'Envoyer aux comptes cochés'; btn.classList.remove('camp-btn--armed'); }, 6000);
      return;
    }
    _lcArmed = false; clearTimeout(_lcTimer);
    btn.disabled = true; btn.textContent = 'Envoi…'; btn.classList.remove('camp-btn--armed');
    try {
      const d = await fetch('/api/admin/lifecycle-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: _lcType, emails }),
      }).then(r => r.json());
      if (d.ok) {
        campToast(d.envoyes + ' mail(s) envoyé(s)' + (d.echecs && d.echecs.length ? ' · ' + d.echecs.length + ' échec(s)' : ''), !!(d.echecs && d.echecs.length));
        lifecycleClose();
      } else { btn.disabled = false; btn.textContent = 'Échec : ' + (d.error || '?'); }
    } catch (e) { btn.disabled = false; btn.textContent = 'Erreur réseau'; }
  }

  function _lucide(n){
    const p = {
      'users':'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      'user-check':'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
      'crown':'<path d="M3 8l4 3 5-6 5 6 4-3-2 11H5z"/><line x1="5" y1="21" x2="19" y2="21"/>',
      'user-plus':'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/>',
      'user-minus':'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="16" y1="11" x2="22" y2="11"/>',
      'clock':'<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
      'bell-off':'<path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.9 17.9 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/>',
      'ban':'<circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/>',
      'mail-open':'<path d="M22 13V8a2 2 0 0 0-1-1.73L12 2 3 6.27A2 2 0 0 0 2 8v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2z"/><polyline points="2 8 12 14 22 8"/>',
      'pointer':'<path d="M3 3l7 18 2.5-7.5L20 11z"/>',
      'send':'<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
      'calendar':'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (p[n] || '') + '</svg>';
  }
  async function loadDashboard(){
    // ── GRILLE « VUE D ENSEMBLE » RETIRÉE (13/08, demande user « trop d information, simplifie ») ──
    // Ses 12 cartes ne portaient que 6 nombres distincts, et 4 étaient faux :
    //  · « Actifs » et « Clients Premium » affichaient LE MÊME nombre (segments.active recompté),
    //    « Churn » et « Comptes expirés » aussi (segments.churned) — 4 cartes, 2 chiffres ;
    //  · « Taux d ouverture », « CTR » et « Dernière campagne » ne mesuraient QUE le mail Bienvenue
    //    (_campaignStats['intro-v1']) tout en s intitulant comme s ils couvraient la campagne ;
    //  · « Prochaine campagne » cherchait une étape jamais envoyée : la rotation étant infinie et
    //    toutes les étapes déjà parties, elle affichait « — / Séquence terminée » À VIE.
    // Les 8 cartes restantes (total, actifs, leads, churn, désabonnés, blacklist, sources) sont déjà
    // affichées par l onglet AUDIENCE, qui est leur place. Rien n est perdu, un écran est allégé.
    // Les vrais chiffres par envoi vivent dans l onglet STATISTIQUES.
    try {
      const d = await fetch('/api/admin/campaign-dashboard').then(function (r) { return r.json(); });
      if (!d || !d.deliverability) return;
      const dv = d.deliverability, ch = dv.checks;
      // « Score 100 » était une CONSTANTE côté serveur : rien n'était mesuré. On ne remplace pas un
      // faux chiffre par un autre — l'anneau disparaît et la section dit ce qu'elle est vraiment.
      const dlab = function(s){ return s === 'pass' ? 'Validé' : (s === 'info' ? 'À surveiller' : (s === 'declare' ? 'Déclaré' : 'Échec')); };
      const dcls = function(s){ return s === 'pass' ? 'pass' : (s === 'info' ? 'info' : (s === 'declare' ? 'info' : 'fail')); };
      const rows = [['SPF',ch.spf],['DKIM',ch.dkim],['DMARC',ch.dmarc],['SMTP',ch.smtp],['Blacklist',ch.blacklist]];
      document.getElementById('camp-deliv').innerHTML =
        '<div class="deliv-wrap deliv-wrap--compact"><div class="deliv-rows">' +
        rows.map(function(x){ return '<div class="deliv-row"><span class="deliv-dot deliv-dot--' + dcls(x[1]) + '"></span><span class="deliv-k">' + x[0] + '</span><span class="deliv-v">' + dlab(x[1]) + '</span></div>'; }).join('') +
        '</div>' + (dv.score == null
          ? '<div class="deliv-note">' + (dv.note || 'Configuration déclarée, non vérifiée.') + '</div>'
          : '<div class="deliv-ring" style="--p:' + dv.score + '"><div class="deliv-ring-in"><div class="deliv-ring-v">' + dv.score + '</div><div class="deliv-ring-l">Score</div></div></div>')
        + '</div>';
    } catch {}
  }
  // `silencieux` : appel du rafraîchissement automatique. On ne remplace PAS l'audience déjà affichée
  // par « Chargement… » — l'admin verrait le chiffre clignoter toutes les 30 s sans rien y gagner.
  async function loadCampaign(silencieux){
    // L'APPEL LE PLUS CHER du panneau : campaign-audience relit toute la base Whop + les comptes DTP,
    // puis vérifie le désabonnement contact par contact. Le lancer toutes les 30 s pour remplir un bloc
    // MASQUÉ était le gros du gaspillage — pour un chiffre qui ne bouge qu'une fois par semaine. On ne
    // le fait donc plus au tic quand l'Audience n'est pas à l'écran. (Attention : la garde porte sur CE
    // seul appel — un `return` ici couperait aussi les chargeurs de Pilotage plus bas.)
    if (!silencieux || _liveSub('audience')) {
      const ael = document.getElementById('camp-audience');
      if (ael && !(silencieux && ael.querySelector('.camp-aud-total'))) ael.textContent = 'Chargement de l’audience…';
      try {
        const d = await fetch('/api/admin/campaign-audience').then(r => r.json());
        _campAud = d;
        if (d && d.report) {
          const r = d.report, s = r.segments || {};
          ael.innerHTML = '<div class="camp-aud-total">' + r.total + ' destinataires uniques <span class="camp-aud-sub">0 doublon</span></div>'
            + '<div class="camp-aud-seg"><span class="camp-chip camp-chip--active">' + (s.active||0) + ' actifs</span>'
            + '<span class="camp-chip camp-chip--churn">' + (s.churned||0) + ' churned</span>'
            + '<span class="camp-chip camp-chip--lead">' + (s.lead||0) + ' leads</span></div>'
            + '<div class="camp-aud-src">Sources : ' + r.dtpAccounts + ' comptes DTP · ' + r.whopContacts + ' Whop · ' + r.manualExtra + ' manuels · ' + r.inMultipleSources + ' en commun · exclus de l envoi : ' + r.excludedBlacklist + ' sur liste noire, ' + r.excludedUnsub + ' désabonnés</div>';
        } else ael.textContent = 'Audience indisponible.';
      } catch { ael.textContent = 'Erreur de chargement de l’audience.'; }
    }
    // ── RAFRAÎCHISSEMENT CIBLÉ (13/08) ────────────────────────────────────────────────────────
    // Le tic de 30 s appelait CES NEUF chargeurs quelle que soit la sous-vue affichée. Deux effets :
    //  · quatre d'entre eux remplissaient du DOM masqué — dont l'audience, qui relit toute la base
    //    Whop + les comptes DTP puis interroge le journal désabonnement contact par contact ;
    //  · csLoad() court-circuitait la garde écrite juste à côté pour la source « camps » (« le détail
    //    d'une campagne ne doit pas se re-rendre sous les doigts pendant qu'on le lit ») — la source
    //    respectait la règle, la cascade la violait toutes les 30 s.
    // Au TIC (silencieux) on ne recharge donc que ce qui est à l'écran ; à l'OUVERTURE de l'onglet ou
    // après une action (silencieux absent) on garde le chargement complet, qui n'arrive qu'une fois.
    // Les Statistiques sortent de la cascade : leur propre source live (90 s) s'en charge, avec sa garde.
    const _vue = function (n) { return !silencieux || _liveSub(n); };
    if (_vue('pilotage')) { loadDashboard(); loadMaster(); loadCampErrors(); loadSequence(); loadPlan(); }
    if (_vue('audience')) {
      loadBlacklist();
      loadUnsubs();
      loadGiftAccess();
      var _rp = document.getElementById('camp-recip-panel');
      if (_rp && _rp.style.display !== 'none') renderRecipients();
    }
    if (!silencieux) csLoad();
  }
  /* ══ CENTRE D'ANALYSE DES CAMPAGNES (06/08) ═══════════════════════════════════════════════════
     Remplace la vue « Ouvertures & clics », qui agrégeait tout par TEMPLATE : le Mindset du 6 août
     et celui du 13 y étaient un seul chiffre, impossible de savoir lequel avait marché. Chaque ENVOI
     est désormais une campagne à part, avec sa liste, son détail et ses courbes.

     RÈGLE TENUE PARTOUT ICI : ce qui n'est pas mesuré s'affiche « non mesuré », jamais 0 ni « 0 % ».
     Délivrés, rebonds et plaintes ne sont pas observables sur un envoi SMTP direct — un tableau de
     bord qui affiche un zéro à leur place est pire que pas de tableau de bord. */
  let _csLignes = [], _csTri = { k: 'debut', desc: true }, _csNote = '';
  let _csDetail = null, _csFiltre = 'all', _csPage = 0;
  const _CS_PAGE = 60;

  const _csNum = function (v) { return v == null ? '<span class="cs-nm" title="Non mesuré sur un envoi SMTP direct">non mesuré</span>' : v; };
  const _csPct = function (v) { return v == null ? '<span class="cs-nm">-</span>' : (String(v).replace('.', ',') + '%'); };
  // (_csDate supprimee : ses appels passent par _dt — un seul format de date dans le panneau.)
  const _csHeure = function (ts) { return ts ? new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '-'; };
  // (_csEsc supprimée le 13/08 : c était le MÊME code que _escH, au caractère près, écrit deux fois
  //  pour deux onglets qui ne se parlaient pas. Une seule règle d échappement dans tout le panneau —
  //  et elle s applique désormais AUSSI aux listes qui affichent des adresses saisies à la main.)
  const _csDuree = function (ms) {
    if (ms == null) return '-';
    const m = Math.round(ms / 60000);
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    return h < 48 ? (h + ' h ' + (m % 60) + ' min') : (Math.round(h / 24) + ' j');
  };

  async function csLoad() {
    try {
      const d = await fetch('/api/admin/campaigns').then(function (r) { return r.json(); });
      if (!d || !d.ok) throw new Error((d && d.error) || 'réponse invalide');
      _csLignes = d.lignes || []; _csNote = d.note || '';
      csRender();
    } catch (e) {
      // ERREUR VISIBLE : l'ancienne version avalait tout dans un try/catch muet et laissait le
      // contenu périmé à l'écran — on croyait lire des chiffres à jour.
      const tb = document.querySelector('#cs-liste tbody');
      if (tb) tb.innerHTML = '<tr><td colspan="11" class="empty-state">Statistiques indisponibles : ' + _escH(e.message) + '</td></tr>';
    }
  }

  function csTri(k) {
    if (_csTri.k === k) _csTri.desc = !_csTri.desc; else { _csTri.k = k; _csTri.desc = true; }
    csRender();
  }

  // ── COMPARAISON CÔTE À CÔTE PAR TEMPLATE (10/08, demande user) ─────────────────────────────────
  // Une COLONNE par template, une LIGNE par KPI, meilleure valeur de chaque ligne suréclairée (or).
  // Chargée au 1er clic seulement (l'agrégat parcourt tout le store côté serveur).
  const _CS_TPL_FR = { 'outlook-hebdo': 'Semaine à venir', 'outlook': 'Semaine à venir', 'decryptage': 'Comprendre le marché', 'pointmarche': 'Point marché', 'point-hebdo': 'Point marché', 'mindset': 'Mindset', 'recap-hebdo': 'Récap hebdo', 'recap': 'Récap hebdo', 'temoignage': 'Témoignage', 'invitation': 'Invitation', 'intro-v1': 'Bienvenue', 'intro': 'Bienvenue', 'digest': 'Digest hebdo' };
  let _csCompCache = null;
  window.csCompareToggle = async function () {
    const box = document.getElementById('cs-compare'), btn = document.getElementById('cs-compare-btn');
    if (!box) return;
    if (!box.hidden) { box.hidden = true; if (btn) btn.classList.remove('btn--actif'); return; }
    box.hidden = false; if (btn) btn.classList.add('btn--actif');
    if (!_csCompCache) {
      box.innerHTML = '<div class="empty-state">Agrégation par template…</div>';
      try {
        const d = await fetch('/api/admin/campaign-compare').then(function (r) { return r.json(); });
        if (!d || !d.ok) throw new Error((d && d.error) || 'réponse invalide');
        _csCompCache = d;
      } catch (e) { box.innerHTML = '<div class="empty-state">Comparaison indisponible : ' + _escH(e.message) + '</div>'; _csCompCache = null; return; }
    }
    csCompareRender(box, _csCompCache);
  };
  function csCompareRender(box, d) {
    const cols = (d.colonnes || []).slice(0, 8);
    if (!cols.length) { box.innerHTML = '<div class="empty-state">Aucun envoi identifié à comparer pour l\'instant.</div>'; return; }
    // Lignes de KPI : [label, clé, format, sens (1 = plus haut est mieux, -1 = plus bas est mieux, 0 = neutre)]
    const F_INT = function (v) { return v == null ? '-' : String(v); };
    const F_PCT = function (v) { return v == null ? '-' : (String(v).replace('.', ',') + '%'); };
    const F_DATE = function (v) { return v ? _dt(v) : '-'; };
    const ROWS = [
      ['Envois', 'envois', F_INT, 0],
      ['Personnes touchées', 'touches', F_INT, 0],
      ['Ouvreurs uniques', 'ouvUniq', F_INT, 0],
      ["Taux d'ouverture", 'tauxOuv', F_PCT, 1],
      ['Ouvertures totales', 'ouvTot', F_INT, 0],
      ['Cliqueurs uniques', 'cliUniq', F_INT, 0],
      ['Taux de clic', 'tauxCli', F_PCT, 1],
      ['Réactivité (clics/ouv.)', 'ctor', F_PCT, 1],
      ['Désabonnés', 'desabos', F_INT, -1],
      ['Dernier envoi', 'dernier', F_DATE, 0],
    ];
    let h = '<div class="table-wrap"><table class="camp-table cs-table cs-comp-table"><thead><tr><th></th>'
      + cols.map(function (c) { return '<th class="cs-comp-th"><b>' + _escH(_CS_TPL_FR[c.tpl] || c.tpl) + '</b><span class="cs-sub">' + _escH(c.tpl) + '</span></th>'; }).join('')
      + '</tr></thead><tbody>';
    ROWS.forEach(function (row) {
      const label = row[0], k = row[1], fmt = row[2], sens = row[3];
      // Meilleure valeur de la ligne (uniquement si le KPI a un « mieux » et ≥ 2 valeurs mesurées).
      let best = null;
      if (sens !== 0) {
        const vals = cols.map(function (c) { return c[k]; }).filter(function (v) { return v != null; });
        if (vals.length > 1) best = sens > 0 ? Math.max.apply(null, vals) : Math.min.apply(null, vals);
      }
      h += '<tr><td class="cs-comp-lbl">' + label + '</td>'
        + cols.map(function (c) {
          const v = c[k];
          const top = best != null && v != null && v === best;
          return '<td class="' + (top ? 'cs-comp-best' : '') + '">' + fmt(v) + '</td>';
        }).join('') + '</tr>';
    });
    // Dernier objet parti : en pied, tronqué (contexte qualitatif, pas un KPI).
    h += '<tr><td class="cs-comp-lbl">Dernier objet</td>' + cols.map(function (c) {
      const o = c.dernierObjet || '';
      return '<td class="cs-comp-obj"' + (o ? ' title="' + _escH(o) + '"' : '') + '>' + (o ? _escH(o.length > 46 ? o.slice(0, 45) + '…' : o) : '<span class="cs-nm">non conservé</span>') + '</td>';
    }).join('') + '</tr>';
    h += '</tbody></table></div>'
      + '<p class="camp-note">' + _escH(d.note || '') + ' Délivrés, rebonds et plaintes : non mesurés (SMTP direct), jamais zéro.</p>';
    box.innerHTML = h;
  }

  function csRender() {
    const tb = document.querySelector('#cs-liste tbody'); if (!tb) return;
    const q = ((document.getElementById('cs-q') || {}).value || '').toLowerCase().trim();
    const jours = parseInt((document.getElementById('cs-periode') || {}).value, 10) || 0;
    const depuis = jours ? Date.now() - jours * 86400000 : 0;
    let l = _csLignes.slice();
    if (q) l = l.filter(function (x) { return ((x.titre || '') + ' ' + (x.tpl || '') + ' ' + (x.objet || '')).toLowerCase().indexOf(q) !== -1; });
    if (depuis) l = l.filter(function (x) { return x.consolide || (x.debut || 0) >= depuis; });
    // L'entrée consolidée reste TOUJOURS en bas : ce n'est pas une campagne, c'est un fourre-tout
    // historique. La trier avec les autres laisserait croire à un envoi daté.
    const cons = l.filter(function (x) { return x.consolide; });
    l = l.filter(function (x) { return !x.consolide; });
    const k = _csTri.k, sens = _csTri.desc ? -1 : 1;
    l.sort(function (a, b) {
      const va = a[k] == null ? -1 : a[k], vb = b[k] == null ? -1 : b[k];
      return va === vb ? 0 : (va < vb ? -1 : 1) * sens;
    });
    document.querySelectorAll('#cs-liste th.sortable').forEach(function (th) {
      th.classList.toggle('sorted', th.dataset.k === k);
      th.setAttribute('data-sens', th.dataset.k === k ? (_csTri.desc ? '▾' : '▴') : '');
      // Câblé UNE fois : csRender re-passe ici à chaque rendu, sans le drapeau on empilerait un
      // écouteur par rendu et un clic finirait par déclencher dix tris.
      if (!th._cs) { th._cs = 1; th.addEventListener('click', function () { csTri(th.dataset.k); }); }
    });

    const lignes = l.concat(cons);
    tb.innerHTML = lignes.length ? lignes.map(function (x) {
      const statut = x.consolide ? '<span class="cs-badge cs-badge--hist">Historique</span>'
        : '<span class="cs-badge cs-badge--ok">Envoi terminé</span>';
      const quand = x.consolide ? '<span class="cs-sub">avant le 13/07/2026</span>'
        : ('<b>' + _dt(x.debut) + '</b>' + (x.fin && x.fin - x.debut > 3600000 ? '<span class="cs-sub">étalé sur ' + _csDuree(x.fin - x.debut) + '</span>' : ''));
      const nom = '<b>' + _escH(x.titre || x.tpl) + '</b>'
        + (x.objet ? '<span class="cs-sub" title="' + _escH(x.objet) + '">' + _escH(x.objet) + '</span>'
                   : (x.consolide ? '' : '<span class="cs-sub cs-nm">objet non conservé</span>'));
      return '<tr' + (x.consolide ? ' class="cs-tr--hist"' : '') + '>'
        + '<td>' + quand + '</td>'
        + '<td class="cs-td-nom">' + nom + '</td>'
        + '<td>' + (x.envoyes || 0) + '</td>'
        + '<td>' + statut + '</td>'
        + '<td class="cs-td-fort">' + _csPct(x.tauxOuv) + '</td>'
        + '<td>' + (x.ouvTot || 0) + '</td>'
        + '<td>' + _csPct(x.tauxCli) + '</td>'
        + '<td>' + (x.cliTot || 0) + '</td>'
        + '<td title="Clics rapportés aux ouvertures : l’indicateur le moins sensible au gonflage du pixel">' + _csPct(x.ctor) + '</td>'
        + '<td>' + _csNum(x.rebonds) + '</td>'
        + '<td><button class="btn btn-sm" onclick="csOuvrir(\'' + x.id + '\')">Voir les statistiques</button></td>'
        + '</tr>';
    }).join('') : '<tr><td colspan="11" class="empty-state">Aucune campagne sur cette période.</td></tr>';

    const note = document.getElementById('cs-note');
    if (note) note.textContent = _csNote + ' Le pixel d’ouverture est gonflé par les proxys d’images (Gmail, Apple Mail) : la réactivité (clics/ouvertures) est l’indicateur le plus fiable.';
    csInsights(l);
  }

  // INSIGHTS — uniquement ce qui se déduit des données affichées. Aucune corrélation inventée :
  // avec ~52 envois par an, tirer « les objets avec un chiffre performent mieux » serait du bruit
  // présenté comme un enseignement.
  function csInsights(l) {
    const host = document.getElementById('cs-insights'); if (!host) return;
    const util = l.filter(function (x) { return x.tauxOuv != null && (x.envoyes || 0) >= 10; });
    if (util.length < 2) { host.innerHTML = ''; return; }
    const parc = function (k, sens) {
      return util.slice().sort(function (a, b) { return sens * ((b[k] || 0) - (a[k] || 0)); })[0];
    };
    const best = parc('tauxOuv', 1), pire = parc('tauxOuv', -1), bctr = parc('tauxCli', 1);
    const moy = Math.round(util.reduce(function (a, x) { return a + x.tauxOuv; }, 0) / util.length * 10) / 10;
    // Meilleure heure : sur la MÉDIANE des heures de début d'envoi des campagnes les mieux ouvertes.
    const cartes = [
      { l: 'Meilleure ouverture', v: _csPct(best.tauxOuv), s: best.titre || best.tpl, c: '#00e676' },
      { l: 'Meilleur taux de clic', v: _csPct(bctr.tauxCli), s: bctr.titre || bctr.tpl, c: '#e3b23a' },
      { l: 'Ouverture moyenne', v: _csPct(moy), s: util.length + ' campagnes comparées', c: '#9aa3b2' },
      { l: 'À revoir', v: _csPct(pire.tauxOuv), s: pire.titre || pire.tpl, c: '#ff3d00' },
    ];
    host.innerHTML = cartes.map(function (c) {
      return '<div class="cs-ins" style="--kc:' + c.c + '"><div class="cs-ins-v">' + c.v + '</div>'
        + '<div class="cs-ins-l">' + c.l + '</div><div class="cs-ins-s">' + _escH(c.s) + '</div></div>';
    }).join('');
  }

  // ── DÉTAIL D'UN ENVOI ──
  async function csOuvrir(id) {
    document.getElementById('cs-ecran-liste').hidden = true;
    document.getElementById('cs-ecran-detail').hidden = false;
    document.getElementById('cs-d-titre').textContent = 'Chargement…';
    _csFiltre = 'all'; _csPage = 0;
    try { history.replaceState(null, '', '#campaign/stats'); } catch (e) {}
    try {
      const d = await fetch('/api/admin/campaigns/' + encodeURIComponent(id)).then(function (r) { return r.json(); });
      if (!d || !d.ok) throw new Error((d && d.error) || 'réponse invalide');
      _csDetail = d;
      csRenderDetail();
    } catch (e) {
      document.getElementById('cs-d-titre').textContent = 'Campagne indisponible';
      document.getElementById('cs-d-entete').innerHTML = '<div class="empty-state">' + _escH(e.message) + '</div>';
    }
  }
  function csFermer() {
    document.getElementById('cs-ecran-detail').hidden = true;
    document.getElementById('cs-ecran-liste').hidden = false;
    _csDetail = null;
    try { if (_csRoot) { _csRoot.dispose(); _csRoot = null; } } catch (e) {}
  }

  let _csRoot = null;
  function csRenderDetail() {
    const d = _csDetail, c = d.campagne;
    document.getElementById('cs-d-titre').textContent = c.titre || c.tpl;
    document.getElementById('cs-d-entete').innerHTML =
      '<div class="cs-ent-l"><span class="cs-ent-k">Objet</span><span class="cs-ent-v">'
        + (c.objet ? _escH(c.objet) : '<span class="cs-nm">non conservé pour cet envoi</span>') + '</span></div>'
      + '<div class="cs-ent-l"><span class="cs-ent-k">Envoyé le</span><span class="cs-ent-v">' + _dt(c.debut)
        + (c.fin && c.fin - c.debut > 3600000 ? ' → ' + _csHeure(c.fin) + ' (étalé sur ' + _csDuree(c.fin - c.debut) + ')' : '') + '</span></div>'
      + '<div class="cs-ent-l"><span class="cs-ent-k">Audience</span><span class="cs-ent-v">' + (c.audience != null ? c.audience + ' contacts ciblés' : '<span class="cs-nm">non conservée</span>') + '</span></div>'
      + '<div class="cs-ent-l"><span class="cs-ent-k">Délai médian d’ouverture</span><span class="cs-ent-v">' + _csDuree(d.delaiMedian) + '</span></div>';

    const k = [
      ['Envoyés', c.envoyes], ['Délivrés', null], ['Taux de délivrabilité', null],
      ['Ouvertures uniques', c.ouvUniq], ['Ouvertures totales', c.ouvTot], ['Taux d’ouverture', _csPct(c.tauxOuv)],
      ['Clics uniques', c.cliUniq], ['Clics totaux', c.cliTot], ['Taux de clic', _csPct(c.tauxCli)],
      ['Réactivité (CTOR)', _csPct(c.ctor)], ['Rebonds', null], ['Plaintes spam', null],
    ];
    document.getElementById('cs-d-kpis').innerHTML = k.map(function (x) {
      return '<div class="camp-kpi' + (x[1] == null ? ' camp-kpi--nm' : '') + '"><div class="camp-kpi-v">' + _csNum(x[1]) + '</div><div class="camp-kpi-k">' + x[0] + '</div></div>';
    }).join('');

    csCourbe(d.ouverturesParHeure || {});

    const liens = d.liens && Object.keys(d.liens).length ? d.liens : null;
    const tot = liens ? Object.keys(liens).reduce(function (a, x) { return a + liens[x]; }, 0) : 0;
    document.getElementById('cs-d-liens').innerHTML = liens
      ? Object.keys(liens).sort(function (a, b) { return liens[b] - liens[a]; }).map(function (u, i) {
          const p = Math.round((liens[u] / tot) * 1000) / 10;
          return '<div class="cs-lien"><span class="cs-lien-r">' + (i + 1) + '</span>'
            + '<span class="cs-lien-u" title="' + _escH(u) + '">' + _escH(u) + '</span>'
            + '<span class="cs-lien-n">' + liens[u] + '</span>'
            + '<span class="cs-lien-b"><i style="width:' + p + '%"></i></span>'
            + '<span class="cs-lien-p">' + String(p).replace('.', ',') + '%</span></div>';
        }).join('')
      : '<div class="cs-vide">Le détail par lien est enregistré depuis le 6 août 2026. Il apparaîtra dès les prochains clics.</div>';

    document.getElementById('cs-d-apercu').innerHTML = d.html
      ? '<div class="cs-bloc-t">Le mail réellement envoyé</div><iframe class="cs-frame" sandbox="" srcdoc="' + _escH(d.html).replace(/"/g, '&quot;') + '"></iframe>'
      : '<div class="cs-vide">Le contenu envoyé n’a pas été archivé pour cette campagne. Ré-afficher l’aperçu du gabarit montrerait le contenu d’aujourd’hui, pas celui qui est parti : on préfère ne rien montrer.</div>';

    csDest();
  }

  function csCourbe(parHeure) {
    const host = document.getElementById('cs-d-courbe'); if (!host) return;
    try { if (_csRoot) { _csRoot.dispose(); _csRoot = null; } } catch (e) {}
    const cles = Object.keys(parHeure).sort();
    if (!cles.length || typeof am5 === 'undefined') {
      host.innerHTML = '<div class="cs-vide">Aucune ouverture horodatée pour cette campagne.</div>';
      return;
    }
    host.innerHTML = '';
    const root = am5.Root.new(host); _csRoot = root;
    root.setThemes([am5themes_Animated.new(root)]);
    root._logo && root._logo.dispose();
    const chart = root.container.children.push(am5xy.XYChart.new(root, { panX: false, panY: false, layout: root.verticalLayout }));
    const xAxis = chart.xAxes.push(am5xy.DateAxis.new(root, { baseInterval: { timeUnit: 'hour', count: 1 }, renderer: am5xy.AxisRendererX.new(root, { minGridDistance: 55 }) }));
    const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, { min: 0, renderer: am5xy.AxisRendererY.new(root, {}) }));
    xAxis.get('renderer').labels.template.setAll({ fill: am5.color(0x8b93a1), fontSize: 10 });
    yAxis.get('renderer').labels.template.setAll({ fill: am5.color(0x8b93a1), fontSize: 10 });
    const s = chart.series.push(am5xy.ColumnSeries.new(root, {
      xAxis: xAxis, yAxis: yAxis, valueXField: 't', valueYField: 'v',
      tooltip: am5.Tooltip.new(root, { labelText: '{valueY} première(s) ouverture(s)' }),
    }));
    s.columns.template.setAll({ fill: am5.color(0xe3b23a), stroke: am5.color(0xe3b23a), width: am5.percent(70), cornerRadiusTL: 2, cornerRadiusTR: 2 });
    s.data.setAll(cles.map(function (h) { return { t: Date.parse(h + ':00:00Z'), v: parHeure[h] }; }));
  }

  function csFiltre(f) { _csFiltre = f; _csPage = 0; csDest(); }
  function _csDestFiltrees() {
    let r = (_csDetail && _csDetail.destinataires) || [];
    if (_csFiltre === 'ouverts') r = r.filter(function (x) { return x.ouvert; });
    if (_csFiltre === 'non') r = r.filter(function (x) { return !x.ouvert; });
    if (_csFiltre === 'cliques') r = r.filter(function (x) { return x.clique; });
    if (_csFiltre === 'desabo') r = r.filter(function (x) { return !!x.desabo; });
    return r;
  }
  function csDest() {
    const all = (_csDetail && _csDetail.destinataires) || [];
    const f = [
      ['all', 'Tous', all.length],
      ['ouverts', 'Ont ouvert', all.filter(function (x) { return x.ouvert; }).length],
      ['non', 'N’ont pas ouvert', all.filter(function (x) { return !x.ouvert; }).length],
      ['cliques', 'Ont cliqué', all.filter(function (x) { return x.clique; }).length],
      ['desabo', 'Désabonnés', all.filter(function (x) { return !!x.desabo; }).length],
    ];
    document.getElementById('cs-d-filtres').innerHTML = f.map(function (x) {
      return '<button class="camp-btn camp-selbtn' + (_csFiltre === x[0] ? ' camp-selbtn--on' : '')
        + '" onclick="csFiltre(\'' + x[0] + '\')">' + x[1] + ' (' + x[2] + ')</button>';
    }).join('');
    const r = _csDestFiltrees();
    const page = r.slice(_csPage * _CS_PAGE, (_csPage + 1) * _CS_PAGE);
    const tb = document.querySelector('#cs-d-dest tbody');
    tb.innerHTML = page.length ? page.map(function (x) {
      return '<tr><td>' + _escH(x.email) + '</td><td>' + _dt(x.recu) + '</td>'
        + '<td>' + (x.ouvert ? '<span class="cs-oui">oui</span>' : '<span class="cs-non">non</span>') + '</td>'
        + '<td>' + x.nOuv + '</td><td>' + _dt(x.ouvPremiere) + '</td><td>' + _dt(x.ouvDerniere) + '</td>'
        + '<td>' + (x.clique ? '<span class="cs-oui">oui</span>' : '<span class="cs-non">non</span>') + '</td>'
        + '<td>' + x.nCli + '</td>'
        + '<td>' + (x.desabo ? '<span class="tag tag--red">' + _dt(x.desabo) + '</span>' : '-') + '</td>'
        + '<td>' + _csNum(x.rebond) + '</td></tr>';
    }).join('') : '<tr><td colspan="10" class="empty-state">Aucun destinataire dans ce filtre.</td></tr>';
    const pages = Math.ceil(r.length / _CS_PAGE);
    document.getElementById('cs-d-pager').innerHTML = pages > 1
      ? '<button class="btn btn-sm" ' + (_csPage ? '' : 'disabled') + ' onclick="csPage(-1)">‹</button>'
        + '<span class="cs-pg">' + (_csPage + 1) + ' / ' + pages + ' · ' + r.length + ' destinataires</span>'
        + '<button class="btn btn-sm" ' + (_csPage >= pages - 1 ? 'disabled' : '') + ' onclick="csPage(1)">›</button>'
      : '';
  }
  function csPage(d) { _csPage = Math.max(0, _csPage + d); csDest(); }

  // Export du tableau AFFICHÉ (filtre compris). Point-virgule + BOM : Excel FR ouvre sans réglage.
  function csExport() {
    const r = _csDestFiltrees();
    if (!r.length) { _campMsg('❌ Rien à exporter dans ce filtre.'); return; }
    const e = function (v) { v = String(v == null ? '' : v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const iso = function (t) { return t ? new Date(t).toISOString() : ''; };
    const csv = 'email;recu;a_ouvert;ouvertures;premiere_ouverture;derniere_ouverture;a_clique;clics;desabonne\n'
      + r.map(function (x) {
          return [x.email, iso(x.recu), x.ouvert ? 'oui' : 'non', x.nOuv, iso(x.ouvPremiere), iso(x.ouvDerniere), x.clique ? 'oui' : 'non', x.nCli, iso(x.desabo)].map(e).join(';');
        }).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'campagne-' + ((_csDetail && _csDetail.campagne && _csDetail.campagne.id) || 'export') + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    _campMsg('✅ CSV exporté (' + r.length + ' lignes).');
  }

  async function campExtraAdd(){
    const inp = document.getElementById('camp-extra-input'); const v = (inp.value || '').trim(); if (!v) return;
    _campMsg('Ajout…');
    try {
      const d = await fetch('/api/admin/campaign-extra?action=add&emails=' + encodeURIComponent(v)).then(r => r.json());
      _campMsg(d.ok ? ('✅ ' + d.added + ' ajouté(s), ' + (d.dupesIgnored||0) + ' doublon(s) ignoré(s) : ' + d.total + ' au total') : '❌ échec');
      inp.value = ''; loadCampaign();
    } catch { _campMsg('❌ Erreur réseau.'); }
  }
  // ── Liste noire ──
  async function loadBlacklist(){
    try {
      const d = await fetch('/api/admin/blacklist').then(r => r.json());
      const list = d.list || [];
      const cnt = document.getElementById('camp-bl-count'); if (cnt) cnt.textContent = list.length + ' bloqué' + (list.length > 1 ? 's' : '');
      const box = document.getElementById('camp-bl-list'); if (!box) return;
      box.innerHTML = list.length
        ? list.map(function(e){ return '<div class="camp-bl-row"><span class="camp-bl-em">' + _escH(e) + '</span><button class="camp-bl-x" onclick="blRemove(\'' + encodeURIComponent(e) + '\')">retirer</button></div>'; }).join('')
        : '<div class="empty-state">Aucun e-mail en liste noire.</div>';
    } catch {}
  }
  async function blAdd(){
    const inp = document.getElementById('camp-bl-input'); const v = (inp.value || '').trim(); if (!v) return;
    _campMsg('Ajout à la liste noire…');
    try {
      const d = await fetch('/api/admin/blacklist?action=add&emails=' + encodeURIComponent(v)).then(r => r.json());
      _campMsg(d.ok ? ('✅ ' + d.added + ' blacklisté(s) : ' + d.total + ' au total') : '❌ échec');
      inp.value = ''; loadCampaign();   // recharge déjà la liste noire
    } catch { _campMsg('❌ Erreur réseau.'); }
  }
  async function blRemove(encEmail){
    const email = decodeURIComponent(encEmail);
    _campMsg('Retrait de ' + email + '…');
    try {
      const d = await fetch('/api/admin/blacklist?action=remove&email=' + encodeURIComponent(email)).then(r => r.json());
      _campMsg(d.ok ? ('✅ retiré : ' + d.total + ' restant(s)') : '❌ échec');
      loadCampaign();   // recharge déjà la liste noire
    } catch { _campMsg('❌ Erreur réseau.'); }
  }
  /* ── DIAGNOSTIC PARRAINAGE (04/09) ─────────────────────────────────────────────────────────────
     Chaque étape porte son propre verdict, et une étape « attention » n'est PAS une étape « ko » :
     un index d'attribution absent n'empêche plus rien depuis la recherche inverse, alors qu'une
     adhésion Whop introuvable, elle, bloque tout. Les confondre ferait courir après des faux
     problèmes et manquer les vrais. */
  window.parDiag = async function () {
    const inp = document.getElementById('par-diag-input');
    const box = document.getElementById('par-diag-body');
    const sub = document.getElementById('par-diag-sub');
    const em = ((inp && inp.value) || '').trim();
    if (!em) { if (sub) sub.textContent = 'entre une adresse'; return; }
    if (sub) sub.textContent = 'vérification chez Whop…';
    if (box) box.innerHTML = '<div class="skel" style="height:80px"></div>';
    try {
      const d = await fetch('/api/admin/parrainage-diag?email=' + encodeURIComponent(em)).then(r => r.json());
      if (!d || !d.ok) { if (sub) sub.textContent = ''; if (box) box.innerHTML = '<div class="empty-state">' + _escH((d && d.error) || 'échec') + '</div>'; return; }
      const ic = { ok: '✓', attention: '!', ko: '✗' };
      if (sub) sub.innerHTML = '<span class="par-diag-v par-diag-v--' + d.verdict + '">' + _escH(d.resume) + '</span>';
      if (box) box.innerHTML = '<div class="camp-bl-list">' + (d.etapes || []).map(function (e) {
        return '<div class="camp-bl-row"><span class="par-diag-p par-diag-p--' + e.etat + '">' + ic[e.etat] + '</span>'
          + '<span class="camp-bl-em">' + _escH(e.titre) + '</span>'
          + '<span class="camp-un-meta">' + _escH(e.detail) + '</span></div>';
      }).join('') + '</div>';
    } catch (e) { if (sub) sub.textContent = ''; if (box) box.innerHTML = '<div class="empty-state">Erreur réseau.</div>'; }
  };

  /* ── DÉSINSCRITS (04/09, demande user : « les blacklist ne sont pas dedans ») ───────────────────
     Il y avait deux mécanismes d'exclusion et un seul écran. La liste noire du login avait le sien ;
     les désinscrits e-mail n'étaient atteignables que ligne par ligne dans le tableau des comptes,
     donc pas du tout pour une adresse SANS compte — tous les contacts Whop et les ajouts manuels.
     Ils étaient exclus des envois sans figurer nulle part. */
  async function loadUnsubs(){
    const box = document.getElementById('camp-un-list'); if (!box) return;
    try {
      const d = await fetch('/api/admin/unsub-list').then(function(r){ return r.json(); });
      const cnt = document.getElementById('camp-un-count');
      if (!d || !d.ok) {
        /* Mesure indisponible : on le DIT. Une liste vide se lirait « personne n'est désinscrit »,
           et on en conclurait que toute la base reçoit les mails. */
        if (cnt) cnt.textContent = 'mesure indisponible';
        box.innerHTML = '<div class="empty-state">Journal des envois illisible : la liste ne peut pas être affichée. Ne lancez pas d\'envoi avant que cette mesure revienne.</div>';
        return;
      }
      const list = d.list || [];
      if (cnt) cnt.textContent = list.length + ' désinscrit' + (list.length > 1 ? 's' : '')
        + (d.sansCompte ? ' · ' + d.sansCompte + ' sans compte' : '');
      box.innerHTML = list.length ? list.map(function(u){
        /* L'ORIGINE change la portée du bouton, donc elle est écrite à côté. Réabonner quelqu'un que
           l'admin avait désinscrit corrige une erreur ; réabonner quelqu'un qui a CLIQUÉ le lien de
           désinscription lui repasse un consentement qu'il a retiré. On ne bloque pas — c'est la
           décision de l'exploitant — mais on ne le laisse pas cliquer à l'aveugle. */
        var org = u.parLui ? '<span class="camp-un-tag camp-un-tag--self">s\'est désinscrit lui-même</span>'
                : u.seed  ? '<span class="camp-un-tag">désinscription d\'origine</span>'
                          : '<span class="camp-un-tag">désinscrit par l\'admin</span>';
        var qui = u.compte ? _escH(u.nom || '') : '<span class="camp-un-tag">sans compte</span>';
        return '<div class="camp-bl-row"><span class="camp-bl-em">' + _escH(u.email) + '</span>'
          + '<span class="camp-un-meta">' + qui + ' ' + org + '</span>'
          + '<button class="camp-bl-x" onclick="unsubRemove(\'' + encodeURIComponent(u.email) + '\',' + (u.parLui ? 'true' : 'false') + ')">réabonner</button></div>';
      }).join('') : '<div class="empty-state">Aucun désinscrit.</div>';
    } catch (e) {
      if (box) box.innerHTML = '<div class="empty-state">Liste indisponible.</div>';
    }
  }
  async function unsubAdd(){
    const inp = document.getElementById('camp-un-input'); const v = (inp.value || '').trim(); if (!v) return;
    _campMsg('Désinscription…');
    try {
      const d = await fetch('/api/admin/unsub-list?action=add&emails=' + encodeURIComponent(v)).then(function(r){ return r.json(); });
      _campMsg(d && d.ok ? ('✅ ' + d.added + ' désinscrit(s)' + (d.ignores ? ', ' + d.ignores + ' adresse(s) ignorée(s)' : '')) : ('❌ ' + ((d && d.error) || 'échec')));
      inp.value = ''; loadUnsubs();
    } catch (e) { _campMsg('❌ Erreur réseau.'); }
  }
  window.unsubRemove = async function (encEmail, parLui) {
    const email = decodeURIComponent(encEmail);
    // Confirmation EN LIGNE (le cahier des charges interdit les dialogues natifs), et seulement
    // quand elle se justifie : un désabonnement demandé par la personne elle-même.
    if (parLui) {
      const row = document.querySelector('#camp-un-list .camp-bl-row button[onclick*="' + encEmail + '"]');
      if (row && !row.dataset.armed) {
        row.dataset.armed = '1';
        row.textContent = 'il s\'était désinscrit — confirmer ?';
        setTimeout(function(){ if (row) { row.dataset.armed = ''; row.textContent = 'réabonner'; } }, 6000);
        return;
      }
    }
    _campMsg('Réabonnement de ' + email + '…');
    try {
      const d = await fetch('/api/admin/unsub-list?action=remove&email=' + encodeURIComponent(email)).then(function(r){ return r.json(); });
      _campMsg(d && d.ok && !d.unsub ? ('✅ ' + email + ' est réabonné') : ('❌ ' + ((d && d.error) || 'échec')));
      loadUnsubs();
    } catch (e) { _campMsg('❌ Erreur réseau.'); }
  };
  window.unsubAdd = unsubAdd;

  // ── Journal des envois : chaque mail réellement parti (source = anti-doublon durable) ──
  async function loadMailLog(){
    const tb = document.getElementById('maillog-tbody'); if (!tb) return;
    const q = (document.getElementById('maillog-search') || {}).value || '';
    const ft = (document.getElementById('maillog-type') || {}).value || '';
    try {
      const params = [];
      if (q) params.push('q=' + encodeURIComponent(q));
      if (ft) params.push('type=' + encodeURIComponent(ft));
      const d = await fetch('/api/admin/email-log' + (params.length ? '?' + params.join('&') : '')).then(r => r.json());
      // Menu des types : construit depuis les données réelles (une fois, puis on préserve la sélection)
      const sel = document.getElementById('maillog-type');
      if (sel && d.types && sel.options.length <= 1) {
        d.types.forEach(function(t){ const o = document.createElement('option'); o.value = t; o.textContent = t; sel.appendChild(o); });
        sel.value = ft;
      }
      const cnt = document.getElementById('maillog-count');
      if (cnt) cnt.textContent = d.total + ' envoi' + (d.total > 1 ? 's' : '');
      const rows = d.rows || [];
      tb.innerHTML = rows.length ? rows.map(function(r){
        const when = _dt(r.ts);
        const cls = /Désinscription/.test(r.type) ? 'badge-expired'
          : /Campagne/.test(r.type) ? 'badge-client'
          : /Bienvenue|Renouvellement/.test(r.type) ? 'badge-pro'
          : 'badge-essai';   // cycle de vie (essai, expiré, relances, jalons) → or
        return '<tr><td style="font-family:var(--font-mono);font-size:11px;color:var(--text3);white-space:nowrap">' + when + '</td>'
          + '<td><span class="badge ' + cls + '">' + _escH(r.type) + '</span></td>'
          + '<td class="email">' + _escH(r.dest) + '</td></tr>';
      }).join('') : '<tr><td colspan="3" class="empty-state">Aucun envoi ' + (q ? 'ne correspond au filtre.' : 'enregistré.') + '</td></tr>';
    } catch { tb.innerHTML = '<tr><td colspan="3" class="empty-state">Erreur de chargement.</td></tr>'; }
  }

  // ── Accès offerts : exemptés de TOUTE relance de paiement ──
  // Les entrées du seed (code) ne sont pas retirables depuis l'interface : elles se remettraient
  // toutes seules au prochain démarrage. On les affiche donc sans bouton, avec la mention.
  async function loadGiftAccess(){
    try {
      const d = await fetch('/api/admin/gift-access').then(r => r.json());
      const list = d.emails || [], seed = d.seed || [];
      const cnt = document.getElementById('camp-gift-count');
      if (cnt) cnt.textContent = list.length + ' exempté' + (list.length > 1 ? 's' : '');
      const box = document.getElementById('camp-gift-list'); if (!box) return;
      box.innerHTML = list.length
        ? list.map(function(e){
            return '<div class="camp-bl-row"><span class="camp-bl-em">' + _escH(e) + '</span>' +
              (seed.indexOf(e) >= 0
                ? '<span class="camp-bl-x" style="opacity:.55;cursor:default">fixé dans le code</span>'
                : '<button class="camp-bl-x" onclick="giftRemove(\'' + encodeURIComponent(e) + '\')">retirer</button>') +
              '</div>';
          }).join('')
        : '<div class="empty-state">Aucun accès offert exempté.</div>';
    } catch {}
  }
  /* ══ FUSION DE DEUX COMPTES, PAR SELECTION DANS LE TABLEAU ═════════════════════════════════
     Une meme personne peut avoir deux fiches (typiquement une adresse relais Apple creee par un
     paiement « Masquer mon adresse », et sa vraie adresse). On coche les deux lignes, on choisit
     laquelle GARDER, on SIMULE, puis on confirme. Rien n est ecrit avant la confirmation.
     La selection est gardee par ADRESSE et non par index de ligne : le tableau se re-rend a chaque
     tri, filtre ou changement de page, et une selection par position sauterait sur un autre compte. */
  const _fusionSel = new Set();
  let _fusionDir = null;   // { de, vers } une fois le sens choisi
  /* Renvoyer les identifiants : DECOCHE par defaut (28/08, demande user « il a deja recu les mails,
     faut juste fusionner pour pas envoyer de doublon »). Decoche, on ne touche PAS au mot de passe
     du compte conserve : celui que le client possede deja continue de fonctionner. Sur une
     MIGRATION le compte est cree, donc son mot de passe n existe nulle part : le serveur envoie
     alors les acces quoi qu il arrive, et la case n y change rien. */
  let _fusionAcces = false;
  function fusionAccesToggle(el){ _fusionAcces = !!(el && el.checked); if (_fusionDir) fusionSens(encodeURIComponent(_fusionDir.de), encodeURIComponent(_fusionDir.vers)); }
  function fusionCoche(el){
    const em = String(el.dataset.email || '').toLowerCase();
    if (!em) return;
    if (el.checked) _fusionSel.add(em); else _fusionSel.delete(em);
    _fusionDir = null;
    fusionBarre();
  }
  function _fusionInfos(){
    // On relit les LIGNES affichees pour retrouver le nom ; une adresse cochee puis filtree hors
    // page reste selectionnee (l adresse suffit au serveur), on affiche alors l adresse seule.
    return [..._fusionSel].map(em => {
      const ck = document.querySelector('.u-ck[data-email="' + em.replace(/"/g, '\\"') + '"]');
      return { email: em, nom: (ck && ck.dataset.nom) || '' };
    });
  }
  function _fbLigne(k, v){ return '<div class="fa-l"><span>' + _escH(k) + '</span><span>' + _escH(String(v == null ? '' : v)) + '</span></div>'; }
  function fusionBarre(msg, apercuHtml){
    const bar = document.getElementById('fusion-bar'); if (!bar) return;
    const n = _fusionSel.size;
    if (!n) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
    const infos = _fusionInfos();
    const et = c => '<b>' + _escH(c.nom || c.email) + '</b>';
    let h = '<span class="fb-txt">' + n + ' compte' + (n > 1 ? 's' : '') + ' sélectionné' + (n > 1 ? 's' : '') + ' : '
          + infos.map(et).join(' · ') + '</span><span class="fb-sp"></span>';
    if (n !== 2) {
      h += '<span class="fb-txt">Coche <b>exactement 2</b> comptes de la même personne pour les fusionner.</span>'
         + '<button class="btn" onclick="fusionVider()">Tout décocher</button>';
    } else if (!_fusionDir) {
      /* LE CHOIX DOIT SE LIRE SANS DEVINER (28/08, retour user « j'ai pas compris lequel garder ») :
         le bouton portait le NOM quand il existait — donc « Garder Mathis » face a « Garder
         m648fb4tgk@... », deux libelles de nature differente entre lesquels on ne pouvait pas
         choisir. L'ADRESSE est l'identite unique du compte : c'est elle qui est affichee, toujours,
         le nom venant seulement en complement. Et on dit ce qui arrive a l'autre. */
      const [a, b] = infos;
      const lbl = c => 'Garder ' + _escH(c.email) + (c.nom ? ' <span style="opacity:.6">(' + _escH(c.nom) + ')</span>' : ' <span style="opacity:.6">(sans nom)</span>');
      h += '<span class="fb-txt">Sur quel compte <b>tout regrouper</b> ?</span>'
         + '<button class="btn" onclick="fusionSens(\'' + encodeURIComponent(b.email) + '\',\'' + encodeURIComponent(a.email) + '\')">' + lbl(a) + '</button>'
         + '<button class="btn" onclick="fusionSens(\'' + encodeURIComponent(a.email) + '\',\'' + encodeURIComponent(b.email) + '\')">' + lbl(b) + '</button>'
         + '<button class="btn" onclick="fusionVider()">Annuler</button>'
         + '<div class="fusion-apercu"><div class="fa-l"><span>Le compte choisi</span><span>garde l\'accès, reçoit l\'échéance la plus lointaine et les identifiants</span></div>'
         + '<div class="fa-l"><span>L\'autre compte</span><span>est suspendu, et son adresse reste rattachée au compte gardé</span></div></div>';
    } else {
      h += '<span class="fb-txt">' + _escH(msg || '') + '</span>'
         + '<label class="fb-txt" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">'
         + '<input type="checkbox" style="accent-color:#e3b23a;width:14px;height:14px;cursor:pointer;"'
         + (_fusionAcces ? ' checked' : '') + ' onchange="fusionAccesToggle(this)"> Renvoyer les identifiants</label>'
         + '<button class="btn btn-primary" onclick="fusionConfirmer()">Confirmer la fusion</button>'
         + '<button class="btn" onclick="fusionVider()">Annuler</button>';
    }
    if (apercuHtml) h += '<div class="fusion-apercu">' + apercuHtml + '</div>';
    bar.innerHTML = h;
  }
  function fusionVider(){
    _fusionSel.clear(); _fusionDir = null;
    document.querySelectorAll('.u-ck:checked').forEach(c => { c.checked = false; });
    fusionBarre();
  }
  async function _fusionAppel(appliquer){
    if (!_fusionDir) return;
    const body = { from: _fusionDir.de, to: _fusionDir.vers, acces: _fusionAcces ? 1 : 0 };
    if (appliquer) body.appliquer = 1;
    const d = await fetch('/api/admin/merge-users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }).then(r => r.json());
    return d;
  }
  // Choix du sens → SIMULATION immédiate (le serveur n'écrit rien tant qu'appliquer n'est pas envoyé).
  async function fusionSens(de, vers){
    _fusionDir = { de: decodeURIComponent(de), vers: decodeURIComponent(vers) };
    fusionBarre('Simulation…');
    try {
      const d = await _fusionAppel(false);
      if (!d || !d.ok) { _fusionDir = null; fusionBarre(); alert('Fusion impossible : ' + ((d && d.error) || 'échec')); return; }
      const a = d.apercu || {};
      fusionBarre('Simulation — rien n\'a encore été écrit.',
        _fbLigne('Opération', a.operation || '')
        + _fbLigne('Compte conservé', (a.garde && a.garde.email) || '')
        + _fbLigne('Compte absorbé', (a.absorbe && a.absorbe.email) || '')
        + _fbLigne('Échéance retenue', (a.apres && a.apres.echeance) || '')
        + _fbLigne('Nom retenu', (a.apres && a.apres.nom) || '')
        + _fbLigne('L\'absorbé devient', a.absorbeDevient || '')
        + _fbLigne('Alias posé', a.alias || '')
        + _fbLigne('Accès', a.accesEnvoyes || ''));
    } catch (e) { _fusionDir = null; fusionBarre(); alert('Erreur réseau.'); }
  }
  async function fusionConfirmer(){
    if (!_fusionDir) return;
    fusionBarre('Fusion en cours…');
    try {
      const d = await _fusionAppel(true);
      if (!d || !d.ok) { fusionBarre('Échec.'); alert('Fusion impossible : ' + ((d && d.error) || 'échec')); return; }
      const a = d.apercu || {};
      const res = _fbLigne('Compte conservé', (a.garde && a.garde.email) || '')
        + _fbLigne('Échéance', (a.apres && a.apres.echeance) || '')
        + ((d.mail && d.mail.skipped)
            ? _fbLigne('Identifiants', 'aucun envoi — le mot de passe existant reste valable')
            : _fbLigne('Mail → compte conservé', d.mail && d.mail.sent ? '✅ envoyé' : '❌ non envoyé (le filet reprendra)')
              + _fbLigne('Mail → ancienne adresse', d.mailAncienne && d.mailAncienne.sent ? '✅ envoyé' : '— non envoyé'));
      _fusionSel.clear(); _fusionDir = null;
      fusionBarre();
      const bar = document.getElementById('fusion-bar');
      if (bar) { bar.hidden = false; bar.innerHTML = '<span class="fb-txt">✅ <b>Fusion effectuée.</b></span><span class="fb-sp"></span><button class="btn" onclick="fusionVider()">Fermer</button><div class="fusion-apercu">' + res + '</div>'; }
      if (typeof loadUsers === 'function') { try { await loadUsers(); } catch (e) {} }
    } catch (e) { fusionBarre('Échec.'); alert('Erreur réseau.'); }
  }

  async function giftAdd(){
    const inp = document.getElementById('camp-gift-input'); const v = (inp.value || '').trim(); if (!v) return;
    _campMsg('Exemption de ' + v + '…');
    try {
      const d = await fetch('/api/admin/gift-access', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: v, action: 'add' }) }).then(r => r.json());
      _campMsg(d.ok ? ('✅ ' + v + ' ne recevra plus de relance de paiement') : ('❌ ' + (d.error || 'échec')));
      if (d.ok) inp.value = '';
      loadGiftAccess();
    } catch { _campMsg('❌ Erreur réseau.'); }
  }
  async function giftRemove(encEmail){
    const email = decodeURIComponent(encEmail);
    _campMsg('Retrait de ' + email + '…');
    try {
      const d = await fetch('/api/admin/gift-access', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, action: 'remove' }) }).then(r => r.json());
      _campMsg(d.ok ? ('✅ ' + email + ' reçoit à nouveau les relances') : ('❌ ' + (d.error || 'échec')));
      loadGiftAccess();
    } catch { _campMsg('❌ Erreur réseau.'); }
  }

  // ── Liste des destinataires (les 163) ──
  function toggleRecipients(){
    const p = document.getElementById('camp-recip-panel'); const shown = p.style.display !== 'none';
    p.style.display = shown ? 'none' : 'block';
    document.getElementById('camp-recip-toggle').textContent = shown ? '👥 Voir la liste des e-mails' : '✖ Masquer la liste';
    if (!shown) renderRecipients();
  }
  function renderRecipients(){
    const box = document.getElementById('camp-recip-list'); if (!box) return;
    const recs = (_campAud && _campAud.recipients) || [];
    const q = (document.getElementById('camp-recip-search').value || '').toLowerCase().trim();
    const filtered = q ? recs.filter(function(r){ return (r.email || '').toLowerCase().indexOf(q) >= 0; }) : recs;
    box.innerHTML = '<div class="camp-recip-head">' + filtered.length + ' e-mail(s)</div>' + filtered.map(function(r){
      const seg = r.seg || 'lead';
      const chip = seg === 'active' ? 'active' : (seg === 'churned' ? 'churn' : 'lead');
      return '<div class="camp-recip-row"><span class="camp-recip-em">' + _escH(r.email) + '</span>'
        + '<span class="camp-chip camp-chip--' + chip + '">' + seg + '</span>'
        + '<span class="camp-recip-src">' + _escH(r.src || '') + '</span></div>';
    }).join('');
  }
  // ── LA CAMPAGNE — interrupteur UNIQUE (état + prochain e-mail + 1 bouton) ──
  let _campMaster = null;
  async function loadMaster(){
    try {
      const d = await fetch('/api/admin/campaign-master').then(r => r.json());
      _campMaster = d;
      const badge = document.getElementById('camp-master-badge'), body = document.getElementById('camp-master-body'), acts = document.getElementById('camp-master-actions');
      if (!d || !d.ok) { if (body) body.textContent = 'Indisponible.'; return; }
      const mode = d.mode || (d.active ? (d.testMode ? 'test' : 'official') : 'paused');
      if (badge) badge.innerHTML = ({ test: '<span style="color:#e3b23a;font-weight:700;">🧪 MODE TEST</span>', official: '<span style="color:#00e676;font-weight:700;">● OFFICIELLE</span>', paused: '<span style="color:#8b93a1;">○ En pause</span>' })[mode];
      const dot = mode === 'test' ? '#e3b23a' : mode === 'official' ? '#00e676' : '#8b93a1';
      const title = mode === 'test' ? ('Mode TEST : tout part sur ' + (d.testEmail || 'ta boîte')) : mode === 'official' ? 'Campagne OFFICIELLE (audience réelle)' : 'Campagne en pause';
      const statusBig = '<div style="display:flex;align-items:center;gap:10px;"><span style="width:12px;height:12px;border-radius:50%;background:' + dot + ';box-shadow:0 0 12px ' + dot + ';"></span><span style="font-size:18px;font-weight:800;color:' + dot + ';">' + title + '</span></div>';
      const rows = [
        ['Prochain e-mail', '<b style="color:#e3b23a;">' + (d.nextTemplate || '-') + '</b>'],
        ['Quand', d.active ? (d.nextWhen || '-') : 'en pause tant que non lancée'],
        ['Destinataire', mode === 'test' ? ('<span style="color:#e3b23a;">🧪 ' + _escH(d.testEmail || '') + ' (test)</span>') : mode === 'official' ? ('<b style="color:#fff;">' + (d.contactsTracked || 0) + '</b> contacts (réel)') : '-'],
        ['Dernier envoi', d.lastSent ? ('<b style="color:#c9ced8;">' + _escH(d.lastSent.title) + '</b> <span style="color:#8b93a1;">' + _dt(d.lastSent.ts) + '</span>') : '<span style="color:#8b93a1;">aucun pour l instant</span>'],
        ['Envoi en cours', d.running ? '<span style="color:#e3b23a;">🔄 oui, en train d’envoyer…</span>' : 'non']
      ];
      let extra = '';
      if (!d.active && d.pausedReason && d.pausedReason.summary) extra = '<div style="margin-top:10px;color:#ff6b57;font-size:12.5px;">⏸ Mise en pause automatique (pre-flight) : ' + _escH(d.pausedReason.summary) + '</div>';
      body.innerHTML = statusBig + '<table style="width:100%;margin-top:12px;font-size:13px;line-height:1.5;">' + rows.map(function(r){ return '<tr><td style="color:#8b93a1;padding:5px 14px 5px 0;white-space:nowrap;vertical-align:top;">' + r[0] + '</td><td style="color:#cbd5e1;padding:5px 0;">' + r[1] + '</td></tr>'; }).join('') + '</table>' + extra;
      if (acts) {
        const B = (label, action, cls) => '<button class="camp-btn' + (cls ? ' ' + cls : '') + '" onclick="campMasterAction(\'' + action + '\')">' + label + '</button>';
        if (mode === 'paused')      acts.innerHTML = B('🧪 Tester sur ma boîte', 'activate-test') + B('🚀 Lancer officiellement', 'activate-official', 'camp-btn--send');
        else if (mode === 'test')   acts.innerHTML = B('🚀 Passer en officiel', 'activate-official', 'camp-btn--send') + B('⏸ Arrêter le test', 'pause');
        else                        acts.innerHTML = B('🧪 Basculer en test (ma boîte)', 'activate-test') + B('⏸ Mettre en pause', 'pause');
      }
    } catch {}
  }
  let _masterArmUntil = 0, _masterArmAction = '';
  async function campMasterAction(action){
    // Passage en OFFICIEL = envois RÉELS à toute l'audience → armement 2 clics (6 s), conforme à « pas de dialogs natifs ».
    if (action === 'activate-official' && (Date.now() > _masterArmUntil || _masterArmAction !== action)) {
      _masterArmUntil = Date.now() + 6000; _masterArmAction = action;
      const acts = document.getElementById('camp-master-actions');
      const b = acts && acts.querySelector('.camp-btn--send');
      if (b) { const old = b.textContent; b.textContent = '⚠️ Confirmer l’envoi RÉEL à toute l’audience ?'; setTimeout(function(){ if (Date.now() >= _masterArmUntil && b.textContent.indexOf('⚠️') === 0) b.textContent = old; }, 6100); }
      return;
    }
    _masterArmUntil = 0; _masterArmAction = '';
    var msg = document.getElementById('camp-master-msg'); if (msg) msg.textContent = '…';
    const noteMap = { 'activate-test': '🧪 Mode test activé : chaque e-mail arrivera sur ta boîte, le bon jour', 'activate-official': '🚀 Campagne OFFICIELLE lancée (audience réelle)', 'pause': '⏸ Campagne mise en pause' };
    try { await fetch('/api/admin/campaign-master?action=' + action).then(r => r.json()); _campMsg(noteMap[action] || 'ok'); loadMaster(); loadCampErrors(); if (typeof loadSequence === 'function') loadSequence(); }
    catch { if (msg) msg.textContent = '❌ erreur'; }
  }
  // ── Planification automatique (legacy, remplacé par « La Campagne » — conservé sans bouton) ──
  let _campSched = null;
  function _cprevLoad(){
    var type = window._cprevType || 'intro';
    var mem = document.getElementById('cprev-member');
    var m = (mem && mem.checked) ? '&member=1' : '';
    var f = document.getElementById('cprev-frame');
    if (!f) return;
    f.onload = function(){
      var ts = document.getElementById('cprev-ts');
      // Page d'ERREUR nginx dans le cadre (502/504 pendant un redéploiement du conteneur — vécu 17/07) :
      // même origine → on lit le document et on remplace la page brute par un état DTP + re-essai auto.
      var bad = false;
      try {
        var doc = f.contentDocument;
        var txt = ((doc && doc.title) || '') + ' ' + ((doc && doc.body) ? doc.body.textContent.slice(0, 300) : '');
        bad = /bad gateway|gateway time-?out|proxy error/i.test(txt);
        if (bad && doc && doc.body) doc.body.innerHTML = '<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#8b93a1;background:#0d0e11;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;"><div style="font-size:26px;">⟳</div><div style="color:#e6e6ea;font-weight:700;">Serveur en cours de redémarrage</div><div style="font-size:13px;">L\'aperçu revient automatiquement dans quelques secondes…</div></div>';
      } catch (e) {}
      clearTimeout(window._cprevRetryT);
      if (bad) {
        window._cprevRetryCount = (window._cprevRetryCount || 0) + 1;
        if (ts) ts.textContent = '⟳ Déploiement en cours : nouvel essai (' + window._cprevRetryCount + '/5)…';
        if (window._cprevRetryCount <= 5) window._cprevRetryT = setTimeout(_cprevLoad, 6000);
        else if (ts) ts.textContent = '⚠ Aperçu indisponible : nouvel essai automatique dans moins d’une minute.';
        return;
      }
      window._cprevRetryCount = 0;
      if (ts) ts.textContent = '● En direct · MAJ ' + new Date().toLocaleTimeString('fr-FR') + ' -';
    };
    var vv = (window._cprevVariant != null && window._cprevVariant !== '') ? ('&variant=' + window._cprevVariant) : '';   // Invitation : voir chaque variante
    var mo = (type === 'winback' && window._cprevMonths) ? ('&months=' + window._cprevMonths) : '';                       // Win-back : voir chaque jalon
    var ck = (type === 'mindset' && window._cprevConcept) ? ('&concept=' + encodeURIComponent(window._cprevConcept)) : ''; // Mindset : voir chaque thème
    f.src = '/api/admin/campaign-preview?type=' + type + m + vv + mo + ck + '&_=' + Date.now();
  }
  // La recharge auto de l'aperçu est passée dans l'horloge unique (_LIVE_SRC, source « apercu ») :
  // même règle qu'avant — Templates ouvert ET page visible — mais une seule horloge pour tout le panel.
  // On garde la fonction : elle est appelée à chaque changement de template et sert désormais à
  // REPARTIR d'une période pleine, pour qu'un rechargement ne tombe pas juste après une sélection.
  function _cprevArm(){
    if (window._cprevTimer) { clearInterval(window._cprevTimer); window._cprevTimer = null; }   // purge de l'ancien timer
    var s = _LIVE_SRC && _LIVE_SRC.find(function(x){ return x.k === 'apercu'; });
    if (s) s.next = Date.now() + s.per;
  }
  // Marque la carte active dans la bibliothèque + le titre de l'aperçu.
  function _cprevMark(){
    var _tt = _CAMP_TPLS.find(function(x){ return x.prev === window._cprevType; });   // source unique : la liste (couvre AUSSI les cycle-de-vie)
    var t = document.getElementById('cprev-title');
    if (t) t.textContent = '· ' + ((_tt && _tt.name) || window._cprevType || '')
      + (window._cprevVariant != null ? ' (' + (['pro', 'conviviale', 'performance'][window._cprevVariant] || window._cprevVariant) + ')' : '')
      + (window._cprevType === 'winback' && window._cprevMonths ? ' (' + (window._cprevMonths === 12 ? '1 an' : window._cprevMonths + ' mois') + ')' : '');
    document.querySelectorAll('#camp-tpl-grid .tpl-item').forEach(function(c){ c.classList.toggle('active', c.dataset.tpl === window._cprevType); });
  }
  function campPreview(type){
    window._cprevType = type; window._cprevVariant = null; window._cprevMonths = null;   // reset variante/jalon quand on change de template
    window._cprevRetryCount = 0;
    _cprevLoad(); _cprevMark(); _cprevArm();
  }
  // Invitation (conversion) : previsualise une variante precise (0 pro / 1 convivial / 2 perf).
  function campPreviewInvit(v){
    window._cprevType = 'invitation'; window._cprevVariant = v;
    window._cprevRetryCount = 0;
    _cprevLoad(); _cprevMark(); _cprevArm();
  }
  // ── Séquence automatique (drip) ──
  let _campDrip = null;
  let _dripArmUntil = 0;
  async function campDripTest(tpl){
    var say = function(t){ ['camp-drip-msg', 'camp-tpl-msg'].forEach(function(id){ var e = document.getElementById(id); if (e) e.textContent = t; }); };
    say('Envoi du test ' + tpl + '…');
    try { const d = await fetch('/api/admin/campaign-send?test=1&tpl=' + tpl).then(r => r.json());
      say(''); _campMsg(d.ok ? ('✅ Test ' + tpl + ' envoyé à ' + d.to) : ('❌ ' + (d.error || d.note || 'échec'))); }
    catch { say('❌ erreur réseau'); }
  }
  // ── Fiabilité & incidents (pre-flight / historique d'erreurs) ──
  function _dt(ts){ try { return new Date(ts).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}); } catch { return ''; } }
  function _escH(s){ return String(s==null?'':s).replace(/[<>&]/g,function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c];}); }
  async function loadCampErrors(){
    const badge = document.getElementById('camp-err-badge'), body = document.getElementById('camp-err-body');
    if (!body) return;
    try {
      const d = await fetch('/api/admin/campaign-errors').then(r => r.json());
      if (!d || !d.ok) { body.textContent = 'Indisponible.'; return; }
      const errs = d.errors || [];
      const crit = errs.filter(function(e){ return e.level === 'critical'; }).length;
      if (badge) badge.innerHTML = errs.length ? ('<span style="color:' + (crit?'#ff6b57':'#ffb300') + ';font-weight:700;">' + errs.length + ' incident' + (errs.length>1?'s':'') + '</span>') : '<span style="color:#00e676;">● sain</span>';
      var pausedBanner = '';
      if (d.dripPaused && d.pausedReason) {
        pausedBanner = '<div style="background:rgba(255,61,0,0.10);border:1px solid rgba(255,61,0,0.35);border-radius:6px;padding:11px 13px;margin-bottom:12px;">'
          + '<div style="color:#ff6b57;font-weight:800;font-size:13px;">⏸ Séquence mise en pause par le pre-flight</div>'
          + '<div style="color:#cbd5e1;font-size:12.5px;margin-top:4px;">' + _escH(d.pausedReason.summary || '') + '</div>'
          + '<div style="color:#8b93a1;font-size:11.5px;margin-top:6px;">Corrigez la cause, puis « Activer la séquence » ci-dessus (anti-doublon garanti).</div></div>';
      }
      if (!errs.length) { body.innerHTML = pausedBanner + '<div style="display:flex;align-items:center;gap:10px;"><span style="width:11px;height:11px;border-radius:50%;background:#00e676;box-shadow:0 0 10px #00e676;"></span><span style="font-size:15px;font-weight:700;color:#00e676;">Aucun incident : tout fonctionne</span></div>'; return; }
      const rows = errs.slice(0, 12).map(function(e){
        var col = e.level === 'critical' ? '#ff6b57' : '#ffb300';
        return '<tr><td style="padding:8px 10px 8px 0;border-top:1px solid #1f1f24;vertical-align:top;white-space:nowrap;color:#8b93a1;font-size:11.5px;">' + _dt(e.at) + '</td>'
          + '<td style="padding:8px 10px 8px 0;border-top:1px solid #1f1f24;vertical-align:top;"><span style="color:' + col + ';font-weight:700;font-size:11px;">' + (e.level==='critical'?'CRITIQUE':'ALERTE') + '</span> <span style="color:#cbd5e1;font-size:11.5px;">' + _escH(e.campaign) + '</span></td>'
          + '<td style="padding:8px 0;border-top:1px solid #1f1f24;vertical-align:top;color:#cbd5e1;font-size:12.5px;">' + _escH(e.cause) + (e.actions?('<div style="color:#8b93a1;font-size:11.5px;margin-top:3px;">→ ' + _escH(e.actions) + '</div>'):'') + '</td></tr>';
      }).join('');
      body.innerHTML = pausedBanner + '<table style="width:100%;border-collapse:collapse;">' + rows + '</table>';
    } catch { body.textContent = 'Erreur de chargement.'; }
  }
  /* ── PROGRAMME DES ENVOIS (12/08, demande user « donne-moi la possibilité de choisir le prochain
     envoi et d'organiser le programme de pilotage depuis le panel ») ────────────────────────────
     Les 8 prochaines semaines, chacune avec le contenu prévu et un sélecteur pour la forcer.
     « Auto » rend la semaine à la rotation. Aucun envoi ne part d'ici : ce sont des réglages. */
  function _planMsg(t, ko) {
    const el = document.getElementById('camp-plan-msg'); if (!el) return;
    el.textContent = t || ''; el.style.color = ko ? '#ff5233' : '#00e676';
    if (t) setTimeout(function () { if (el.textContent === t) el.textContent = ''; }, 4000);
  }
  async function loadPlan() {
    // « 2026-08-10 » était la SEULE date au format ISO du panneau, sur un écran qui doit être 100 %
    // français. On affiche la semaine telle qu on la lit : « 10 au 16 août ».
    const _semaineFr = function (iso) {
      try {
        const p = String(iso || '').split('-').map(Number);
        if (p.length !== 3 || !p[0]) return iso || '';
        const a = new Date(Date.UTC(p[0], p[1] - 1, p[2])), b = new Date(a.getTime() + 6 * 864e5);
        const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
        const mA = MOIS[a.getUTCMonth()], mB = MOIS[b.getUTCMonth()];
        return mA === mB ? (a.getUTCDate() + ' au ' + b.getUTCDate() + ' ' + mB)
                         : (a.getUTCDate() + ' ' + mA + ' au ' + b.getUTCDate() + ' ' + mB);
      } catch (e) { return iso || ''; }
    };
    const body = document.getElementById('camp-plan-body'); if (!body) return;
    try {
      const d = await fetch('/api/admin/campaign-plan').then(r => r.json());
      if (!d || !d.ok) { body.innerHTML = '<div class="camp-note">Programme indisponible.</div>'; return; }
      /* ⚠️ « AUCUN TÉMOIGNAGE PROGRAMMÉ » ÉTAIT FAUX (09/09). Le témoignage part tout seul le 1er
         mardi de chaque mois — les lignes du programme, juste en dessous, le montraient d'ailleurs.
         Cette mention ne parlait en réalité que de la date FORCÉE À LA MAIN, et son absence se
         lisait comme une absence d'envoi. Elle dit maintenant la cadence réelle et QUELLE des cinq
         présentations partira, la rotation étant déjà en place côté serveur. */
      const sub = document.getElementById('camp-plan-sub');
      const _ti = d.temoignageInfo || null;
      if (sub) {
        const _varTxt = (_ti && _ti.total) ? ' · variante ' + _ti.varianteNum + '/' + _ti.total + (_ti.sujet ? ' « ' + _ti.sujet + ' »' : '') : '';
        sub.textContent = (d.temoignage
          ? 'Témoignage forcé le ' + d.temoignage
          : 'Témoignage : ' + ((_ti && _ti.cadence) || '1er mardi du mois'))
          + _varTxt + (d.testMode ? ' · mode TEST' : '');
      }
      /* CARTE DU PARRAINAGE SEMESTRIEL (04/09). Elle repond a UNE question — « quand ca part » — et
         a une seconde que le user n'a pas eu a poser : QUOI part. Le mail change a chaque envoi,
         donc afficher la date sans dire quelle variante l'accompagne laisserait relire les quatre
         gabarits pour savoir lequel arrive. On montre donc la date, la fenetre horaire, la variante
         a venir avec son objet reel, et l'historique (dernier envoi, nombre d'envois) : c'est lui
         qui prouve que la cadence tourne. */
      const par = d.parrainage;
      const boxPar = document.getElementById('camp-plan-parrain');
      if (boxPar && par) {
        const _jf = function (iso) {
          try { return new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
          catch (e) { return iso || ''; }
        };
        /* PAS `esc` ICI. Le `esc` de ce fichier echappe l'apostrophe en \' — il est ecrit pour
           injecter une valeur dans un littéral JS d'attribut onclick, pas pour poser du TEXTE dans
           du HTML. Aucun des quatre objets actuels ne porte d'apostrophe, donc le defaut ne se
           verrait pas aujourd'hui ; il se verrait le jour ou une cinquieme variante en porte une,
           et il s'afficherait alors comme une barre oblique en clair chez l'admin. */
        const _htm = function (t) { const n = document.createElement('span'); n.textContent = String(t == null ? '' : t); return n.innerHTML; };
        const _retard = par.date && par.date <= new Date().toISOString().slice(0, 10);
        /* ⚠️ « PROCHAIN » N'EST PAS UN SYNONYME DE « À VENIR » (09/09, constat user : « comme le
           prochain envoi n'est pas le truc de parrainage, on peut enlever la bande qui dit que
           c'est le prochain »). Cette ligne portait le libellé « Prochain » ET la mise en avant
           dorée `--now` SANS CONDITION : le parrainage se présentait comme le prochain envoi alors
           que sa date tombait dix-huit mois plus tard, juste au-dessus du vrai prochain envoi, lui
           aussi doré. Deux « prochains » à l'écran, dont un faux.
           La règle est maintenant celle que le mot signifie : premier DANS LE TEMPS. On compare à
           l'échéance hebdomadaire réelle (`prochainIdx`), et à défaut de rang, la colonne dit
           l'attente — c'est l'information utile quand ce n'est PAS pour tout de suite. */
        const _semProch = (d.semaines && d.semaines[d.prochainIdx]) ? d.semaines[d.prochainIdx].debut : '';
        const _estProchain = !!_retard || (!!par.date && !!_semProch && par.date <= _semProch);
        const _attente = (function () {
          if (!par.date) return '';
          const j = Math.round((new Date(par.date + 'T12:00:00Z') - Date.now()) / 86400000);
          if (j <= 31) return 'dans ' + Math.max(1, j) + ' j';
          const m = Math.round(j / 30.4);
          return 'dans ' + m + ' mois';
        })();
        boxPar.innerHTML = '<div class="camp-plan-row' + (_estProchain ? ' camp-plan-row--now' : '') + '">'
          + '<div class="camp-plan-wk">' + (_retard ? 'À envoyer' : (_estProchain ? 'Prochain' : _attente)) + '<span>tous les 6 mois</span></div>'
          + '<div class="camp-plan-main"><strong>Parrainage</strong>'
          + '<span class="camp-plan-when">' + _jf(par.date) + (par.heure ? ' · ' + par.heure : '') + '</span>'
          + (par.programmee ? '<span class="camp-plan-badge">date forcée</span>' : '')
          + '<span class="camp-plan-temoin">Variante ' + par.varianteNum + '/' + (par.variantes || []).length + ' · <em>'
          + _htm(((par.variantes || []).find(function (v) { return v.key === par.variante; }) || {}).subject || par.variante) + '</em></span>'
          + '<span class="camp-plan-sent">' + (par.dernierAt
              ? '✓ dernier envoi ' + new Date(par.dernierAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' · ' + par.envois + ' envoi' + (par.envois > 1 ? 's' : '') + ' au total'
              : 'jamais envoyé') + '</span>'
          + '</div></div>';
      }
      const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
      body.innerHTML = '<div class="camp-plan-list">' + (d.semaines || []).map(function (w, i) {
        const quand = JOURS[w.jour] ? (JOURS[w.jour] + (w.heure ? ' ' + w.heure + 'h' : '')) : '';
        const opts = (d.contenus || []).map(function (c) {
          return '<option value="' + c.id + '"' + (w.force && c.id === w.contenuId ? ' selected' : '') + '>' + c.label + '</option>';
        }).join('');
        // « MONTRE LE PROCHAIN UNE FOIS QUE LE MAIL EST PARTI » (15/08, demande user) : la mise en
        // avant ne suit plus la semaine CALENDAIRE mais la prochaine échéance RÉELLE (prochainIdx,
        // calculé côté serveur d'après le journal des envois). Le samedi après-midi, le panel
        // désignait encore comme à venir un Récap Hebdo parti le matin même.
        const _prochain = (typeof d.prochainIdx === 'number') ? d.prochainIdx : 0;
        /* ⚠️ LA VARIANTE N'EST ANNONCÉE QUE SUR LE PROCHAIN TÉMOIGNAGE, et c'est délibéré. Le plan
           couvre huit semaines, donc deux 1ers mardis : la rotation aura tourné entre les deux, et
           répéter la même étiquette sur les deux lignes annoncerait deux fois un mail qui ne partira
           qu'une. On ne dit donc que ce qu'on sait. */
        const _temPrem = (d.semaines || []).findIndex(function (x) { return x.temoignageLe && !x.envoye; });
        const _tinf = d.temoignageInfo || null;
        const _temLbl = (i === _temPrem && _tinf && _tinf.total)
          ? 'variante ' + _tinf.varianteNum + '/' + _tinf.total + (_tinf.sujet ? ' · ' + _tinf.sujet : '')
          : '';
        const _lbl = w.envoye ? 'Envoyé'
          : (i === _prochain ? 'Prochain envoi'
            : (i === 0 ? 'Cette semaine' : (i === 1 ? 'Semaine prochaine' : 'dans ' + i + ' sem.')));
        // Heure réelle d'envoi + nombre de destinataires : « parti » sans preuve n'aide personne.
        const _envInfo = w.envoye
          ? '<span class="camp-plan-sent">✓ parti' + (w.envoyeAt ? ' ' + new Date(w.envoyeAt).toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
            + (w.envoyeN ? ' · ' + w.envoyeN + ' destinataire' + (w.envoyeN > 1 ? 's' : '') : '') + '</span>'
          : '';
        const _ligne = '<div class="camp-plan-row' + (i === _prochain ? ' camp-plan-row--now' : '') + (w.envoye ? ' camp-plan-row--sent' : '') + '">'
          + '<div class="camp-plan-wk">' + _lbl
          + '<span>' + _semaineFr(w.debut) + '</span></div>'
          + '<div class="camp-plan-main"><strong>' + w.contenu + '</strong>'
          + (quand ? '<span class="camp-plan-when">' + quand + '</span>' : '')
          + _envInfo
          + (w.force ? '<span class="camp-plan-badge">forcé</span><span class="camp-plan-auto">rotation : ' + w.auto + '</span>' : '')
          + '</div>'
          + '<select class="camp-plan-input" data-wk="' + w.cle + '" onchange="campPlanForcer(this.value, this.dataset.wk)">'
          + '<option value="">Auto (rotation)</option>' + opts + '</select>'
          + '</div>';
        /* ⚠️ LE TÉMOIGNAGE A SA PROPRE LIGNE (01/09, demande utilisateur : « ajoute une ligne pour
           témoignage membre comme les autres car ça reste un template comme un autre »).
           Il était rendu en ÉTIQUETTE accrochée à la ligne d'une AUTRE semaine — le seul envoi du
           programme à ne pas se lire comme les autres, alors qu'il en est un : son gabarit, son
           objet, ses cinq variantes. Sur un écran dont le rôle est de dire ce qui part et quand,
           faire d'un envoi la note de bas de page d'un autre le rendait facile à manquer.
           CE QUI NE CHANGE PAS : il reste HORS ROTATION (mensuel, il s'AJOUTE au contenu de la
           semaine au lieu de le remplacer). Sa ligne n'a donc pas de sélecteur « Auto (rotation) » —
           l'y mettre laisserait croire qu'on peut lui substituer un autre contenu, ce qui n'existe
           pas côté serveur. La colonne de droite dit sa cadence à la place.
           ⚠️ JOUR CALCULÉ DEPUIS LA DATE, PLUS JAMAIS « mardi » EN DUR (31/08, demande user :
           « n'envoie jamais 2 mails en même temps... créer un décalage de 2j »). Le serveur décale
           le témoignage au jeudi quand le mardi est déjà pris par la rotation hebdomadaire — un
           libellé figé aurait continué d'afficher « mardi » alors que l'envoi réel a bougé. */
        if (!w.temoignageLe) return _ligne;
        const _tDate = new Date(w.temoignageLe + 'T12:00:00Z');
        const _tJour = JOURS[_tDate.getUTCDay()] || 'mardi';
        return _ligne
          + '<div class="camp-plan-row camp-plan-row--temoin">'
          + '<div class="camp-plan-wk">' + (i === _temPrem ? 'Prochain témoignage' : 'Mensuel')
          + '<span>' + _tDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }) + '</span></div>'
          + '<div class="camp-plan-main"><strong>Témoignage membre</strong>'
          + '<span class="camp-plan-when">' + _tJour + ' 18h</span>'
          + (_temLbl ? '<span class="camp-plan-badge">' + _temLbl + '</span>' : '')
          + '</div>'
          + '<span class="camp-plan-hors">Mensuel · hors rotation</span>'
          + '</div>';
      }).join('') + '</div>';
    } catch (e) { body.innerHTML = '<div class="camp-note">Programme indisponible.</div>'; }
  }
  window.campPlanForcer = async function (contenu, semaine) {
    try {
      const r = await fetch('/api/admin/campaign-plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ semaine: semaine, contenu: contenu || '' }),
      }).then(function (x) { return x.json(); });
      if (!r || !r.ok) { _planMsg((r && r.error) || 'échec', true); return; }
      _planMsg(contenu ? 'Semaine forcée.' : 'Semaine rendue à la rotation.');
      loadPlan(); if (typeof loadSequence === 'function') loadSequence();
    } catch (e) { _planMsg('échec réseau', true); }
  };
  // ── Sequence / supervision hebdo ──
  async function loadSequence(){
    try {
      const d = await fetch('/api/admin/campaign-sequence').then(r => r.json());
      if (!d || !d.steps) return;
      // (Bloc « camp-seq-sub » retiré le 13/08 : il écrivait dans un élément qui n existe dans AUCUN
      //  HTML — vestige d un en-tête supprimé lors de la fusion des sous-onglets. L information qu il
      //  composait, semaine en cours + contenu, est déjà lisible ligne par ligne dans « Programme
      //  des envois » juste au-dessus.)
      // Bandeau d'état — reflète le bouton « La Campagne » : à l'arrêt → tout est figé ; en marche → reprend au bon jour/heure.
      // BANDEAU D ÉTAT et BANDEAU DE VOL SUPPRIMÉS (13/08, « trop d informations ») : le premier
      // répétait le mode de la campagne, déjà écrit EN GROS dans la carte « La Campagne » et rappelé
      // par le badge de son en-tête — trois fois le même état sur un écran. Le second répétait
      // « prochain envoi » et « dernier parti » ; « dernier parti » (demande user du 26/07) n est pas
      // perdu : il est remonté dans la carte principale, à côté du prochain, là où on le cherche.
      let _nextFrameId = null;
      const _cur = d.steps.find(function(s){ return s.thisWeek && s.id !== 'intro-v1'; });
      if (_cur && !_cur.doneWeek) _nextFrameId = _cur.id;
      else {
        let _best = null;
        d.steps.forEach(function(s){ if (s.id !== 'intro-v1' && !s.thisWeek && s.nextRunMonday && (!_best || s.nextRunMonday < _best.nextRunMonday)) _best = s; });
        if (_best) _nextFrameId = _best.id;
      }
      const rowsHtml = d.steps.map(function(s){
        const isIntro = s.id === 'intro-v1';
        // « Envoyé » = envoyé CETTE semaine (le compteur reparte chaque lundi) — sauf l'intro (one-time à l'inscription).
        const doneWeek = isIntro ? (s.sent > 0) : !!s.doneWeek;
        const cls = doneWeek ? 'done' : ((s.thisWeek && d.active) ? 'ready' : 'planned');
        const wk = s.week ? 'S' + s.week : 'Évt';
        // Statut : intro = à l'inscription ; contenu de la semaine = envoyé/à venir ; autres = en rotation.
        let status;
        if (isIntro) status = '📩 À l\'inscription';
        else if (s.thisWeek) status = doneWeek ? '✅ Envoyé cette semaine' : (!d.active ? '⏸ En pause' : '🕓 À venir');
        else status = '🔁 En rotation';
        const weekBadge = (s.thisWeek && !isIntro) ? ' <span class="camp-seq-next">● CETTE SEMAINE</span>' : '';
        // Ligne temps : intro = cadence ; contenu de la semaine à venir = 📅 jour+date ; hors semaine = prochaine diffusion.
        let timeLine = '';
        if (isIntro) timeLine = s.when ? '<div class="camp-seq-desc" style="color:#e3b23a;opacity:.9;margin-top:3px;">🕐 ' + s.when + '</div>' : '';
        else if (s.thisWeek && !doneWeek && s.planned) timeLine = '<div class="camp-seq-desc" style="color:#e3b23a;opacity:.95;margin-top:3px;font-weight:600;">📅 ' + s.planned.label + '</div>';
        else if (!s.thisWeek && s.nextRunMonday) timeLine = '<div class="camp-seq-desc" style="color:#8b93a1;margin-top:3px;">🔁 Prochaine diffusion : semaine du ' + _dj(s.nextRunMonday) + '</div>';
        else if (s.when) timeLine = '<div class="camp-seq-desc" style="color:#e3b23a;opacity:.9;margin-top:3px;">🕐 ' + s.when + '</div>';
        // Métriques = historique cumulé (dernier envoi + total + taux), pour le suivi de performance.
        const metrics = s.lastSentAt ? '<div class="camp-seq-metrics">Dernier envoi ' + _dt(s.lastSentAt) + ' · ' + s.sent + ' au total · ' + s.openRate + '% ouv. · ' + s.clickRate + '% clics</div>' : '';
        const dim = (!isIntro && !s.thisWeek) ? ' style="opacity:.62;"' : ((!d.active && !doneWeek) ? ' style="opacity:.55;"' : '');
        return '<div class="camp-seq-row camp-seq-row--' + cls + ((s.id === _nextFrameId && d.active) ? ' camp-seq-row--next' : '') + '"' + dim + '><div class="camp-seq-wk">' + wk + '</div>'
          + '<div class="camp-seq-main"><div class="camp-seq-title">' + s.title + ' <span class="camp-seq-pill">' + s.pillar + '</span>' + weekBadge + '</div>'
          + '<div class="camp-seq-desc">' + s.desc + '</div>'
          + timeLine
          + metrics + '</div>'
          + '<div class="camp-seq-status camp-seq-status--' + cls + '">' + status + '</div></div>';
      }).join('');
      document.getElementById('camp-seq-list').innerHTML = rowsHtml;
    } catch {}
  }

  // ── amCharts 5 : courbes (area lissée) + donut, style du site (dark + orange) ──
  const _amRoots = {};
  function _amReady() { return typeof am5 !== 'undefined'; }
  function _amDispose(id) { if (_amRoots[id]) { try { _amRoots[id].dispose(); } catch {} _amRoots[id] = null; } }
  function _amArea(id, data, colorHex, prefix) {
    const host = document.getElementById(id); if (!host) return;
    if (!_amReady()) { host.innerHTML = '<div class="am-fallback">Graphique indisponible.</div>'; return; }
    _amDispose(id);
    const root = am5.Root.new(id); _amRoots[id] = root;
    root._logo?.set('forceHidden', true); root._logo?.dispose();
    root.setThemes([am5themes_Animated.new(root)]);
    const color = am5.color(colorHex);
    const chart = root.container.children.push(am5xy.XYChart.new(root, { panX:false, panY:false, wheelX:'none', wheelY:'none', paddingLeft:2, paddingRight:10, paddingTop:12, paddingBottom:2 }));
    const xR = am5xy.AxisRendererX.new(root, { minGridDistance:28 });
    xR.grid.template.setAll({ strokeOpacity:0 });
    xR.labels.template.setAll({ fill:am5.color(0xcfd4da), fontSize:10, fontFamily:'Inter, -apple-system, sans-serif' });
    const xAxis = chart.xAxes.push(am5xy.CategoryAxis.new(root, { categoryField:'cat', renderer:xR }));
    xAxis.data.setAll(data);
    const yR = am5xy.AxisRendererY.new(root, {});
    yR.grid.template.setAll({ stroke:am5.color(0x222227), strokeOpacity:0.7 });
    yR.labels.template.setAll({ fill:am5.color(0x9aa0a6), fontSize:10, fontFamily:'Inter, -apple-system, sans-serif' });
    const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, { min:0, renderer:yR }));
    const series = chart.series.push(am5xy.SmoothedXLineSeries.new(root, { xAxis, yAxis, valueYField:'val', categoryXField:'cat', stroke:color, fill:color, tooltip:am5.Tooltip.new(root, { labelText:(prefix||'') + '{valueY}' }) }));
    series.strokes.template.setAll({ strokeWidth:2.5 });
    series.fills.template.setAll({ visible:true, fillGradient: am5.LinearGradient.new(root, { stops:[{ color, opacity:0.32 }, { color, opacity:0.02 }], rotation:90 }) });
    series.bullets.push(() => am5.Bullet.new(root, { sprite: am5.Circle.new(root, { radius:3, fill:color, stroke:am5.color(0x0a0a0a), strokeWidth:1.5 }) }));
    series.data.setAll(data);
    chart.set('cursor', am5xy.XYCursor.new(root, { behavior:'none', xAxis, yAxis }));
    series.appear(700); chart.appear(700, 80);
  }
  function _amDonut(id, data) {
    const host = document.getElementById(id); if (!host) return;
    if (!_amReady()) { host.innerHTML = '<div class="am-fallback">Graphique indisponible.</div>'; return; }
    _amDispose(id);
    if (!data.length) { host.innerHTML = '<div class="am-fallback">Aucun abonné actif.</div>'; return; }
    const root = am5.Root.new(id); _amRoots[id] = root;
    root._logo?.set('forceHidden', true); root._logo?.dispose();
    root.setThemes([am5themes_Animated.new(root)]);
    const chart = root.container.children.push(am5percent.PieChart.new(root, { innerRadius: am5.percent(62), paddingTop:4, paddingBottom:4 }));
    const series = chart.series.push(am5percent.PieSeries.new(root, { categoryField:'cat', valueField:'val', alignLabels:false }));
    series.set('colors', am5.ColorSet.new(root, { colors: data.map(d => am5.color(d.color)) }));
    series.slices.template.setAll({ stroke:am5.color(0x0a0a0a), strokeWidth:2 });
    series.labels.template.setAll({ fill:am5.color(0xcfd4da), fontSize:10, fontFamily:'Inter, -apple-system, sans-serif', text:'{category} {value}' });
    series.ticks.template.setAll({ stroke:am5.color(0x3a3a40), strokeOpacity:0.6 });
    series.data.setAll(data);
    series.appear(700, 90);
  }

  // ── Test de l'alerte e-mail admin (provider rouge / quota / panne) ──
  async function aimTestAlert(btn) {
    const old = btn.textContent; btn.disabled = true; btn.textContent = 'Envoi…';
    try {
      const r = await fetch('/api/admin/ai-alert-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(x => x.json());
      btn.textContent = r.ok ? '✓ Envoyée (' + (r.channel || 'ok') + ')' : '✗ Échec d\'envoi';
    } catch { btn.textContent = '✗ Erreur'; }
    setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 4500);
  }

  // ── IA Monitor : refonte pro (validée en maquette) : barre de commande, KPIs denses, empilé par
  //    fournisseur, prévision à micro-barres, infra en cartes, journal filtrable ──
  let _aimNextAt = 0, _aimBusy = false;   // source de vérité du compte à rebours (barre de statut)
  let _aimHours = 24, _aimJFilter = '', _aimLastData = null;
  // Groq en 1re clé = ordre de la cascade réelle (Groq principal depuis juil. 2026) → légende + empilement du graphe.
  const AIM_PCOL = { groq: 0xec4899, gemini: 0x60a5fa, github: 0xa78bfa, openrouter: 0x00cc99, cohere: 0x38bdf8, cloudflare: 0xf6821f, xai: 0x94a3b8, claude: 0xe3b23a };
  const AIM_PLBL = { groq: 'Groq', gemini: 'Gemini', github: 'GitHub', openrouter: 'OpenRouter', cohere: 'Cohere', cloudflare: 'Cloudflare', xai: 'xAI', claude: 'Claude' };
  const _hcol = s => s == null ? '#6b7280' : s >= 75 ? '#22c55e' : s >= 40 ? '#ffb300' : '#ef4444';
  function aimRenderKpis(d) {
    const b = d.budget, g = (d.providers || {}).gemini || {};
    const riskLbl = { low: 'Faible', medium: 'Modéré', high: 'Élevé', exhausted: 'Épuisé', unknown: '-' }[b.risk] || b.risk;
    const press = Math.round((g.pressure || 0) * 100);
    const pressCol = press >= 75 ? '#ef4444' : press >= 55 ? '#ffb300' : '#22c55e';
    const bk = d.backoff && d.backoff.active;
    const mPct = Math.min(100, Math.round((b.monthUsed || 0) / Math.max(1, b.monthly) * 100));
    document.getElementById('aim-kpis').innerHTML =
      `<div class="aim-kpi aim-kpi--accent"><div class="aim-kpi-l">Quota du jour</div><div class="aim-kpi-v">${b.dayTotal}<small> / ${b.dailyCap}</small></div><div class="aim-track"><i style="width:${Math.min(100, b.pctUsed)}%"></i></div><div class="aim-kpi-s">${b.pctUsed}% utilisé · reste ${b.remaining}</div></div>`
      + `<div class="aim-kpi"><div class="aim-kpi-l">Risque épuisement</div><div class="aim-kpi-v"><span class="aim-pill aim-pill--${b.risk}">${riskLbl}</span></div><div class="aim-kpi-s">${b.hoursToExhaust != null ? ('~' + b.hoursToExhaust + ' h restantes') : 'conso négligeable'}</div></div>`
      + `<div class="aim-kpi"><div class="aim-kpi-l">Débit récent</div><div class="aim-kpi-v">${b.ratePerHour}<small> /h</small></div><div class="aim-kpi-s">appels IA (3 dernières h)</div></div>`
      + `<div class="aim-kpi"><div class="aim-kpi-l">Pression santé</div><div class="aim-kpi-v" style="color:${pressCol}">${press}<small> %</small></div><div class="aim-kpi-s">RPM Gemini (repli) ${g.effRpm || 0}/${g.rpmTarget || 0}</div></div>`
      + `<div class="aim-kpi"><div class="aim-kpi-l">Backoff global</div><div class="aim-kpi-v" style="color:${bk ? '#ef4444' : '#22c55e'}">${bk ? 'ACTIF' : 'non'}</div><div class="aim-kpi-s">${bk ? (d.backoff.totalFails || 0) + ' échecs cumulés' : 'chaîne nominale'}</div></div>`
      + `<div class="aim-kpi"><div class="aim-kpi-l">Budget mensuel</div><div class="aim-kpi-v">${b.monthUsed}<small> / ${b.monthly}</small></div><div class="aim-track"><i style="width:${mPct}%"></i></div><div class="aim-kpi-s">${(b.weekend ? 'week-end · ' : '') + (b.quietHours ? 'heures calmes' : 'heures actives')}</div></div>`;
  }
  function aimRenderProviders(d) {
    const h = d.health || {}, P = d.providers || {};
    const g = P.gemini || {}, gh = P.github || {}, or = P.openrouter || {}, cl = P.claude || {}, gr = P.groq || {}, co = P.cohere || {}, xa = P.xai || {}, cf = P.cloudflare || {};
    /* 23/09 : la dernière erreur de CHAQUE fournisseur, avec son code. 14 jours de télémétrie
       montraient Groq, GitHub et OpenRouter à zéro succès sans que l'écran dise pourquoi. */
    const ERR = P.erreurs || {};
    const cause = st => st === 401 ? 'clé refusée (expirée ou révoquée)' : st === 403 ? 'accès refusé (compte ou région)'
      : st === 402 ? 'crédit épuisé' : st === 429 ? 'quota ou débit dépassé' : st === 404 ? 'modèle introuvable (retiré ?)'
      : (st >= 500 && st < 600) ? 'panne côté fournisseur' : '';
    const errRow = (k) => {
      const e = ERR[k]; if (!e || !e.at) return [];
      const min = Math.max(0, Math.round((Date.now() - e.at) / 60000));
      const quand = min < 1 ? 'à l’instant' : min < 60 ? 'il y a ' + min + ' min' : 'il y a ' + Math.round(min / 60) + ' h';
      const code = e.status ? 'HTTP ' + e.status + (cause(e.status) ? ' · ' + cause(e.status) : '') : 'sans code';
      const esc2 = t => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      return [['Dernière erreur', `<span title="${esc2(e.msg)}">${esc2(code)} · ${quand}</span>`]];
    };
    const card = (label, tier, score, rows, chips, cle) => {
      const col = _hcol(score);
      rows = rows.concat(cle ? errRow(cle) : []);
      return `<div class="aim-prov"><div class="aim-prov-top"><span class="aim-prov-dot" style="background:${col};box-shadow:0 0 5px ${col}66"></span><span class="aim-prov-name">${label} <small>${tier}</small></span><span class="aim-prov-score" style="color:${col}">${score == null ? '-' : score}</span></div>`
        + `<div class="aim-prov-bar"><i style="width:${score == null ? 0 : score}%;background:${col}"></i></div>`
        + rows.map(r => `<div class="aim-kv"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')
        + (chips && chips.length ? `<div class="aim-chips">${chips.join('')}</div>` : '')
        + `</div>`;
    };
    const chip = (txt, cls) => `<span class="aim-chip${cls ? ' ' + cls : ''}">${txt}</span>`;
    document.getElementById('aim-providers').innerHTML =
      card('Gemini', 'gratuit', h.gemini, [
        ['Clés', g.keys + ' (' + (g.coolingKeys || 0) + ' gelées)'], ['Appels aujourd’hui', g.callsToday + ''], ['Erreurs 429', g.err429Today + ''], ['RPM effectif', (g.effRpm || 0) + ' / ' + (g.rpmTarget || 0)],
      ], [chip('repli n°1'), g.coolingKeys ? chip(g.coolingKeys + ' clé(s) en cooldown') : chip('clés OK', 'aim-chip--ok'), g.breakersOpen ? chip(g.breakersOpen + ' breaker ouvert') : ''].filter(Boolean), 'gemini')
      + card('GitHub Models', 'gratuit', h.github, gh.tokens ? [
        ['Tokens × modèles', gh.tokens + ' × ' + (gh.models || 1)], ['Appels aujourd’hui', gh.callsToday + ''], ['Échecs (jour)', (gh.failToday || 0) + ''],
      ] : [['État', 'non configuré']], gh.tokens ? [gh.coolingKeys ? chip(gh.coolingKeys + ' (modèle,token) gelés') : chip('nominal', 'aim-chip--ok')] : [], 'github')
      + card('OpenRouter', 'gratuit', h.openrouter, or.keys ? [
        ['Clés (comptes)', or.keys + ' · ~' + (or.keys * 50) + ' req/j'], ['Appels aujourd’hui', or.callsToday + ''], ['Échecs (jour)', (or.failToday || 0) + ''], ['Modèles :free', or.models + ''],
      ] : [['État', 'non configuré']], or.keys ? [or.coolingKeys ? chip(or.coolingKeys + ' en cooldown') : chip('nominal', 'aim-chip--ok')] : [], 'openrouter')
      + card('Cohere', 'gratuit', h.cohere, co.keys ? [
        ['Clés', co.keys + ''], ['Appels aujourd’hui', co.callsToday + ''], ['Échecs (jour)', (co.failToday || 0) + ''], ['Modèles', co.models + ''],
      ] : [['État', 'non configuré']], co.keys ? [co.coolingKeys ? chip(co.coolingKeys + ' clé(s) en cooldown') : chip('nominal · trial', 'aim-chip--ok')] : [], 'cohere')
      + card('Cloudflare', 'gratuit', h.cloudflare, cf.keys ? [
        ['Modèles', cf.models + ''], ['Appels aujourd’hui', cf.callsToday + ''], ['Échecs (jour)', (cf.failToday || 0) + ''],
      ] : [['État', cf.account ? 'clé absente' : 'compte (ID) manquant']], cf.keys ? [chip('repli gratuit'), cf.coolingKeys ? chip(cf.coolingKeys + ' clé(s) en cooldown') : chip('nominal', 'aim-chip--ok')] : [chip('Workers AI · à configurer')], 'cloudflare')
      + card('Claude', 'payant', h.claude, cl.keys ? [
        ['Clés', cl.keys + ''], ['Utilisé (jour)', cl.usedToday + ' / ' + cl.dailyMax], ['Disponibilité', cl.usable ? 'disponible' : 'indisponible'],
      ] : [['État', 'non configuré']], cl.keys ? [cl.usable ? chip('réservé macro importante', 'aim-chip--ok') : chip('crédit épuisé', 'aim-chip--bad'), (cl.cooling && cl.cooling.length) ? chip(cl.cooling.length + ' clé(s) en cooldown') : ''].filter(Boolean) : [], 'claude');
    const sub = document.getElementById('aim-prov-sub');
    if (sub) { const scores = [h.gemini, h.github, h.openrouter, h.cohere, h.cloudflare, h.claude].filter(s => s != null); sub.textContent = scores.length ? ('santé moyenne ' + Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) + '/100') : ''; }
  }
  function aimRenderLegend(d) {
    const P = d.providers || {};
    const el = document.getElementById('aim-legend'); if (!el) return;
    el.innerHTML = Object.keys(AIM_PCOL).map(k => {
      const calls = (P[k] || {}).callsToday; const hex = '#' + AIM_PCOL[k].toString(16).padStart(6, '0');
      return `<span><i style="background:${hex}"></i>${AIM_PLBL[k]}${calls != null ? ' · ' + calls : ''}</span>`;
    }).join('');
  }
  function aimRenderForecast(d) {
    const b = d.budget;
    const maxE = Math.max(1, ...(b.nextHours || []).map(x => x.expected || 0));
    const nh = (b.nextHours || []).map(x => `<div class="aim-dem"><span>${String(x.h).padStart(2, '0')}h</span><div class="aim-dem-track"><i style="width:${Math.round((x.expected || 0) / maxE * 100)}%"></i></div><b>${x.expected}</b></div>`).join('');
    // Rythme MENSUEL : projection fin de mois au rythme observé (vert = enveloppe tenue, ambre/rouge = pacing va resserrer)
    const projRow = (b.monthProjected != null && b.monthly) ? (() => {
      const col = b.monthProjected > b.monthly * 1.1 ? '#ef4444' : b.monthProjected > b.monthly ? '#ffb300' : '#22c55e';
      return `<div class="aim-fc-row"><span>Projection fin de mois</span><b style="color:${col}">${b.monthProjected} <span style="color:#6b7280">/ ${b.monthly} · ${b.daysLeftMonth || '-'} j restants</span></b></div>`;
    })() : '';
    // Efficacité du cache à la demande + requêtes économisées (coalescing / cooldown de panne)
    const cacheRows = d.cache ? (() => {
      const c = d.cache, pc = o => { const t = (o && ((o.hit || 0) + (o.miss || 0))) || 0; return t ? Math.round((o.hit || 0) / t * 100) + '%' : '-'; };
      return `<div class="aim-fc-row"><span>Cache à la demande (hit)</span><b>info ${pc(c.info)} · analyse ${pc(c.analyse)} · réaction ${pc(c.react)}</b></div>`
        + `<div class="aim-fc-row"><span>Requêtes économisées</span><b>${(c.coalesced || 0)} coalescées · ${(c.coolskip || 0)} évitées (panne)</b></div>`
        + (c.usersIdle ? `<div class="aim-fc-row"><span>Activité</span><b style="color:#ffb300">personne connecté : fond au ralenti</b></div>` : '');
    })() : '';
    /* TÂCHES DE FOND (traduction du fil, pré-traduction des descriptions, impact marché) :
       généré / tenté / plafond du jour. Exigé par la règle du desk (toute évolution de plafond IA
       doit être VISIBLE ici).
       ⚠️ CE BLOC LISAIT `d.providers.propos`, UN CHAMP QUI N'EXISTE NULLE PART (11/09, capture
       client répétée : « pourquoi c'est en anglais ? »). Le vrai champ est `proposFr`
       (_proposFrStats, server.js) : la faute d'un caractère faisait taire ce contrôle DEPUIS SA
       POSE — la garde `if (!s …) return ''` avalait un `undefined` sans un mot, alors que ce bloc
       existe précisément pour qu'une tâche de fond qui compte reste VISIBLE. Impossible, depuis ce
       panneau, de distinguer une traduction qui n'a simplement pas encore tourné (0 tentative)
       d'une traduction qui ÉCHOUE à chaque tentative (chaîne IA dégradée) : les deux rendent le
       même fil en anglais côté client, et seul ce chiffre les distingue. Les deux tâches voisines
       (pré-traduction des descriptions, Impact marché) portaient le même défaut de fond — jamais
       affichées nulle part — et reçoivent la même correction, même forme.
       ⚠️ DEUX PIÈGES D'AFFICHAGE ÉVITÉS ICI, tous deux mesurés :
       1. UNE TÂCHE ÉTEINTE NE DOIT PAS S'AFFICHER EN VERT. `..._MAX_JOUR=0` est le mécanisme de
          coupure sans redéploiement ; une garde en `plafond == null` ne filtre pas 0, et un calcul
          de couleur en `cap && …` retombe sur le vert. L'administrateur aurait lu « 0 / 0 » en vert,
          c'est-à-dire une fonctionnalité arrêtée présentée comme saine. On l'annonce en gris.
       2. LA COULEUR SUIT LES TENTATIVES, PAS LES SUCCÈS. Côté serveur c'est le nombre de TENTATIVES
          qui est plafonné (un refus coûte un appel réel) : colorer sur les succès afficherait du
          vert alors que le budget du jour est déjà consommé. Les deux chiffres restent lisibles. */
    const fondRows = (() => {
      const ligne = (nom, s, champFait) => {
        if (!s || s.plafond == null) return '';
        const cap = s.plafond | 0, faits = s[champFait] || 0, essais = s.tentes ?? s.tentees ?? 0;
        const corps = cap <= 0
          ? `<b style="color:#6b7280">désactivée (plafond 0)</b>`
          : `<b style="color:${essais >= cap ? '#ef4444' : (essais >= cap * 0.8 ? '#ffb300' : '#22c55e')}">${faits}<span style="color:#6b7280"> faites · ${essais} / ${cap} tentées</span></b>`;
        return `<div class="aim-fc-row"><span>${nom}</span>${corps}</div>`;
      };
      const p = d.providers || {};
      const corps = ligne('Traduction du fil (titres)', p.proposFr, 'traduits')
        + ligne('Pré-traduction des descriptions', p.descFr, 'traduites')
        + ligne('Impact marché (stats tier-1)', p.impacts, 'generes');
      return corps ? `<div class="aim-sec-title">Tâches de fond (jour)</div>` + corps : '';
    })();
    document.getElementById('aim-forecast').innerHTML =
      `<div class="aim-fc-row"><span>Quota restant</span><b>${b.remaining}</b></div>`
      + `<div class="aim-fc-row"><span>Épuisement estimé</span><b>${b.hoursToExhaust != null ? ('~' + b.hoursToExhaust + ' h') : '-'}</b></div>`
      + projRow
      + `<div class="aim-fc-row"><span>Préchauffage de fond</span><b>${b.prewarmActive === false ? (b.quietHours ? 'PAUSE (nuit)' : (b.prePeak === false ? 'PAUSE (creux)' : 'PAUSE (budget)')) : b.prewarmActive ? 'actif' : '-'}</b></div>`
      + `<div class="aim-fc-row"><span>Pré-pic appris</span><b>${b.prePeak === true ? 'OUI (on prépare)' : b.prePeak === false ? 'non (creux)' : 'apprentissage (' + (b.learnedSlots || 0) + '/24)'}</b></div>`
      + cacheRows
      + fondRows
      + `<div class="aim-sec-title">Demande attendue (apprise)</div>` + nh
      /* ══ PLAFOND PAR REQUÊTE, APPRIS (16/09) ═════════════════════════════════
         Le Récap Quotidien est resté des jours en anglais parce que son appel dépassait ce que la
         chaîne gratuite accepte PAR REQUÊTE. Le desk l'apprend maintenant sur ses propres refus,
         comme il apprend la demande horaire juste au-dessus. Et il l'AFFICHE, pour la même raison
         qu'on affiche la demande apprise : un apprentissage qu'on ne montre pas ne se vérifie
         jamais, et on découvre qu'il a dérapé par un rapport en anglais. */
      + (() => {
        const P = d.plafonds; if (!P) return '';
        const par = P.parFournisseur || {};
        const noms = Object.keys(par).filter(k => par[k] && (par[k].plafond || par[k].okMax));
        const tete = `<div class="aim-sec-title">Plafond par requ\u00eate (appris)</div>`;
        if (!noms.length) return tete + `<div class="aim-kpi-s" style="color:#6b7280;line-height:1.5">Aucun refus de taille rencontr\u00e9 : le desk n'a encore rien \u00e0 \u00e9viter, et tente donc tout. Un plafond n'appara\u00eet ici qu'apr\u00e8s un vrai refus.</div>`;
        const j = n => Number(n).toLocaleString('fr-FR');
        const lignes = noms.sort().map(k => {
          const e = par[k];
          const val = e.plafond ? j(e.plafond) + ' jetons' : '\u2265 ' + j(e.okMax);
          const col = e.plafond ? '#ffb300' : '#22c55e';
          const det = e.plafond ? `refus\u00e9 \u00e0 ${j(e.koMin)}` : `accept\u00e9 jusqu'\u00e0 ${j(e.okMax)}`;
          return `<div class="aim-fc-row"><span>${_esc2(k)} <span style="color:#6b7280">${_esc2(det)}</span></span><b style="color:${col}">${val}</b></div>`;
        }).join('');
        const sur = P.budgetSur;
        const pied = `<div class="aim-kpi-s" style="margin-top:4px;color:#6b7280;line-height:1.5">`
          + (sur == null
            ? `Au moins un fournisseur n'a pas encore \u00e9t\u00e9 \u00e9prouv\u00e9 : rien n'est interdit, on tente (c'est ainsi qu'on apprend).`
            : `La cha\u00eene encaisse ${j(sur)} jetons par appel. Au-del\u00e0, le desk n'envoie plus la requ\u00eate : il produit directement une version courte plut\u00f4t qu'une salve d'allers-retours perdants.`)
          + `</div>`;
        return tete + lignes + pied;
      })();
  }
  function aimRenderInfra(d) {
    /* ══ POURQUOI UN RAPPORT QUOTIDIEN EST PROVISOIRE (16/09) ════════════════════════
       Le repli déterministe recycle les dépêches BRUTES, donc anglaises : un client ouvre le
       Récap Quotidien et lit de l'anglais. C'était signalé au lecteur depuis le 11/09 et
       diagnosticable par personne. La cause vit désormais ici, avec l'heure et la taille du
       prompt envoyé : une réponse tronquée face à un prompt de 40 000 caractères ne se lit pas
       comme un fournisseur en panne, et les deux se corrigent à des endroits différents. */
    const _rp = document.getElementById('aim-rapports');
    if (_rp) _rp.innerHTML = (() => {
      const R = d.rapports;
      if (!R || R.erreur) return '<div class="aim-j-empty">indisponible' + (R && R.erreur ? ' : ' + _esc2(R.erreur) : '') + '</div>';
      const ligne = (r) => {
        if (!r) return '';
        if (!r.present) return `<div class="aim-kv"><span>${_esc2(r.nom || '')}</span><b style="color:#6b7280">pas encore g\u00e9n\u00e9r\u00e9 (${_esc2(r.jour || '')})</b></div>`;
        /* TROIS ÉTATS, PAS DEUX. Une version courte est rédigée et française : la peindre en rouge
           la déprécierait, la peindre en vert cacherait que la passe complète est en panne. */
        const col = r.court ? '#e3b23a' : r.ia ? '#22c55e' : '#ffb300';
        const etat = r.court ? 'VERSION COURTE' : r.ia ? 'r\u00e9dig\u00e9 ✓' : 'PROVISOIRE';
        let h = `<div class="aim-kv"><span>${_esc2(r.nom || '')} <span style="color:#6b7280">${_esc2(r.jour || '')}</span></span><b style="color:${col}">${etat}</b></div>`;
        if (!r.ia || r.court) {
          h += `<div class="aim-kpi-s" style="margin:-2px 0 8px;color:#c8ccd4;line-height:1.45">${_esc2(String(r.raison || '').slice(0, 220))}</div>`;
          const bas = [];
          if (r.raisonTs) bas.push(new Date(r.raisonTs).toLocaleString('fr-FR'));
          if (r.promptLen) bas.push('prompt ' + r.promptLen.toLocaleString('fr-FR') + ' caract\u00e8res');
          if (bas.length) h += `<div class="aim-kpi-s" style="margin:-6px 0 8px;color:#6b7280">${_esc2(bas.join(' \u00b7 '))}</div>`;
        }
        return h;
      };
      return ligne(R.fxRecap) + ligne(R.dtpDaily)
        + '<div class="aim-kpi-s" style="margin-top:6px;color:#6b7280">Un rapport provisoire se rejoue tout seul toutes les 15 minutes jusqu\u2019\u00e0 obtenir sa version fran\u00e7aise.</div>';
    })();
    document.getElementById('aim-mail').innerHTML = (() => {
      const M = d.mail; if (!M) return '<div class="aim-j-empty">indisponible</div>';
      const ovhOk = !!(M.ovh && M.ovh.configured);
      return `<div class="aim-kv"><span>Canal principal</span><b style="color:${ovhOk ? '#22c55e' : '#ef4444'}">${ovhOk ? 'OVH SMTP ✓' : 'non configuré'}</b></div>`
        + `<div class="aim-kv"><span>Dernier canal</span><b>${M.lastProvider || '-'}</b></div>`
        + `<div class="aim-kv"><span>Envoyés / échecs</span><b>${(M.sent || 0)} / ${(M.failed || 0)}</b></div>`
        + (M.gmailApi && M.gmailApi.configured && M.gmailApi.verified === false ? `<div class="aim-kv"><span>Gmail API (secours)</span><b style="color:#ffb300">token expiré</b></div>` : '')
        + (M.lastError ? `<div class="aim-kv"><span>Dernière erreur</span><b style="color:#ef4444">${_esc2(String(M.lastError).slice(0, 52))}</b></div>` : '');
    })();
    document.getElementById('aim-egress').innerHTML = (() => {
      const E = d.egress; if (!E) return '<div class="aim-j-empty">indisponible</div>';
      const mb = n => (Number(n || 0) / 1048576).toFixed(1) + ' Mo';
      const pct = Math.min(100, Math.round((E.bytes24h || 0) / Math.max(1, E.cap24h || 1) * 100));
      const col = E.tripped ? '#ef4444' : (pct >= 70 ? '#ffb300' : '#22c55e');
      return `<div class="aim-kv"><span>État</span><b style="color:${col}">${E.tripped ? ('COUPURE ACTIVE ' + _esc2(E.info || '')) : 'OK ✓'}</b></div>`
        + `<div class="aim-kv"><span>Lu sur 1 h</span><b>${mb(E.bytes1h)} <span style="color:#6b7280">/ ${mb(E.cap1h)}</span></b></div>`
        + `<div class="aim-kv"><span>Lu sur 24 h</span><b>${mb(E.bytes24h)} <span style="color:#6b7280">/ ${mb(E.cap24h)}</span></b></div>`
        + `<div class="aim-track" style="margin-top:9px"><i style="width:${pct}%;background:${col}"></i></div>`
        + `<div class="aim-kpi-s" style="margin-top:5px">${pct}% du plafond 24 h</div>`;
    })();
    /* 17/09, demande user : « vérifie que tout est à jour et le badge est toujours présent... met
       dans le panel admin que je puisse surveiller aussi ». Même horloge que l'alerte mail
       (`_rpVerifierFraicheur` dans server.js, seuil 20 min), montrée SANS attendre le seuil. */
    const _taux = document.getElementById('aim-taux');
    if (_taux) _taux.innerHTML = (() => {
      const T = d.taux; if (!T) return '<div class="aim-j-empty">indisponible</div>';
      if (!T.at) return '<div class="aim-j-empty">aucun cycle réussi depuis le démarrage</div>';
      const ageMin = Math.round(T.ageMs / 60000);
      const perime = !!T.perime;
      const col = perime ? '#ef4444' : (T.ageMs > T.fraisSeuilMs * 0.5 ? '#ffb300' : '#22c55e');
      const ageTxt = ageMin < 1 ? '<1 min' : ageMin < 60 ? ageMin + ' min' : Math.round(ageMin / 60) + ' h';
      let h = `<div class="aim-kv"><span>Dernier cycle réussi</span><b style="color:${col}">${perime ? 'FIGÉ ' : ''}il y a ${ageTxt}</b></div>`
        + `<div class="aim-kv"><span>Banques en cache</span><b>${T.banques || 0}/8</b></div>`
        + `<div class="aim-kv"><span>Alerte e-mail</span><b style="color:${T.alerteEnvoyee ? '#ffb300' : '#6b7280'}">${T.alerteEnvoyee ? 'ENVOYÉE (panne en cours)' : 'aucune en cours'}</b></div>`;
      const pannes = Object.entries(T.pannes || {});
      if (pannes.length) h += `<div class="aim-kpi-s" style="margin-top:4px;color:#8b93a1;line-height:1.5">${pannes.map(([s, r]) => `${_esc2(s)} : ${_esc2(String(r).slice(0, 70))}`).join('<br>')}</div>`;
      const relais = Object.entries(T.relais || {});   // 23/09 : servies par le lecteur r.jina.ai (accès direct refusé)
      if (relais.length) h += `<div class="aim-kpi-s" style="margin-top:4px;color:#b8a36a;line-height:1.5">${relais.map(([s, r]) => `${_esc2(s)} : via ${_esc2(String((r && r.via) || 'relais'))} (direct : ${_esc2(String((r && r.direct) || '?').slice(0, 40))})`).join('<br>')}</div>`;
      // RBA : pricing de marché servi par les futures ASX (comme la Fed par les futures CME). 23/09.
      const RW = T.rbaWatch;
      if (RW) h += `<div class="aim-kv"><span>RBA · futures ASX</span><b style="color:#22c55e">hausse ${Math.round(RW.hike)}% · taux ${Number(RW.impliedRate).toFixed(2)}%</b></div>`;
      // Firecrawl : passerelle de dernier recours pour l'ASX (clé dans le .env du VPS), budgétée. 23/09.
      const FC = T.firecrawl;
      if (FC) {
        const _fcAge = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? '<1 min' : m < 60 ? m + ' min' : Math.round(m / 60) + ' h'; };
        const fcCol = !FC.pose ? '#6b7280' : (FC.err ? '#ffb300' : '#22c55e');
        const fcTxt = !FC.pose ? 'clé absente (.env du VPS)'
          : `${FC.n}/${FC.capJour} appel(s) aujourd’hui${FC.okAt ? ' · dernier OK il y a ' + _fcAge(FC.okAt) : ''}${FC.err ? ' · ' + _esc2(String(FC.err).slice(0, 40)) : ''}`;
        h += `<div class="aim-kv"><span>Firecrawl (recours ASX)</span><b style="color:${fcCol}">${fcTxt}</b></div>`;
      }
      // Courbe souveraine : lecture de marché en direct pour les banques sans futures (CAD, EUR…). 23/09.
      const SV = T.sov && Object.entries(T.sov);
      if (SV && SV.length) h += `<div class="aim-kpi-s" style="margin-top:4px;color:#8bb0c8;line-height:1.5">Courbe souveraine (marché) : ${SV.map(([c, s]) => `${_esc2(c)} ${Number(s.spread) >= 0 ? '+' : ''}${Number(s.spread).toFixed(2)} pt vs taux → ${_esc2(s.bias === 'hike' ? 'hausse' : s.bias === 'cut' ? 'baisse' : 'statu quo')}`).join(' · ')}</div>`;
      /* Biais IA (rates:aibias) : cycle HEBDO, pas 90 s — trouvé figé 14 jours le 17/09 sans que rien
         ne le dise (le cycle du samedi 02h réussissait pour ses 3 voisins, pas pour celui-ci). */
      if (T.biaisAt) {
        const bAgeMin = Math.round(T.biaisAgeMs / 60000);
        const bCol = T.biaisPerime ? '#ef4444' : '#22c55e';
        const bAgeTxt = bAgeMin < 60 ? bAgeMin + ' min' : bAgeMin < 1440 ? Math.round(bAgeMin / 60) + ' h' : Math.round(bAgeMin / 1440) + ' j';
        h += `<div class="aim-kv" style="margin-top:6px;border-top:1px dashed #26262b;padding-top:6px"><span>Biais IA (hebdo)</span><b style="color:${bCol}">${T.biaisPerime ? 'FIGÉ ' : ''}il y a ${bAgeTxt}</b></div>`;
      } else {
        h += `<div class="aim-kv" style="margin-top:6px;border-top:1px dashed #26262b;padding-top:6px"><span>Biais IA (hebdo)</span><b style="color:#6b7280">aucun cycle réussi depuis le démarrage</b></div>`;
      }
      return h;
    })();
    const _sv = document.getElementById('aim-sauvegarde');
    if (_sv) _sv.innerHTML = (() => {
      const S = d.sauvegarde; if (!S) return '<div class="aim-j-empty">indisponible</div>';
      if (!S.at) return '<div class="aim-j-empty">aucune sauvegarde enregistrée depuis la pose du minuteur</div>';
      const ageH = Math.round((Date.now() - S.at) / 3600000);
      // > 26h = le minuteur quotidien (04h10) a raté au moins un passage.
      const col = S.ok === false ? '#ef4444' : ageH > 26 ? '#ffb300' : '#22c55e';
      const etat = S.ok === false ? 'ÉCHEC' : ageH > 26 ? `RETARD (${ageH} h)` : 'OK ✓';
      let h = `<div class="aim-kv"><span>Dernier passage</span><b style="color:${col}">${etat} <span style="color:#6b7280;font-weight:400">${new Date(S.at).toLocaleString('fr-FR')}</span></b></div>`;
      if (S.ok !== false) {
        h += `<div class="aim-kv"><span>Taille</span><b>${_esc2(S.taille || '—')}</b></div>`
          + `<div class="aim-kv"><span>Copie hors-site</span><b style="color:${S.horsSite ? '#22c55e' : '#ffb300'}">${S.horsSite ? 'envoyée ✓' : 'non confirmée'}</b></div>`;
      } else if (S.raison) {
        h += `<div class="aim-kpi-s" style="margin:-2px 0 4px;color:#ef4444">${_esc2(String(S.raison).slice(0, 200))}</div>`;
      }
      return h;
    })();
    document.getElementById('aim-db').innerHTML = (() => {
      const DB = d.db; if (!DB || !DB.nodes || !DB.nodes.length) return '<div class="aim-j-empty">sondes en cours…</div>';
      const col = s => s === 'ok' ? '#22c55e' : s === 'restreint' ? '#ef4444' : '#ffb300';
      const lbl = s => s === 'ok' ? 'OK ✓' : s === 'restreint' ? 'RESTREINT' : 'erreur';
      /* UNE BASE PEUT RÉPONDRE « OK » ET N ÊTRE POURTANT PAS PRÊTE À SERVIR (02/09). Après une
         absence, elle a raté des écritures : elle reste écartée des LECTURES de `users` jusqu à ce
         que la convergence l ait resynchronisée (cf. la quarantaine de lecture dans auth.js). La
         sonde, elle, ne teste que la joignabilité — elle dirait « OK ✓ » pendant ce temps, et on
         croirait l incident clos alors que le rattrapage court encore. On l affiche donc. */
      /* ⚠️ « RESYNCHRO… » SANS CAUSE EST UNE IMPASSE (16/09). Trois bases sont restées bloquées
         dans cet état, joignables, sous une étiquette qui promet une levée en moins de 20 minutes.
         L'échec d'écriture qui les y maintenait était avalé sans trace : la convergence le rejouait
         toutes les 20 minutes et personne ne pouvait savoir pourquoi. La cause s'affiche donc sous
         la ligne, en clair. Un état dégradé muet se diagnostique par hypothèses, et on y passe des
         jours — le rapport provisoire de ce matin l'a coûté deux fois. */
      /* DEPUIS QUAND (17/09) : « RESYNCHRO… » sans durée ne dit pas si le rattrapage vient de
         commencer ou s'il traîne. L'alerte mail à 1h (auth.js) porte déjà cette horloge ; le panel
         doit pouvoir la montrer SANS attendre le seuil d'alerte. */
      const age = ms => { const m = Math.round(ms / 60000); return m < 1 ? '<1 min' : m < 60 ? m + ' min' : Math.round(m / 60) + ' h'; };
      const rows = DB.nodes.map(n => `<div class="aim-kv"><span title="${_esc2(n.host)}">${_esc2(n.name)}</span><b style="color:${n.quarLect ? '#ffb300' : col(n.state)}">${n.quarLect ? (n.quarDemarrage ? 'DÉMARRAGE…' : 'RESYNCHRO…') : lbl(n.state)} <span style="color:#6b7280;font-weight:400">${n.quarLect && n.quarSince ? 'depuis ' + age(Date.now() - n.quarSince) + ' · ' : ''}${n.ms} ms</span></b></div>`
        + (n.quarLect && n.quarRaison ? `<div class="aim-kpi-s" style="margin:-3px 0 7px;color:#ffb300;line-height:1.45">↳ ${_esc2(String(n.quarRaison).slice(0, 150))}</div>` : '')).join('');
      const KA = DB.keepalive;   // anti-pause free-tier : WRITE sur chaque base /12 h (ingress → marche même en 402)
      const kaLine = (KA && KA.last) ? `<div class="aim-kv"><span>Keep-alive</span><b style="color:${KA.ok >= DB.count ? '#22c55e' : '#ffb300'}">${KA.ok}/${DB.count} <span style="color:#6b7280;font-weight:400">il y a ${(() => { const m = Math.round((Date.now() - KA.last) / 60000); return m < 1 ? '<1 min' : m < 60 ? m + ' min' : Math.round(m / 60) + ' h'; })()}</span></b></div>` : '';
      /* SYNCHRO WHOP — elle tournait toutes les 10 min sans qu'aucun écran ne la montre (03/09).
         On lit l'état de la DERNIÈRE réconciliation : combien d'adhésions valides ont été
         comparées au panneau, combien ont été prolongées, combien de comptes manquants créés.
         ⚠️ CETTE TÂCHE N'ALLONGE JAMAIS QUE VERS LE HAUT : elle ne coupe pas un payeur sur un
         doute. Un abonnement réglé par VIREMENT n'a donc aucune source externe pour le réparer —
         c'est la différence qui explique qu'un compte Whop se soit rétabli tout seul quand un
         compte payé par virement, lui, est resté cassé. On l'écrit sous le compteur. */
      const W = d.whop;
      const wLine = W ? (() => {
        const age = W.ts ? (() => { const m = Math.round((Date.now() - W.ts) / 60000); return m < 1 ? '<1 min' : m < 60 ? m + ' min' : Math.round(m / 60) + ' h'; })() : '—';
        const coul = W.error ? '#ef4444' : '#22c55e';
        const det = W.error ? _esc2(String(W.error).slice(0, 60)) : `${W.checked} vérifié(s)${W.fixed ? ' · ' + W.fixed + ' prolongé(s)' : ''}${W.created ? ' · ' + W.created + ' créé(s)' : ''}`;
        return `<div class="aim-kv"><span>Synchro Whop</span><b style="color:${coul}">${det} <span style="color:#6b7280;font-weight:400">il y a ${age}</span></b></div>`;
      })() : '<div class="aim-kv"><span>Synchro Whop</span><b style="color:#6b7280">pas encore passée</b></div>';
      return `<div class="aim-kv"><span>Projets joignables</span><b style="color:${DB.okCount >= DB.count ? '#22c55e' : '#ffb300'}">${DB.okCount}/${DB.count}</b></div>` + rows + kaLine + wLine
        + (DB.nodes.some(n => n.state === 'restreint') ? '<div style="font-size:10.5px;color:#ef4444;margin-top:6px;line-height:1.5">⚠ Restreint = quota/égress mensuel dépassé → revient au rollover (le keep-alive ne lève pas un 402).</div>' : '')
        + (() => {
          /* ⚠️ DEUX SITUATIONS, DEUX PHRASES (16/09, retour user « pourquoi tout est en resynchro ?
             alors que bdd 2 était ok »). Pousser sur main déploie, un déploiement redémarre le
             conteneur, et un processus neuf ne peut pas savoir ce qu'une base a manqué pendant
             qu'il n'existait pas : les quatre repartent quarantainées, par prudence. Les annoncer
             comme ayant « raté des écritures pendant leur absence » était FAUX, et alarmant pour
             rien — à chaque livraison. Un message qui se trompe de cause use la confiance qu'on
             met dans tous les autres. */
          const dem = DB.nodes.filter(n => n.quarLect && n.quarDemarrage).length;
          const res = DB.nodes.filter(n => n.quarLect && !n.quarDemarrage).length;
          let t = '';
          if (dem) t += '⏳ Démarrage = le desk vient de redémarrer, et toute livraison le redémarre. Un processus neuf ne peut pas savoir ce qu’une base a manqué pendant qu’il n’existait pas : elles repartent donc toutes prudemment en quarantaine de lecture, le temps de la première convergence. Aucune n’a rien raté. Levée automatique (~30 s).';
          if (res) t += (t ? '<br>' : '') + '⏳ Resynchro = la base est joignable mais a raté des écritures pendant son absence. Elle reçoit les écritures et se recomplète, mais ne sert AUCUNE lecture de comptes tant que le rattrapage n’a pas réussi : sans ça, elle rendrait des mots de passe et des échéances périmés. Levée automatique (≤ 20 min).';
          return t ? '<div style="font-size:10.5px;color:#ffb300;margin-top:6px;line-height:1.5">' + t + '</div>' : '';
        })()
        + `<div class="aim-recup" style="margin-top:10px;padding-top:9px;border-top:1px solid #1c1c20">
             <div class="aim-kpi-s" style="color:#8b93a1;margin-bottom:6px;line-height:1.45">Récupération : voir ce que <b>chaque</b> base détient pour un compte, et les réaligner. La lecture normale sert la version la plus RÉCENTE, ce qui peut masquer une version plus COMPLÈTE sur une autre base.</div>
             <div style="display:flex;gap:6px;align-items:center">
               <input id="recup-uid" type="text" placeholder="identifiant du compte (ex. 1)" spellcheck="false"
                 style="flex:1;min-width:0;background:#0c0c0e;border:1px solid #26262b;border-radius:4px;color:#e6e6e6;font-size:12px;padding:5px 8px">
               <button type="button" id="recup-go"
                 style="background:transparent;border:1px solid #3a3f4b;border-radius:4px;color:#e3b23a;font-size:12px;padding:5px 12px;cursor:pointer">Constater</button>
             </div>
             <div id="recup-out" style="margin-top:7px"></div>
             <div class="aim-kpi-s" style="color:#8b93a1;margin:12px 0 6px;line-height:1.45;border-top:1px solid #1c1c20;padding-top:9px">Diagnostic d'un compte (login impossible même après reset) : voir base par base si l'enregistrement, le mot de passe et l'identité sont cohérents. <b>Lecture seule</b> — rien n'est modifié.</div>
             <div style="display:flex;gap:6px;align-items:center">
               <input id="udiag-email" type="text" placeholder="e-mail du compte bloqué" spellcheck="false"
                 style="flex:1;min-width:0;background:#0c0c0e;border:1px solid #26262b;border-radius:4px;color:#e6e6e6;font-size:12px;padding:5px 8px">
               <button type="button" id="udiag-go"
                 style="background:transparent;border:1px solid #3a3f4b;border-radius:4px;color:#e3b23a;font-size:12px;padding:5px 12px;cursor:pointer">Diagnostiquer</button>
             </div>
             <div id="udiag-out" style="margin-top:7px"></div>
           </div>`;;
    })();
  }
  /* ══ LA MACHINE, SON DISQUE, ET LE SCHÉMA QUI LES RELIE (11/09, demande user) ═════════════════
     « Dans le panel admin je dois voir les performances du serveur ainsi que le stockage du disque
     dur et aussi un schéma d'architecture de l'infrastructure du DTP si possible dynamique. »
     Rien de tout cela n'était à mesurer : le serveur surveille son disque toutes les 5 minutes
     depuis le 07/09 et sa mémoire toutes les 30 secondes depuis bien plus longtemps. Ce qui
     manquait, c'était un ÉCRAN. Un garde-fou que personne ne regarde ne prévient personne, et ce
     dépôt en a déjà payé le prix : le keep-alive est resté vert deux mois et demi en ne pinguant
     rien, la sauvegarde nocturne n'avait jamais produit une archive.
     ⚠️ TOUT VIENT DE LA MÊME CHARGE QUE LES CARTES VOISINES. Un second appel serait un second
     endroit à tenir à jour, et surtout deux instantanés pris à des moments différents : le schéma
     pourrait peindre une base en vert pendant que la carte juste au-dessus la dit en panne. Un
     schéma en désaccord avec les chiffres qu'il accompagne est pire qu'aucun schéma. */
  const _AIM_COUL = { 0: '#22c55e', 1: '#22c55e', 2: '#ffb300', 3: '#ef4444', 4: '#ef4444', 5: '#ef4444' };
  function _aimDuree(s) {
    s = Math.max(0, Math.round(s || 0));
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.round(s / 60) + ' min';
    if (s < 86400) return Math.round(s / 3600) + ' h';
    return Math.round(s / 86400) + ' j';
  }
  function aimRenderSysteme(d) {
    const el = document.getElementById('aim-systeme'); if (!el) return;
    const S = d.systeme;
    if (!S) { el.innerHTML = '<div class="aim-j-empty">indisponible</div>'; return; }
    const c = _AIM_COUL[S.niveau] || '#22c55e';
    /* ⚠️ LA MÉMOIRE SE JUGE CONTRE LE SEUIL D'ACTION, PAS CONTRE LA LIMITE DU CONTENEUR. C'est à
       ce seuil que le serveur ferme les navigateurs pour éviter l'arrêt brutal : une barre remplie
       à 60% de la limite ne dit rien, une barre remplie à 90% du seuil dit qu'il va se passer
       quelque chose. On montre donc les deux repères, et on remplit contre le seuil. */
    const pctSeuil = Math.min(100, Math.round(S.rssMo / Math.max(1, S.seuilMo) * 100));
    /* ⚠️ ET LE RETARD DE LA BOUCLE EST LA MESURE QUI DIT « LE DESK RAME ». Node est mono-fil : une
       charge processeur ne se voit pas dans la mémoire, elle se voit dans le temps que met un
       minuteur à se déclencher. 200 ms de retard, c'est 200 ms de plus sur chaque requête. */
    const cR = S.retardMs >= 400 ? '#ef4444' : S.retardMs >= 100 ? '#ffb300' : '#22c55e';
    return void (el.innerHTML =
      '<div class="aim-kv"><span>Mémoire du desk</span><b style="color:' + c + '">' + S.rssMo + ' Mo <span style="color:#6b7280;font-weight:400">/ ' + S.seuilMo + ' Mo avant nettoyage</span></b></div>'
      + '<div class="aim-track" style="margin-top:7px"><i style="width:' + pctSeuil + '%;background:' + c + '"></i></div>'
      + '<div class="aim-kpi-s" style="margin-top:5px">' + pctSeuil + '% du seuil · ' + S.memPct + '% des ' + S.limiteMo + ' Mo alloués au conteneur</div>'
      + '<div class="aim-kv" style="margin-top:9px"><span title="Node est mono-fil : ce retard est le temps que chaque requête attend en plus.">Retard de traitement</span><b style="color:' + cR + '">' + S.retardMs + ' ms</b></div>'
      + (S.charge1 == null ? '' : '<div class="aim-kv"><span title="Charge de l\'HÔTE, voisins compris : elle dit si la machine est chargée, quand le retard ci-dessus dit si c\'est NOUS qui la chargeons.">Charge système</span><b>' + S.charge1 + ' <span style="color:#6b7280;font-weight:400">sur ' + S.coeurs + ' cœur(s)' + (S.chargeParCoeur == null ? '' : ' · ' + Math.round(S.chargeParCoeur * 100) + '%') + '</span></b></div>')
      + '<div class="aim-kv"><span>Tas JavaScript</span><b>' + S.heapMo + ' <span style="color:#6b7280;font-weight:400">/ ' + S.heapTotalMo + ' Mo</span></b></div>'
      + '<div class="aim-kv"><span>En ligne depuis</span><b>' + _aimDuree(S.uptimeS) + ' <span style="color:#6b7280;font-weight:400">' + _esc2(S.node || '') + '</span></b></div>');
  }
  function aimRenderDisque(d) {
    const el = document.getElementById('aim-disque'); if (!el) return;
    const D = d.disque;
    /* ⚠️ « PAS ENCORE MESURÉ » N'EST PAS « TOUT VA BIEN ». La première mesure du disque arrive
       30 s après le démarrage : afficher 0% en attendant peindrait un vert rassurant sur une
       absence d'information. On le dit. */
    /* ⚠️ LES BOUTONS RESTENT DISPONIBLES MÊME SANS MESURE, et le banc l'a exigé avant la
       production. Première écriture : on sortait ici quand l'état du disque était inconnu, donc
       sans les boutons. Or « je ne sais pas combien il reste » est PRÉCISÉMENT le moment où l'on
       veut pouvoir faire de la place : une mesure qui échoue n'est pas une raison de retirer les
       commandes, c'en est une de les garder sous la main. */
    if (!D || D.pct == null) {
      el.innerHTML = '<div class="aim-j-empty">première mesure en cours (30 s après le démarrage)…</div>' + _aimDisqueActions(D);
      _aimBrancherDisque();
      return;
    }
    const c = _AIM_COUL[D.niveau] || '#22c55e';
    const nom = D.nom || (D.niveau >= 2 ? 'à surveiller' : 'normal');
    /* La sentinelle est le watchdog SYSTÈME (minuteur toutes les 15 min), et c'est elle qui agit
       quand le desk lui-même ne répond plus. Son âge est donc une information de PREMIER plan :
       muette, on n'a plus de filet, et personne ne le saurait. */
    const sa = D.sentinelleAgeMin;
    const cS = sa == null ? '#6b7280' : sa > 45 ? '#ef4444' : sa > 25 ? '#ffb300' : '#22c55e';
    el.innerHTML =
      '<div class="aim-kv"><span>Occupation</span><b style="color:' + c + '">' + D.pct + '% <span style="color:#6b7280;font-weight:400">' + _esc2(String(nom)) + '</span></b></div>'
      + '<div class="aim-track" style="margin-top:7px"><i style="width:' + Math.min(100, D.pct) + '%;background:' + c + '"></i></div>'
      + '<div class="aim-kpi-s" style="margin-top:5px">' + D.libreGo + ' Go libres sur ' + D.totalGo + ' Go</div>'
      + (D.vitesseGoH ? '<div class="aim-kv" style="margin-top:9px"><span title="Une rafale qui projette la saturation à court terme fait monter le niveau quel que soit le pourcentage courant.">Vitesse</span><b>' + D.vitesseGoH + ' Go/h' + (D.tendance ? ' <span style="color:#6b7280;font-weight:400">' + _esc2(String(D.tendance)) + '</span>' : '') + '</b></div>' : '')
      + (D.jours != null ? '<div class="aim-kv"><span>Saturation prévue</span><b style="color:' + (D.jours <= 7 ? '#ffb300' : '#22c55e') + '">dans ' + D.jours + ' j</b></div>' : '')
      + '<div class="aim-kv"><span title="Minuteur systemd toutes les 15 min, AU NIVEAU DE L\'OS : c\'est lui qui agit quand le desk ne répond plus. Muet, il n\'y a plus de filet.">Sentinelle système</span><b style="color:' + cS + '">' + (sa == null ? 'jamais vue' : 'vue il y a ' + sa + ' min') + '</b></div>'
      + (D.frein ? '<div style="font-size:10.5px;color:#ef4444;margin-top:6px;line-height:1.5">⚠ Frein actif : les écritures régénérables (caches, aperçus) sont suspendues le temps que la sentinelle nettoie.</div>' : '')
      + (D.motif ? '<div style="font-size:10.5px;color:#ffb300;margin-top:6px;line-height:1.5">' + _esc2(String(D.motif)) + '</div>' : '')
      /* ── LIBÉRER LA PLACE (11/09, demande user) ──────────────────────────────────────────────
         ⚠️ CES BOUTONS NE PURGENT PAS DOCKER EUX-MÊMES, ET C'EST ÉCRIT SOUS EUX. Le desk tourne
         dans un conteneur SANS socket Docker (vérifié dans docker-compose.yml) : il ne peut pas
         toucher aux images, qui sont pourtant le gros de ce qui remplit ce disque. Il supprime ce
         qu'il possède — ses caches régénérables — et DEMANDE la purge à la sentinelle de l'hôte,
         qui passe tous les quarts d'heure. Annoncer « nettoyé » ici serait le faux vert sur le
         mécanisme même censé nous sauver : on annonce donc ce qui est fait ET ce qui est demandé.
         ⚠️ PAS DE `confirm()` : la charte du desk interdit les fenêtres natives. Le forçage
         demande une seconde frappe sur le même bouton, qui se réarme tout seul après 4 s. */
      + _aimDisqueActions(D);
    _aimBrancherDisque();
  }
  /* Un seul HTML pour les deux chemins (avec et sans mesure) : deux copies divergeraient au
     premier changement de libellé, et c'est celle qu'on regarde le moins qui se périmerait. */
  /* ══ CHAQUE BOUTON ANNONCE CE QU'IL REND (16/09, demande utilisateur : « raccourcis la description
     et précise le nombre d'espace qu'on peut nettoyer manuellement ») ══════════════════════
     Le pavé précédent faisait six lignes et se terminait par « le gain sera faible » : une phrase
     là où il faut un chiffre, et qui obligeait à cliquer pour savoir. Le détail des commandes
     n'apprenait rien à personne : ce qu'on veut savoir avant de cliquer, c'est COMBIEN.
     ⚠️ ET ON N'ÉCRIT PAS « 0 Go » QUAND ON N'A PAS REGARDÉ. Tant que la sentinelle n'a pas déposé
     son relevé, le chiffre de l'hôte est inconnu, pas nul : le bouton ne porte alors aucun montant
     et la ligne du dessous dit pourquoi. Annoncer zéro serait plus court, et faux. */
  function _aimDisqueActions(D) {
    const R = (D && D.recuperable) || null;
    const go = n => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    const chiffre = v => (v == null || v <= 0.05) ? '' : ' \u00b7 ~' + go(v) + ' Go';
    const age = (() => {
      if (!R || !R.releveTs) return '';
      const m = Math.round((Date.now() - R.releveTs) / 60000);
      return m < 1 ? 'mesur\u00e9 \u00e0 l\'instant' : 'mesur\u00e9 il y a ' + m + ' min';
    })();
    const pied = !R ? 'Mesure en cours.'
      : !R.complet ? 'Caches du desk uniquement : la sentinelle n\'a pas encore d\u00e9pos\u00e9 sa mesure du serveur, le total sera plus \u00e9lev\u00e9.'
      : (R.surGo != null && R.surGo <= 0.05 && R.forceGo != null && R.forceGo <= 0.05)
        ? 'Rien \u00e0 lib\u00e9rer pour l\'instant : le disque est d\u00e9j\u00e0 propre (' + age + ').'
        : 'Ce qui reste \u00e0 rendre, ' + age + '. Le d\u00e9tail s\'ex\u00e9cute sous 15 min.';
    return '<div class="aim-disk-act">'
      + '<button class="aim-btn" data-disk="sur">Lib\u00e9rer la place' + chiffre(R && R.surGo) + '</button>'
      + '<button class="aim-btn aim-btn--warn" data-disk="agressif">Forcer' + chiffre(R && R.forceGo) + '</button>'
      + '<span class="aim-disk-msg" id="aim-disk-msg"></span>'
      + '</div>'
      + '<div class="aim-kpi-s" style="margin-top:6px;line-height:1.5">Caches du desk, puis images et cache de construction c\u00f4t\u00e9 serveur. <b>Forcer</b> ajoute le ballast d\'1 Go et les PDF : premier rapport plus lent, retour arri\u00e8re \u00e0 reconstruire.'
      + '<br><span style="color:#6b7280">' + pied + '</span></div>';
  }

  /* Un seul branchement, délégué sur le conteneur : le bloc est réécrit à chaque rafraîchissement,
     donc un écouteur posé sur les boutons eux-mêmes disparaîtrait au passage suivant. */
  let _aimDiskArme = '';
  let _aimDiskT = null;
  function _aimBrancherDisque() {
    const host = document.getElementById('aim-disque');
    if (!host || host.dataset.branche) return;
    host.dataset.branche = '1';
    host.addEventListener('click', async (ev) => {
      const b = ev.target.closest && ev.target.closest('[data-disk]');
      if (!b) return;
      const mode = b.dataset.disk;
      const msg = document.getElementById('aim-disk-msg');
      const dire = (t, c) => { const m = document.getElementById('aim-disk-msg'); if (m) { m.textContent = t; m.style.color = c || '#8b93a1'; } };
      /* Le forçage supprime des choses qui coûtent à refabriquer : il demande une confirmation,
         sur le bouton lui-même, et elle se périme. Un état armé qui ne retombe pas finit par
         partir sur un clic distrait trois minutes plus tard. */
      if (mode === 'agressif' && _aimDiskArme !== 'agressif') {
        _aimDiskArme = 'agressif';
        /* ⚠️ LE LIBELLÉ D'ORIGINE EST MÉMORISÉ, PAS RÉÉCRIT EN DUR (16/09). Depuis que le bouton
           porte le nombre de gigaoctets récupérables, une remise à « Forcer » en dur EFFACERAIT ce
           chiffre — et seulement après un clic suivi de quatre secondes, donc dans un cas qu'aucune
           relecture ne croise. On range l'original sur l'élément et on le restaure. */
        b.dataset.libelle = b.dataset.libelle || b.textContent;
        b.textContent = 'Confirmer le forçage';
        clearTimeout(_aimDiskT);
        _aimDiskT = setTimeout(() => { _aimDiskArme = ''; const x = document.querySelector('[data-disk="agressif"]'); if (x) x.textContent = x.dataset.libelle || 'Forcer'; }, 4000);
        dire('Vide aussi le cache des PDF et les images hors rétention. Cliquez à nouveau pour confirmer.', '#ffb300');
        return;
      }
      _aimDiskArme = ''; clearTimeout(_aimDiskT);
      b.disabled = true; dire('Libération en cours…');
      try {
        const r = await fetch('/api/admin/disque/liberer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error((d && d.error) || ('HTTP ' + r.status));
        /* On rapporte ce qui a ÉTÉ fait et ce qui est ATTENDU, séparément. Mélanger les deux
           laisserait croire que la place est déjà rendue. */
        const fait = d.fichiers + ' fichier(s) · ' + d.moOctets + ' Mo'
          + (d.avant != null && d.apres != null ? ' · disque ' + d.avant + '% → ' + d.apres + '%' : '');
        const suite = d.demandeDeposee
          ? ' Purge des images demandée au serveur : effet sous ' + d.sentinelleDansMin + ' min.'
          : ' ⚠ La demande n\'a PAS pu être déposée (volume partagé injoignable) : les images ne seront pas purgées.';
        dire(fait + '.' + suite, d.demandeDeposee ? '#22c55e' : '#ffb300');
        /* Et on relit la mesure : le panneau doit montrer le nouvel état, pas celui d'avant. */
        setTimeout(() => { try { loadAIMon(); } catch (e) {} }, 800);
      } catch (e) {
        dire('Échec : ' + (e && e.message ? e.message : 'erreur inconnue'), '#ef4444');
      } finally {
        const x = document.querySelector('[data-disk="' + mode + '"]');
        if (x) { x.disabled = false; if (mode === 'agressif') x.textContent = x.dataset.libelle || 'Forcer'; }
      }
    });
  }
  /* ── LE SCHÉMA D'ARCHITECTURE, PEINT PAR L'ÉTAT RÉEL ────────────────────────────────────────
     Vanille et SVG en ligne, comme tout le desk : aucune bibliothèque de diagrammes.
     ⚠️ AUCUN BLOC N'EST PEINT « PAR DÉFAUT EN VERT ». Un état inconnu est GRIS, jamais vert : la
     maladie du faux vert commence toujours par une valeur manquante qu'on a traitée en succès.
     Chaque brique dit d'où vient sa couleur, et la légende en bas rappelle la règle. */
  /* ══ LE SCHÉMA D'ARCHITECTURE — ÉPURÉ, ET VIVANT (11/09, demande user) ═══════════════════════
     « Améliore l'architecture, le schéma, afin qu'il soit épuré, propre et dynamique en temps réel. »

     ⚠️ ON ABANDONNE LE SVG À COORDONNÉES CALCULÉES À LA MAIN. La première version plaçait neuf
     rectangles et six courbes à coups de `x`, `y` et de courbes de Bézier : chaque texte devait
     être positionné au pixel, rien ne se réajustait à la largeur, et ajouter une brique obligeait
     à recalculer la grille entière. Une grille CSS fait le même dessin, s'adapte toute seule et
     se lit dans le thème du panneau.
     ⚠️ ET LES COURBES POINTILLÉES SONT RETIRÉES, PAS REDESSINÉES. Elles reliaient chaque étage au
     suivant sans rien apprendre : l'ordre des étages dit déjà le sens de lecture. C'est le même
     arbitrage que le quadrillage du journal, tranché le 05/09 — les filets horizontaux suffisent à
     suivre une ligne, les verticaux ne font que fatiguer. Six traits de moins, zéro information
     perdue.
     ⚠️ « TEMPS RÉEL » SE DIT AVEC PRUDENCE, ET ON AFFICHE L'ÂGE DU RELEVÉ. Le panneau se recharge
     toutes les 30 s, mais le disque n'est mesuré côté serveur que toutes les 5 min : annoncer « en
     direct » sans dire de QUAND date la mesure serait exactement le faux vert qu'on traque. Le
     point pulse tant que le relevé est frais, et l'âge est écrit à côté. */
  const _AIM_ETAGES = [
    { cle: 'vps', titre: 'VPS 149.71.44.90 · Docker Compose' },
    { cle: 'flux', titre: 'Données et sorties' },
    { cle: 'auto', titre: 'Rattrapages automatiques' },
  ];
  function _aimBrique(b) {
    const c = b.coul || '#6b7280';
    return '<div class="aims-b" style="--aims-c:' + c + '"' + (b.aide ? ' title="' + _esc2(b.aide) + '"' : '') + '>'
      + '<div class="aims-b-h"><i class="aims-dot"' + (b.vivant ? ' data-vif="1"' : '') + '></i>'
      + '<span class="aims-b-t">' + _esc2(b.titre) + '</span></div>'
      + '<div class="aims-b-v">' + _esc2(b.valeur) + '</div>'
      + (b.detail ? '<div class="aims-b-d">' + _esc2(b.detail) + '</div>' : '')
      + '</div>';
  }
  function aimRenderSchema(d) {
    const el = document.getElementById('aim-infra'); if (!el) return;
    const S = d.systeme, D = d.disque, DB = d.db, M = d.mail, E = d.egress, W = d.whop;
    const GRIS = '#6b7280';
    /* ⚠️ AUCUNE BRIQUE N'EST VERTE PAR DÉFAUT : un état inconnu est GRIS. Le faux vert commence
       toujours par une valeur manquante traitée en succès. */
    const cSys = S ? (_AIM_COUL[S.niveau] || GRIS) : GRIS;
    const cDsk = (D && D.pct != null) ? (_AIM_COUL[D.niveau] || GRIS) : GRIS;
    const cDb = DB && DB.count ? (DB.okCount >= DB.count ? '#22c55e' : DB.okCount ? '#ffb300' : '#ef4444') : GRIS;
    const cMail = M ? (M.ok === false ? '#ef4444' : '#22c55e') : GRIS;
    const cEg = E ? (E.tripped ? '#ef4444' : '#22c55e') : GRIS;
    const cWhop = W ? (W.error ? '#ef4444' : '#22c55e') : GRIS;
    const sa = D ? D.sentinelleAgeMin : null;
    const cSent = sa == null ? GRIS : sa <= 25 ? '#22c55e' : sa <= 45 ? '#ffb300' : '#ef4444';
    const resync = DB && DB.nodes ? DB.nodes.filter(n => n.quarLect).length : 0;
    const ka = DB && DB.keepalive;
    const pctEg = E ? Math.min(100, Math.round((E.bytes24h || 0) / Math.max(1, E.cap24h || 1) * 100)) : null;

    const etages = {
      vps: [
        { titre: 'Conteneur desk', valeur: S ? S.rssMo + ' Mo' : 'inconnu', coul: cSys, vivant: !!S,
          detail: S ? S.retardMs + ' ms de retard · en ligne depuis ' + _aimDuree(S.uptimeS) : 'aucune mesure reçue',
          aide: 'Mémoire du processus et retard de la boucle d\'événements : Node étant mono-fil, ce retard est le temps que chaque requête attend en plus.' },
        { titre: 'Disque', valeur: (D && D.pct != null) ? D.pct + '%' : 'non mesuré', coul: cDsk, vivant: !!(D && D.pct != null),
          detail: (D && D.pct != null) ? D.libreGo + ' Go libres sur ' + D.totalGo + ' Go' : 'première mesure 30 s après le démarrage',
          aide: 'Un disque plein fait tronquer par nginx toute réponse de plus de 750 Ko, sans erreur HTTP : le desk arrive sans style ni script.' },
        { titre: 'Sentinelle (systemd)', valeur: sa == null ? 'jamais vue' : 'il y a ' + sa + ' min', coul: cSent, vivant: sa != null,
          detail: 'watchdog au niveau de l\'OS, toutes les 15 min',
          aide: 'Elle vit hors du conteneur : c\'est elle qui agit quand le desk lui-même ne répond plus. Muette, il n\'y a plus de filet.' },
      ],
      flux: [
        { titre: 'Bases Supabase', valeur: DB && DB.count ? DB.okCount + '/' + DB.count : 'inconnu', coul: cDb, vivant: !!(DB && DB.count),
          detail: DB && DB.count ? ('joignables' + (resync ? ' · ' + resync + ' en resynchro' : '')) : 'sondes en cours',
          aide: 'Quatre projets plus un miroir local. Une base revenue de pause ne sert aucune lecture de comptes tant qu\'elle n\'est pas resynchronisée.' },
        { titre: 'Egress Supabase', valeur: pctEg == null ? 'inconnu' : (E.tripped ? 'COUPÉ' : pctEg + '%'), coul: cEg, vivant: !!E,
          detail: pctEg == null ? 'aucune mesure' : 'du plafond sur 24 h',
          aide: 'Garde-fou anti-fuite : au-delà du plafond, les lectures sont coupées avant que le quota mensuel ne saute.' },
        { titre: 'Email (OVH)', valeur: M ? (M.sent || 0) + ' envoyés' : 'inconnu', coul: cMail, vivant: !!M,
          detail: M ? ((M.failed || 0) + ' échec(s) · ' + (M.lastProvider || 'canal inconnu')) : 'aucune mesure',
          aide: 'Canal principal OVH SMTP, avec repli. Les échecs se comptent sur la journée.' },
      ],
      auto: [
        { titre: 'Miroir et convergence', valeur: DB && DB.count ? 'actif' : 'inconnu', coul: DB && DB.count ? '#22c55e' : GRIS, vivant: !!(DB && DB.count),
          detail: 'superset local, repoussé vers les quatre bases',
          aide: 'Le miroir est le superset à jour. C\'est lui qui répare une base revenue en retard, jamais l\'inverse.' },
        { titre: 'Synchro Whop', valeur: W ? (W.error ? 'en erreur' : (W.checked || 0) + ' vérifiés') : 'jamais passée', coul: cWhop, vivant: !!W,
          detail: W ? (W.error ? String(W.error).slice(0, 48) : (W.fixed || 0) + ' prolongé(s) · ' + (W.created || 0) + ' créé(s)') : 'au boot puis toutes les 10 min',
          aide: 'Elle ne fait qu\'ALLONGER un abonnement en retard : on ne coupe pas un payeur sur un doute. Un abonnement réglé par virement n\'a donc aucune source externe pour se réparer.' },
        { titre: 'Keep-alive Supabase', valeur: (ka && ka.last) ? ka.ok + '/' + DB.count : 'jamais passé', coul: (ka && ka.last) ? (ka.ok >= DB.count ? '#22c55e' : '#ffb300') : GRIS, vivant: !!(ka && ka.last),
          detail: (ka && ka.last) ? ('dernier passage il y a ' + _aimDuree((Date.now() - ka.last) / 1000)) : 'anti-pause du palier gratuit',
          aide: 'Écriture sur chaque base toutes les 6 h : sans elle, un projet gratuit se met en pause au bout de quelques semaines.' },
      ],
    };

    el.innerHTML = _AIM_ETAGES.map(et =>
      '<div class="aims-et"><div class="aims-et-t">' + _esc2(et.titre) + '</div>'
      + '<div class="aims-g">' + etages[et.cle].map(_aimBrique).join('') + '</div></div>').join('')
      + '<div class="aims-note"><b style="color:#6b7280">Gris</b> = état inconnu, jamais « tout va bien » : une valeur manquante n\'est pas un succès. '
      + 'Chaque brique est peinte par la même mesure que les cartes de cet onglet, elle ne peut donc pas les contredire.</div>';

    /* L'ÂGE DU RELEVÉ, écrit et rafraîchi à la seconde : « en direct » sans date est une promesse
       qu'on ne peut pas vérifier. Le panneau recharge toutes les 30 s, le disque est mesuré côté
       serveur toutes les 5 min : les deux durées sont différentes et l'une ne remplace pas l'autre. */
    const t = document.getElementById('aim-infra-t');
    if (t) {
      const pris = d.now || Date.now();
      clearInterval(_aimSchemaT);
      const ecrire = () => {
        const s2 = Math.max(0, Math.round((Date.now() - pris) / 1000));
        t.innerHTML = '<i class="aims-live"></i>relevé ' + (s2 < 5 ? 'à l\'instant' : 'il y a ' + _aimDuree(s2));
      };
      ecrire();
      _aimSchemaT = setInterval(ecrire, 1000);
    }
  }
  /* ⚠️ UN SEUL MINUTEUR, ET IL EST REMPLACÉ À CHAQUE RENDU. Sans cette variable au niveau du
     module, chaque rafraîchissement (toutes les 30 s) en empilerait un de plus : au bout d'une
     heure le panneau tiendrait cent vingt minuteurs qui écrivent tous dans le même élément. */
  let _aimSchemaT = null;
  function aimRenderJournal(d) {
    const all = (d.alerts && d.alerts.log) || [];
    const J = all.filter(e => !_aimJFilter || e.level === _aimJFilter);
    const jc = document.getElementById('aim-j-count'); if (jc) jc.textContent = all.length ? (all.length + ' événement(s)') : '';
    const jEl = document.getElementById('aim-journal'); if (!jEl) return;
    jEl.innerHTML = J.length ? J.slice(0, 40).map(e => {
      const col = e.level === 'critical' ? '#ef4444' : e.level === 'warn' ? '#ffb300' : '#60a5fa';
      return `<div class="aim-j-row"><span class="aim-j-t">${new Date(e.t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span><span class="aim-j-lvl" style="color:${col}">${String(e.level || 'info').toUpperCase()}</span><span class="aim-j-msg">${_esc2(e.msg || '')}</span></div>`;
    }).join('') : '<div class="aim-j-empty">Aucun événement : tout roule ✓</div>';
  }
  // Graphe EMPILÉ par fournisseur (remplace la courbe totale : on VOIT qui porte la charge)
  function _amStacked(id, trend) {
    if (!_amReady() || !document.getElementById(id)) return;
    _amDispose(id);
    const root = am5.Root.new(id); _amRoots[id] = root;
    root._logo && root._logo.dispose();
    root.setThemes([am5themes_Animated.new(root)]);
    const chart = root.container.children.push(am5xy.XYChart.new(root, { panX: false, panY: false, wheelX: 'none', wheelY: 'none', paddingLeft: 2, paddingRight: 8, paddingTop: 10, paddingBottom: 2 }));
    const wide = (trend || []).length > 60;   // portée 7 j → étiquette jour·heure (sinon 24 "14h" ambigus)
    const data = (trend || []).map(t => ({ cat: (wide ? t.hour.slice(8, 10) + '·' : '') + t.hour.slice(11, 13) + 'h', gemini: t.gemini || 0, groq: t.groq || 0, github: t.github || 0, openrouter: t.openrouter || 0, cohere: t.cohere || 0, xai: t.xai || 0, claude: t.claude || 0 }));
    const xR = am5xy.AxisRendererX.new(root, { minGridDistance: 34 });
    xR.grid.template.setAll({ visible: false });
    xR.labels.template.setAll({ fill: am5.color(0x9aa0a6), fontSize: 10, fontFamily: 'Inter, -apple-system, sans-serif' });
    const xAxis = chart.xAxes.push(am5xy.CategoryAxis.new(root, { categoryField: 'cat', renderer: xR }));
    xAxis.data.setAll(data);
    const yR = am5xy.AxisRendererY.new(root, {});
    yR.grid.template.setAll({ stroke: am5.color(0x222227), strokeOpacity: 0.7 });
    yR.labels.template.setAll({ fill: am5.color(0x9aa0a6), fontSize: 10, fontFamily: 'Inter, -apple-system, sans-serif' });
    const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, { min: 0, renderer: yR }));
    for (const k of Object.keys(AIM_PCOL)) {
      const color = am5.color(AIM_PCOL[k]);
      const s = chart.series.push(am5xy.SmoothedXLineSeries.new(root, { xAxis, yAxis, valueYField: k, categoryXField: 'cat', stacked: true, stroke: color, fill: color, tooltip: am5.Tooltip.new(root, { labelText: AIM_PLBL[k] + ' {valueY}' }) }));
      s.strokes.template.setAll({ strokeWidth: 1.4 });
      s.fills.template.setAll({ visible: true, fillOpacity: 0.30 });
      s.data.setAll(data);
    }
    chart.set('cursor', am5xy.XYCursor.new(root, { behavior: 'none', xAxis, yAxis }));
  }
  // Donut compact : étiquettes am5 coupées (chevauchent en carte étroite) → légende HTML dédiée
  function _amDonutCompact(id, data, legendId) {
    if (!_amReady() || !document.getElementById(id)) return;
    _amDispose(id);
    const root = am5.Root.new(id); _amRoots[id] = root;
    root._logo && root._logo.dispose();
    root.setThemes([am5themes_Animated.new(root)]);
    const chart = root.container.children.push(am5percent.PieChart.new(root, { innerRadius: am5.percent(62), paddingTop: 4, paddingBottom: 4 }));
    const series = chart.series.push(am5percent.PieSeries.new(root, { categoryField: 'cat', valueField: 'val', alignLabels: false }));
    series.set('colors', am5.ColorSet.new(root, { colors: data.map(x => am5.color(x.color)) }));
    series.slices.template.setAll({ stroke: am5.color(0x0c0c0e), strokeWidth: 2, tooltipText: '{category} : {value}' });
    series.labels.template.set('visible', false);
    series.ticks.template.set('visible', false);
    series.data.setAll(data);
    const lg = document.getElementById(legendId);
    if (lg) lg.innerHTML = data.map(x => `<span><i style="background:#${x.color.toString(16).padStart(6, '0')}"></i>${x.cat} <b>${x.val}</b></span>`).join('');
  }
  async function loadAIMon() {
    if (_aimBusy) return;
    _aimBusy = true;
    const _dot = document.getElementById('aim-dot'), _btn = document.getElementById('aim-refresh'), _last = document.getElementById('aim-last');
    if (_dot) _dot.classList.add('aim-live-dot--busy');   // point or pulsant = rechargement EN COURS
    if (_btn) _btn.disabled = true;
    let d; try { d = await fetch('/api/admin/ai-monitor?hours=' + _aimHours).then(r => r.json()); } catch { d = null; }
    _aimBusy = false; _aimNextAt = Date.now() + 30000;    // prochain refresh auto dans 30 s (affiché à la seconde)
    if (_dot) _dot.classList.remove('aim-live-dot--busy');
    if (_btn) _btn.disabled = false;
    if (!d || !d.budget) { if (_last) _last.textContent = 'erreur de chargement : nouvel essai dans 30 s'; return; }
    _aimLastData = d;
    if (_last) _last.textContent = 'MAJ à ' + new Date(d.now).toLocaleTimeString('fr-FR');
    aimAppliquer(d);
  }
  /* Extrait de `loadAIMon` pour être rejouable au changement d'onglet : sans cela, un graphe rendu
     pendant que son onglet était masqué resterait un cadre vide. */
  function aimAppliquer(d) {
    aimRenderKpis(d); aimRenderProviders(d); aimRenderLegend(d); aimRenderForecast(d); aimRenderInfra(d); aimRenderJournal(d);
    aimRenderSysteme(d); aimRenderDisque(d); aimRenderSchema(d);
    _amStacked('aim-trend-am', d.trend);
    const CATCOL = { analyst: 0xe3b23a, bank: 0x60a5fa, news: 0x22c55e, bias: 0xa78bfa, ratesbias: 0x14b8a6, weekahead: 0xf472b6, chat: 0xfbbf24, outlook: 0xef4444, weekly: 0x0ea5e9, dtpdaily: 0xfb923c };
    _amDonutCompact('aim-cat-am', Object.entries(d.categoriesToday || {}).filter(([, v]) => v > 0).map(([k, v]) => ({ cat: k, val: v, color: CATCOL[k] || 0x6b7280 })), 'aim-cat-legend');
  }
  /* ══ LES QUATRE ONGLETS DU MONITEUR (11/09, demande user) ═══════════════════════════════════
     ⚠️ UN GRAPHE amCharts RENDU DANS UN CONTENEUR MASQUÉ MESURE ZÉRO, et il ne se répare pas tout
     seul quand on révèle le conteneur : il reste un cadre vide, sans la moindre erreur. C'est le
     piège documenté le 02/09 sur les widgets montés dans un onglet, et il mord exactement pareil
     ici. On ne se contente donc PAS de montrer et masquer : au changement d'onglet, on REJOUE le
     rendu avec la dernière charge reçue, ce qui reconstruit les graphes à la bonne taille.
     ⚠️ ET ON REJOUE TOUT, pas seulement l'onglet ouvert : les rendus sont idempotents et écrivent
     dans des conteneurs identifiés ; trier lequel appartient à quel onglet créerait une seconde
     table à tenir d'accord avec le HTML, qui se périmerait au premier onglet déplacé. */
  let _aimOnglet = 'ia';
  function aimOnglet(nom) {
    const bar = document.getElementById('aimt-bar'); if (!bar) return;
    _aimOnglet = nom;
    bar.querySelectorAll('.aimt').forEach(b => b.classList.toggle('on', b.dataset.aimt === nom));
    document.querySelectorAll('[data-aimt-p]').forEach(p => { p.hidden = (p.dataset.aimtP !== nom); });
    if (nom === 'perf') { try { loadPerf(); } catch (e) {} }
    if (_aimLastData) { try { aimAppliquer(_aimLastData); } catch (e) {} }
  }

  // ── PERFORMANCE INTELLIGENTE : lit /api/admin/perf (mesures réelles des membres), affiche les
  //    constats classés, les optimisations réversibles et l'historique. Aucune écriture de code.
  function _perfEsc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  async function loadPerf() {
    let d; try { d = await fetch('/api/admin/perf').then(r => r.json()); } catch { return; }
    if (!d) return;
    const meta = document.getElementById('perf-meta');
    if (meta) meta.textContent = (d.samples || 0) + ' session(s) mesurée(s)' + (d.maj ? ' · maj ' + new Date(d.maj).toLocaleString('fr-FR') : '');
    // Constats classés
    const gc = { haute: '#ff3d00', moyenne: '#ffb300', basse: '#8a8f98' };
    const cbox = document.getElementById('perf-constats');
    if (cbox) {
      const c = d.constats || [];
      cbox.innerHTML = !c.length
        ? '<p class="doc-p" style="color:var(--text3)">Aucun problème détecté pour l’instant' + ((d.samples || 0) < 3 ? ' (peu de sessions mesurées — laissez tourner quelques navigations).' : '.') + '</p>'
        : c.map(f => '<div class="row-inline" style="align-items:flex-start;gap:8px;margin:0 0 8px;padding:8px;border:1px solid var(--line,#232429);border-radius:6px">'
          + '<span style="flex:0 0 auto;width:9px;height:9px;border-radius:50%;margin-top:4px;background:' + (gc[f.gravite] || '#8a8f98') + '"></span>'
          + '<div style="flex:1"><b>' + _perfEsc(f.categorie) + '</b> — <code>' + _perfEsc(f.cible) + '</code><br>'
          + '<span style="color:var(--text2)">' + _perfEsc(f.mesure) + '</span><br>'
          + '<span style="color:var(--text3);font-size:12px">Cause : ' + _perfEsc(f.cause) + ' · Reco : ' + _perfEsc(f.recommandation) + '</span>'
          + (f.auto ? ' <button class="btn btn-sm" onclick="perfApply(\'' + _perfEsc(f.auto) + '\')">Corriger (sûr)</button>' : '')
          + '</div></div>').join('');
    }
    // Optimisations réversibles
    const obox = document.getElementById('perf-optims');
    if (obox) {
      obox.innerHTML = (d.optims || []).map(o => '<div class="row-inline" style="justify-content:space-between;gap:8px;margin:0 0 8px">'
        + '<div style="flex:1"><b>' + _perfEsc(o.titre) + '</b> ' + (o.active ? '<span style="color:#00e676">● active</span>' : '<span style="color:var(--text3)">○ inactive</span>')
        + '<br><span style="color:var(--text3);font-size:12px">' + _perfEsc(o.detail) + '</span></div>'
        + (o.active ? '<button class="btn btn-sm" onclick="perfRevert(\'' + _perfEsc(o.id) + '\')">Retour arrière</button>'
                    : '<button class="btn btn-sm btn-primary" onclick="perfApply(\'' + _perfEsc(o.id) + '\')">Appliquer</button>')
        + '</div>').join('') || '<p class="doc-p" style="color:var(--text3)">Aucune optimisation disponible.</p>';
    }
    // Détail des mesures (top vues + top API)
    const dbox = document.getElementById('perf-detail');
    if (dbox) {
      const moy = o => o.n ? Math.round(o.ms / o.n) : 0;
      const vues = Object.entries(d.views || {}).sort((a, b) => moy(b[1]) - moy(a[1])).slice(0, 12);
      const apis = Object.entries(d.api || {}).sort((a, b) => moy(b[1]) - moy(a[1])).slice(0, 15);
      const tv = vues.map(([k, v]) => '<tr><td>' + _perfEsc(k) + '</td><td>' + moy(v) + ' ms</td><td>' + Math.round(v.msMax) + ' ms</td><td>' + v.n + '</td></tr>').join('');
      const ta = apis.map(([k, a]) => '<tr><td><code>' + _perfEsc(k) + '</code></td><td>' + moy(a) + ' ms</td><td>' + a.n + '</td><td>' + (a.dup || 0) + '</td><td>' + (a.err || 0) + '</td></tr>').join('');
      dbox.innerHTML = '<div class="table-wrap"><b style="font-size:12px">Vues (temps d’ouverture)</b><table class="users-table"><thead><tr><th>Vue</th><th>Moy.</th><th>Max</th><th>Nav.</th></tr></thead><tbody>' + (tv || '<tr><td colspan=4 style="color:var(--text3)">—</td></tr>') + '</tbody></table></div>'
        + '<div class="table-wrap" style="margin-top:10px"><b style="font-size:12px">Appels API</b><table class="users-table"><thead><tr><th>Endpoint</th><th>Moy.</th><th>Appels</th><th>Doublons</th><th>Erreurs</th></tr></thead><tbody>' + (ta || '<tr><td colspan=5 style="color:var(--text3)">—</td></tr>') + '</tbody></table></div>';
    }
    // Historique
    const hbox = document.getElementById('perf-historique');
    if (hbox) {
      const h = d.historique || [];
      hbox.innerHTML = !h.length ? '<p class="doc-p" style="color:var(--text3)">Aucune optimisation appliquée pour l’instant.</p>'
        : '<div class="table-wrap"><table class="users-table"><thead><tr><th>Date</th><th>Optimisation</th><th>Action</th><th>Avant</th><th>Statut</th></tr></thead><tbody>'
        + h.map(r => '<tr><td>' + new Date(r.t).toLocaleString('fr-FR') + '</td><td>' + _perfEsc(r.titre) + '</td><td>' + _perfEsc(r.action) + '</td><td>' + (r.avant && r.avant.moyMs != null ? r.avant.moyMs + ' ms' : '—') + '</td><td>' + _perfEsc(r.statut) + '</td></tr>').join('')
        + '</tbody></table></div>';
    }
  }
  async function perfApply(id) {
    try { await fetch('/api/admin/perf/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); } catch {}
    loadPerf();
  }
  async function perfRevert(id) {
    try { await fetch('/api/admin/perf/revert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); } catch {}
    loadPerf();
  }
  async function perfReset() {
    try { await fetch('/api/admin/perf/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch {}
    loadPerf();
  }
  function perfAnalyser() { loadPerf(); }   // l'analyse est calculée côté serveur à chaque lecture
  window.perfApply = perfApply; window.perfRevert = perfRevert; window.perfReset = perfReset; window.perfAnalyser = perfAnalyser;

  // Câblage UNIQUE des contrôles statiques (portée du graphe + filtres du journal)
  (function _aimWire() {
    const rg = document.getElementById('aim-range');
    if (rg) rg.addEventListener('click', e => { const bt = e.target.closest('button'); if (!bt) return; _aimHours = parseInt(bt.dataset.h, 10) || 24; rg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === bt)); loadAIMon(); });
    const jf = document.getElementById('aim-j-filters');
    if (jf) jf.addEventListener('click', e => { const bt = e.target.closest('button'); if (!bt) return; _aimJFilter = bt.dataset.lvl || ''; jf.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === bt)); if (_aimLastData) aimRenderJournal(_aimLastData); });
    /* Délégué sur la barre, comme les deux ci-dessus : un écouteur par bouton ne survivrait pas à
       une réécriture de la barre, et il y en aurait quatre à tenir d'accord. */
    const tb = document.getElementById('aimt-bar');
    if (tb) tb.addEventListener('click', e => { const bt = e.target.closest('.aimt'); if (bt && bt.dataset.aimt) aimOnglet(bt.dataset.aimt); });
  })();

  // ── Dashboard financier (NET réel uniquement : aucune prévision) ─────────────
  async function loadFinance() {
    let d; try { d = await fetch('/api/admin/finance').then(r => r.json()); } catch { return; }
    if (!d || !d.kpis) return;
    const k = d.kpis, cur = (d.pricing && d.pricing.currency) || '€';
    const eur = n => cur + Math.round(n || 0).toLocaleString('fr-FR');
    const sign = v => (v >= 0 ? '+' : '') + v;
    const asof = document.getElementById('fin-asof');
    if (asof) asof.textContent = (d.source === 'whop' ? 'chiffres Whop · ' : '') + 'au ' + new Date(d.generatedAt).toLocaleString('fr-FR');

    // ARGENT RÉEL (paiements Whop soldés, net de remboursements) quand il est disponible ;
    // sinon on retombe sur l'estimation, en le DISANT plutôt qu'en laissant croire à du réel.
    const r = d.revenu || null;
    const eur2 = n2 => cur + (Math.round((n2 || 0) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const varHtml = v => v == null ? '' : `<span class="${v >= 0 ? 'fin-up' : 'fin-down'}">${sign(v)}% vs 30j -1</span>`;

    const kpis = r ? [
      { l: 'Encaissé · ce mois',  v: eur2(r.ceMois), sub: `mois dernier ${eur2(r.moisDernier)}`, accent: true },
      { l: 'Encaissé · total',    v: eur2(r.total),  sub: `${r.nb} paiement(s) · panier ${eur2(r.panier)}` },
      { l: 'Abonnés actifs',      v: k.activeSubs, sub: `${k.trials} essai(s) en cours` },
      { l: 'Clients',             v: k.clients, sub: `${k.newThisMonth} nouveau(x) ce mois` },
      { l: 'Encaissé · 30 jours', v: eur2(r.j30), sub: varHtml(r.j30Var) || `30j -1 : ${eur2(r.j30Prec)}` },
      { l: 'Revenu à risque',     v: eur(k.atRiskMrr), sub: `${k.expiringSoon} expire(nt) ≤ 7j · estimation` },
    ] : [
      { l: 'MRR · estimé', v: eur(k.mrr), sub: `ARPU ${eur(k.arpu)} / abonné · Whop injoignable`, accent: true },
      { l: 'ARR · estimé', v: eur(k.arr), sub: `${k.activeSubs} abonné(s) actif(s)` },
      { l: 'Abonnés actifs',       v: k.activeSubs, sub: `${k.trials} essai(s) en cours` },
      { l: 'Clients',              v: k.clients, sub: `${k.newThisMonth} nouveau(x) ce mois` },
      { l: 'Ajout net (30j)',      v: sign(k.netAdds), sub: `<span class="${k.growthPct >= 0 ? 'fin-up' : 'fin-down'}">${sign(k.growthPct)}% vs mois -1</span>` },
      { l: 'Revenu à risque',      v: eur(k.atRiskMrr), sub: `${k.expiringSoon} expire(nt) ≤ 7j` },
    ];
    /* PROCHAIN(S) PAIEMENT(S) (23/09, demande user). Une carte dans la rangée (le prochain, sa date,
       son montant, et le total attendu sous 30 jours), puis la liste datée juste dessous. */
    const pro = Array.isArray(d.prochains) ? d.prochains : [];
    const escP = s2 => String(s2 == null ? '' : s2).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const jour = ts => new Date(ts).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    const dans = ts => { const j = Math.max(0, Math.round((ts - Date.now()) / 864e5)); return j === 0 ? 'aujourd\'hui' : j === 1 ? 'demain' : 'dans ' + j + ' j'; };
    const pro30 = pro.filter(p => p.ts - Date.now() <= 30 * 864e5);
    const tot30 = pro30.reduce((a, p) => a + (p.montant || 0), 0);
    kpis.push(pro.length
      ? { l: 'Prochain paiement', v: eur2(pro[0].montant), sub: `${jour(pro[0].ts)} (${dans(pro[0].ts)}) · ${escP(pro[0].nom)}` }
      : { l: 'Prochain paiement', v: '—', sub: 'aucune échéance payante sous 45 j' });
    kpis.push({ l: 'Attendu · 30 jours', v: eur2(tot30), sub: `${pro30.length} échéance(s) · estimation` });
    const liste = document.getElementById('fin-prochains');
    if (liste) {
      liste.innerHTML = pro.length
        ? `<table class="fin-pro-tbl"><thead><tr><th>Échéance</th><th>Abonné</th><th>Formule</th><th class="num">Montant</th></tr></thead><tbody>`
          + pro.slice(0, 12).map(p => `<tr><td>${jour(p.ts)} <span class="fin-pro-dans">${dans(p.ts)}</span></td><td title="${escP(p.email)}">${escP(p.nom)}</td><td>${p.cycle === 'annual' ? 'Annuel' : 'Mensuel'}</td><td class="num">${eur2(p.montant)}</td></tr>`).join('')
          + `</tbody></table><div class="fin-pro-note">Montants attendus à l’échéance de chaque abonnement actif (prix de sa formule). Une résiliation n’est connue qu’à la date : c’est une estimation, pas un encaissement.</div>`
        : '<div class="fin-pro-note">Aucune échéance d’abonnement payant dans les 45 prochains jours.</div>';
    }
    document.getElementById('fin-kpis').innerHTML = kpis.map(c =>
      `<div class="fin-kpi${c.accent ? ' fin-kpi--accent' : ''}"><div class="fin-kpi-label">${c.l}</div><div class="fin-kpi-val">${c.v}</div><div class="fin-kpi-sub">${c.sub || ''}</div></div>`).join('');

    // Revenu mensuel : l'ENCAISSÉ RÉEL quand Whop répond (série 12 mois construite depuis les
    // paiements soldés), sinon l'estimation. Le titre du panneau le précise.
    const rev = d.revenueByMonth || {};
    const serieReelle = r && Array.isArray(r.serie) && r.serie.length;
    _amArea('fin-rev-am',
      serieReelle ? r.serie.map(m => ({ cat: m.mois.slice(2), val: m.total }))
                  : Object.keys(rev).map(m => ({ cat: m.slice(2), val: rev[m] })),
      0xe3b23a, cur);
    const titreRev = document.getElementById('fin-rev-title');
    if (titreRev) titreRev.textContent = serieReelle ? 'Encaissé mensuel · 12 mois' : 'Revenu estimé · 12 mois';
    // Inscriptions 12 mois : courbe (bleu)
    const sm = d.signupsByMonth || {};
    _amArea('fin-chart-am', Object.keys(sm).map(m => ({ cat: m.slice(2), val: sm[m] })), 0x60a5fa, '');
    // Répartition des abonnés : donut
    const dist = d.distribution || {};
    _amDonut('fin-dist-am', [
      { cat:'Mensuel',  val:dist.monthly   || 0, color:0xe3b23a },
      { cat:'Annuel',   val:dist.annual    || 0, color:0x60a5fa },
      { cat:'Essai',    val:dist.trial     || 0, color:0xf59e0b },
      { cat:'Illimité', val:dist.unlimited || 0, color:0x2ecc71 },
    ].filter(x => x.val > 0));

    // Whop
    const w = d.whop || {};
    document.getElementById('fin-whop').innerHTML = `
      <div class="whop-stat"><span class="whop-dot ${w.configured ? 'whop-on' : 'whop-off'}"></span> API Whop ${w.configured ? 'connectée' : 'non configurée (WHOP_API_KEY)'}</div>
      <div class="whop-stat"><span class="whop-dot ${w.webhookSecret ? 'whop-on' : 'whop-off'}"></span> Webhook ${w.webhookSecret ? 'sécurisé (token actif)' : 'non protégé (WHOP_WEBHOOK_SECRET)'}</div>
      <div class="whop-stat" style="border-bottom:none"><span class="whop-dot whop-on"></span> Renouvellement auto + email à chaque paiement</div>
      <a href="${w.renewUrl}" target="_blank" rel="noopener" class="btn-sm btn-primary" style="margin-top:14px;display:inline-block;text-decoration:none">Ouvrir la page Whop →</a>`;
  }

  // ── Chat support (admin) ──────────────────────────────────────────────────
  let _adChatUser = null;
  function _esc2(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  async function loadAdChat() {
    try {
      const [d, su] = await Promise.all([
        fetch('/api/admin/chat').then(r => r.json()).catch(() => ({ threads: [] })),
        fetch('/api/support/users').then(r => r.json()).catch(() => ({ users: [] })),
      ]);
      const threads = d.threads || [];
      const online = (su.users || []).filter(u => u.online).length;
      document.getElementById('ad-chat-count').textContent = threads.length;
      const _unread = threads.filter(t => (t.unread || 0) > 0).length;
      const _tb = document.getElementById('adm-tab-chat');
      if (_tb) { _tb.textContent = _unread; _tb.style.display = _unread > 0 ? '' : 'none'; }
      const oc = document.getElementById('ad-online-count');
      if (oc) oc.innerHTML = `<span class="ad-online-dot"></span>${online} en ligne`;
      const el = document.getElementById('ad-chat-threads');
      if (!threads.length) { el.innerHTML = '<div class="empty-state">Aucun message.</div>'; return; }
      el.innerHTML = threads.map(t => {
        let last = String(t.last || '');
        if (/^data:image\//.test(last)) last = '📷 Image';
        else if (/^data:/.test(last))   last = '📎 Pièce jointe';
        else last = last.slice(0, 48);
        return `<div class="ad-thread${t.user_id===_adChatUser?' active':''}" onclick="openAdThread('${t.user_id}')">
          <div class="ad-thread-name">${_esc2(t.name || t.email || ('Client · ' + String(t.user_id || '').slice(0, 8)))}${t.unread?` <span class="ad-thread-badge">${t.unread}</span>`:''}</div>
          <div class="ad-thread-last">${_esc2(last)}</div>
        </div>`;
      }).join('');
      if (_adChatUser) openAdThread(_adChatUser, true);
    } catch {}
  }
  async function openAdThread(userId, silent) {
    _adChatUser = userId;
    document.getElementById('ad-chat-reply').style.display = 'flex';
    if (!silent) loadAdChat();
    try {
      const d = await fetch('/api/admin/chat/' + userId).then(r => r.json());
      const msgs = d.messages || [];
      const box = document.getElementById('ad-chat-msgs');
      box.innerHTML = msgs.map(m => {
        const t = m.text || '';
/* ⚠️ FAILLE CORRIGEE LE 21/08 : XSS STOCKEE, ABONNE VERS ADMIN.
   Le test se contentait du PREFIXE `data:image/`. Or `data:image/svg+xml;base64,...` est une
   image au sens du prefixe ET un document capable de porter du script. Un abonne joignait donc
   une piece a la messagerie de support, et le script s executait DANS LA SESSION ADMIN a
   l ouverture du fil : escalade de privileges complete depuis un compte client ordinaire.
   On valide desormais la FORME COMPLETE de l URI de donnees, on n autorise que des formats
   raster (jamais SVG), et tout ce qui ne correspond pas est traite comme du TEXTE, donc echappe.
   Un prefixe n est pas une validation : il dit par quoi la chaine commence, jamais ce qu elle est. */
        const _IMG_OK = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+\/=]{16,}$/;
        const body = _IMG_OK.test(t)
          ? `<a href="${t}" target="_blank" rel="noopener"><img src="${t}" alt="image" style="max-width:220px;max-height:220px;border-radius:8px;display:block"></a>`
          : _esc2(t);
        return `<div class="ad-msg ad-msg--${m.sender}"><div>${body}</div><div class="ad-msg-meta">${new Date(m.created_at).toLocaleString('fr-FR')}</div></div>`;
      }).join('') || '<div class="empty-state">Pas encore de message.</div>';
      box.scrollTop = box.scrollHeight;
      if (!silent) loadAdChat();   // après le markRead serveur → le badge du thread + la pastille de l'onglet Support retombent à 0
    } catch {}
  }
  async function _adChatPost(text) {
    if (!text || !_adChatUser) return;
    await fetch('/api/admin/chat/' + _adChatUser, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text}) }).catch(()=>{});
    openAdThread(_adChatUser);
  }
  async function adChatSend() {
    const inp = document.getElementById('ad-chat-text');
    const text = (inp.value||'').trim();
    if (!text) return;
    inp.value = '';
    _adChatPost(text);
  }
  // Coller une image (Ctrl+V) dans la réponse support → envoyée directement
  document.getElementById('ad-chat-text')?.addEventListener('paste', e => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.type && it.type.indexOf('image') === 0) {
        const f = it.getAsFile(); if (!f) continue;
        e.preventDefault();
        if (f.size > 900*1024) { showToast('Image trop volumineuse (max 900 Ko).', 'err'); return; }
        const reader = new FileReader();
        reader.onload = () => _adChatPost(String(reader.result));
        reader.readAsDataURL(f);
        return;
      }
    }
  });

  // ── Load users ──────────────────────────────────────────────────────────────
  let _allUsers = [];
  let _fSearch = '', _fStatus = 'all', _fRole = 'all', _fMail = 'all';
  let _page = 1, _perPage = 12, _sortKey = 'created', _sortDir = -1;   // tri défaut : inscription la + récente d'abord

  async function loadUsers() {
    let resp = null;
    try { resp = await fetch('/api/admin/users').then(r => r.json()); }
    catch (e) { console.error('[admin] loadUsers échec', e); }
    // Tolère un tableau OU un objet { users:[…] }
    _allUsers = Array.isArray(resp) ? resp : (resp && Array.isArray(resp.users) ? resp.users : []);
    console.log('[admin] utilisateurs chargés :', _allUsers.length);
    renderStats();
    renderUserRows();
    if (typeof loadFinance === 'function') loadFinance();   // KPIs financiers à jour après toute modif
  }

  // État d'abonnement d'un utilisateur (pour stats + filtres + badge)
  function subState(u) {
    if (!u.active) return 'suspended';
    if (u.role === 'admin' || !u.expires_at) return 'active';
    const days = Math.ceil((new Date(u.expires_at) - new Date()) / 86400000);
    if (days < 0)  return 'expired';
    if (days <= 7) return 'soon';
    return 'active';
  }
  // Badge de statut EFFECTIF — avant, la colonne affichait « Actif » (le flag technique u.active)
  // à côté d'un abonnement « Expiré » : contradictoire à l'écran. On montre l'état réel du compte.
  /* « POURQUOI JE LES VOIS PAS CES COMPTES ? » (04/09). Parce que ce tableau ne liste QUE des
     comptes du desk, et que les désabonnés d'une campagne viennent en majorité de Whop : ils n'ont
     jamais eu de compte, donc aucun filtre ne peut les y faire apparaître. Le mode blanc d'un envoi,
     lui, travaille sur l'AUDIENCE (comptes + contacts Whop + ajouts manuels) : les deux écrans ne
     comptent pas la même population, et rien ne le disait. Le chiffre est demandé au serveur, pas
     déduit ici : lui seul connaît les adresses sans compte. */
  let _noteMailN = null;
  function _noteMail() {
    const el = document.getElementById('u-note-mail'); if (!el) return;
    if (_fMail !== 'unsub') { el.hidden = true; return; }
    const rendre = () => {
      if (_noteMailN == null) { el.hidden = true; return; }
      if (_noteMailN.mesure === false) {
        el.hidden = false;
        el.innerHTML = '⚠️ Le journal des envois n\'a pas pu être lu en entier : cette liste est peut-être incomplète.';
        return;
      }
      if (!_noteMailN.sansCompte) { el.hidden = true; return; }
      el.hidden = false;
      el.innerHTML = '<strong>' + _noteMailN.sansCompte + ' autre' + (_noteMailN.sansCompte > 1 ? 's' : '') + ' adresse'
        + (_noteMailN.sansCompte > 1 ? 's' : '') + ' désabonnée' + (_noteMailN.sansCompte > 1 ? 's' : '')
        + '</strong> n\'a' + (_noteMailN.sansCompte > 1 ? '' : '') + ' pas de compte sur le desk — contacts Whop ou ajouts manuels. '
        + 'Ce tableau ne liste que des comptes, ils ne peuvent donc pas y apparaître. '
        + 'Vous les retrouvez tous dans <strong>Campagne › Désinscrits</strong>.';
    };
    if (_noteMailN != null) return rendre();
    fetch('/api/admin/unsub-list').then(r => r.json()).then(d => {
      _noteMailN = (d && d.ok) ? { sansCompte: d.sansCompte || 0, total: d.total || 0, mesure: d.complet !== false }
                               : { sansCompte: 0, total: 0, mesure: false };
      rendre();
    }).catch(() => { _noteMailN = { sansCompte: 0, total: 0, mesure: false }; rendre(); });
  }

  function statusBadge(u) {
    const st = subState(u);
    /* « AFFICHER » AUTANT QUE « FILTRER » (04/09, demande user). Un filtre ne répond qu'à la question
       qu'on pense à poser ; il faut aussi voir l'état en parcourant la liste, sans rien filtrer.
       L'icône enveloppe de la ligne changeait déjà de forme — un détail qui se repère quand on sait
       où regarder, donc jamais. Ces deux états portent une conséquence trop lourde pour rester
       implicites : ne plus recevoir les campagnes, ne plus pouvoir se connecter du tout. */
    const marq = (u.blackliste ? '<span class="badge badge-black" title="Bloqué : connexion, création de compte et campagnes">Bloqué</span>' : '')
      + (u.unsub ? '<span class="badge badge-unsub" title="Désabonné des campagnes. Les e-mails de compte (accès, sécurité) partent toujours.">Désabonné</span>' : '');
    const base = st === 'suspended' ? '<span class="badge badge-suspended">Suspendu</span>'
      : st === 'expired'   ? '<span class="badge badge-expired">Expiré</span>'
      : st === 'soon'      ? '<span class="badge badge-soon">Expire bientôt</span>'
      : '<span class="badge badge-active">Actif</span>';
    return base + marq;
  }
  // Dernière connexion en RELATIF : « il y a 3 j » se lit d'un coup d'œil, là où
  // « 24/07/2026 23:51:51 » force à calculer de tête.
  // ⚠️ LA DATE EXACTE N'EST PLUS AU SEUL SURVOL (16/09) : sur une liste, un survol par ligne n'est
  // pas une lecture, c'est une enquête — et au doigt il n'y a pas de survol du tout. Elle s'écrit
  // donc SOUS la mention relative, en plus petit. Le `title` reste pour la seconde près.
  function relTime(ts) {
    if (!ts) return 'jamais';
    const ms = Date.now() - new Date(ts).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '-';
    const mn = Math.floor(ms / 60000);
    if (mn < 1)   return 'à l\'instant';
    if (mn < 60)  return 'il y a ' + mn + ' min';
    const h = Math.floor(mn / 60);
    if (h < 24)   return 'il y a ' + h + ' h';
    const j = Math.floor(h / 24);
    if (j < 30)   return 'il y a ' + j + ' j';
    const mo = Math.floor(j / 30);
    if (mo < 12)  return 'il y a ' + mo + ' mois';
    return 'il y a ' + Math.floor(mo / 12) + ' an' + (mo >= 24 ? 's' : '');
  }
  /* La cellule « Dernière connexion » : la mention relative COLORÉE par ancienneté, la date
     absolue dessous. Les seuils reprennent ceux qu'un exploitant utilise vraiment : aujourd'hui
     (le compte est vivant), moins de 30 jours (cas ordinaire), au-delà (il décroche), jamais.
     Le vocabulaire de couleur est celui du desk, pas un nouveau : vert vif = vivant, ambre =
     à surveiller, rouge = absent. En inventer un second ici finirait par le contredire. */
  function conxCell(ts) {
    if (!ts) return '<div class="u-conx u-conx--jamais"><span class="u-conx-rel">jamais connect\u00e9</span></div>';
    const d = new Date(ts), t = d.getTime();
    if (!Number.isFinite(t)) return '<div class="u-conx"><span class="u-conx-rel">-</span></div>';
    const j = Math.floor((Date.now() - t) / 86400000);
    const cls = j < 1 ? 'u-conx--vif' : j < 30 ? 'u-conx--frais' : 'u-conx--tiede';
    const abs = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })
      + ' \u00e0 ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `<div class="u-conx ${cls}" title="${esc(d.toLocaleString('fr-FR'))}">`
      + `<span class="u-conx-rel">${esc(relTime(ts))}</span>`
      + `<span class="u-conx-abs">${esc(abs)}</span></div>`;
  }

  const _ICON = {
    users:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    ok:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    warn:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
    expired: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    susp:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></svg>',
    client:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>' };
  function renderStats() {
    const u = _allUsers;
    const n = s => u.filter(x => subState(x) === s).length;
    const cards = [
      { v: u.length,                                  l: 'Utilisateurs', c: 'accent', i: 'users',   dim:'status', val:'all'       },
      { v: n('active'),                               l: 'Actifs',       c: 'ok',     i: 'ok',      dim:'status', val:'active'    },
      { v: n('soon'),                                 l: 'Expire ≤ 7j',  c: 'warn',   i: 'warn',    dim:'status', val:'soon'      },
      { v: n('expired'),                              l: 'Expirés',      c: 'danger', i: 'expired', dim:'status', val:'expired'   },
      { v: n('suspended'),                            l: 'Suspendus',    c: 'danger', i: 'susp',    dim:'status', val:'suspended' },
      { v: u.filter(x => x.role === 'client').length, l: 'Clients',      c: 'info',   i: 'client',  dim:'role',   val:'client'    },
    ];
    const isActive = c => c.dim === 'status'
      ? (_fStatus === c.val && (c.val !== 'all' || _fRole === 'all'))
      : (_fRole === c.val);
    document.getElementById('stats-row').innerHTML = cards.map(c =>
      `<div class="stat-card clickable ${c.c}${isActive(c) ? ' active' : ''}" onclick="statFilter('${c.dim}','${c.val}')" title="Filtrer : ${c.l}">
         <div class="stat-ic">${_ICON[c.i] || ''}</div>
         <div><div class="stat-value">${c.v}</div><div class="stat-label">${c.l}</div></div>
       </div>`).join('');
  }

  // Filtre rapide depuis une carte stat (synchronise les menus déroulants)
  function statFilter(dim, val) {
    if (dim === 'status') { _fStatus = val; if (val === 'all') _fRole = 'all'; }
    else if (dim === 'role') { _fRole = val; _fStatus = 'all'; }
    document.getElementById('flt-status').value = _fStatus;
    document.getElementById('flt-role').value   = _fRole;
    _page = 1;
    renderStats(); renderUserRows();
  }

  // Avatar à initiales : couleur dérivée de l'email (stable, pas de random)
  const _AVA_COLORS = ['#e3b23a','#60a5fa','#2ecc71','#a78bfa','#f472b6','#22d3ee','#fb923c','#34d399','#e879f9','#facc15'];
  function _avatar(u) {
    const base = (u.name || u.email || '?').trim();
    const initials = base.split(/\s+/).slice(0,2).map(s => s[0]).join('').toUpperCase() || '?';
    let h = 0; const key = (u.email || base); for (let i=0;i<key.length;i++) h = (h*31 + key.charCodeAt(i)) >>> 0;
    const col = _AVA_COLORS[h % _AVA_COLORS.length];
    return `<span class="u-avatar" style="background:${col}">${_escH(initials)}</span>`;   // initiales dérivées du nom libre → échappées aussi
  }

  // Tri : renvoie une clé comparable selon la colonne
  function _sortVal(u, key) {
    switch (key) {
      case 'name':   return (u.name || u.email || '').toLowerCase();
      case 'email':  return (u.email || '').toLowerCase();
      case 'type': {                                        // ordre : staff, puis Amis, Essai, Pro
        if (u.role === 'admin') return 0;
        if (u.role === 'support') return 1;
        if (String(u.plan || '').toLowerCase() === 'amis') return 2;
        return isTrialUser(u) ? 3 : 4;
      }
      case 'status': return ({ suspended:0, expired:1, soon:2, active:3 })[subState(u)] ?? 4;
      case 'last':   return u.last_login ? new Date(u.last_login).getTime() : 0;
      case 'created': return u.created_at ? new Date(u.created_at).getTime() : 0;   // date d'inscription
      case 'expiry':
        if (u.role === 'admin' || u.role === 'support') return 9e15;       // staff = jamais d'échéance → tout en bas
        if (!u.expires_at) return 8e15;                                    // illimité → après les datés
        return new Date(u.expires_at).getTime();
      default: return 0;
    }
  }

  function _filteredUsers() {
    let users = _allUsers.slice();
    if (_fSearch)            users = users.filter(u => ((u.name||'') + ' ' + (u.email||'')).toLowerCase().includes(_fSearch));
    if (_fStatus !== 'all')  users = users.filter(u => subState(u) === _fStatus);
    if (_fRole !== 'all')    users = users.filter(u => u.role === _fRole);
    /* ÉTAT E-MAIL. `blackliste` n'est PAS un sous-cas de `unsub` : un compte bloqué ne peut plus se
       connecter mais reste abonné aux campagnes tant qu'on ne l'a pas désinscrit, et l'inverse est
       vrai aussi. Les trois filtres sont donc exclusifs, pas emboîtés. */
    if (_fMail === 'unsub')      users = users.filter(u => !!u.unsub);
    else if (_fMail === 'sub')   users = users.filter(u => !u.unsub);
    else if (_fMail === 'black') users = users.filter(u => !!u.blackliste);
    users.sort((a, b) => {
      const va = _sortVal(a, _sortKey), vb = _sortVal(b, _sortKey);
      if (va < vb) return -1 * _sortDir;
      if (va > vb) return  1 * _sortDir;
      return (a.email||'').localeCompare(b.email||'');
    });
    return users;
  }

  function renderUserRows() {
    const tbody = document.getElementById('users-tbody');
    const users = _filteredUsers();
    document.getElementById('user-count').textContent = users.length;

    // En-têtes : flèche de tri active
    document.querySelectorAll('.users-table th.sortable').forEach(th => {
      const active = th.dataset.sort === _sortKey;
      th.classList.toggle('sorted', active);
      const ar = th.querySelector('.sort-arrow');
      if (ar) ar.textContent = active ? (_sortDir === 1 ? '▲' : '▼') : '▲';
    });

    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Aucun utilisateur ne correspond aux filtres.</td></tr>';
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    // Pagination
    const per = _perPage === 0 ? users.length : _perPage;
    const totalPages = Math.max(1, Math.ceil(users.length / per));
    if (_page > totalPages) _page = totalPages;
    const start = (_page - 1) * per;
    const pageUsers = users.slice(start, start + per);

    // Actions en ICÔNES (les 5 boutons texte faisaient ~450 px par ligne — retour user « trop large ») ;
    // le libellé survit dans title + aria-label.
    const IC = {
      edit:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
      pwd:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
      pause:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
      play:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
      kick:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
      // Newsletter (enveloppe) / desinscrit (enveloppe barree) / blocage (interdiction).
      mail:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
      mailoff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/><path d="M3 3l18 18"/></svg>',
      ban:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
      del:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    };
    const icBtn = (icon, label, onclick, danger) =>
      `<button class="btn-ic${danger ? ' btn-ic--danger' : ''}" title="${label}" aria-label="${label}" onclick="${onclick}">${IC[icon]}</button>`;
    tbody.innerHTML = pageUsers.map(u => `
      <tr data-id="${u.id}">
        <td class="u-ck-col"><input type="checkbox" class="u-ck" data-email="${_escH(u.email)}" data-nom="${_escH(u.name || '')}" onchange="fusionCoche(this)"${_fusionSel.has(String(u.email).toLowerCase()) ? ' checked' : ''}></td>
        <td><div class="u-name-cell">${_avatar(u)}<span class="u-name-txt">${_escH(u.name || '-')}</span></div></td><!-- (XSS) nom/e-mail TOUJOURS échappés : modifiables par le client via son profil -->
        <td class="email">${_escH(u.email)}</td>
        <td><span class="badge badge-client">${cycleLabel(u)}</span></td>
        <td>${typeBadge(u)}</td>
        <td class="u-statut">${statusBadge(u)}</td>
        <td>${subInfo(u)}</td>
        <td>${conxCell(u.last_login)}</td>
        <td class="actions">
          ${icBtn('edit', 'Modifier', `openEdit('${esc(String(u.id))}','${esc(u.name)}','${u.role}','${u.plan}',${u.active},'${esc(u.plancad || '')}')`)}
          ${icBtn('pwd', 'Mot de passe', `openPwd('${esc(String(u.id))}')`)}
          ${u.role !== 'admin' ? icBtn(u.active ? 'pause' : 'play', u.active ? 'Suspendre' : 'Réactiver', `toggleSuspend('${esc(String(u.id))}',${u.active})`)
            + icBtn('kick', 'Déconnecter du desk', `forceDisconnect('${esc(String(u.id))}')`)
            + icBtn(u.unsub ? 'mailoff' : 'mail',
                /* PLUS DE BOUTON MORT (04/09, demande user : « je dois pouvoir désinscrire et
                   réinscrire moi-même »). Il était privé de son onclick pour les désinscrits du
                   seed, et il avait raison de l'être tant que le seed se réappliquait à chaque
                   démarrage : le panneau aurait annoncé « réabonné » et le redémarrage suivant
                   l'aurait défait sans un mot. Le seed ne s'applique plus qu'une fois, donc un
                   réabonnement TIENT, donc le bouton bascule dans les deux sens, toujours. */
                (u.unsub ? 'Réabonner à la newsletter' : 'Désinscrire de la newsletter')
                  + (u.unsubFige ? ' (désinscription d\'origine)' : ''),
                `toggleNewsletter('${esc(String(u.id))}',${!!u.unsub})`)
            + icBtn('ban', u.blackliste ? 'Débloquer l accès au terminal' : 'Bloquer l accès au terminal',
                `toggleBlacklist('${esc(String(u.id))}',${!!u.blackliste})`, !u.blackliste) : ''}
          ${icBtn('del', 'Supprimer', `deleteUser('${esc(String(u.id))}')`, true)}
        </td>
      </tr>`).join('');

    renderPagination(users.length, totalPages, start, pageUsers.length);
    _noteMail();
  }

  function renderPagination(total, totalPages, start, shown) {
    const el = document.getElementById('pagination');
    if (!el) return;
    const from = total ? start + 1 : 0;
    const to   = start + shown;
    // Numéros de page condensés (1 … p-1 p p+1 … N)
    let nums = [];
    const add = n => nums.push(`<button class="pg-num${n === _page ? ' active' : ''}" onclick="gotoPage(${n})">${n}</button>`);
    const ell = () => nums.push('<span class="pg-ellipsis">…</span>');
    if (totalPages <= 7) { for (let i=1;i<=totalPages;i++) add(i); }
    else {
      add(1);
      if (_page > 3) ell();
      for (let i = Math.max(2, _page-1); i <= Math.min(totalPages-1, _page+1); i++) add(i);
      if (_page < totalPages-2) ell();
      add(totalPages);
    }
    el.innerHTML = `
      <span class="pg-info">${from}–${to} sur ${total}</span>
      <div class="pg-spacer"></div>
      <button class="pg-btn" onclick="gotoPage(${_page-1})" ${_page<=1?'disabled':''}>‹ Préc.</button>
      <div class="pg-pages">${nums.join('')}</div>
      <button class="pg-btn" onclick="gotoPage(${_page+1})" ${_page>=totalPages?'disabled':''}>Suiv. ›</button>
      <div class="pg-per">
        <span>Par page</span>
        <select onchange="setPerPage(this.value)">
          <option value="12"${_perPage===12?' selected':''}>12</option>
          <option value="25"${_perPage===25?' selected':''}>25</option>
          <option value="50"${_perPage===50?' selected':''}>50</option>
          <option value="0"${_perPage===0?' selected':''}>Tout</option>
        </select>
      </div>`;
  }

  function gotoPage(n) {
    _page = Math.max(1, n);
    renderUserRows();
    document.querySelector('.users-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function setPerPage(v) { _perPage = parseInt(v, 10) || 0; _page = 1; renderUserRows(); }
  function sortBy(key) {
    if (_sortKey === key) _sortDir = -_sortDir; else { _sortKey = key; _sortDir = 1; }
    _page = 1; renderUserRows();
  }

  // Essai gratuit = durée d'abonnement (création → expiration) ≤ ~1 semaine
  // Essai : le TYPE déclaré fait autorité ; la fenêtre d'accès ne sert que de repli pour les comptes
  // créés avant l'existence du type « essai ». Miroir exact de _isTrialAccount (server.js).
  function isTrialUser(u) {
    if (u.role === 'admin' || u.role === 'support') return false;
    const p = String(u.plan || '').toLowerCase();
    if (p === 'essai') return true;
    if (p === 'amis') return false;                          // ami déclaré → jamais reclassé essai par les dates
    if (!u.expires_at || !u.created_at) return false;
    const span = new Date(u.expires_at) - new Date(u.created_at);
    return span > 0 && span <= 8.5 * 86400000;
  }
  // ── Colonne PLAN = la CADENCE, dérivée des dates (aucune saisie) : 7 jours / Mensuel / Annuel /
  //    Illimité. Colonne TYPE = la NATURE déclarée : Professionnel / Amis / Essai (+ staff).
  const _CADS = { mensuel: 'Mensuel', annuel: 'Annuel', '7j': '7 jours', illimite: 'Illimité' };
  function cycleLabel(u) {
    if (u.role === 'admin' || u.role === 'support') return '∞';
    if (u.plancad && _CADS[u.plancad]) return _CADS[u.plancad];   // réglage admin / synchro Whop → prime
    if (!u.expires_at) return 'Illimité';
    const span = u.created_at ? new Date(u.expires_at) - new Date(u.created_at) : 0;
    if (span > 0 && span <= 8.5 * 86400000) return '7 jours';
    if (span >= 300 * 86400000) return 'Annuel';
    return 'Mensuel';                                        // défaut (dates incohérentes incluses) — corrigé au renouvellement Whop
  }
  // Couleurs voulues par le user : Amis = BLEU · Professionnel = VERT · Essai = OR DTP.
  function typeBadge(u) {
    if (u.role === 'admin')   return '<span class="badge badge-admin">Admin</span>';
    if (u.role === 'support') return '<span class="badge badge-support">Support</span>';
    if (String(u.plan || '').toLowerCase() === 'amis') return '<span class="badge badge-amis">Amis</span>';
    if (isTrialUser(u)) return '<span class="badge badge-essai">Essai</span>';
    return '<span class="badge badge-pro">Professionnel</span>';
  }
  // Note sous le sélecteur de type + réglages associés. « Essai » propose la durée 1 semaine
  // (création seulement — en édition la durée vaut « ne rien changer », la forcer raccourcirait
  // l'accès d'un compte existant sans que l'admin l'ait demandé).
  const _TYPE_HINTS = {
    essai: "Compte d'essai : aucun revenu compté, et à l'échéance c'est le mail « fin d'essai » qui part : jamais la relance de renouvellement.",
    amis:  "Compte ami : accès offert, ne recevra JAMAIS de relance de paiement (ni renouvellement, ni fin d'essai). Tout le reste est normal.",
  };
  function planSync(which) {
    const sel = document.getElementById(which + '-plan'); if (!sel) return;
    const hint = document.getElementById(which + '-plan-hint');
    if (hint) {
      const t = _TYPE_HINTS[sel.value] || '';
      hint.textContent = t;
      hint.style.display = t ? 'block' : 'none';
    }
    if (which !== 'add') return;
    const dur = document.getElementById('add-duration');
    if (sel.value === 'essai' && dur && dur.value !== '1week') { dur.value = '1week'; if (typeof toggleCustom === 'function') toggleCustom('add'); }
  }
  // Affiche l'état de l'abonnement (illimité / actif jusqu'au… / expiré)
  function subInfo(u) {
    if (u.role === 'admin')   return '<span class="badge badge-admin">∞ admin</span>';
    if (u.role === 'support') return '<span class="badge badge-support">∞ support</span>';
    if (!u.expires_at)      return '<span class="badge badge-active">Illimité</span>';
    const end  = new Date(u.expires_at);
    const date = end.toLocaleDateString('fr-FR');
    const days = Math.ceil((end - new Date()) / 86400000);
    if (days < 0)  return `<span class="badge badge-expired">Expiré le ${date}</span>`;
    if (days <= 7) return `<span class="badge badge-soon">Expire le ${date} (${days}j)</span>`;
    return `<span class="badge badge-active">Jusqu'au ${date}</span>`;
  }

  // (Audit 28/07 — XSS) esc() sert aux ARGUMENTS des onclick (chaîne JS simple-quotée dans un
  // attribut double-quoté) : il faut neutraliser le backslash D'ABORD, puis ' " < > & — l'ancienne
  // version laissait passer < > & \ (injection + boutons morts sur un nom finissant par \).
  function esc(s) { return (s||'').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&(?!(quot|lt|gt|amp);)/g, '&amp;'); }

  // Affiche/masque le champ date personnalisée (formulaire add ou edit)
  function toggleCustom(which) {
    const sel  = document.getElementById(which + '-duration');
    const wrap = document.getElementById(which + '-custom-wrap');
    wrap.style.display = sel.value === 'custom' ? '' : 'none';
  }

  // Staff (support/admin) = pas d'abonnement → on masque les champs liés
  function toggleStaff(which) {
    const role  = document.getElementById(which + '-role').value;
    const staff = role === 'support' || role === 'admin';
    const hint  = document.getElementById(which + '-role-hint');
    if (hint) hint.style.display = role === 'support' ? '' : 'none';
    ['plan','start-date','duration','custom-wrap'].forEach(k=>{
      const f = document.getElementById(which + '-' + k);
      const field = f ? f.closest('.form-field') : null;
      if (field) field.style.display = staff ? 'none' : '';
    });
    // Repasser en « Client » ré-affichait TOUT le bloc, y compris la date d'expiration réservée à la
    // durée « personnalisée » → on redonne la main à toggleCustom, seul juge de ce champ.
    if (!staff) toggleCustom(which);
  }

  // ── Add user ────────────────────────────────────────────────────────────────
  document.getElementById('add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    const errEl = document.getElementById('add-error');
    const okEl  = document.getElementById('add-success');
    errEl.classList.remove('visible'); okEl.classList.remove('visible');

    const r = await fetch('/api/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.ok) {
      e.target.reset();
      const ms = d.mail || {};
      const mailMsg = ms.skipped ? '' : ms.sent ? ` : email de bienvenue envoyé via ${ms.provider}.` : ' : ⚠️ compte créé mais EMAIL DE BIENVENUE NON ENVOYÉ (voir la carte Email dans l\'onglet IA Monitor).';
      const nlMsg = d.newsletter ? ' Inscrit à la newsletter : e-mail de bienvenue au prochain jour d\'envoi, puis il suit la séquence hebdo là où elle en est.' : '';
      okEl.textContent = `Utilisateur ${body.email} créé avec succès.${mailMsg}${nlMsg}`;
      okEl.classList.add('visible');
      loadUsers();
    } else {
      errEl.textContent = d.error || 'Erreur lors de la création';
      errEl.classList.add('visible');
    }
  });

  // ── Delete (confirmation INLINE dans la ligne : aucun dialog natif) ───────────
  function deleteUser(id) {
    const cell = document.querySelector(`tr[data-id="${id}"] td.actions`);
    if (!cell || cell.dataset.confirming) return;
    cell.dataset.prevHtml  = cell.innerHTML;   // mémorise les boutons pour pouvoir annuler
    cell.dataset.confirming = '1';
    cell.innerHTML = `<span class="del-confirm">
        <span class="del-confirm-txt">Supprimer&nbsp;?</span>
        <button class="btn-sm btn-danger" onclick="confirmDeleteUser('${esc(String(id))}')">Oui</button>
        <button class="btn-sm" onclick="cancelDeleteUser('${esc(String(id))}')">Non</button>
      </span>`;
  }
  function cancelDeleteUser(id) {
    const cell = document.querySelector(`tr[data-id="${id}"] td.actions`);
    if (cell && cell.dataset.prevHtml != null) {
      cell.innerHTML = cell.dataset.prevHtml;
      delete cell.dataset.prevHtml; delete cell.dataset.confirming;
    }
  }
  async function confirmDeleteUser(id) {
    const cell = document.querySelector(`tr[data-id="${id}"] td.actions`);
    if (cell) cell.innerHTML = `<span class="del-confirm-txt" style="opacity:.6">Suppression…</span>`;
    try {
      const r = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('http');
      showToast('✓ Utilisateur supprimé');
      loadUsers();
    } catch {
      showToast('Erreur lors de la suppression : réessayez', 'err');
      loadUsers();
    }
  }

  // ── Suspendre / Réactiver (bascule active) + Déconnecter (kill session) ──────
  async function toggleSuspend(id, isActive) {
    const next = isActive ? 0 : 1;
    try {
      const r = await fetch(`/api/admin/users/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: next }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok !== false) { showToast(next ? '✓ Compte réactivé' : '✓ Compte suspendu : déconnecté du desk'); loadUsers(); }
      else showToast(d.error || 'Erreur lors de la mise à jour', 'err');
    } catch { showToast('Erreur réseau : réessayez', 'err'); }
  }
  async function forceDisconnect(id) {
    try {
      const r = await fetch(`/api/admin/users/${id}/disconnect`, { method: 'POST' });
      if (r.ok) showToast('✓ Utilisateur déconnecté du desk (éjecté sous ~20 s)');
      else showToast('Erreur : réessayez', 'err');
    } catch { showToast('Erreur réseau : réessayez', 'err'); }
  }

  // ── Newsletter : désinscrire / réabonner un compte depuis sa fiche ──────────
  // Réversible et sans effet sur l'accès : aucune confirmation, un clic suffit. L'état affiché
  // vient de la RÉPONSE du serveur, jamais de ce qu'on a demandé — si l'écriture échoue, le
  // bouton ne ment pas.
  async function toggleNewsletter(id, estDesinscrit) {
    try {
      const r = await fetch(`/api/admin/users/${id}/newsletter`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inscrit: !!estDesinscrit }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(d.error || 'Erreur : réessayez', 'err'); return; }
      showToast(d.unsub ? '✓ Désinscrit de la newsletter' : '✓ Réabonné à la newsletter');
      loadUsers();
    } catch { showToast('Erreur réseau : réessayez', 'err'); }
  }

  // ── Blocage de l'accès au terminal (liste noire) ────────────────────────────
  // BLOQUER coupe l'accès : confirmation EN LIGNE, comme la suppression. Le cahier des charges
  // interdit les dialogues natifs, et on réutilise le motif déjà en place plutôt que d'en
  // inventer un second. DÉBLOQUER ne casse rien : direct.
  function toggleBlacklist(id, estBloque) {
    if (estBloque) { _blacklistAppliquer(id, false); return; }
    const cell = document.querySelector(`tr[data-id="${id}"] td.actions`);
    if (!cell || cell.dataset.confirming) return;
    cell.dataset.prevHtml = cell.innerHTML;
    cell.dataset.confirming = '1';
    cell.innerHTML = `<span class="del-confirm"><span class="del-confirm-txt">Bloquer l'accès&nbsp;?</span><button class="btn-sm btn-danger" onclick="_blacklistAppliquer(\'${esc(String(id))}\', true)">Oui</button><button class="btn-sm" onclick="cancelDeleteUser(\'${esc(String(id))}\')">Non</button></span>`;
  }
  async function _blacklistAppliquer(id, bloquer) {
    try {
      const r = await fetch(`/api/admin/users/${id}/blacklist`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bloque: !!bloquer }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(d.error || 'Erreur : réessayez', 'err'); loadUsers(); return; }
      showToast(d.blackliste ? '✓ Accès bloqué : compte éjecté du terminal' : '✓ Accès rétabli');
      loadUsers();
    } catch { showToast('Erreur réseau : réessayez', 'err'); loadUsers(); }
  }
  // ── Edit modal ──────────────────────────────────────────────────────────────
  function openEdit(id, name, role, plan, active, plancad) {
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-name').value = name;
    document.getElementById('edit-role').value = role;
    const _pc = document.getElementById('edit-plancad'); if (_pc) _pc.value = plancad || '';
    // TYPE : les anciennes valeurs (mensuel/annuel/professionnel) se rangent toutes sous
    // « Professionnel » — la cadence est désormais DÉRIVÉE des dates, plus une valeur du sélecteur.
    const _tp = String(plan || '').toLowerCase();
    document.getElementById('edit-plan').value = (_tp === 'essai' || _tp === 'amis') ? _tp : 'professionnel';
    document.getElementById('edit-active').value = active ? '1' : '0';   // statut actuel (Actif/Suspendu) pré-rempli
    toggleStaff('edit');   // masque les champs abonnement si support/admin
    planSync('edit');      // note du type (en édition planSync ne touche JAMAIS à la durée)
    document.getElementById('edit-duration').value = '';      // par défaut : on garde l'échéance
    document.getElementById('edit-custom-date').value = '';
    document.getElementById('edit-custom-wrap').style.display = 'none';
    document.getElementById('edit-modal').classList.add('open');
  }
  function closeEditModal() { document.getElementById('edit-modal').classList.remove('open'); }
  async function saveEdit() {
    const id = document.getElementById('edit-id').value;
    const body = {
      name:   document.getElementById('edit-name').value,
      role:   document.getElementById('edit-role').value,
      plan:   document.getElementById('edit-plan').value,
      plancad: (document.getElementById('edit-plancad') || {}).value || '',
      active: +document.getElementById('edit-active').value };
    const dur = document.getElementById('edit-duration').value;
    if (dur) {                                  // l'admin a choisi de renouveler / changer l'échéance
      body.duration = dur;
      if (dur === 'custom') body.expiresAt = document.getElementById('edit-custom-date').value;
    }
    try {
      const r = await fetch(`/api/admin/users/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok !== false) {
        closeEditModal(); loadUsers();
        showToast('✓ Utilisateur mis à jour avec succès');
      } else {
        showToast(d.error || 'Erreur lors de la mise à jour', 'err');
      }
    } catch {
      showToast('Erreur de connexion : réessayez', 'err');
    }
  }

  // Notification toast (bas-droite)
  function showToast(msg, type) {
    let wrap = document.getElementById('toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toast-wrap'; wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'err' ? ' err' : '');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity 0.3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2800);
  }

  // ── Password modal ──────────────────────────────────────────────────────────
  function openPwd(id) {
    document.getElementById('pwd-id').value = id;
    document.getElementById('pwd-new').value = '';
    document.getElementById('pwd-modal').classList.add('open');
  }
  function closePwdModal() { document.getElementById('pwd-modal').classList.remove('open'); }
  async function savePwd() {
    const id  = document.getElementById('pwd-id').value;
    const pwd = document.getElementById('pwd-new').value;
    if (!pwd || pwd.length < 6) { showToast('Min. 6 caractères', 'err'); return; }
    // (Audit 27/07) La réponse était IGNORÉE : « ✓ mis à jour » s'affichait même sur un 500 —
    // et une erreur réseau laissait la modale figée sans message. On vérifie comme saveEdit.
    try {
      const r = await fetch(`/api/admin/users/${id}/password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) { showToast('Échec : ' + (d.error || 'erreur serveur (' + r.status + ')'), 'err'); return; }
      closePwdModal();
      showToast("✓ Mot de passe mis à jour : email envoyé (l'utilisateur doit vérifier ses indésirables/spams)");
    } catch { showToast('Erreur réseau : réessayez', 'err'); }
  }

  // ── Logout ──────────────────────────────────────────────────────────────────
  async function logout() {
    // `await` : la garde « déjà connecté » de login.html interroge /api/auth/me à l'arrivée ; naviguer
    // avant que la session soit tuée renverrait au panneau quelqu'un qui veut en sortir.
    await fetch('/api/auth/logout', { method: 'POST' });
    // `replace` : sinon le panneau admin reste dans l'historique derrière la page de connexion.
    window.location.replace('/login');
  }

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
  });

  // Recherche + filtres (retour page 1 + maj surbrillance des cartes stats)
  document.getElementById('flt-search').addEventListener('input',  e => { _fSearch = e.target.value.trim().toLowerCase(); _page = 1; renderUserRows(); });
  document.getElementById('flt-status').addEventListener('change', e => { _fStatus = e.target.value; _page = 1; renderStats(); renderUserRows(); });
  document.getElementById('flt-role').addEventListener('change',   e => { _fRole   = e.target.value; _page = 1; renderStats(); renderUserRows(); });
  document.getElementById('flt-mail').addEventListener('change',   e => { _fMail   = e.target.value; _page = 1; renderUserRows(); });

  // Tri au clic sur les en-têtes de colonnes
  document.querySelectorAll('.users-table th.sortable').forEach(th =>
    th.addEventListener('click', () => sortBy(th.dataset.sort)));

/* ── PHOTO DU SUPPORT (26/08) ───────────────────────────────────────────────────────────────────
   Celle que voient TOUS les clients à côté de chaque message du support. Elle était une constante
   du code : la changer imposait de modifier un fichier, redéployer, et vider le cache de chaque
   navigateur. Elle se dépose désormais ici, et s'applique dans la minute.
   LE TRAVAIL D'IMAGE EST FAIT DANS LE NAVIGATEUR, comme pour les avatars de compte : recadrage
   CARRÉ, downscale en plusieurs demi-passes (une réduction directe de 3000 px à 256 px crénelle
   fortement), puis JPEG progressif jusqu'à passer sous la limite du serveur. On envoie donc toujours
   un fichier petit et au bon format, quelle que soit la photo d'origine.
   ⚠️ RECADRAGE VERS LE HAUT : sur une photo de bureau, le visage est dans le tiers supérieur. Un
   carré centré coupe la tête et cadre le torse — exactement le défaut déjà corrigé sur les avatars
   de compte. On remonte donc la fenêtre à proportion de l'élongation de l'image. */
/* Repli de la carte. L'etat n'est PAS persiste : c'est un reglage qu'on pose une fois, et le
   rouvrir ferme au chargement suivant est le bon defaut — pas une preference a memoriser. */
function adSupAvToggle() {
  var c = document.getElementById('ad-supav-card'); if (!c) return;
  var ferme = c.classList.toggle('is-closed');
  var e = document.getElementById('ad-supav-etat'); if (e) e.textContent = ferme ? 'Repliée' : 'Ouverte';
  if (ferme) adCropAnnuler();   // on ne laisse pas un recadrage en cours dans un tiroir ferme
}
function adSupAvPick() { var f = document.getElementById('ad-supav-file'); if (f) { f.value = ''; f.click(); } }
function _adSupAvRender(dataUrl) {
  var e = document.getElementById('ad-supav'); if (!e) return;
  e.innerHTML = dataUrl ? '<img src="' + dataUrl + '" alt="Support">' : 'DTP';
  e.classList.toggle('has-photo', !!dataUrl);
}
function adSupAvLoad() {
  fetch('/api/support-avatar', { cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (d) { _adSupAvRender(d && d.avatar); }).catch(function () {});
}
function _adSupAvEnvoi(dataUrl) {
  return fetch('/api/admin/support-avatar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar: dataUrl }),
  }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok && j.ok, err: j.error }; }); });
}
function adSupAvDelete() {
  _adSupAvEnvoi(null).then(function (r) {
    if (!r.ok) return showToast('Retrait impossible : ' + (r.err || 'erreur'), 'err');
    _adSupAvRender(null);
    showToast('✓ Photo retirée : les clients revoient les initiales DTP.');
  }).catch(function () { showToast('Retrait impossible.', 'err'); });
}
/* ── RECADRAGE MANUEL, PARCE QUE DEVINER NE MARCHE PAS (28/08) ──────────────────────────────────
   Le premier jet recadrait au centre, avec une remontée proportionnelle sur les photos verticales.
   Sur une photo de bureau — plan large, sujet décentré, tête dans le tiers haut — ça tombe sur le
   torse : « on voit mal, centre bien la photo ». Et l'automatiser vraiment n'est pas fiable ici :
   la détection de visage du navigateur n'existe pas partout, et une heuristique de luminosité se
   ferait piéger par le logo doré du mur, aussi lumineux que la peau.
   On montre donc le RÉSULTAT EXACT et on laisse placer : la fenêtre ronde est celle du client, à
   l'échelle. Ce qui est dans le cercle est ce qui sera enregistré — rien à deviner, rien à vérifier
   après coup.
   ÉTAT : `k` = échelle appliquée à l'image, `x`/`y` = coin haut-gauche de l'image dans la scène.
   L'image COUVRE toujours la scène (bornes ci-dessous) : aucun trou blanc possible dans le cercle. */
var _crop = null;   // { img, S, kMin, k, x, y }
function _cropBorner() {
  if (!_crop) return;
  var dw = _crop.img.naturalWidth * _crop.k, dh = _crop.img.naturalHeight * _crop.k;
  _crop.x = Math.min(0, Math.max(_crop.S - dw, _crop.x));
  _crop.y = Math.min(0, Math.max(_crop.S - dh, _crop.y));
}
function _cropRendre() {
  if (!_crop) return;
  _cropBorner();
  var e = document.getElementById('ad-crop-img'); if (!e) return;
  e.style.width = (_crop.img.naturalWidth * _crop.k) + 'px';
  e.style.height = (_crop.img.naturalHeight * _crop.k) + 'px';
  e.style.left = _crop.x + 'px';
  e.style.top = _crop.y + 'px';
  // Aperçu à la taille RÉELLE d'un avatar de conversation : la même fenêtre, réduite.
  var m = document.getElementById('ad-crop-mini');
  if (m) {
    var r = 34 / _crop.S;
    m.style.backgroundImage = 'url(' + _crop.img.src + ')';
    m.style.backgroundSize = (_crop.img.naturalWidth * _crop.k * r) + 'px ' + (_crop.img.naturalHeight * _crop.k * r) + 'px';
    m.style.backgroundPosition = (_crop.x * r) + 'px ' + (_crop.y * r) + 'px';
  }
}
function adCropZoom(v) {
  if (!_crop) return;
  var S = _crop.S, av = _crop.k;
  _crop.k = _crop.kMin * (parseFloat(v) / 100);
  // On zoome sur le CENTRE de la fenêtre, pas sur le coin : sinon le sujet fuit dès qu'on approche.
  var f = _crop.k / av;
  _crop.x = S / 2 - (S / 2 - _crop.x) * f;
  _crop.y = S / 2 - (S / 2 - _crop.y) * f;
  _cropRendre();
}
function adCropAnnuler() {
  _crop = null;
  var c = document.getElementById('ad-crop'); if (c) c.hidden = true;
  var f = document.getElementById('ad-supav-file'); if (f) f.value = '';
}
function _cropOuvrir(src) {
  var img = new Image();
  img.onload = function () {
    var stage = document.getElementById('ad-crop-stage');
    var S = (stage && stage.clientWidth) || 240;
    var kMin = S / Math.min(img.naturalWidth, img.naturalHeight);   // « cover » : l'image remplit toujours le cercle
    _crop = { img: img, S: S, kMin: kMin, k: kMin, x: 0, y: 0 };
    // Point de départ : centré horizontalement, remonté vers le tiers haut — là où se trouve une
    // tête neuf fois sur dix. C'est une AMORCE, pas une décision : le curseur fait le reste.
    _crop.x = (S - img.naturalWidth * kMin) / 2;
    _crop.y = (S - img.naturalHeight * kMin) * 0.28;
    var e = document.getElementById('ad-crop-img'); if (e) e.src = src;
    var z = document.getElementById('ad-crop-zoom'); if (z) z.value = 100;
    var c = document.getElementById('ad-crop'); if (c) c.hidden = false;
    _cropRendre();
  };
  img.onerror = function () { showToast('Image illisible.', 'err'); };
  img.src = src;
}
function adSupAvChange(ev) {
  var file = ev.target.files && ev.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (e) {
    var c = document.getElementById('ad-supav-card');
    if (c && c.classList.contains('is-closed')) adSupAvToggle();   // le recadreur a besoin d'etre visible pour se mesurer
    _cropOuvrir(e.target.result);
  };
  reader.onerror = function () { showToast('Lecture du fichier impossible.', 'err'); };
  reader.readAsDataURL(file);
}
/* Enregistrement : on redessine EXACTEMENT la fenêtre visible. La réduction se fait en demi-passes
   (une réduction directe de 3000 px à 256 px crénelle fortement), puis JPEG progressif jusqu'à
   passer sous la limite du serveur — quelle que soit la photo d'origine, on envoie petit et propre. */
function adCropValider() {
  if (!_crop) return;
  var src = _crop.img, S = _crop.S, k = _crop.k;
  var sx = -_crop.x / k, sy = -_crop.y / k, sc = S / k;          // fenêtre, en pixels de l'image d'origine
  function encode(taille, q) {
    var cur = document.createElement('canvas'); cur.width = cur.height = Math.round(sc);
    var cx = cur.getContext('2d'); cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, sx, sy, sc, sc, 0, 0, cur.width, cur.height);
    var cote = cur.width;
    while (cote > taille * 2) {
      var n = document.createElement('canvas'); n.width = n.height = Math.round(cote / 2);
      var nx = n.getContext('2d'); nx.imageSmoothingEnabled = true; nx.imageSmoothingQuality = 'high';
      nx.drawImage(cur, 0, 0, n.width, n.height); cur = n; cote = n.width;
    }
    var f = document.createElement('canvas'); f.width = f.height = taille;
    var fx = f.getContext('2d'); fx.imageSmoothingEnabled = true; fx.imageSmoothingQuality = 'high';
    fx.drawImage(cur, 0, 0, taille, taille);
    return f.toDataURL('image/jpeg', q);
  }
  var url = '', essais = [[256, 0.9], [256, 0.8], [192, 0.8], [160, 0.72], [128, 0.7]];
  for (var i = 0; i < essais.length; i++) { url = encode(essais[i][0], essais[i][1]); if (url.length < 180000) break; }
  _adSupAvEnvoi(url).then(function (r) {
    if (!r.ok) return showToast('Envoi impossible : ' + (r.err || 'erreur'), 'err');
    _adSupAvRender(url);
    adCropAnnuler();
    showToast('✓ Photo du support mise à jour : visible par tous les clients.');
  }).catch(function () { showToast('Envoi impossible.', 'err'); });
}
/* Déplacement à la souris et au doigt, molette pour zoomer. Écouteurs posés UNE fois sur la scène,
   qui est statique : la rouvrir n'en empile pas. */
(function () {
  function poser() {
    var st = document.getElementById('ad-crop-stage');
    if (!st || st._wired) return; st._wired = true;
    var d = null;
    var pos = function (ev) { var t = (ev.touches && ev.touches[0]) || ev; return { x: t.clientX, y: t.clientY }; };
    var start = function (ev) { if (!_crop) return; var p = pos(ev); d = { px: p.x, py: p.y, x: _crop.x, y: _crop.y }; ev.preventDefault(); };
    var move = function (ev) {
      if (!d || !_crop) return;
      var p = pos(ev);
      _crop.x = d.x + (p.x - d.px); _crop.y = d.y + (p.y - d.py);
      _cropRendre(); ev.preventDefault();
    };
    var end = function () { d = null; };
    st.addEventListener('mousedown', start);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
    st.addEventListener('touchstart', start, { passive: false });
    st.addEventListener('touchmove', move, { passive: false });
    st.addEventListener('touchend', end);
    st.addEventListener('wheel', function (ev) {
      if (!_crop) return;
      var z = document.getElementById('ad-crop-zoom'); if (!z) return;
      z.value = Math.min(400, Math.max(100, parseFloat(z.value) + (ev.deltaY < 0 ? 8 : -8)));
      adCropZoom(z.value); ev.preventDefault();
    }, { passive: false });
  }
  try { document.addEventListener('DOMContentLoaded', poser); } catch (e) {}
})();
try { document.addEventListener('DOMContentLoaded', adSupAvLoad); } catch (e) {}

/* ══ RÉCUPÉRATION — DÉLÉGATION, PAS D'ACCROCHE DIRECTE ═══════════════════════════════════════
   La carte Bases est REDESSINÉE à chaque rafraîchissement du panneau : un gestionnaire posé sur
   le bouton disparaîtrait au rendu suivant, et le bouton deviendrait mort sans que rien ne le
   dise. On délègue donc au document, une fois. C'est le même piège que la barre de sauvegardes
   du volet Layouts, déjà payé le 21/08. */
(function _recupBrancher() {
  if (window.__recupPret) return; window.__recupPret = true;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sortie = () => document.getElementById('recup-out');
  async function constater(uid) {
    const o = sortie(); if (!o) return;
    o.innerHTML = '<div class="aim-kpi-s" style="color:#8b93a1">Lecture des quatre bases…</div>';
    let d = null;
    try { d = await (await fetch('/api/admin/recuperation?uid=' + encodeURIComponent(uid))).json(); } catch (e) {}
    if (!d || !d.ok) { o.innerHTML = '<div class="aim-kpi-s" style="color:#ef4444">' + esc((d && d.erreur) || 'lecture impossible') + '</div>'; return; }
    let h = '';
    for (const f of d.familles) {
      const presents = f.noeuds.filter(n => n.present);
      if (!presents.length && !f.noeuds.some(n => n.erreur)) continue;   // famille absente partout : rien à montrer
      h += '<div style="margin:8px 0 3px;font-size:11px;font-weight:600;color:' + (f.divergent ? '#ffb300' : '#8b93a1') + '">'
        + esc(f.quoi) + (f.divergent ? ' · les bases DIVERGENT' : '') + '</div>';
      for (const n of f.noeuds) {
        const dét = n.erreur ? '<span style="color:#ef4444">' + esc(n.erreur) + '</span>'
          : (n.present ? esc(n.resume) : '<span style="color:#6b7280">absent</span>');
        const meilleur = n.present && f.divergent && n.richesse === f.max;
        h += '<div class="aim-kv" style="font-size:11.5px"><span>' + esc(n.noeud || '?') + '</span>'
          + '<b style="font-weight:400;color:' + (meilleur ? '#00e676' : '#e6e6e6') + '">' + dét
          + (meilleur ? ' <button type="button" class="recup-do" data-uid="' + esc(d.uid) + '" data-cle="' + esc(f.cle) + '" data-noeud="' + esc(n.noeud) + '" style="margin-left:8px;background:transparent;border:1px solid #3a3f4b;border-radius:4px;color:#e3b23a;font-size:11px;padding:2px 9px;cursor:pointer">Réaligner les 4 bases</button>' : '')
          + '</b></div>';
      }
    }
    o.innerHTML = h || '<div class="aim-kpi-s" style="color:#6b7280">Aucune donnée privée pour ce compte.</div>';
  }
  // ── Diagnostic compte par e-mail (lecture seule) ──
  function _diagBadge(ok, txt) { return '<span style="color:' + (ok ? '#00e676' : '#ef4444') + '">' + txt + '</span>'; }
  function diagRender(d) {
    const o = document.getElementById('udiag-out'); if (!o) return;
    if (!d || !d.ok) { o.innerHTML = '<div class="aim-kpi-s" style="color:#ef4444">' + _esc2((d && d.erreur) || 'diagnostic indisponible') + '</div>'; return; }
    const lig = c => c ? ('id ' + _esc2(c.id) + ' · ' + _esc2(c.nom) + ' · mdp ' + _diagBadge(c.hashPresent, c.hashPresent ? 'présent' : 'ABSENT')
      + ' · ' + (c.actif ? 'actif' : _diagBadge(false, 'inactif')) + (c.echeance ? ' · échéance ' + _esc2(String(c.echeance).slice(0, 10)) : '')) : '—';
    let rows = (d.noeuds || []).map(n => '<tr><td>' + _esc2(n.noeud) + '</td><td>'
      + (n.erreur ? _diagBadge(false, 'erreur : ' + _esc2(n.erreur))
         : (!n.present ? _diagBadge(false, 'compte ABSENT de cette base')
            : (n.doublon ? _diagBadge(false, 'DOUBLON (' + n.comptes.length + ')') + ' — ' + n.comptes.map(lig).join(' | ') : lig(n.comptes[0]))))
      + '</td></tr>').join('');
    rows += '<tr><td><b>miroir</b></td><td>' + (d.miroir ? lig(d.miroir) : _diagBadge(false, 'absent du miroir')) + '</td></tr>';
    const alertes = [];
    if (d.doublonEntreBases) alertes.push('⚠️ Identité éclatée : ' + d.idsDistincts.length + ' identifiants différents pour le même e-mail — le login peut lire le mauvais. À réunir sur un seul id.');
    if (d.hashDivergent) alertes.push('⚠️ Mot de passe présent sur certaines bases, ABSENT sur d\'autres — le login peut tomber sur la version sans mot de passe. Redéfinir le mot de passe depuis la fiche admin propage la bonne version.');
    if (d.supprime) alertes.push('⚠️ Ce compte est marqué SUPPRIMÉ (pierre tombale) — refusé au login avant même le mot de passe. À restaurer.');
    if (d.listeNoire) alertes.push('⚠️ Cet e-mail est sur la LISTE NOIRE — connexion bloquée.');
    o.innerHTML = '<div class="table-wrap"><table class="users-table" style="font-size:11px"><thead><tr><th>Base</th><th>Ce qu\'elle détient</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      + (alertes.length ? '<div style="font-size:11px;color:#ffb300;margin-top:7px;line-height:1.5">' + alertes.map(_esc2).join('<br>') + '</div>'
                        : '<div class="aim-kpi-s" style="color:#00e676;margin-top:6px">Aucune incohérence détectée entre les bases pour ce compte.</div>');
  }
  async function udiagGo(email) {
    const o = document.getElementById('udiag-out'); if (o) o.innerHTML = '<div class="aim-kpi-s" style="color:#8b93a1">Lecture des bases…</div>';
    let d = null; try { d = await (await fetch('/api/admin/user-diag?email=' + encodeURIComponent(email))).json(); } catch (e) {}
    diagRender(d);
  }
  document.addEventListener('click', async (e) => {
    const go = e.target.closest && e.target.closest('#recup-go');
    if (go) { const i = document.getElementById('recup-uid'); if (i && i.value.trim()) constater(i.value.trim()); return; }
    const gd = e.target.closest && e.target.closest('#udiag-go');
    if (gd) { const i = document.getElementById('udiag-email'); if (i && i.value.trim()) udiagGo(i.value.trim()); return; }
    const b = e.target.closest && e.target.closest('.recup-do');
    if (!b) return;
    /* PAS DE BOÎTE NATIVE (règle du desk) : la confirmation se fait SUR le bouton, en deux temps. */
    if (b.dataset.arme !== '1') { b.dataset.arme = '1'; b.dataset.libelle = b.textContent; b.textContent = 'Confirmer ?'; b.style.color = '#ffb300';
      setTimeout(() => { if (b.isConnected && b.dataset.arme === '1') { b.dataset.arme = ''; b.textContent = b.dataset.libelle; b.style.color = '#e3b23a'; } }, 4000); return; }
    b.dataset.arme = ''; b.textContent = 'Réalignement…';
    let r = null;
    try {
      r = await (await fetch('/api/admin/recuperation/realigner', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: b.dataset.uid, cle: b.dataset.cle, noeud: b.dataset.noeud }) })).json();
    } catch (err) {}
    b.textContent = (r && r.ok) ? 'Réaligné' : ((r && r.erreur) ? 'Refusé' : 'Échec');
    b.style.color = (r && r.ok) ? '#00e676' : '#ef4444';
    b.title = (r && r.ok) ? ('depuis ' + r.depuis + ' · ' + r.resume) : ((r && r.erreur) || '');
    if (r && r.ok) { const i = document.getElementById('recup-uid'); if (i && i.value.trim()) setTimeout(() => constater(i.value.trim()), 900); }
  });
})();
