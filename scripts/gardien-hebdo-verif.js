#!/usr/bin/env node
/**
 * scripts/gardien-hebdo-verif.js — LE RÉCAP HEBDO N'ATTEND PLUS QU'UN CLIENT OUVRE L'ONGLET (23/09)
 * ------------------------------------------------------------------------------------------------
 * Capture user : la liste « Notes d'analystes » sans Récap Hebdo. Mesuré en base : rédigé 4 à 7 jours
 * après son créneau du samedi, trois semaines de suite. Le créneau tentait une fois ; les rattrapages
 * ne couraient que le week-end (démarrage) ou à l'ouverture de l'onglet hors pause IA.
 *
 * On EXÉCUTE le vrai gardien extrait de server.js avec une horloge et un générateur simulés, et un
 * témoin retire l'espacement pour prouver que le banc mord.
 *
 *   node scripts/gardien-hebdo-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

const debut = SRV.indexOf('const _GARDIEN_HEBDO_MIN_MS');
const fin = SRV.indexOf('\nsetTimeout(() => {\n  _gardienHebdo()', debut);
const bloc = debut > 0 && fin > debut ? SRV.slice(debut, fin) : null;
const satFn = (() => {
  const d = SRV.indexOf('function _expectedRecapSatTs()');
  return d < 0 ? null : SRV.slice(d, SRV.indexOf('\n}\n', d) + 2);
})();

(async () => {
  console.log('\n── 1. Le gardien existe et tourne seul ──');
  v('le bloc du gardien est extractible de server.js', !!bloc && !!satFn);
  v('il est planifié côté serveur (toutes les 5 min), sans dépendre d\'une ouverture d\'onglet',
    /setInterval\(\(\) => \{ _gardienHebdo\(\)\.catch\(\(\) => \{\}\); \}, 5 \* 60 \* 1000\);/.test(SRV));
  if (!bloc || !satFn) { console.log('\n✗ banc interrompu\n'); process.exit(1); }

  const monter = (code, t0) => {
    let now = t0, appels = 0, produire = false;
    const allNews = [];
    class D extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
    const api = new Function('Date', 'allNews', 'RECAP_MIN_OK', 'generateWeeklyMarketRecap', '_aiPrioriteRapport', 'console',
      'let _weeklyGenLock = 0;\n' + satFn + '\n' + code + '\nreturn { _gardienHebdo, verrou: v => { _weeklyGenLock = v; } };')(
      D, allNews, 41,
      async () => { appels++; if (produire) allNews.push({ _reportType: 'Weekly Market Recap', _weekly: { v: 52 }, timestamp: now }); },
      () => {}, { log() {}, warn() {} });
    return { api, avancer: ms => { now += ms; }, appels: () => appels, reussir: () => { produire = true; }, allNews };
  };
  const MARDI = Date.UTC(2026, 8, 22, 10, 0);   // mardi 22/09 10:00 UTC, récap de la semaine absent
  const MIN = 60e3;

  console.log('\n── 2. Récap absent en semaine : il est relancé, espacé, jusqu\'à réussite ──');
  const g = monter(bloc, MARDI);
  let r = await g.api._gardienHebdo();
  v('mardi, récap absent → la rédaction est relancée sans attendre un client', r === 'echec' && g.appels() === 1, r + ' / ' + g.appels());
  r = await g.api._gardienHebdo();
  v('… mais pas de nouvelle tentative 5 min plus tard (on ne martèle pas une chaîne en panne)', g.appels() === 1, r);
  g.avancer(21 * MIN); r = await g.api._gardienHebdo();
  v('20 min après : deuxième tentative', g.appels() === 2, r);
  g.avancer(21 * MIN); await g.api._gardienHebdo();
  v('… puis l\'espacement DOUBLE après un nouvel échec (40 min)', g.appels() === 2);
  g.avancer(20 * MIN); g.reussir(); r = await g.api._gardienHebdo();
  v('40 min après la 2e : troisième tentative, qui réussit', g.appels() === 3 && r === 'redige', r);
  g.avancer(60 * MIN); r = await g.api._gardienHebdo();
  v('récap présent → plus aucune rédaction', r === 'present' && g.appels() === 3, r);

  console.log('\n── 3. Il respecte le créneau du samedi et le verrou partagé ──');
  const s = monter(bloc, Date.UTC(2026, 8, 26, 0, 10));   // samedi 00:10 UTC = 02:10 Paris
  r = await s.api._gardienHebdo();
  v('samedi 00 h 10 UTC : le créneau de 02 h 05 Paris a la main, pas de doublon', r === 'creneau' && s.appels() === 0, r);
  const l = monter(bloc, MARDI);
  l.api.verrou(MARDI - 5 * MIN);
  r = await l.api._gardienHebdo();
  v('une rédaction lancée par l\'onglet il y a 5 min → le gardien n\'en lance pas une seconde', r === 'verrou' && l.appels() === 0, r);
  const p = monter(bloc, MARDI);
  p.allNews.push({ _reportType: 'Weekly Market Recap', _weekly: { v: 1 }, timestamp: MARDI - 60 * MIN });
  await p.api._gardienHebdo();
  v('un simple repli (version < RECAP_MIN_OK) ne suffit pas : la vraie rédaction est relancée', p.appels() === 1);
  const a = monter(bloc, MARDI);
  a.allNews.push({ _reportType: 'Weekly Market Recap', _weekly: { v: 52 }, timestamp: Date.UTC(2026, 8, 12, 6) });
  await a.api._gardienHebdo();
  v('le récap de la semaine D\'AVANT ne compte pas pour la semaine écoulée', a.appels() === 1);

  console.log('\n── 4. Témoin ──');
  const mut = bloc.replace("if (now < _gardienHebdoProchain) return 'attente';", '');
  v('(témoin) la mutation retire bien l\'espacement', mut !== bloc);
  if (mut !== bloc) {
    const t = monter(mut, MARDI);
    await t.api._gardienHebdo(); t.avancer(16 * MIN); await t.api._gardienHebdo();
    v('(témoin) sans lui, la chaîne est relancée dès que le verrou tombe', t.appels() === 2, t.appels() + ' — si 1, le témoin ne mord plus');
  }

  console.log('\n── 5. La passe d\'enrichissement cherche bien le Récap Hebdo, pas le Récap Éco ──');
  v('_enrichirWeeklyMentor52 filtre sur le type « Weekly Market Recap »',
    /\.find\(i => i && i\._reportType === 'Weekly Market Recap' && i\._weekly && i\._weekly\.summary\)/.test(SRV));

  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
})();
