#!/usr/bin/env node
/**
 * scripts/mentor52-verif.js — LES TROIS GESTES DU MENTOR QUE NOS RÉCAPS N'AVAIENT PAS (23/09)
 * ------------------------------------------------------------------------------------------------
 * Deux demandes du même jour, chacune avec le texte du mentor en pièce jointe :
 *   · quotidien : « JPY : cas d'école du "acheter la rumeur, vendre le fait"… Trois causes : …
 *     exactement ce que le marché ne voulait pas entendre » — « améliore le nôtre en gardant ce
 *     qu'on a déjà » ;
 *   · hebdo : « améliore le récap hebdo pour que ce soit ressemblant pour les prochains ET mets-le
 *     à jour ».
 * Ce qui manquait n'était pas des faits : c'était l'EXPLICATION d'une réaction (quotidien), la
 * LECTURE d'une ligne de chaque rubrique chiffrée et la conclusion « ⇒ » dynamique + risque (hebdo).
 *
 * On EXÉCUTE la vraie passe d'enrichissement extraite de server.js (jamais une copie), avec un
 * fournisseur IA simulé, et on vérifie ses règles de sûreté ; un témoin retire la garde « jamais
 * remplacer » et doit faire rougir.
 *
 *   node scripts/mentor52-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(R, 'public/js/app.js'), 'utf8');
const MAIL = fs.readFileSync(path.join(R, 'mailer.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };
const fn = (src, nom) => {
  const d = src.indexOf('async function ' + nom + '(') >= 0 ? src.indexOf('async function ' + nom + '(') : src.indexOf('function ' + nom + '(');
  if (d < 0) return null;
  let prof = 0;
  for (let k = src.indexOf('{', d); k < src.length; k++) {
    if (src[k] === '{') prof++;
    else if (src[k] === '}') { prof--; if (prof === 0) return src.slice(d, k + 1); }
  }
  return null;
};

(async () => {
  console.log('\n── 1. Quotidien : la « lecture de marché » est commandée, bornée, rendue ──');
  const schemaComplet = SRV.indexOf('"lectures": [ { "ccy": "<code devise, ex. JPY>"');
  v('le prompt complet commande "lectures"', schemaComplet > 0);
  const ligne = schemaComplet > 0 ? SRV.slice(schemaComplet, SRV.indexOf('\n', schemaComplet)) : '';
  v('… avec le mécanisme nommé, « Trois causes : » et « ce que le marché voulait »',
    /MÉCANISME/.test(ligne) && /Trois causes/.test(ligne) && /VOULAIT/.test(ligne));
  v('… avec la clause anti-invention (cause absente des données interdite)', /INTERDIT : une cause absente des données/.test(ligne));
  v('… et sans cadratin (veto du 14/08)', !/—/.test(ligne));
  v('la passe COURTE la commande aussi (c\'est elle qui tourne quand la chaîne est tendue)',
    /"lectures": \[ \{ "ccy": "<code devise>", "text": "<0 ou 1 entrée/.test(SRV));
  v('le nettoyage borne les devises aux huit majeures et à deux entrées',
    /\.filter\(x => \/\^\(USD\|EUR\|JPY\|GBP\|CHF\|AUD\|CAD\|NZD\)\$\/\.test\(x\.ccy\) && x\.text\)\.slice\(0, 2\)/.test(SRV));
  const posMacro = APP.indexOf("body += _sec('Macro');");
  const posLect = APP.indexOf("body += _sec('Lecture de marché')");
  const posChiffres = APP.indexOf("body += _sec('Chiffres du jour')");
  v('desk : « Lecture de marché » rendue entre Macro et Chiffres du jour', posMacro > 0 && posLect > posMacro && posChiffres > posLect,
    [posMacro, posLect, posChiffres].join(' / '));
  v('mail : même section, juste sous Macro', /S\('Macro', _macroHtml\);\n  \/\/ LECTURE DE MARCHÉ[^\n]*\n  S\('Lecture de marché'/.test(MAIL));

  console.log('\n── 2. Hebdo : les champs v52 sont commandés et gardés au parse ──');
  v('RECAP_VER passe à 52, RECAP_MIN_OK reste à 41 (pas de régénération sur corpus purgé)',
    /const RECAP_VER = 52;/.test(SRV) && /const RECAP_MIN_OK = 41;/.test(SRV));
  ['employment', 'growth', 'verdict'].forEach(k => v(`le prompt par devise commande "${k}"`, SRV.indexOf(`  "${k}": "<`) > 0));
  v('l\'ouverture de devise exige l\'attendu face à l\'obtenu, puis l\'enjeu', /ATTENDAIT face à ce qu'il a OBTENU/.test(SRV) && /L'ENJEU qui reste ouvert/.test(SRV));
  v('le parse garde employment / growth / verdict (et retire un « ⇒ » de tête)',
    /employment: _stripMd\(String\(v\.employment/.test(SRV) && /growth: _stripMd\(String\(v\.growth/.test(SRV) && /verdict: _stripMd\(String\(v\.verdict \|\| ''\)\)\.replace\(/.test(SRV));

  console.log('\n── 3. Hebdo : rendu desk et mail ──');
  v('desk : la lecture de rubrique passe par _wrLecture (flèche or)', /function _wrLecture\(t\)/.test(APP) && (APP.match(/_wrLecture\(cd\.(inflation|employment|growth)\)/g) || []).length === 3);
  v('desk : la conclusion « ⇒ » clôt la devise, après « Biais »',
    APP.indexOf('wr-verdict-fl') > APP.indexOf('<strong>Biais :</strong>') && APP.indexOf('wr-verdict-fl') > 0);
  v('desk : « Semaine à venir » en puces, plus en ligne « a · b · c »', !/wkAhead\.map\(_wrEsc\)\.join\(' · '\)/.test(APP));
  v('mail : lectures et « ⇒ » rendus aussi', /const _lect = t =>/.test(MAIL) && /cd\.verdict/.test(MAIL));

  console.log('\n── 4. L\'édition affichée est ENRICHIE, jamais réécrite ──');
  const src = fn(SRV, '_enrichirWeeklyMentor52');
  v('la passe _enrichirWeeklyMentor52 est extractible', !!src);
  if (src) {
    const monter = (code, reponse) => {
      const w = {
        v: 51, summary: 'x',
        centralBanks: [{ code: 'USD', decision: 'Hausse de 25 pb à 3,75-4,00 %' }],
        currencies: {
          USD: { bias: 'Haussier', execSummary: 'Semaine gagnante pour le dollar.', inflation: 'Lecture déjà écrite, à garder.',
            inflationPrints: [{ label: 'CPI Y/Y', actual: '3,1%', forecast: '3,0%' }],
            employmentPrints: [{ label: 'Claims', actual: '196K', forecast: '208K' }], growthPrints: [] },
          EUR: { bias: 'Neutre', execSummary: 'Semaine passive.', inflationPrints: [], employmentPrints: [], growthPrints: [] },
        },
      };
      let memorise = 0, prompts = [];
      const f = new Function('allNews', '_weeklyDurable', '_weeklyMemoriser', 'aiSmart', '_stripMd', 'saveHistory', 'broadcast',
        'let _mentor52Essais = 0;\n' + code + '\nreturn _enrichirWeeklyMentor52;')(
        [], w, () => { memorise++; }, async (cat, p) => { prompts.push(p); return JSON.stringify(reponse); }, s => String(s), () => {}, () => {});
      return { w, f, etat: () => ({ memorise, prompts }) };
    };
    const REP = {
      USD: { inflation: 'Une lecture NOUVELLE qui ne doit pas écraser celle déjà écrite.', employment: 'Marché du travail résilient, claims au plus bas, rien qui presse la Fed de ralentir.',
        growth: 'Croissance solide qui ne devrait pas apparaître faute de prints de croissance.', verdict: '⇒ Dynamique haussière validée par la Fed. Le risque principal est une déception sur l—inflation.' },
      EUR: { verdict: 'Configuration sans moteur propre, captive du dollar. Le risque principal est commercial.' },
    };
    const m = monter(src, REP);
    const fini = await m.f();
    const U = m.w.currencies.USD, E = m.w.currencies.EUR;
    v('la passe se termine et marque l\'édition (_mentor52)', fini === true && m.w._mentor52 === true && m.etat().memorise === 1);
    v('une lecture DÉJÀ écrite n\'est jamais remplacée', U.inflation === 'Lecture déjà écrite, à garder.', U.inflation);
    v('une lecture de rubrique AVEC prints est ajoutée', /^Marché du travail résilient/.test(U.employment || ''), U.employment);
    v('une lecture de rubrique SANS prints est refusée (elle commenterait du vide)', !U.growth, U.growth);
    v('le « ⇒ » de tête est retiré, le cadratin remplacé', U.verdict && !/^⇒/.test(U.verdict) && !/—/.test(U.verdict), U.verdict);
    v('une devise sans aucun print reçoit quand même sa conclusion', /^Configuration sans moteur propre/.test(E.verdict || ''));
    v('le prompt ne transmet QUE le rapport écrit (décision et prints présents)', /Hausse de 25 pb/.test(m.etat().prompts[0] || '') && /CPI Y\/Y : publié 3,1%/.test(m.etat().prompts[0] || ''));
    const again = await m.f();
    v('deuxième passage : rien à refaire, aucun appel IA', again === true && m.etat().prompts.length === 1);
    const neuf = monter(src, REP); neuf.w.v = 52;
    await neuf.f();
    v('un hebdo déjà natif v52 n\'est pas touché', neuf.etat().prompts.length === 0);
    const panne = monter(src, null);
    panne.f = new Function('allNews', '_weeklyDurable', '_weeklyMemoriser', 'aiSmart', '_stripMd', 'saveHistory', 'broadcast',
      'let _mentor52Essais = 0;\n' + src + '\nreturn _enrichirWeeklyMentor52;')([], panne.w, () => {}, async () => 'pas de json', s => String(s), () => {}, () => {});
    v('réponse IA inexploitable → false (on retentera), édition non marquée', (await panne.f()) === false && !panne.w._mentor52);

    // TÉMOIN : sans la garde « jamais remplacer », la lecture déjà écrite est écrasée.
    const mut = src.replace("if (!cd[champ] && Array.isArray", 'if (Array.isArray');
    v('(témoin) la mutation retire bien la garde', mut !== src);
    if (mut !== src) {
      const t = monter(mut, REP);
      await t.f();
      v('(témoin) sans elle, la lecture déjà écrite est écrasée', t.w.currencies.USD.inflation !== 'Lecture déjà écrite, à garder.', 'si égale, le témoin ne mord plus');
    }
  }
  v('la passe est planifiée au boot, avec relance si la chaîne IA n\'a pas répondu',
    /setTimeout\(function _m52\(\) \{ _enrichirWeeklyMentor52\(\)\.then\(fini => \{ if \(!fini\) setTimeout\(_m52, 2 \* 3600e3\); \}\)/.test(SRV));

  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
})();
