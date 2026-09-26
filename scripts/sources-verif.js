#!/usr/bin/env node
/**
 * scripts/sources-verif.js — AUCUN FOURNISSEUR DE DONNÉES NOMMÉ DEVANT UN CLIENT.
 * ------------------------------------------------------------------------------------------------
 * 26/09, demande utilisateur, sur capture de la pastille « Sources » (rateprobability, WatchTower,
 * CME FedWatch, ASX IB, COT CFTC…) : « cache les sources, ne les montre jamais, sinon les clients
 * peuvent recopier ». La pastille est retirée ; mais les noms vivaient aussi dans une vingtaine de
 * textes d'aide, de pieds de widget et de messages d'erreur (« via Yahoo Finance », « lecture
 * Myfxbook », « Identifiants Myfxbook absents (MFB_EMAIL / MFB_PASS) »…). Une relecture ne les
 * retrouve pas tous : ce banc balaie les CHAÎNES de tout le JavaScript et de tout le HTML servis aux
 * clients, hors commentaires, et refuse un nom de fournisseur.
 * Hors champ, à dessein : le panneau admin (admin.js, admin.html), seul endroit où les nommer ; les
 * dictionnaires de traduction (ils suivent le français, i18n-verif s'en charge).
 * Exceptions ÉCRITES, pas devinées : les directs Bloomberg / Yahoo Finance sont des CHAÎNES TV que le
 * lecteur choisit de regarder, pas une source de données ; le bouton Voice News ouvre FinancialJuice
 * avec le compte du lecteur.
 *
 *   node scripts/sources-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', 'public');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

const INTERDITS = /\b(CFTC|Myfxbook|rateprobability|WatchTower|FedWatch|ASX IB|Cboe|Yahoo Finance|TradingEconomics|Trading Economics|Firecrawl|Investing\.com|ForexFactory|Forex Factory|Stooq|Frankfurter|MFB_EMAIL|MFB_PASS)\b/i;
// Chaînes autorisées malgré un nom (voir l'en-tête) : on les reconnaît à leur texte, pas à leur ligne.
const PERMIS = [/Yahoo Finance Live/, /direct (de )?Yahoo Finance/i, /Yahoo Live/];

// Extrait les littéraux de chaîne d'un source JS, commentaires exclus. Un petit automate : il suit
// les chaînes '…', "…", `…` et les commentaires, et traite une expression régulière littérale comme
// du code (elle ne s'affiche jamais). Suffisant pour ce contrôle : on cherche des TEXTES affichés.
function chainesJS(src) {
  const out = [];
  let i = 0, ligne = 1;
  const n = src.length;
  let prec = '';   // dernier caractère significatif hors blanc, pour distinguer « / » division et regex
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '\n') { ligne++; i++; continue; }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const f = src.indexOf('*/', i + 2); const bloc = src.slice(i, f < 0 ? n : f + 2); ligne += (bloc.match(/\n/g) || []).length; i = f < 0 ? n : f + 2; continue; }
    if (c === '/' && (!prec || /[(,=:[!&|?{};+\-*%<>~^]/.test(prec))) {
      // expression régulière littérale : on la saute
      i++; let classe = false;
      while (i < n) { const e = src[i]; if (e === '\\') { i += 2; continue; } if (e === '[') classe = true; else if (e === ']') classe = false; else if (e === '/' && !classe) break; else if (e === '\n') break; i++; }
      i++; while (i < n && /[a-z]/i.test(src[i])) i++;
      prec = 'x'; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c, debut = ligne; let j = i + 1, t = '';
      while (j < n && src[j] !== q) { if (src[j] === '\\') { t += src[j + 1] || ''; j += 2; continue; } if (src[j] === '\n') { ligne++; if (q !== '`') break; } t += src[j]; j++; }
      out.push({ t, ligne: debut });
      i = j + 1; prec = 'x'; continue;
    }
    if (!/\s/.test(c)) prec = c;
    i++;
  }
  return out;
}
function textesHTML(src) {
  const sans = src.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/g, m => m.replace(/[^\n]/g, ' '));
  return sans.split('\n').map((t, k) => ({ t, ligne: k + 1 }));
}

const fichiers = [];
for (const f of fs.readdirSync(path.join(PUB, 'js'))) if (f.endsWith('.js')) fichiers.push('js/' + f);
for (const f of fs.readdirSync(path.join(PUB, 'js', 'v2'))) if (f.endsWith('.js')) fichiers.push('js/v2/' + f);
for (const f of fs.readdirSync(PUB)) if (f.endsWith('.html')) fichiers.push(f);
const HORS = /^(js\/admin\.js|admin\.html|js\/i18n-[a-z-]+\.js)$/;

const fautes = [];
let vus = 0;
for (const f of fichiers) {
  if (HORS.test(f)) continue;
  const src = fs.readFileSync(path.join(PUB, f), 'utf8');
  const morceaux = f.endsWith('.html') ? textesHTML(src).concat(chainesJS([...src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n'))) : chainesJS(src);
  vus++;
  for (const m of morceaux) {
    if (!INTERDITS.test(m.t)) continue;
    if (/^https?:\/\//.test(m.t.trim())) continue;   // une adresse technique n'est pas un texte affiché
    if (PERMIS.some(r => r.test(m.t))) continue;
    fautes.push(f + ':' + m.ligne + ' → « ' + m.t.trim().slice(0, 110) + ' »');
  }
}

console.log('\n── Aucun fournisseur nommé dans ce que voit un client ──');
v('fichiers balayés (' + vus + ')', vus >= 20, vus + ' fichier(s)');
v('aucune chaîne affichable ne nomme une source de données', fautes.length === 0, fautes.slice(0, 25).join('\n        '));
console.log('\n── Témoins : le balayage mord, et épargne ce qu\'il doit épargner ──');
const t1 = chainesJS("var a = 'Cotations via Yahoo Finance';");
v('TÉMOIN — une chaîne qui nomme un fournisseur est vue', t1.some(x => INTERDITS.test(x.t)));
const t2 = chainesJS("// lu chez Myfxbook\n/* CFTC */ var b = x.replace(/Investing\\.com|FXStreet/g, '');");
v('TÉMOIN — un commentaire ou une expression régulière ne comptent pas', !t2.some(x => INTERDITS.test(x.t)), JSON.stringify(t2));
v('TÉMOIN — le direct Yahoo Finance (chaîne TV choisie par le lecteur) reste permis', PERMIS.some(r => r.test('Le direct de Yahoo Finance : actualité de marché')));
v('TÉMOIN — le module de traçabilité (pastille Sources) n\'existe plus', !fs.existsSync(path.join(PUB, 'js/v2/tracabilite.js')));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);
