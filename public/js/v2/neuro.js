/* ═══ DTP V3 · NEURO-ONDES (comptes admin, « Aperçu V3 ») ═════════════════════════════════════════
   Demande user (25/09, capture de référence « Neurobeats ») : « ajoute le widget neuro à l'identique,
   en mieux ». Une bibliothèque de pistes (nom, famille, tempo, fréquence, durée), des commandes
   précédent / lecture / suivant, un volume, des filtres par famille.
   CE QUI EST « EN MIEUX », et pourquoi c'est possible sans héberger une seule piste :
     · le son est GÉNÉRÉ dans le navigateur (Web Audio) : deux porteuses décalées gauche / droite
       font naître le battement binaural à la fréquence annoncée, une nappe harmonique respire au
       tempo annoncé, un fond de bruit doux masque l'environnement. Rien à télécharger, aucune
       coupure, aucune licence musicale ;
     · des SÉANCES minutées qui ont un sens pour un trader : 25 ou 50 min en concentration (le
       rythme d'une fenêtre de marché), 60 min en créativité, 15 ou 30 min pour redescendre ;
     · un visualiseur, la progression de la séance, et les commandes de l'écran verrouillé ;
     · le son SURVIT au re-rendu du desk (le moteur est unique, les cartes s'y abonnent) et s'arrête
       quand plus aucune carte ne l'affiche.
   ⚠️ Volatil, comme le reste du desk : aucune piste ni volume n'est mémorisé d'une visite à l'autre. */
(function () {
  'use strict';
  if (window._v3Neuro) return;
  window._v3Neuro = true;

  var OR = '#e3b23a';
  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  /* ── Les pistes ────────────────────────────────────────────────────────────────────────────────
     Trois familles, seize pistes chacune. Les plages de fréquence suivent la convention des
     battements binauraux : bêta (14-18 Hz) et gamma (40 Hz) pour la concentration, alpha (8-12 Hz)
     pour la créativité, thêta (4-7 Hz) pour la détente. Chaque piste a sa porteuse, sa tonalité
     et sa texture : deux pistes voisines ne sonnent jamais pareil. */
  var FAMILLES = [
    { k: 'conc', nom: 'Concentration', hz: [14, 15, 16, 18, 40], bpm: [72, 76, 80, 84, 88], min: [25, 50], porteuse: 200, bruit: 'rose',
      noms: ['Ligne claire', 'Salle des marchés', 'Carnet d’ordres', 'Tension juste', 'Cap fixe', 'Heure d’ouverture', 'Front calme', 'Mise au point',
        'Sang-froid', 'Lecture fine', 'Signal net', 'Plein régime', 'Clarté', 'Horizon court', 'Veille active', 'Main sûre'] },
    { k: 'crea', nom: 'Créativité', hz: [8, 9, 10, 10, 12], bpm: [60, 60, 62, 64, 60], min: [60], porteuse: 170, bruit: 'rose',
      noms: ['Aube dorée', 'Entre deux rives', 'Au-delà du bruit', 'Bleu d’aube', 'Fil d’Ariane', 'Marée haute', 'Lumière oblique', 'Champ libre',
        'Écho lointain', 'Carnet blanc', 'Grand large', 'Terre d’ocre', 'Nuit claire', 'Onde lente', 'Vent d’ouest', 'Jardin suspendu'] },
    { k: 'rel', nom: 'Relaxation', hz: [4, 5, 6, 7, 6], bpm: [50, 52, 54, 56, 50], min: [15, 30], porteuse: 140, bruit: 'brun',
      noms: ['Retour au calme', 'Brume', 'Eau dormante', 'Clôture de séance', 'Pluie fine', 'Feu de bois', 'Lac gelé', 'Nocturne',
        'Respiration', 'Pleine lune', 'Sable chaud', 'Forêt basse', 'Dernier cours', 'Houle', 'Silence doré', 'Veilleuse'] },
  ];
  // Tonalités de la nappe (fondamentale en Hz) : une gamme de fondamentales graves et douces.
  var TONS = [110, 123.47, 130.81, 146.83, 98, 116.54, 138.59, 103.83];
  var PISTES = [];
  FAMILLES.forEach(function (f) {
    f.noms.forEach(function (nom, i) {
      PISTES.push({ id: f.k + i, nom: nom, fam: f.k, famNom: f.nom, hz: f.hz[i % f.hz.length], bpm: f.bpm[(i * 3) % f.bpm.length],
        min: f.min[i % f.min.length], porteuse: f.porteuse + ((i * 7) % 5) * 6, ton: TONS[(i * 5 + f.k.length) % TONS.length], bruit: f.bruit });
    });
  });
  PISTES.sort(function (a, b) { return a.nom.localeCompare(b.nom, 'fr'); });   // ordre alphabétique, comme la référence
  var duree = function (s) { s = Math.max(0, Math.round(s)); var m = Math.floor(s / 60), r = s % 60; return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r; };

  /* ── Le moteur (unique pour la page) ──────────────────────────────────────────────────────────── */
  var M = { ctx: null, maitre: null, analyse: null, voix: null, piste: null, t0: 0, pause: false, vol: 0.75, abonnes: [], fin: null, arretDiffere: null };
  function notifier() { M.abonnes.slice().forEach(function (f) { try { f(); } catch (e) {} }); majSession(); }
  function contexte() {
    if (M.ctx) return M.ctx;
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    // iPhone : sans ce réglage, le bouton silencieux coupe le son de Web Audio.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    M.ctx = new AC();
    var comp = M.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
    M.maitre = M.ctx.createGain(); M.maitre.gain.value = volGain(M.vol);
    M.analyse = M.ctx.createAnalyser(); M.analyse.fftSize = 1024;
    M.maitre.connect(comp); comp.connect(M.analyse); M.analyse.connect(M.ctx.destination);
    return M.ctx;
  }
  // Courbe du volume : perçue linéaire (l'oreille est logarithmique).
  function volGain(v) { return Math.pow(Math.max(0, Math.min(1, v)), 1.6) * 0.9; }

  var _bruits = {};
  function tamponBruit(ctx, genre) {
    if (_bruits[genre]) return _bruits[genre];
    var n = ctx.sampleRate * 4, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, dernier = 0;
    for (var i = 0; i < n; i++) {
      var w = Math.random() * 2 - 1;
      if (genre === 'brun') { dernier = (dernier + 0.02 * w) / 1.02; d[i] = dernier * 3.2; }
      else {   // bruit rose (filtre de Paul Kellet)
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
    }
    _bruits[genre] = b; return b;
  }
  function osc(ctx, type, f) { var o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }

  // Une VOIX = le graphe d'une piste. Rend de quoi l'arrêter en fondu.
  function creerVoix(ctx, p) {
    var t = ctx.currentTime, sortie = ctx.createGain(), sources = [];
    sortie.gain.setValueAtTime(0, t); sortie.gain.linearRampToValueAtTime(1, t + 3);
    sortie.connect(M.maitre);
    // 1. Battement binaural : porteuse − hz/2 à gauche, porteuse + hz/2 à droite.
    var fusion = ctx.createChannelMerger(2), gB = ctx.createGain(); gB.gain.value = 0.15;
    var oG = osc(ctx, 'sine', p.porteuse - p.hz / 2), oD = osc(ctx, 'sine', p.porteuse + p.hz / 2);
    oG.connect(fusion, 0, 0); oD.connect(fusion, 0, 1); fusion.connect(gB); gB.connect(sortie);
    sources.push(oG, oD);
    // 2. Nappe harmonique (fondamentale, quinte, octave, dixième), filtrée, qui RESPIRE au tempo.
    var filtre = ctx.createBiquadFilter(); filtre.type = 'lowpass'; filtre.frequency.value = p.fam === 'conc' ? 1100 : p.fam === 'crea' ? 850 : 600; filtre.Q.value = 0.6;
    var souffle = ctx.createGain(); souffle.gain.value = 0.72;
    var gP = ctx.createGain(); gP.gain.value = p.fam === 'rel' ? 0.05 : 0.04;
    [1, 1.4983, 2, 2.5198].forEach(function (r, k) {
      [-4, 4].forEach(function (cents) {
        var o = osc(ctx, k === 0 ? 'triangle' : 'sine', p.ton * r); o.detune.value = cents;
        o.connect(filtre); sources.push(o);
      });
    });
    filtre.connect(souffle); souffle.connect(gP); gP.connect(sortie);
    var pouls = osc(ctx, 'sine', p.bpm / 60), gPouls = ctx.createGain(); gPouls.gain.value = 0.26;
    pouls.connect(gPouls); gPouls.connect(souffle.gain); sources.push(pouls);
    var derive = osc(ctx, 'sine', 0.06), gDerive = ctx.createGain(); gDerive.gain.value = 260;
    derive.connect(gDerive); gDerive.connect(filtre.frequency); sources.push(derive);
    // 3. Fond de bruit doux (rose : air ; brun : pluie, houle), avec sa propre houle lente.
    var br = ctx.createBufferSource(); br.buffer = tamponBruit(ctx, p.bruit); br.loop = true;
    var fB = ctx.createBiquadFilter(); fB.type = 'lowpass'; fB.frequency.value = p.bruit === 'brun' ? 520 : 2400;
    var gN = ctx.createGain(); gN.gain.value = p.fam === 'rel' ? 0.05 : 0.026;
    var houle = osc(ctx, 'sine', 0.08), gH = ctx.createGain(); gH.gain.value = p.fam === 'rel' ? 0.025 : 0.008;
    houle.connect(gH); gH.connect(gN.gain);
    br.connect(fB); fB.connect(gN); gN.connect(sortie);
    sources.push(br, houle);
    sources.forEach(function (s) { try { s.start(t); } catch (e) {} });
    return {
      arreter: function (fondu) {
        var t1 = ctx.currentTime, f = fondu == null ? 1.2 : fondu;
        try { sortie.gain.cancelScheduledValues(t1); sortie.gain.setValueAtTime(sortie.gain.value, t1); sortie.gain.linearRampToValueAtTime(0, t1 + f); } catch (e) {}
        sources.forEach(function (s) { try { s.stop(t1 + f + 0.05); } catch (e) {} });
        setTimeout(function () { try { sortie.disconnect(); } catch (e) {} }, (f + 0.3) * 1000);
      },
    };
  }

  function ecoule() { return M.piste && M.ctx ? Math.max(0, M.ctx.currentTime - M.t0) : 0; }
  function jouer(p) {
    var ctx = contexte(); if (!ctx || !p) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    if (M.voix) M.voix.arreter(0.8);
    M.voix = creerVoix(ctx, p); M.piste = p; M.t0 = ctx.currentTime; M.pause = false;
    clearInterval(M.fin);
    // La séance s'éteint seule à son terme, en fondu long.
    M.fin = setInterval(function () { if (M.piste && ecoule() >= M.piste.min * 60) { arreter(6); } }, 1000);
    notifier();
  }
  function basculer() {
    if (!M.piste) return jouer(PISTES[0]);
    if (!M.ctx) return;
    if (M.pause) { M.ctx.resume(); M.pause = false; } else { M.ctx.suspend(); M.pause = true; }
    notifier();
  }
  function arreter(fondu) { if (M.voix) M.voix.arreter(fondu); M.voix = null; M.piste = null; M.pause = false; clearInterval(M.fin); notifier(); }
  function voisine(liste, d) {
    if (!liste.length) return null;
    var i = M.piste ? liste.indexOf(M.piste) : -1;
    return liste[(i + d + liste.length) % liste.length];
  }
  function volume(v) { M.vol = Math.max(0, Math.min(1, v)); if (M.maitre && M.ctx) M.maitre.gain.setTargetAtTime(volGain(M.vol), M.ctx.currentTime, 0.05); notifier(); }

  // Commandes de l'écran verrouillé et du casque (Media Session), quand le navigateur les offre.
  var _listeSession = PISTES;
  function majSession() {
    var ms = navigator.mediaSession; if (!ms) return;
    try {
      if (M.piste) ms.metadata = new window.MediaMetadata({ title: M.piste.nom, artist: 'Neuro-ondes · ' + M.piste.famNom, album: 'DataTradingPro' });
      ms.playbackState = !M.piste ? 'none' : M.pause ? 'paused' : 'playing';
      ms.setActionHandler('play', function () { if (M.pause) basculer(); });
      ms.setActionHandler('pause', function () { if (M.piste && !M.pause) basculer(); });
      ms.setActionHandler('previoustrack', function () { jouer(voisine(_listeSession, -1)); });
      ms.setActionHandler('nexttrack', function () { jouer(voisine(_listeSession, 1)); });
    } catch (e) {}
  }

  /* ── Présentation ────────────────────────────────────────────────────────────────────────────── */
  var ICO = {
    prec: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 9 12l9 6V6Z"/><path d="M6 6v12"/></svg>',
    suiv: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 6 9 6-9 6V6Z"/><path d="M18 6v12"/></svg>',
    lire: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
    vol: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    muet: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>',
    casque: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg>',
  };
  var CSS = ''
    + 'html.dtp-v2 .v3n{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--v3-carte, #0a0a0c);color:var(--v3-texte, #d6d6dc);font:500 12px/1.35 "Inter Tight",system-ui,sans-serif;font-variant-numeric:tabular-nums}'
    /* EN-TÊTE V3 (25/09, « le design ne reflète pas la V3 ») : la carte n'avait pas de tête — elle
       s'ouvrait sur « Choisissez une piste — ». Même grammaire que les widgets de marché (.v3w-tete) :
       le nom, puis des pastilles d'état (lecture, famille, casque). */
    + 'html.dtp-v2 .v3n-tete{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;border-bottom:1px solid var(--v3-ligne, #15151a)}'
    + 'html.dtp-v2 .v3n-nom{font:600 12.5px/1 "Inter Tight",system-ui,sans-serif;color:var(--v3-titre, #f2f2f4);margin-right:2px}'
    + 'html.dtp-v2 .v3n-pil{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 7px;border:1px solid var(--v3-bord, #22222a);border-radius:3px;background:var(--v3-tete, #0f0f12);color:#a1a1aa;font-size:11px;white-space:nowrap}'
    + 'html.dtp-v2 .v3n-pil b{color:var(--v3-titre, #f0f0f3);font-weight:600}html.dtp-v2 .v3n-pil[hidden]{display:none}'
    + 'html.dtp-v2 .v3n-etat i{width:6px;height:6px;border-radius:50%;background:#6f6f78}html.dtp-v2 .v3n-etat.est-joue i{background:' + OR + ';animation:v3nPouls 2s ease-out infinite}'
    + '@keyframes v3nPouls{0%{box-shadow:0 0 0 0 rgba(227,178,58,.55)}100%{box-shadow:0 0 0 7px rgba(227,178,58,0)}}'
    + 'html.dtp-v2 .v3n-pil-fam b{color:var(--fam, #f0f0f3)}'
    + 'html.dtp-v2 .v3n-casque-p{margin-left:auto;color:var(--v3-pale, #6f6f78)}'
    + 'html.dtp-v2 .v3n-lecteur{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:10px;padding:10px 12px 8px}'
    + 'html.dtp-v2 .v3n-titre{min-width:0}html.dtp-v2 .v3n-titre b{display:block;color:var(--v3-titre, #f4f4f6);font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + 'html.dtp-v2 .v3n-titre span{display:block;color:var(--v3-pale, #6f6f78);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + 'html.dtp-v2 .v3n-cmd{display:flex;align-items:center;gap:6px}'
    + 'html.dtp-v2 .v3n-cmd button{display:grid;place-items:center;width:30px;height:30px;border:0;border-radius:50%;background:transparent;color:#a1a1aa;cursor:pointer;transition:color .15s,background .15s}'
    + 'html.dtp-v2 .v3n-cmd button:hover{color:var(--v3-titre, #f4f4f6);background:#16161b}'
    + 'html.dtp-v2 .v3n-cmd .v3n-lire{width:38px;height:38px;background:' + OR + ';color:#0a0a0c}html.dtp-v2 .v3n-cmd .v3n-lire:hover{background:#f0c75a;color:#0a0a0c}'
    + 'html.dtp-v2 .v3n-cmd button:focus-visible,html.dtp-v2 .v3n-puce:focus-visible,html.dtp-v2 .v3n-ligne:focus-visible{outline:1px solid ' + OR + ';outline-offset:2px}'
    + 'html.dtp-v2 .v3n-vol{display:flex;align-items:center;justify-content:flex-end;gap:7px;color:var(--v3-doux, #8e8e98);min-width:0}'
    + 'html.dtp-v2 .v3n-vol button{display:grid;place-items:center;border:0;background:none;color:inherit;cursor:pointer;padding:2px}'
    + 'html.dtp-v2 .v3n-vol input{-webkit-appearance:none;appearance:none;width:96px;max-width:100%;height:4px;border-radius:2px;background:linear-gradient(90deg,' + OR + ' var(--v,75%),#26262d var(--v,75%));cursor:pointer}'
    + 'html.dtp-v2 .v3n-vol input::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#f4f4f6;border:2px solid ' + OR + '}'
    + 'html.dtp-v2 .v3n-vol input::-moz-range-thumb{width:10px;height:10px;border-radius:50%;background:#f4f4f6;border:2px solid ' + OR + '}'
    + 'html.dtp-v2 .v3n-vol em{font-style:normal;min-width:32px;text-align:right;color:#a1a1aa;font-size:11px}'
    + 'html.dtp-v2 .v3n-onde{position:relative;height:44px;margin:0 12px;border-radius:4px;background:var(--v3-tete, #0e0e11);box-shadow:inset 0 0 0 1px #16161b;overflow:hidden}'
    + 'html.dtp-v2 .v3n-onde canvas{position:absolute;inset:0;width:100%;height:100%}'
    + 'html.dtp-v2 .v3n-prog{position:absolute;left:0;bottom:0;height:2px;background:' + OR + ';transition:width 1s linear}'
    + 'html.dtp-v2 .v3n-temps{position:absolute;right:8px;top:5px;font-size:10.5px;color:var(--v3-doux, #8e8e98)}'
    + 'html.dtp-v2 .v3n-temps:empty{display:none}'
    + 'html.dtp-v2 .v3n-filtres{display:flex;align-items:center;gap:4px;padding:10px 12px 6px;border-bottom:1px solid var(--v3-ligne, #15151a)}'
    + 'html.dtp-v2 .v3n-nb{color:var(--v3-pale, #6f6f78);font-size:11px;margin-right:auto;white-space:nowrap}'
    + 'html.dtp-v2 .v3n-puce{border:0;background:none;color:var(--v3-doux, #8e8e98);font:600 10.5px/1 "Inter Tight",system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:5px 7px;border-radius:3px;cursor:pointer}'
    + 'html.dtp-v2 .v3n-puce:hover{color:var(--v3-titre, #f4f4f6)}html.dtp-v2 .v3n-puce.est-actif{color:var(--v3-titre, #f4f4f6);background:#16161b;box-shadow:inset 0 -2px 0 ' + OR + '}'
    + 'html.dtp-v2 .v3n-liste{flex:1;min-height:0;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#26262d transparent}'
    + 'html.dtp-v2 .v3n-ligne{display:grid;grid-template-columns:18px minmax(0,1fr) auto;align-items:center;gap:8px;width:100%;padding:7px 12px;border:0;border-bottom:1px solid #121216;background:none;color:inherit;text-align:left;cursor:pointer;font:inherit}'
    + 'html.dtp-v2 .v3n-ligne:hover{background:var(--v3-tete, #101013)}'
    + 'html.dtp-v2 .v3n-ligne b{display:block;color:var(--v3-titre, #ececf0);font-weight:600;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + 'html.dtp-v2 .v3n-ligne span{display:block;color:var(--v3-pale, #6f6f78);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + 'html.dtp-v2 .v3n-ligne em{font-style:normal;color:var(--v3-doux, #8e8e98);font-size:11.5px}'
    + 'html.dtp-v2 .v3n-ligne i{display:flex;align-items:flex-end;gap:1.5px;height:12px;color:#3a3a42}'
    + 'html.dtp-v2 .v3n-ligne i s{display:block;width:3px;height:3px;background:currentColor;border-radius:1px}'
    + 'html.dtp-v2 .v3n-ligne.est-en-cours{background:rgba(227,178,58,.06)}html.dtp-v2 .v3n-ligne.est-en-cours b{color:' + OR + '}'
    + 'html.dtp-v2 .v3n-ligne.est-en-cours i{color:' + OR + '}'
    + 'html.dtp-v2 .v3n-ligne.est-en-cours.est-joue i s{animation:v3nEq .9s ease-in-out infinite}'
    + 'html.dtp-v2 .v3n-ligne.est-en-cours.est-joue i s:nth-child(2){animation-delay:.2s}html.dtp-v2 .v3n-ligne.est-en-cours.est-joue i s:nth-child(3){animation-delay:.45s}'
    + '@keyframes v3nEq{0%,100%{height:3px}50%{height:12px}}'
    + 'html.dtp-v2 .v3n-fam-conc{--fam:#4a86c8}html.dtp-v2 .v3n-fam-crea{--fam:' + OR + '}html.dtp-v2 .v3n-fam-rel{--fam:#3fae6e}'
    + 'html.dtp-v2 .v3n-ligne span u{text-decoration:none;color:var(--fam)}'
    // Carte ÉTROITE (mesurée sur la carte elle-même, pas sur l'écran : une colonne étroite du desk
    // a les mêmes besoins qu'un téléphone).
    + 'html.dtp-v2 .v3n.est-etroit .v3n-lecteur{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"t c" "v v"}html.dtp-v2 .v3n.est-etroit .v3n-titre{grid-area:t}html.dtp-v2 .v3n.est-etroit .v3n-cmd{grid-area:c}html.dtp-v2 .v3n.est-etroit .v3n-vol{grid-area:v;justify-content:flex-start}html.dtp-v2 .v3n.est-etroit .v3n-vol input{flex:1;width:auto}'
    + 'html.dtp-v2 .v3n.est-etroit .v3n-nb{display:none}html.dtp-v2 .v3n.est-etroit .v3n-filtres{gap:2px}html.dtp-v2 .v3n.est-etroit .v3n-puce{flex:1 1 auto;padding:6px 4px;font-size:10px;letter-spacing:.03em}'
    + 'html.dtp-v2 .v3n.est-etroit .v3n-casque-p{display:none}'
    + '@media (prefers-reduced-motion:reduce){html.dtp-v2 .v3n-ligne i s,html.dtp-v2 .v3n-etat.est-joue i{animation:none!important}html.dtp-v2 .v3n-prog{transition:none}}';
  function styles() { if (document.getElementById('v3n-css')) return; var s = document.createElement('style'); s.id = 'v3n-css'; s.textContent = CSS; document.head.appendChild(s); }

  function monter(host) {
    styles();
    var fam = '', dernierVol = M.vol || 0.75, raf = 0;
    host.innerHTML = '<div class="v3n">'
      + '<div class="v3n-tete"><span class="v3n-nom">Neuro-ondes</span><span class="v3n-pil v3n-etat"><i></i><b>Prêt</b></span><span class="v3n-pil v3n-pil-fam" hidden></span>'
      + '<span class="v3n-pil v3n-casque-p" title="À écouter au casque">' + ICO.casque + 'Casque conseillé</span></div>'
      + '<div class="v3n-lecteur"><div class="v3n-titre"></div>'
      + '<div class="v3n-cmd"><button class="v3n-prec" title="Piste précédente" aria-label="Piste précédente">' + ICO.prec + '</button>'
      + '<button class="v3n-lire" title="Lecture" aria-label="Lecture">' + ICO.lire + '</button>'
      + '<button class="v3n-suiv" title="Piste suivante" aria-label="Piste suivante">' + ICO.suiv + '</button></div>'
      + '<div class="v3n-vol"><button class="v3n-muet" title="Couper le son" aria-label="Couper le son">' + ICO.vol + '</button>'
      + '<input type="range" min="0" max="100" step="1" aria-label="Volume" data-no-enhance="1"><em></em></div></div>'
      + '<div class="v3n-onde"><canvas></canvas><span class="v3n-temps"></span><span class="v3n-prog"></span></div>'
      + '<div class="v3n-filtres"><span class="v3n-nb"></span>'
      + [['', 'Tout']].concat(FAMILLES.map(function (f) { return [f.k, f.nom]; })).map(function (c) { return '<button class="v3n-puce" data-f="' + c[0] + '">' + c[1] + '</button>'; }).join('')
      + '</div><div class="v3n-liste" role="list"></div></div>';
    var $ = function (s) { return host.querySelector(s); };
    var titre = $('.v3n-titre'), lire = $('.v3n-lire'), liste = $('.v3n-liste'), nb = $('.v3n-nb'), curseur = $('.v3n-vol input'), pct = $('.v3n-vol em');
    var temps = $('.v3n-temps'), prog = $('.v3n-prog'), toile = $('.v3n-onde canvas'), muet = $('.v3n-muet');
    var visibles = function () { return PISTES.filter(function (p) { return !fam || p.fam === fam; }); };

    function rendreListe() {
      var l = visibles(); _listeSession = l;
      nb.textContent = l.length + ' pistes disponibles';
      host.querySelectorAll('.v3n-puce').forEach(function (b) { b.classList.toggle('est-actif', b.dataset.f === fam); });
      liste.innerHTML = l.map(function (p) {
        return '<button class="v3n-ligne v3n-fam-' + p.fam + '" role="listitem" data-id="' + p.id + '"><i aria-hidden="true"><s></s><s></s><s></s></i>'
          + '<div><b>' + esc(p.nom) + '</b><span><u>' + p.famNom + '</u> · ' + p.bpm + ' BPM · ' + p.hz + ' Hz</span></div><em>' + duree(p.min * 60) + '</em></button>';
      }).join('');
      maj();
    }
    function maj() {
      if (!host.isConnected) return;
      var p = M.piste, joue = !!p && !M.pause;
      titre.innerHTML = p ? '<b>' + esc(p.nom) + '</b><span>' + p.famNom + ' · ' + p.bpm + ' BPM · ' + p.hz + ' Hz</span>'
        : '<b>Aucune piste en cours</b><span>' + PISTES.length + ' pistes : concentration, créativité, relaxation</span>';
      var et = host.querySelector('.v3n-etat'), pf = host.querySelector('.v3n-pil-fam');
      if (et) { et.classList.toggle('est-joue', joue); et.querySelector('b').textContent = joue ? 'À l’écoute' : (p ? 'En pause' : 'Prêt'); }
      if (pf) { pf.hidden = !p; pf.className = 'v3n-pil v3n-pil-fam' + (p ? ' v3n-fam-' + p.fam : ''); pf.innerHTML = p ? '<b>' + esc(p.famNom) + '</b>' + p.hz + ' Hz' : ''; }
      lire.innerHTML = joue ? ICO.pause : ICO.lire; lire.title = joue ? 'Pause' : 'Lecture'; lire.setAttribute('aria-label', lire.title);
      var v = Math.round(M.vol * 100);
      curseur.value = v; curseur.style.setProperty('--v', v + '%'); pct.textContent = v + '%';
      muet.innerHTML = M.vol > 0 ? ICO.vol : ICO.muet;
      liste.querySelectorAll('.v3n-ligne').forEach(function (b) {
        var ici = p && b.dataset.id === p.id; b.classList.toggle('est-en-cours', !!ici); b.classList.toggle('est-joue', !!ici && joue);
        if (ici) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      });
      horloge();
      if (joue && !raf) raf = requestAnimationFrame(boucle);
      if (!joue) dessinerOnde(true);
    }
    function horloge() {
      var p = M.piste, e = ecoule();
      temps.textContent = p ? duree(e) + ' / ' + duree(p.min * 60) : '';
      prog.style.width = p ? Math.min(100, e / (p.min * 60) * 100).toFixed(2) + '%' : '0';
    }
    // Le visualiseur : la forme d'onde réelle de ce qui sort, en or ; à l'arrêt, une ligne au repos.
    var tampon = null;
    // ⚠️ requestAnimationFrame passe un HORODATAGE en argument : appelée directement, dessinerOnde
    // l'aurait pris pour « figer » et le visualiseur restait plat. D'où ce relais sans argument.
    function boucle() { dessinerOnde(false); }
    function dessinerOnde(fige) {
      raf = 0;
      if (!host.isConnected) return;
      var w = toile.clientWidth, h = toile.clientHeight, r = window.devicePixelRatio || 1;
      if (!w || !h) { if (!fige && M.piste && !M.pause) raf = requestAnimationFrame(boucle); return; }
      if (toile.width !== Math.round(w * r)) { toile.width = Math.round(w * r); toile.height = Math.round(h * r); }
      var g = toile.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, w, h);
      g.lineWidth = 1.5; g.strokeStyle = M.piste && !M.pause ? OR : '#2a2a31'; g.beginPath();
      if (M.analyse && M.piste && !M.pause && !fige) {
        if (!tampon || tampon.length !== M.analyse.fftSize) tampon = new Float32Array(M.analyse.fftSize);
        M.analyse.getFloatTimeDomainData(tampon);
        var n = tampon.length, amp = 0; for (var k = 0; k < n; k++) amp = Math.max(amp, Math.abs(tampon[k]));
        var gain = amp > 0 ? Math.min(6, 0.42 / amp) : 1;
        for (var i = 0; i < n; i++) { var x = i / (n - 1) * w, y = h / 2 + tampon[i] * gain * h * 0.9; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      } else {
        // Au repos : l'onde de la piste choisie (ou d'une piste type), calme et pâle, au lieu d'un trait
        // plat qui faisait croire à une carte vide. Rien ne bouge : c'est une silhouette, pas un signal.
        var hz = (M.piste && M.piste.hz) || 10;
        g.strokeStyle = 'rgba(227,178,58,.28)';
        for (var j = 0; j <= 160; j++) { var xx = j / 160 * w, t = j / 160; var yy = h / 2 + Math.sin(t * Math.PI * 2 * (2 + hz / 8)) * h * 0.22 * Math.sin(t * Math.PI); if (j) g.lineTo(xx, yy); else g.moveTo(xx, yy); }
      }
      g.stroke();
      if (!fige && M.piste && !M.pause && !document.hidden) raf = requestAnimationFrame(boucle);
    }

    host.querySelector('.v3n-filtres').addEventListener('click', function (e) { var b = e.target.closest('.v3n-puce'); if (!b) return; fam = b.dataset.f; rendreListe(); });
    liste.addEventListener('click', function (e) {
      var b = e.target.closest('.v3n-ligne'); if (!b) return;
      var p = PISTES.filter(function (x) { return x.id === b.dataset.id; })[0];
      if (p && M.piste === p) basculer(); else jouer(p);
    });
    lire.addEventListener('click', function () { if (!M.piste) jouer(visibles()[0]); else basculer(); });
    $('.v3n-prec').addEventListener('click', function () { jouer(voisine(visibles(), -1)); });
    $('.v3n-suiv').addEventListener('click', function () { jouer(voisine(visibles(), 1)); });
    curseur.addEventListener('input', function () { volume(curseur.value / 100); });
    muet.addEventListener('click', function () { if (M.vol > 0) { dernierVol = M.vol; volume(0); } else volume(dernierVol || 0.75); });
    // Le glisser du curseur ne doit pas déplacer la carte du desk.
    ['mousedown', 'touchstart', 'pointerdown'].forEach(function (t) { curseur.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true }); });

    // Abonnement au moteur : la carte suit l'état, d'où qu'il change (autre carte, écran verrouillé).
    var cadre = $('.v3n'), ro = null;
    var palier = function () { var w = cadre.clientWidth; cadre.classList.toggle('est-etroit', w > 0 && w < 470); };
    if (window.ResizeObserver) { ro = new ResizeObserver(palier); ro.observe(cadre); }
    palier();
    clearTimeout(M.arretDiffere);
    M.abonnes.push(maj);
    var tic = setInterval(function () { if (M.piste && !M.pause) horloge(); }, 1000);
    rendreListe();
    return function () {
      clearInterval(tic); cancelAnimationFrame(raf); raf = 0; if (ro) ro.disconnect();
      M.abonnes = M.abonnes.filter(function (f) { return f !== maj; });
      // Plus aucune carte n'affiche le lecteur (carte retirée, desk quitté) : le son s'arrête.
      // Le délai laisse passer un simple re-rendu du desk, qui remonte la carte aussitôt.
      clearTimeout(M.arretDiffere);
      M.arretDiffere = setTimeout(function () { if (!M.abonnes.length && M.piste) arreter(1.5); }, 1500);
    };
  }

  window._v3NeuroTest = { PISTES: PISTES, FAMILLES: FAMILLES, moteur: M };   // pour les bancs

  function declarer() {
    if (!window.DTPWidgets || typeof DTPWidgets.enregistrer !== 'function') return false;
    DTPWidgets.enregistrer({
      id: 'v3-neuro', name: 'Neuro-ondes', court: 'Neuro-ondes', tag: 'FOCUS', cat: 'Outils', h: 380, icone: 'onde',
      desc: 'Des ambiances sonores pour se concentrer, créer ou redescendre : battements binauraux générés en direct, séances minutées.',
      aide: '<p>Chaque piste superpose deux sons très proches, un par oreille : le cerveau perçoit leur écart comme un battement lent, à la fréquence indiquée. <strong>Concentration</strong> (14 à 40 Hz) pour une fenêtre de marché, <strong>Créativité</strong> (8 à 12 Hz) pour préparer un plan, <strong>Relaxation</strong> (4 à 7 Hz) pour redescendre après une séance. Une nappe douce respire au tempo annoncé.</p><p>Le battement ne s’entend qu’au <strong>casque</strong>. Chaque séance s’éteint seule, en fondu, à la fin de sa durée.</p>',
      src: 'Son généré dans le navigateur (Web Audio) : aucune piste téléchargée, aucune donnée envoyée.',
      watch: 'Une séance de 25 ou 50 minutes calée sur une fenêtre de marché (ouverture de Londres, chevauchement Londres × New York).',
      apercu: '<svg viewBox="0 0 120 56" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="8" width="108" height="16" rx="3" fill="#0e0e11" stroke="#1c1c22"/>'
        + '<path d="M10 16 Q16 9 22 16 T34 16 T46 16 T58 16 T70 16 T82 16 T94 16 T106 16" fill="none" stroke="#e3b23a" stroke-width="1.2"/>'
        + '<circle cx="60" cy="36" r="7" fill="#e3b23a"/><path d="M58 32.6v6.8l5.4-3.4z" fill="#0a0a0c"/>'
        + '<path d="M44 33v6l-5-3zM41 33v6" fill="#8e8e98" stroke="#8e8e98" stroke-width=".8"/><path d="M76 33v6l5-3zM79 33v6" fill="#8e8e98" stroke="#8e8e98" stroke-width=".8"/>'
        + '<rect x="10" y="48" width="40" height="2" rx="1" fill="#3a3a42"/><rect x="10" y="48" width="26" height="2" rx="1" fill="#e3b23a"/><rect x="92" y="47" width="18" height="4" rx="1" fill="#26262d"/></svg>',
      opts: [],
      mount: function (host) { return monter(host); },
    });
    return true;
  }
  if (!declarer()) { var n = 0; (function r() { if (declarer() || ++n > 100) return; setTimeout(r, 100); })(); }
})();
