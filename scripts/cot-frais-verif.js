#!/usr/bin/env node
/**
 * scripts/cot-frais-verif.js — LE COT EST À JOUR QUAND ON A LE DERNIER RAPPORT PARU.
 * ------------------------------------------------------------------------------------------------
 * 26/09, demande utilisateur : « vérifie que le COT est bien à jour en temps réel, c'est important ».
 * La CFTC publie le vendredi à 15 h 30 (New York) les positions du mardi. Un cache aveugle de 6 h
 * pouvait garder le rapport de la semaine d'avant jusqu'au vendredi soir tard. On EXÉCUTE le vrai
 * scrapers/cot.js (pas une copie), avec une CFTC simulée et un disque en mémoire, et une horloge
 * contrôlée, pour vérifier :
 *   · le rapport attendu est le bon, heure d'été comme d'hiver ;
 *   · en retard sur lui, on relit au bout de 15 min ; à jour, on ne relit pas avant 6 h ;
 *   · une CFTC muette rend le DERNIER rapport connu, jamais une liste vide ;
 *   · dix demandes simultanées ne font qu'UNE requête.
 *
 *   node scripts/cot-frais-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const SRC_PATH = path.join(__dirname, '..', 'scrapers', 'cot.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

// Monte le VRAI module avec une CFTC, un disque et une horloge sous contrôle.
function monter(src) {
  src = src || SRC;
  const etat = { maintenant: 0, rapport: '2026-09-15', panne: false, requetes: 0, delai: 0, disque: {} };
  const axios = {
    get: async () => {
      etat.requetes++;
      if (etat.delai) await new Promise(r => setTimeout(r, etat.delai));
      if (etat.panne) throw new Error('CFTC muette');
      const d = etat.rapport + 'T00:00:00.000';
      return { data: [['099741', 'EURO FX'], ['096742', 'BRITISH POUND'], ['097741', 'JAPANESE YEN'], ['092741', 'SWISS FRANC'], ['090741', 'CANADIAN DOLLAR'], ['232741', 'AUSTRALIAN DOLLAR'], ['112741', 'NEW ZEALAND DOLLAR']]
        .map(([code, nom]) => ({ cftc_contract_market_code: code, market_and_exchange_names: nom, report_date_as_yyyy_mm_dd: d, noncomm_positions_long_all: '100', noncomm_positions_short_all: '50' })) };
    },
  };
  const fauxFs = {
    mkdirSync() {}, existsSync: p => p in etat.disque, copyFileSync() {},
    writeFileSync: (p, t) => { etat.disque[p] = t; },
    readFileSync: p => { if (!(p in etat.disque)) throw new Error('ENOENT'); return etat.disque[p]; },
  };
  const DateH = class extends Date { static now() { return etat.maintenant; } };
  const m = new Module(SRC_PATH);
  m.filename = SRC_PATH;
  const req = n => (n === 'axios' ? axios : n === 'fs' ? fauxFs : require(n));
  const f = new Function('require', 'module', 'exports', '__dirname', 'Date', 'console', src);
  f(req, m, m.exports, path.dirname(SRC_PATH), DateH, { log() {}, warn() {}, error() {} });
  return { cot: m.exports, etat };
}

(async () => {
  console.log('\n── 1. Le rapport attendu ──');
  {
    const { cot } = monter();
    const cas = [
      ['samedi 26/09 midi', Date.UTC(2026, 8, 26, 12), '2026-09-22'],
      ['mercredi 23/09', Date.UTC(2026, 8, 23, 12), '2026-09-15'],
      ['vendredi 25/09, 15 h 29 à New York (heure d\'été)', Date.UTC(2026, 8, 25, 19, 29), '2026-09-15'],
      ['vendredi 25/09, 15 h 31 à New York', Date.UTC(2026, 8, 25, 19, 31), '2026-09-22'],
      ['vendredi 4/12, 15 h 29 à New York (heure d\'hiver)', Date.UTC(2026, 11, 4, 20, 29), '2026-11-24'],
      ['vendredi 4/12, 15 h 31 à New York', Date.UTC(2026, 11, 4, 20, 31), '2026-12-01'],
      ['lundi 28/09, 3 h UTC (dimanche soir à New York)', Date.UTC(2026, 8, 28, 3), '2026-09-22'],
    ];
    for (const [nom, ms, att] of cas) v(nom + ' → ' + att, cot.rapportAttendu(ms) === att, cot.rapportAttendu(ms));
    v('la date d\'un rapport se lit au format réel de la CFTC', cot._dernierRapport([{ reportDate: '2026-09-15T00:00:00.000' }, { reportDate: '2026-09-22T00:00:00.000' }]) === '2026-09-22');
  }

  console.log('\n── 2. En retard : relu dans le quart d\'heure. À jour : pas avant 6 h ──');
  {
    const { cot, etat } = monter();
    const VEN = Date.UTC(2026, 8, 25, 19, 0);            // 15 h 00 à New York : le 15/09 est le dernier
    etat.maintenant = VEN;
    await cot.fetchCOTData('noncomm');
    v('première lecture : une requête', etat.requetes === 1, etat.requetes);
    etat.maintenant = VEN + 20 * 60e3;                    // 15 h 20 : toujours à jour
    await cot.fetchCOTData('noncomm');
    v('15 h 20 à New York, rapport à jour → aucune relecture', etat.requetes === 1, etat.requetes);
    etat.maintenant = VEN + 40 * 60e3;                    // 15 h 40 : le 22/09 est paru, on a le 15/09
    etat.rapport = '2026-09-22';
    const d = await cot.fetchCOTData('noncomm');
    v('15 h 40 : le cache est en retard sur le rapport attendu → relu tout de suite', etat.requetes === 2, etat.requetes);
    v('… et le desk sert le rapport du 22/09', cot._dernierRapport(d) === '2026-09-22', cot._dernierRapport(d));
    etat.maintenant += 5 * 3600e3;
    await cot.fetchCOTData('noncomm');
    v('cinq heures plus tard, rapport à jour → aucune requête de plus', etat.requetes === 2, etat.requetes);
    etat.maintenant += 90 * 60e3;
    await cot.fetchCOTData('noncomm');
    v('passé 6 h → une relecture de contrôle', etat.requetes === 3, etat.requetes);
  }
  {
    const { cot, etat } = monter();
    const SAM = Date.UTC(2026, 8, 26, 12);
    etat.maintenant = SAM; etat.rapport = '2026-09-15';   // publication décalée : la CFTC sert encore le 15/09
    await cot.fetchCOTData('noncomm');
    etat.maintenant += 10 * 60e3;
    await cot.fetchCOTData('noncomm');
    v('rapport en retard : pas de rafale, rien avant 15 min', etat.requetes === 1, etat.requetes);
    etat.maintenant += 6 * 60e3;
    await cot.fetchCOTData('noncomm');
    v('… puis une relecture passé le quart d\'heure', etat.requetes === 2, etat.requetes);
  }
  {
    // TÉMOIN : le même module avec l'ancien cache aveugle de 6 h doit RATER la publication du vendredi.
    const AVEUGLE = SRC.replace('Date.now() - _cache[type].ts < _ttlDe(_dernierRapport(_cache[type].data))', 'Date.now() - _cache[type].ts < CACHE_TTL');
    v('TÉMOIN — la garde est bien celle que le banc remplace', AVEUGLE !== SRC);
    const { cot, etat } = monter(AVEUGLE);
    etat.maintenant = Date.UTC(2026, 8, 25, 19, 0);
    await cot.fetchCOTData('noncomm');
    etat.maintenant += 40 * 60e3; etat.rapport = '2026-09-22';
    const d = await cot.fetchCOTData('noncomm');
    v('TÉMOIN — avec l\'ancien cache de 6 h, le desk servait encore le 15/09 à 15 h 40', cot._dernierRapport(d) === '2026-09-15', cot._dernierRapport(d));
  }

  console.log('\n── 3. CFTC muette : le dernier rapport connu, jamais une liste vide ──');
  {
    const { cot, etat } = monter();
    etat.maintenant = Date.UTC(2026, 8, 23, 12);
    await cot.fetchCOTData('noncomm');
    etat.maintenant += 9 * 3600e3; etat.panne = true;    // cache expiré ET source en panne
    const d = await cot.fetchCOTData('noncomm');
    v('la panne rend le rapport en main', d.length === 8 && cot._dernierRapport(d) === '2026-09-15', d.length);
    const n = etat.requetes;
    etat.maintenant += 60e3;
    await cot.fetchCOTData('noncomm');
    v('… sans relancer la CFTC à chaque requête', etat.requetes === n, etat.requetes - n);
  }
  {
    const a = monter(), b = monter();
    a.etat.maintenant = Date.UTC(2026, 8, 23, 12);
    await a.cot.fetchCOTData('noncomm');
    b.etat.disque = a.etat.disque;                        // redémarrage : seul le disque reste
    b.etat.maintenant = a.etat.maintenant + 3 * 24 * 3600e3; b.etat.panne = true;
    const d = await b.cot.fetchCOTData('noncomm');
    v('après un redémarrage, CFTC en panne : le disque sert, même vieux de 3 jours', d.length === 8, d.length);
  }

  console.log('\n── 4. Dix demandes simultanées, une seule requête ──');
  {
    const { cot, etat } = monter();
    etat.maintenant = Date.UTC(2026, 8, 23, 12); etat.delai = 30;
    const r = await Promise.all(Array.from({ length: 10 }, () => cot.fetchCOTData('noncomm')));
    v('une seule lecture de la CFTC', etat.requetes === 1, etat.requetes);
    v('… et les dix reçoivent le rapport', r.every(x => x.length === 8));
  }

  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
})();
