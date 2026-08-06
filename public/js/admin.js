
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
    { k: 'maillog',  per: 20000, zone: '#tab-campaign', go: function(){ loadMailLog(); },
      vu: function(){ return _liveTab('campaign') && _liveSub('journal'); } },
    { k: 'apercu',   per: 45000, zone: '#tab-campaign', go: function(){ _cprevLoad(); },
      vu: function(){ return _liveTab('campaign') && _liveSub('templates'); } },
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
        var pill = document.querySelector('.live-pill[data-live="' + s.k + '"]');
        if (pill) pill.classList.toggle('live-pill--off', !vu);
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
  function admTab(name) {
    document.querySelectorAll('.rail-item').forEach(b => b.classList.toggle('rail-item--active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('tab-panel--active', p.id === 'tab-' + name));
    try { document.querySelector('.adm-main').scrollTop = 0; window.scrollTo(0, 0); } catch (e) {}
    try { if (location.hash.replace(/^#/, '').split('/')[0] !== name) history.replaceState(null, '', '#' + name); } catch (e) {}   // deep-link : F5 / partage d'URL conservent l'onglet
    if (name === 'dash') setTimeout(() => { Object.values(_amRoots).forEach(r => { try { r && r.resize && r.resize(); } catch {} }); }, 40);
    if (name === 'aimon') { loadAIMon(); setTimeout(() => { Object.values(_amRoots).forEach(r => { try { r && r.resize && r.resize(); } catch {} }); }, 60); }
    if (name === 'campaign') loadCampaign();
    if (name === 'api') loadApiKeys();
  }

  // ── Accès API : gestion des clés (liste, création une-seule-fois, révocation inline) ──
  async function loadApiKeys() {
    const tb = document.getElementById('apikeys-tbody');
    try {
      const d = await fetch('/api/admin/api-keys').then(r => r.json());
      const keys = d.keys || [];
      if (!keys.length) { tb.innerHTML = '<tr><td colspan="8" style="color:#6f6f79;">Aucune clé — générez la première ci-dessus.</td></tr>'; return; }
      const fd = ts => ts ? new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
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
  function _campFmt(ts){ try { return new Date(ts).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); } catch { return '—'; } }
  function _campMsg(t){ const e = document.getElementById('camp-msg'); if (e) e.textContent = t || ''; if (t && /[✅❌]/.test(t)) campToast(t, /❌/.test(t)); }
  function campToast(msg, isErr){
    const box = document.getElementById('camp-toasts'); if (!box) return;
    const t = document.createElement('div'); t.className = 'camp-toast' + (isErr ? ' camp-toast--err' : ''); t.textContent = msg;
    box.appendChild(t); setTimeout(function(){ t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(function(){ t.remove(); }, 320); }, 3600);
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
  }
  // ── Bibliothèque de templates (aperçu + test par template, TOUS les templates y compris one-shot) ──
  const _CAMP_TPLS = [
    { prev:'intro',       test:'intro',       name:'Bienvenue',            when:'Intro',      desc:'Présentation du desk + la semaine type (1er mail de la séquence).' },
    { prev:'decryptage',  test:'decryptage',  name:'Comprendre le marché', when:'Mardi',      desc:'Un concept macro choisi selon l\'actualité, décodé simplement.' },
    { prev:'pointmarche', test:'pointmarche', name:'Point marché',         when:'Mercredi',   desc:'Le brief du desk : séance, chiffres éco, force des devises.' },
    { prev:'mindset',     test:'mindset',     name:'Mindset',              when:'Jeudi',      mindset:true, desc:'Psychologie et discipline de trading — 25 thèmes en rotation, un par semaine. Le sélecteur permet de tous les relire.' },
    { prev:'weekly',      test:null,          name:'Récap hebdo',          when:'Samedi',     desc:'Rétrospective de la semaine, devise par devise (rendu dispo après génération du récap).' },
    { prev:'outlook',     test:'outlook',     name:'Semaine à venir',      when:'Dimanche',   desc:'L\'agenda éco trié par le desk pour la semaine qui s\'ouvre.' },
    { prev:'invitation',  test:'invitation',  name:'Invitation',           when:'Conversion', desc:'3 variantes (pro / conviviale / performance) — aperçu par variante.', variants:true },
    { prev:'app-desktop', test:'app-desktop', name:'Annonce app desktop',  when:'One-shot',   oneshot:true, desc:'Annonce de l\'application Windows/macOS (campagne app-desktop-v1).' },
    { prev:'desk-widgets', test:'desk-widgets', name:'Annonce accueil & Mon Desk', when:'One-shot', oneshot:true, desc:'Les deux nouveautés : l\'écran d\'accueil « Vue d\'ensemble », et Mon Desk — widgets composables, plusieurs dispositions, enregistrées par compte (campagne desk-widgets-v1).' },
    // ── CYCLE DE VIE (transactionnels : déclenchés par l'état du compte, pas par le calendrier).
    //    Ajoutés le 27/07 pour pouvoir les RELIRE avant de valider un rattrapage. Pas de bouton « Test »
    //    (ils s'envoient sur événement) — l'aperçu suffit à vérifier le rendu.
    { prev:'trial-upsell',   test:null, name:'Fin d\'essai gratuit',  when:'Auto · fin d\'essai',  lifecycle:'trial-upsell', desc:'Part le jour où l\'essai expire. Rattrapage possible via « Comptes sans ce mail ».' },
    { prev:'expired',        test:null, name:'Abonnement expiré',     when:'Auto · à l\'échéance', lifecycle:'expired',      desc:'Part quand l\'abonnement payant arrive à échéance.' },
    { prev:'expired-7j',     test:null, name:'Relance J+7',           when:'Auto · J+7',           lifecycle:'expired-7j',   desc:'Dernier rappel automatique, 7 jours après l\'expiration si toujours pas renouvelé.' },
    { prev:'winback',        test:null, name:'Win-back (jalons)',     when:'Auto · 1/3/6/12 mois', winback:true,             desc:'« Ça fait X que vous nous avez quittés » — 4 jalons après le départ, copy adaptée à l\'ancienneté.' },
    { prev:'temoignage',     test:null, name:'Témoignage membre',     when:'Manuel · validation',  desc:'Un avis Whop réel + l\'histoire de JustOneTrader et du terminal. Ne part JAMAIS seul : aperçu pour validation.' },
    { prev:'reengagement',   test:null, name:'Réengagement',          when:'Auto · inactif 7j',    desc:'Relance d\'un client inactif depuis ~7 jours.' },
    { prev:'renewal-failed', test:null, name:'Renouvellement échoué', when:'Auto · sur échec',     desc:'Envoyé quand un paiement échoue / le compte est suspendu.' },
    { prev:"auto-renew-off", test:null, name:"Renouvellement auto coupé", when:"Auto · à la coupure", desc:"Part quand un client désactive la reconduction côté Whop. L'accès reste actif jusqu'à l'échéance — le mail informe, une seule fois par échéance." },
    { prev:'welcome',        test:null, name:'Bienvenue (accès)',     when:'Auto · création',      desc:'Identifiants d\'accès envoyés à la création du compte.' },
  ];
  // Liste maître (gauche) : un clic sélectionne le template → l'aperçu se charge à DROITE, les
  // actions contextuelles (variantes / test / rattrapage) suivent dans la barre au-dessus du cadre.
  function _campTplRender(){
    const g = document.getElementById('camp-tpl-grid'); if (!g || g.dataset.done) return;
    g.dataset.done = '1';
    g.innerHTML = _CAMP_TPLS.map(function(t){
      return '<button type="button" class="tpl-item" data-tpl="' + t.prev + '" onclick="tplSelect(\'' + t.prev + '\')">'
        + '<span class="tpl-item-name">' + t.name + '</span>'
        + '<span class="tpl-when' + (t.oneshot ? ' tpl-when--oneshot' : '') + '">' + t.when + '</span></button>';
    }).join('');
  }
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
    var a = document.getElementById('cprev-actions'); if (a) a.innerHTML = acts.join('');
    if (t.mindset) _msFill();
    if (t.variants) campPreviewInvit(0);
    else if (t.winback) campPreviewWinback(3);
    else { window._cprevConcept = null; campPreview(t.prev); }
  }
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
      document.getElementById('lc-title').textContent = d.label + ' — comptes sans ce mail';
      if (!_lcRows.length) {
        body.innerHTML = '<div class="empty-state">Aucun compte en attente : tous ceux dont l\'échéance est passée ont déjà reçu ce mail (' + d.alreadySent + ' au total).</div>';
        return;
      }
      body.innerHTML =
        '<p class="hint" style="margin-bottom:10px">' + _lcRows.length + ' compte(s) dont l\'échéance est passée n\'ont jamais reçu ce mail'
        + (d.alreadySent ? ' · ' + d.alreadySent + ' déjà servi(s)' : '')
        + '. Coche ceux à relancer — un envoi par compte, jamais de doublon.</p>'
        + '<div class="row-inline" style="margin-bottom:8px"><button class="btn" onclick="lifecycleAll(1)">Tout cocher</button>'
        + '<button class="btn" onclick="lifecycleAll(0)">Tout décocher</button></div>'
        + '<div class="table-wrap"><table class="users-table"><thead><tr><th style="width:34px"></th><th>E-mail</th><th>Échéance</th><th>Ancienneté</th><th>État</th></tr></thead><tbody>'
        + _lcRows.map(function(u, i){
            const vieux = u.joursDepuis > 30;
            return '<tr><td><input type="checkbox" class="lc-ck" data-email="' + _escH(u.email) + '"'
              + (vieux || u.donneeIncoherente ? '' : ' checked') + ' style="width:auto"></td>'
              + '<td>' + _escH(u.email) + '</td>'
              + '<td>' + (u.expiresAt ? String(u.expiresAt).slice(0, 10) : '—') + '</td>'
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
    const box = document.getElementById('camp-dash-kpis');
    if (box && !box.children.length) box.innerHTML = new Array(12).fill('<div class="skel" style="height:96px"></div>').join('');
    try {
      const d = await fetch('/api/admin/campaign-dashboard').then(function(r){ return r.json(); });
      if (!d || !d.kpis) return;
      const k = d.kpis;
      const last = k.lastCampaign, next = k.nextCampaign;
      const cards = [
        { ic:'users', c:'#e3b23a', v:k.total, l:'Destinataires uniques', t:'Total dédupliqué : DTP + Whop + manuel' },
        { ic:'user-check', c:'#00e676', v:k.active, l:'Actifs', t:'Abonnement en cours' },
        { ic:'crown', c:'#e3b23a', v:k.premium, l:'Clients Premium', t:'Abonnés actifs (payants)' },
        { ic:'user-plus', c:'#8b93a1', v:k.lead, l:'Leads', t:'Contacts sans abonnement' },
        { ic:'user-minus', c:'#ffb300', v:k.churn, l:'Churn', t:'Résiliés / expirés : cibles win-back' },
        { ic:'clock', c:'#ffb300', v:k.expired, l:'Comptes expirés', t:'Abonnement terminé' },
        { ic:'bell-off', c:'#ff3d00', v:k.unsub, l:'Désabonnés', t:'Opt-out e-mail (exclus)' },
        { ic:'ban', c:'#ff3d00', v:k.blacklist, l:'Blacklist', t:'E-mails bloqués partout' },
        { ic:'mail-open', c:'#3aa0e0', v:k.openRate + '%', l:'Taux d’ouverture', t:'Ouvertures uniques / envoyés' },
        { ic:'pointer', c:'#3aa0e0', v:k.ctr + '%', l:'CTR', t:'Clics uniques / envoyés' },
        { ic:'send', c:'#9aa3b2', v:last ? _campFmt(last.sentAt) : '—', l:'Dernière campagne', t:last ? (last.title + ' · ' + last.sent + ' envoyés') : 'Aucune campagne envoyée' },
        { ic:'calendar', c:'#9aa3b2', v:next ? ('S' + next.week) : '—', l:'Prochaine campagne', t:next ? (next.title + ' : non programmée') : 'Séquence terminée' }
      ];
      box.innerHTML = cards.map(function(c){
        return '<div class="kpi-card" style="--kc:' + c.c + '" title="' + String(c.t).replace(/"/g,'') + '"><div class="kpi-top"><div class="kpi-ic">' + _lucide(c.ic) + '</div></div><div class="kpi-val">' + c.v + '</div><div class="kpi-lbl">' + c.l + '</div></div>';
      }).join('');
      const dv = d.deliverability, ch = dv.checks;
      // « Score 100 » était une CONSTANTE côté serveur : rien n'était mesuré. On ne remplace pas un
      // faux chiffre par un autre — l'anneau disparaît et la section dit ce qu'elle est vraiment.
      const dlab = function(s){ return s === 'pass' ? 'Validé' : (s === 'info' ? 'À surveiller' : (s === 'declare' ? 'Déclaré' : 'Échec')); };
      const dcls = function(s){ return s === 'pass' ? 'pass' : (s === 'info' ? 'info' : (s === 'declare' ? 'info' : 'fail')); };
      const rows = [['SPF',ch.spf],['DKIM',ch.dkim],['DMARC',ch.dmarc],['SMTP',ch.smtp],['Blacklist',ch.blacklist]];
      document.getElementById('camp-deliv').innerHTML =
        '<div class="deliv-wrap"><div class="deliv-rows">' +
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
          + '<div class="camp-aud-src">Sources : ' + r.dtpAccounts + ' comptes DTP · ' + r.whopContacts + ' Whop · ' + r.manualExtra + ' manuels · ' + r.inMultipleSources + ' en commun · exclus : ' + r.excludedBlacklist + ' blacklist, ' + r.excludedUnsub + ' désabonnés</div>';
      } else ael.textContent = 'Audience indisponible.';
    } catch { ael.textContent = 'Erreur de chargement de l’audience.'; }
    loadDashboard();
    loadMaster();
    loadCampErrors();
    loadCampStats();
    loadBlacklist();
    loadGiftAccess();
    loadSequence();
    var _rp = document.getElementById('camp-recip-panel'); if (_rp && _rp.style.display !== 'none') renderRecipients();
  }
  let _campStatRows = [], _campStatFilter = 'all';
  function campStatFilter(f){ _campStatFilter = f; renderCampStatRows(); }
  function renderCampStatRows(){
    var rows = _campStatRows;
    if (_campStatFilter === 'opened')    rows = rows.filter(function(r){ return (r.opens||0) > 0; });
    if (_campStatFilter === 'notopened') rows = rows.filter(function(r){ return !(r.opens||0); });
    if (_campStatFilter === 'clicked')   rows = rows.filter(function(r){ return (r.clicks||0) > 0; });
    if (_campStatFilter === 'unsub')     rows = rows.filter(function(r){ return !!r.unsubAt; });
    // chips de filtre avec compteurs (l'actif est dore)
    var all = _campStatRows, nOpen = all.filter(function(r){ return (r.opens||0)>0; }).length;
    var nClick = all.filter(function(r){ return (r.clicks||0)>0; }).length;
    var nUnsub = all.filter(function(r){ return !!r.unsubAt; }).length;
    var chips = [ ['all','Tous',all.length], ['opened','✓ Ont ouvert',nOpen], ['notopened','✗ N’ont pas ouvert',all.length-nOpen], ['clicked','↗ Ont cliqué',nClick], ['unsub','⊘ Désabonnés',nUnsub] ];
    document.getElementById('camp-stat-filters').innerHTML = chips.map(function(c){
      var on = _campStatFilter === c[0];
      return '<button class="camp-chip" onclick="campStatFilter(\'' + c[0] + '\')" style="cursor:pointer;background:' + (on ? 'rgba(227,178,58,.14)' : 'rgba(255,255,255,.03)') + ';color:' + (on ? '#e3b23a' : '#8b93a1') + ';border-color:' + (on ? 'rgba(227,178,58,.5)' : '#33333a') + ';">' + c[1] + ' (' + c[2] + ')</button>';
    }).join('');
    // Colonne DEDIEE « Désabonné » : badge rouge + date de desinscription, ou : s'il est toujours abonne.
    // (Les clics restent lisibles dans la colonne « Clics » + le filtre « Ont cliqué ».)
    var _desabo = function(r){
      if (!r.unsubAt) return '<span style="color:#565660;">—</span>';
      return '<span style="display:inline-block;color:#ff6b57;border:1px solid rgba(255,61,0,.4);border-radius:4px;font-size:11px;font-weight:700;padding:1px 7px;">⊘ Désabonné</span> <span style="color:#8b93a1;font-size:11px;">' + _campFmt(r.unsubAt) + '</span>';
    };
    var tb = document.querySelector('#camp-recipients tbody');
    tb.innerHTML = rows.length ? rows.map(function(r){ return '<tr' + (r.unsubAt ? ' style="opacity:.6;"' : '') + '><td>' + r.email + '</td><td>' + (r.sentAt ? _campFmt(r.sentAt) : '—') + '</td><td>' + (r.opens||0) + '</td><td>' + (r.clicks||0) + '</td><td>' + (r.lastOpen ? _campFmt(r.lastOpen) : '—') + '</td><td>' + _desabo(r) + '</td></tr>'; }).join('')
      : '<tr><td colspan="6" class="empty-state">' + (_campStatRows.length ? 'Aucun destinataire dans ce filtre.' : 'Aucun envoi pour l’instant.') + '</td></tr>';
  }
  // Sélecteur de campagne pour les statistiques (l'ancien code figeait intro-v1 : le drip hebdo,
  // le digest et les nouveaux templates étaient invisibles dans la vue Statistiques).
  // « Total » = vue consolidée de TOUTES les campagnes, et c'est le DÉFAUT (demande user 26/07) : on veut
  // d'abord voir la performance globale, puis creuser par contenu.
  let _campStatsId = 'all';
  const _CAMP_STAT_IDS = [ ['all', 'Total'], ['intro-v1', 'Bienvenue'], ['decryptage', 'Comprendre le marché'], ['point-marche', 'Point marché'], ['mindset', 'Mindset'], ['outlook-hebdo', 'Semaine à venir'], ['app-desktop-v1', 'Annonce app desktop'], ['desk-widgets-v1', 'Annonce accueil & Mon Desk'] ];
  // Export CSV du tableau AFFICHÉ (respecte le filtre actif) — réutilise les lignes déjà chargées, zéro fetch.
  function campStatsExport(){
    var rows = _campStatRows;
    if (_campStatFilter === 'opened')    rows = rows.filter(function(r){ return (r.opens||0) > 0; });
    if (_campStatFilter === 'notopened') rows = rows.filter(function(r){ return !(r.opens||0); });
    if (_campStatFilter === 'clicked')   rows = rows.filter(function(r){ return (r.clicks||0) > 0; });
    if (_campStatFilter === 'unsub')     rows = rows.filter(function(r){ return !!r.unsubAt; });
    if (!rows.length) { _campMsg('❌ Rien à exporter dans ce filtre.'); return; }
    var esc = function(v){ v = String(v == null ? '' : v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csv = 'email;envoye;ouvertures;clics;derniere_ouverture;desabonne\n' + rows.map(function(r){
      return [r.email, r.sentAt ? new Date(r.sentAt).toISOString() : '', r.opens||0, r.clicks||0, r.lastOpen ? new Date(r.lastOpen).toISOString() : '', r.unsubAt ? new Date(r.unsubAt).toISOString() : ''].map(esc).join(';');
    }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));   // BOM → accents OK dans Excel
    a.download = 'stats-' + _campStatsId + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    _campMsg('✅ CSV exporté (' + rows.length + ' lignes).');
  }
  function _campStatsPick(id){ _campStatsId = id; loadCampStats(); }
  function _renderCampSel(){
    const host = document.getElementById('camp-campsel'); if (!host) return;
    // « Total » est mis en avant (classe --total : séparateur + libellé or) : c'est une vue d'une autre
    // nature que les campagnes individuelles qui suivent.
    host.innerHTML = _CAMP_STAT_IDS.map(function(c){
      const on = c[0] === _campStatsId;
      return '<button class="camp-btn camp-selbtn' + (c[0] === 'all' ? ' camp-selbtn--total' : '') + (on ? ' camp-selbtn--on' : '')
        + '" onclick="_campStatsPick(\'' + c[0] + '\')">' + c[1] + '</button>';
    }).join('');
  }
  async function loadCampStats(){
    try {
      _renderCampSel();
      const d = await fetch('/api/admin/campaign-stats?campaign=' + encodeURIComponent(_campStatsId)).then(r => r.json());
      if (!d || !d.summary) return;
      const s = d.summary;
      const kpis = [ ['Envoyés', s.sent], ['Ouvertures uniques', s.uniqueOpens + ' (' + s.openRate + '%)'],
        ['Ouvertures totales', s.totalOpens], ['Clics uniques', s.uniqueClicks + ' (' + s.clickRate + '%)'],
        ['Clics totaux', s.totalClicks], ['Désabonnés', s.unsub] ];
      document.getElementById('camp-kpis').innerHTML = kpis.map(function(kv){ return '<div class="camp-kpi"><div class="camp-kpi-v">' + kv[1] + '</div><div class="camp-kpi-k">' + kv[0] + '</div></div>'; }).join('');
      _campStatRows = (d.recipients || []);
      renderCampStatRows();
      // En vue Total, « envoyés » = personnes TOUCHÉES au moins une fois (fusion par destinataire) : on le
      // dit explicitement, sinon le chiffre paraît incohérent avec la somme des campagnes.
      const sub = document.getElementById('camp-stats-sub');
      if (sub) sub.textContent = (_campStatsId === 'all')
        ? s.sent + ' destinataire' + (s.sent > 1 ? 's' : '') + ' touché' + (s.sent > 1 ? 's' : '') + ' (toutes campagnes) · ' + s.uniqueOpens + ' ayant ouvert'
        : s.sent + ' envoyé' + (s.sent > 1 ? 's' : '') + ' · ' + s.uniqueOpens + ' ouvert' + (s.uniqueOpens > 1 ? 's' : '');
    } catch {}
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
        ? list.map(function(e){ return '<div class="camp-bl-row"><span class="camp-bl-em">' + e + '</span><button class="camp-bl-x" onclick="blRemove(\'' + encodeURIComponent(e) + '\')">retirer</button></div>'; }).join('')
        : '<div class="empty-state">Aucun e-mail en liste noire.</div>';
    } catch {}
  }
  async function blAdd(){
    const inp = document.getElementById('camp-bl-input'); const v = (inp.value || '').trim(); if (!v) return;
    _campMsg('Ajout à la liste noire…');
    try {
      const d = await fetch('/api/admin/blacklist?action=add&emails=' + encodeURIComponent(v)).then(r => r.json());
      _campMsg(d.ok ? ('✅ ' + d.added + ' blacklisté(s) : ' + d.total + ' au total') : '❌ échec');
      inp.value = ''; loadBlacklist(); loadCampaign();
    } catch { _campMsg('❌ Erreur réseau.'); }
  }
  async function blRemove(encEmail){
    const email = decodeURIComponent(encEmail);
    _campMsg('Retrait de ' + email + '…');
    try {
      const d = await fetch('/api/admin/blacklist?action=remove&email=' + encodeURIComponent(email)).then(r => r.json());
      _campMsg(d.ok ? ('✅ retiré : ' + d.total + ' restant(s)') : '❌ échec');
      loadBlacklist(); loadCampaign();
    } catch { _campMsg('❌ Erreur réseau.'); }
  }
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
        const when = r.ts ? new Date(r.ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
        const cls = /Désinscription/.test(r.type) ? 'badge-expired'
          : /Campagne/.test(r.type) ? 'badge-client'
          : /Bienvenue|Renouvellement/.test(r.type) ? 'badge-pro'
          : 'badge-essai';   // cycle de vie (essai, expiré, relances, jalons) → or
        return '<tr><td style="font-family:var(--font-mono);font-size:11px;color:var(--text3);white-space:nowrap">' + when + '</td>'
          + '<td><span class="badge ' + cls + '">' + r.type + '</span></td>'
          + '<td class="email">' + r.dest + '</td></tr>';
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
            return '<div class="camp-bl-row"><span class="camp-bl-em">' + e + '</span>' +
              (seed.indexOf(e) >= 0
                ? '<span class="camp-bl-x" style="opacity:.55;cursor:default">fixé dans le code</span>'
                : '<button class="camp-bl-x" onclick="giftRemove(\'' + encodeURIComponent(e) + '\')">retirer</button>') +
              '</div>';
          }).join('')
        : '<div class="empty-state">Aucun accès offert exempté.</div>';
    } catch {}
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
      return '<div class="camp-recip-row"><span class="camp-recip-em">' + r.email + '</span>'
        + '<span class="camp-chip camp-chip--' + chip + '">' + seg + '</span>'
        + '<span class="camp-recip-src">' + (r.src || '') + '</span></div>';
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
      const title = mode === 'test' ? ('Mode TEST — tout part sur ' + (d.testEmail || 'ta boîte')) : mode === 'official' ? 'Campagne OFFICIELLE (audience réelle)' : 'Campagne en pause';
      const statusBig = '<div style="display:flex;align-items:center;gap:10px;"><span style="width:12px;height:12px;border-radius:50%;background:' + dot + ';box-shadow:0 0 12px ' + dot + ';"></span><span style="font-size:18px;font-weight:800;color:' + dot + ';">' + title + '</span></div>';
      const rows = [
        ['Prochain e-mail', '<b style="color:#e3b23a;">' + (d.nextTemplate || '—') + '</b>'],
        ['Quand', d.active ? (d.nextWhen || '—') : 'en pause tant que non lancée'],
        ['Destinataire', mode === 'test' ? ('<span style="color:#e3b23a;">🧪 ' + _escH(d.testEmail || '') + ' (test)</span>') : mode === 'official' ? ('<b style="color:#fff;">' + (d.contactsTracked || 0) + '</b> contacts (réel)') : '—'],
        ['Calendrier', '<span style="color:#8b93a1;">' + (d.sequence || []).join(' → ') + '</span>'],
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
    const noteMap = { 'activate-test': '🧪 Mode test activé — chaque e-mail arrivera sur ta boîte, le bon jour', 'activate-official': '🚀 Campagne OFFICIELLE lancée (audience réelle)', 'pause': '⏸ Campagne mise en pause' };
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
        if (ts) ts.textContent = '⟳ Déploiement en cours — nouvel essai (' + window._cprevRetryCount + '/5)…';
        if (window._cprevRetryCount <= 5) window._cprevRetryT = setTimeout(_cprevLoad, 6000);
        else if (ts) ts.textContent = '⚠ Aperçu indisponible — nouvel essai automatique dans moins d’une minute.';
        return;
      }
      window._cprevRetryCount = 0;
      if (ts) ts.textContent = '● En direct · MAJ ' + new Date().toLocaleTimeString('fr-FR') + ' —';
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
  function _errWhen(ts){ try { return new Date(ts).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}); } catch { return ''; } }
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
        return '<tr><td style="padding:8px 10px 8px 0;border-top:1px solid #1f1f24;vertical-align:top;white-space:nowrap;color:#8b93a1;font-size:11.5px;">' + _errWhen(e.at) + '</td>'
          + '<td style="padding:8px 10px 8px 0;border-top:1px solid #1f1f24;vertical-align:top;"><span style="color:' + col + ';font-weight:700;font-size:11px;">' + (e.level==='critical'?'CRITIQUE':'ALERTE') + '</span> <span style="color:#cbd5e1;font-size:11.5px;">' + _escH(e.campaign) + '</span></td>'
          + '<td style="padding:8px 0;border-top:1px solid #1f1f24;vertical-align:top;color:#cbd5e1;font-size:12.5px;">' + _escH(e.cause) + (e.actions?('<div style="color:#8b93a1;font-size:11.5px;margin-top:3px;">→ ' + _escH(e.actions) + '</div>'):'') + '</td></tr>';
      }).join('');
      body.innerHTML = pausedBanner + '<table style="width:100%;border-collapse:collapse;">' + rows + '</table>';
    } catch { body.textContent = 'Erreur de chargement.'; }
  }
  // ── Sequence / supervision hebdo ──
  async function loadSequence(){
    try {
      const d = await fetch('/api/admin/campaign-sequence').then(r => r.json());
      if (!d || !d.steps) return;
      const sub = document.getElementById('camp-seq-sub');
      if (sub) sub.textContent = (d.weekRange ? 'Semaine du ' + d.weekRange : '')
        + (d.rotation ? ' · Cette semaine : ' + d.rotation.title + (d.rotation.sentThisWeek ? ' · envoyé ✓' : ' · à venir') : '');
      // Bandeau d'état — reflète le bouton « La Campagne » : à l'arrêt → tout est figé ; en marche → reprend au bon jour/heure.
      const bStyle = 'display:block;padding:9px 12px;border-radius:6px;font-size:12.5px;font-weight:600;margin:0 0 10px;';
      const stateBanner = !d.active
        ? '<div style="' + bStyle + 'background:rgba(139,147,161,.12);border:1px solid #33333a;color:#c9ced8;">⏸ Campagne à l\'arrêt — aucun e-mail ne part. À la reprise, elle repart automatiquement au bon jour selon l\'heure (le prochain envoi est indiqué ci-dessous).</div>'
        : (d.testMode
          ? '<div style="' + bStyle + 'background:rgba(227,178,58,.1);border:1px solid rgba(227,178,58,.35);color:#e3b23a;">🧪 Mode TEST actif — chaque e-mail part uniquement sur ta boîte, le bon jour. Aucun client touché.</div>'
          : '<div style="' + bStyle + 'background:rgba(0,230,118,.1);border:1px solid rgba(0,230,118,.3);color:#00e676;">● Campagne active (envoi réel) — 1 e-mail par semaine (rotation) : le contenu de la semaine part à toute l\'audience, le bon jour. Ça repart automatiquement chaque semaine.</div>');
      const _fmtMonday = ts => { try { return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }); } catch { return ''; } };
      // Bandeau « Dernier parti → Prochain envoi » : la réponse directe à « c'est lequel le prochain ? »
      // dès qu'un mail est parti (demande user 26/07). Données serveur (lastSend/nextSend), rien de calculé ici.
      let flightStrip = '';
      if (d.nextSend) {
        flightStrip = '<div style="display:flex;flex-wrap:wrap;gap:8px 22px;align-items:center;padding:10px 12px;border:1px solid rgba(227,178,58,.35);background:rgba(227,178,58,.06);border-radius:6px;margin:0 0 10px;">'
          + '<span style="font-size:12.5px;color:#e3b23a;font-weight:700;">⏭ Prochain envoi : ' + d.nextSend.title + ' — ' + d.nextSend.when + '</span>'
          + (d.lastSend ? '<span style="font-size:12px;color:#8b93a1;">✉️ Dernier parti : <strong style="color:#c9ced8;font-weight:600;">' + d.lastSend.title + '</strong> — ' + _campFmt(d.lastSend.ts) + '</span>' : '')
          + '</div>';
      }
      // ENCADRÉ « prochain à partir » (28/07) : le contenu de la semaine s'il n'est PAS encore parti,
      // sinon la rotation la plus proche — l'encadré se réajuste tout seul après chaque envoi.
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
        else if (!s.thisWeek && s.nextRunMonday) timeLine = '<div class="camp-seq-desc" style="color:#8b93a1;margin-top:3px;">🔁 Prochaine diffusion : semaine du ' + _fmtMonday(s.nextRunMonday) + '</div>';
        else if (s.when) timeLine = '<div class="camp-seq-desc" style="color:#e3b23a;opacity:.9;margin-top:3px;">🕐 ' + s.when + '</div>';
        // Métriques = historique cumulé (dernier envoi + total + taux), pour le suivi de performance.
        const metrics = s.lastSentAt ? '<div class="camp-seq-metrics">Dernier envoi ' + _campFmt(s.lastSentAt) + ' · ' + s.sent + ' au total · ' + s.openRate + '% ouv. · ' + s.clickRate + '% clics</div>' : '';
        const dim = (!isIntro && !s.thisWeek) ? ' style="opacity:.62;"' : ((!d.active && !doneWeek) ? ' style="opacity:.55;"' : '');
        return '<div class="camp-seq-row camp-seq-row--' + cls + ((s.id === _nextFrameId && d.active) ? ' camp-seq-row--next' : '') + '"' + dim + '><div class="camp-seq-wk">' + wk + '</div>'
          + '<div class="camp-seq-main"><div class="camp-seq-title">' + s.title + ' <span class="camp-seq-pill">' + s.pillar + '</span>' + weekBadge + '</div>'
          + '<div class="camp-seq-desc">' + s.desc + '</div>'
          + timeLine
          + metrics + '</div>'
          + '<div class="camp-seq-status camp-seq-status--' + cls + '">' + status + '</div></div>';
      }).join('');
      document.getElementById('camp-seq-list').innerHTML = stateBanner + flightStrip + rowsHtml;
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
  const AIM_PCOL = { groq: 0xec4899, gemini: 0x60a5fa, github: 0xa78bfa, openrouter: 0x00cc99, cohere: 0x38bdf8, xai: 0x94a3b8, claude: 0xe3b23a };
  const AIM_PLBL = { groq: 'Groq', gemini: 'Gemini', github: 'GitHub', openrouter: 'OpenRouter', cohere: 'Cohere', xai: 'xAI', claude: 'Claude' };
  const _hcol = s => s == null ? '#6b7280' : s >= 75 ? '#22c55e' : s >= 40 ? '#ffb300' : '#ef4444';
  function aimRenderKpis(d) {
    const b = d.budget, g = (d.providers || {}).gemini || {};
    const riskLbl = { low: 'Faible', medium: 'Modéré', high: 'Élevé', exhausted: 'Épuisé', unknown: '—' }[b.risk] || b.risk;
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
    const g = P.gemini || {}, gh = P.github || {}, or = P.openrouter || {}, cl = P.claude || {}, gr = P.groq || {}, co = P.cohere || {}, xa = P.xai || {};
    const card = (label, tier, score, rows, chips) => {
      const col = _hcol(score);
      return `<div class="aim-prov"><div class="aim-prov-top"><span class="aim-prov-dot" style="background:${col};box-shadow:0 0 5px ${col}66"></span><span class="aim-prov-name">${label} <small>${tier}</small></span><span class="aim-prov-score" style="color:${col}">${score == null ? '—' : score}</span></div>`
        + `<div class="aim-prov-bar"><i style="width:${score == null ? 0 : score}%;background:${col}"></i></div>`
        + rows.map(r => `<div class="aim-kv"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')
        + (chips && chips.length ? `<div class="aim-chips">${chips.join('')}</div>` : '')
        + `</div>`;
    };
    const chip = (txt, cls) => `<span class="aim-chip${cls ? ' ' + cls : ''}">${txt}</span>`;
    document.getElementById('aim-providers').innerHTML =
      card('Groq', 'gratuit', h.groq, gr.keys ? [
        ['Clés', gr.keys + ''], ['Appels aujourd’hui', gr.callsToday + ''], ['Échecs (jour)', (gr.failToday || 0) + ''], ['Modèles', gr.models + ''],
      ] : [['État', 'non configuré']], gr.keys ? [chip('fournisseur principal', 'aim-chip--ok'), gr.coolingKeys ? chip(gr.coolingKeys + ' clé(s) en cooldown') : chip('nominal · rapide', 'aim-chip--ok')] : [])
      + card('Gemini', 'gratuit', h.gemini, [
        ['Clés', g.keys + ' (' + (g.coolingKeys || 0) + ' gelées)'], ['Appels aujourd’hui', g.callsToday + ''], ['Erreurs 429', g.err429Today + ''], ['RPM effectif', (g.effRpm || 0) + ' / ' + (g.rpmTarget || 0)],
      ], [chip('repli n°1'), g.coolingKeys ? chip(g.coolingKeys + ' clé(s) en cooldown') : chip('clés OK', 'aim-chip--ok'), g.breakersOpen ? chip(g.breakersOpen + ' breaker ouvert') : ''].filter(Boolean))
      + card('GitHub Models', 'gratuit', h.github, gh.tokens ? [
        ['Tokens × modèles', gh.tokens + ' × ' + (gh.models || 1)], ['Appels aujourd’hui', gh.callsToday + ''], ['Échecs (jour)', (gh.failToday || 0) + ''],
      ] : [['État', 'non configuré']], gh.tokens ? [gh.coolingKeys ? chip(gh.coolingKeys + ' (modèle,token) gelés') : chip('nominal', 'aim-chip--ok')] : [])
      + card('OpenRouter', 'gratuit', h.openrouter, or.keys ? [
        ['Clés (comptes)', or.keys + ' · ~' + (or.keys * 50) + ' req/j'], ['Appels aujourd’hui', or.callsToday + ''], ['Échecs (jour)', (or.failToday || 0) + ''], ['Modèles :free', or.models + ''],
      ] : [['État', 'non configuré']], or.keys ? [or.coolingKeys ? chip(or.coolingKeys + ' en cooldown') : chip('nominal', 'aim-chip--ok')] : [])
      + card('Cohere', 'gratuit', h.cohere, co.keys ? [
        ['Clés', co.keys + ''], ['Appels aujourd’hui', co.callsToday + ''], ['Échecs (jour)', (co.failToday || 0) + ''], ['Modèles', co.models + ''],
      ] : [['État', 'non configuré']], co.keys ? [co.coolingKeys ? chip(co.coolingKeys + ' clé(s) en cooldown') : chip('nominal · trial', 'aim-chip--ok')] : [])
      + card('xAI (Grok)', 'payant', h.xai, xa.keys ? [
        ['Clés', xa.keys + ''], ['Appels aujourd’hui', xa.callsToday + ''], ['Échecs (jour)', (xa.failToday || 0) + ''], ['Modèles', xa.models + ''],
      ] : [['État', 'non configuré']], xa.keys ? [chip('repli payant avant Claude'), xa.coolingKeys ? chip(xa.coolingKeys + ' clé(s) en cooldown', 'aim-chip--bad') : ''].filter(Boolean) : [])
      + card('Claude', 'payant', h.claude, cl.keys ? [
        ['Clés', cl.keys + ''], ['Utilisé (jour)', cl.usedToday + ' / ' + cl.dailyMax], ['Disponibilité', cl.usable ? 'disponible' : 'indisponible'],
      ] : [['État', 'non configuré']], cl.keys ? [cl.usable ? chip('réservé macro importante', 'aim-chip--ok') : chip('crédit épuisé', 'aim-chip--bad'), (cl.cooling && cl.cooling.length) ? chip(cl.cooling.length + ' clé(s) en cooldown') : ''].filter(Boolean) : []);
    const sub = document.getElementById('aim-prov-sub');
    if (sub) { const scores = [h.gemini, h.groq, h.github, h.openrouter, h.cohere, h.xai, h.claude].filter(s => s != null); sub.textContent = scores.length ? ('santé moyenne ' + Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) + '/100') : ''; }
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
      return `<div class="aim-fc-row"><span>Projection fin de mois</span><b style="color:${col}">${b.monthProjected} <span style="color:#6b7280">/ ${b.monthly} · ${b.daysLeftMonth || '—'} j restants</span></b></div>`;
    })() : '';
    // Efficacité du cache à la demande + requêtes économisées (coalescing / cooldown de panne)
    const cacheRows = d.cache ? (() => {
      const c = d.cache, pc = o => { const t = (o && ((o.hit || 0) + (o.miss || 0))) || 0; return t ? Math.round((o.hit || 0) / t * 100) + '%' : '—'; };
      return `<div class="aim-fc-row"><span>Cache à la demande (hit)</span><b>info ${pc(c.info)} · analyse ${pc(c.analyse)} · réaction ${pc(c.react)}</b></div>`
        + `<div class="aim-fc-row"><span>Requêtes économisées</span><b>${(c.coalesced || 0)} coalescées · ${(c.coolskip || 0)} évitées (panne)</b></div>`
        + (c.usersIdle ? `<div class="aim-fc-row"><span>Activité</span><b style="color:#ffb300">personne connecté : fond au ralenti</b></div>` : '');
    })() : '';
    document.getElementById('aim-forecast').innerHTML =
      `<div class="aim-fc-row"><span>Quota restant</span><b>${b.remaining}</b></div>`
      + `<div class="aim-fc-row"><span>Épuisement estimé</span><b>${b.hoursToExhaust != null ? ('~' + b.hoursToExhaust + ' h') : '—'}</b></div>`
      + projRow
      + `<div class="aim-fc-row"><span>Préchauffage de fond</span><b>${b.prewarmActive === false ? (b.quietHours ? 'PAUSE (nuit)' : (b.prePeak === false ? 'PAUSE (creux)' : 'PAUSE (budget)')) : b.prewarmActive ? 'actif' : '—'}</b></div>`
      + `<div class="aim-fc-row"><span>Pré-pic appris</span><b>${b.prePeak === true ? 'OUI (on prépare)' : b.prePeak === false ? 'non (creux)' : 'apprentissage (' + (b.learnedSlots || 0) + '/24)'}</b></div>`
      + cacheRows
      + `<div class="aim-sec-title">Demande attendue (apprise)</div>` + nh;
  }
  function aimRenderInfra(d) {
    document.getElementById('aim-mail').innerHTML = (() => {
      const M = d.mail; if (!M) return '<div class="aim-j-empty">indisponible</div>';
      const ovhOk = !!(M.ovh && M.ovh.configured);
      return `<div class="aim-kv"><span>Canal principal</span><b style="color:${ovhOk ? '#22c55e' : '#ef4444'}">${ovhOk ? 'OVH SMTP ✓' : 'non configuré'}</b></div>`
        + `<div class="aim-kv"><span>Dernier canal</span><b>${M.lastProvider || '—'}</b></div>`
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
    document.getElementById('aim-db').innerHTML = (() => {
      const DB = d.db; if (!DB || !DB.nodes || !DB.nodes.length) return '<div class="aim-j-empty">sondes en cours…</div>';
      const col = s => s === 'ok' ? '#22c55e' : s === 'restreint' ? '#ef4444' : '#ffb300';
      const lbl = s => s === 'ok' ? 'OK ✓' : s === 'restreint' ? 'RESTREINT' : 'erreur';
      const rows = DB.nodes.map(n => `<div class="aim-kv"><span title="${_esc2(n.host)}">${_esc2(n.name)}</span><b style="color:${col(n.state)}">${lbl(n.state)} <span style="color:#6b7280;font-weight:400">${n.ms} ms</span></b></div>`).join('');
      const KA = DB.keepalive;   // anti-pause free-tier : WRITE sur chaque base /12 h (ingress → marche même en 402)
      const kaLine = (KA && KA.last) ? `<div class="aim-kv"><span>Keep-alive</span><b style="color:${KA.ok >= DB.count ? '#22c55e' : '#ffb300'}">${KA.ok}/${DB.count} <span style="color:#6b7280;font-weight:400">il y a ${(() => { const m = Math.round((Date.now() - KA.last) / 60000); return m < 1 ? '<1 min' : m < 60 ? m + ' min' : Math.round(m / 60) + ' h'; })()}</span></b></div>` : '';
      return `<div class="aim-kv"><span>Projets joignables</span><b style="color:${DB.okCount >= DB.count ? '#22c55e' : '#ffb300'}">${DB.okCount}/${DB.count}</b></div>` + rows + kaLine
        + (DB.nodes.some(n => n.state === 'restreint') ? '<div style="font-size:10.5px;color:#ef4444;margin-top:6px;line-height:1.5">⚠ Restreint = quota/égress mensuel dépassé → revient au rollover (le keep-alive ne lève pas un 402).</div>' : '');
    })();
  }
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
    aimRenderKpis(d); aimRenderProviders(d); aimRenderLegend(d); aimRenderForecast(d); aimRenderInfra(d); aimRenderJournal(d);
    _amStacked('aim-trend-am', d.trend);
    const CATCOL = { analyst: 0xe3b23a, bank: 0x60a5fa, news: 0x22c55e, bias: 0xa78bfa, ratesbias: 0x14b8a6, weekahead: 0xf472b6, chat: 0xfbbf24, outlook: 0xef4444, weekly: 0x0ea5e9, dtpdaily: 0xfb923c };
    _amDonutCompact('aim-cat-am', Object.entries(d.categoriesToday || {}).filter(([, v]) => v > 0).map(([k, v]) => ({ cat: k, val: v, color: CATCOL[k] || 0x6b7280 })), 'aim-cat-legend');
  }
  // Câblage UNIQUE des contrôles statiques (portée du graphe + filtres du journal)
  (function _aimWire() {
    const rg = document.getElementById('aim-range');
    if (rg) rg.addEventListener('click', e => { const bt = e.target.closest('button'); if (!bt) return; _aimHours = parseInt(bt.dataset.h, 10) || 24; rg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === bt)); loadAIMon(); });
    const jf = document.getElementById('aim-j-filters');
    if (jf) jf.addEventListener('click', e => { const bt = e.target.closest('button'); if (!bt) return; _aimJFilter = bt.dataset.lvl || ''; jf.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === bt)); if (_aimLastData) aimRenderJournal(_aimLastData); });
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
      { l: 'Churn (30j)',         v: k.churnRate + '%', sub: `${k.churned30} expiré(s)` },
      { l: 'Revenu à risque',     v: eur(k.atRiskMrr), sub: `${k.expiringSoon} expire(nt) ≤ 7j · estimation` },
    ] : [
      { l: 'MRR · estimé', v: eur(k.mrr), sub: `ARPU ${eur(k.arpu)} / abonné · Whop injoignable`, accent: true },
      { l: 'ARR · estimé', v: eur(k.arr), sub: `${k.activeSubs} abonné(s) actif(s)` },
      { l: 'Abonnés actifs',       v: k.activeSubs, sub: `${k.trials} essai(s) en cours` },
      { l: 'Clients',              v: k.clients, sub: `${k.newThisMonth} nouveau(x) ce mois` },
      { l: 'Ajout net (30j)',      v: sign(k.netAdds), sub: `<span class="${k.growthPct >= 0 ? 'fin-up' : 'fin-down'}">${sign(k.growthPct)}% vs mois -1</span>` },
      { l: 'Churn (30j)',          v: k.churnRate + '%', sub: `${k.churned30} expiré(s)` },
      { l: 'Revenu à risque',      v: eur(k.atRiskMrr), sub: `${k.expiringSoon} expire(nt) ≤ 7j` },
    ];
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
      <div class="whop-stat"><span class="whop-dot ${w.configured ? 'whop-on' : 'whop-off'}"></span> API Whop ${w.configured ? 'connectée' : '— non configurée (WHOP_API_KEY)'}</div>
      <div class="whop-stat"><span class="whop-dot ${w.webhookSecret ? 'whop-on' : 'whop-off'}"></span> Webhook ${w.webhookSecret ? 'sécurisé (token actif)' : '— non protégé (WHOP_WEBHOOK_SECRET)'}</div>
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
          <div class="ad-thread-name">${_esc2(t.name || t.email || ('User '+t.user_id))}${t.unread?` <span class="ad-thread-badge">${t.unread}</span>`:''}</div>
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
        const body = /^data:image\//.test(t)
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
  let _fSearch = '', _fStatus = 'all', _fRole = 'all';
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
  function statusBadge(u) {
    const st = subState(u);
    if (st === 'suspended') return '<span class="badge badge-suspended">Suspendu</span>';
    if (st === 'expired')   return '<span class="badge badge-expired">Expiré</span>';
    if (st === 'soon')      return '<span class="badge badge-soon">Expire bientôt</span>';
    return '<span class="badge badge-active">Actif</span>';
  }
  // Dernière connexion en RELATIF (la date exacte reste au survol) : « il y a 3 j » se lit
  // d'un coup d'œil, là où « 24/07/2026 23:51:51 » force à calculer de tête.
  function relTime(ts) {
    if (!ts) return 'jamais';
    const ms = Date.now() - new Date(ts).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '—';
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
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Aucun utilisateur ne correspond aux filtres.</td></tr>';
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
      del:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    };
    const icBtn = (icon, label, onclick, danger) =>
      `<button class="btn-ic${danger ? ' btn-ic--danger' : ''}" title="${label}" aria-label="${label}" onclick="${onclick}">${IC[icon]}</button>`;
    tbody.innerHTML = pageUsers.map(u => `
      <tr data-id="${u.id}">
        <td><div class="u-name-cell">${_avatar(u)}<span class="u-name-txt">${_escH(u.name || '—')}</span></div></td><!-- (XSS) nom/e-mail TOUJOURS échappés : modifiables par le client via son profil -->
        <td class="email">${_escH(u.email)}</td>
        <td><span class="badge badge-client">${cycleLabel(u)}</span></td>
        <td>${typeBadge(u)}</td>
        <td>${statusBadge(u)}</td>
        <td>${subInfo(u)}</td>
        <td style="color:var(--text3);font-family:var(--font-mono);font-size:11px" title="${u.last_login ? esc(new Date(u.last_login).toLocaleString('fr-FR')) : ''}">${relTime(u.last_login)}</td>
        <td class="actions">
          ${icBtn('edit', 'Modifier', `openEdit('${esc(String(u.id))}','${esc(u.name)}','${u.role}','${u.plan}',${u.active},'${esc(u.plancad || '')}')`)}
          ${icBtn('pwd', 'Mot de passe', `openPwd('${esc(String(u.id))}')`)}
          ${u.role !== 'admin' ? icBtn(u.active ? 'pause' : 'play', u.active ? 'Suspendre' : 'Réactiver', `toggleSuspend('${esc(String(u.id))}',${u.active})`)
            + icBtn('kick', 'Déconnecter du desk', `forceDisconnect('${esc(String(u.id))}')`) : ''}
          ${icBtn('del', 'Supprimer', `deleteUser('${esc(String(u.id))}')`, true)}
        </td>
      </tr>`).join('');

    renderPagination(users.length, totalPages, start, pageUsers.length);
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
    essai: "Compte d'essai : aucun revenu compté, et à l'échéance c'est le mail « fin d'essai » qui part — jamais la relance de renouvellement.",
    amis:  "Compte ami : accès offert — ne recevra JAMAIS de relance de paiement (ni renouvellement, ni fin d'essai). Tout le reste est normal.",
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

  // Tri au clic sur les en-têtes de colonnes
  document.querySelectorAll('.users-table th.sortable').forEach(th =>
    th.addEventListener('click', () => sortBy(th.dataset.sort)));
