#!/usr/bin/env node
/**
 * obligataire-verif.js — LES RENDEMENTS SOUVERAINS À 10 ANS.
 * ------------------------------------------------------------------------------------------------
 * Premier jalon du chantier obligataire (16/09). Le desk savait dire ce qu'une banque centrale
 * DÉCIDE et ce que le marché price pour sa PROCHAINE réunion ; il ne disait rien du prix de
 * l'argent long, dont l'ÉCART d'un pays à l'autre est le premier moteur d'une paire de devises sur
 * l'horizon d'un swing.
 *
 * DEUX RISQUES, DEUX FAMILLES DE CONTRÔLES.
 *  1. LE NOM DE LA LIGNE CHEZ LA SOURCE. C'est l'hypothèse que je n'ai pas pu vérifier depuis une
 *     session distante : aucune sortie réseau n'y est autorisée. On exécute donc le VRAI scraper
 *     (module chargé, `axios.get` doublé) sur une page qui porte les pièges réels de ce genre de
 *     tableau : « Government Budget », « Interbank Rate », « Deposit Interest Rate ». Un contrôle
 *     de plus vérifie que l'extraction SE DÉCLARE quand elle échoue, au lieu de rendre une carte
 *     vide sans dire pourquoi.
 *  2. LE CALCUL SERVI. On extrait et on exécute le vrai `_obligPayload` de server.js.
 *
 * Chaque famille porte son témoin : une mutation du vrai code doit faire rougir.
 */
const fs = require('fs');
const path = require('path');

let ok = 0, ko = 0;
const vert = m => { ok++; console.log('  \x1b[32m✓\x1b[0m ' + m); };
const rouge = (m, d) => { ko++; console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); };
const titre = t => console.log('\n── ' + t + ' ──');

/* Une page pays telle que TradingEconomics la sert : un tableau de lignes à trois cellules. Les
   décoys ne sont pas décoratifs — ce sont les intitulés qui cohabitent RÉELLEMENT avec celui qu'on
   cherche, et chacun d'eux piégerait une expression régulière trop large. */
const PAGE = rows => '<html><body><table>' + rows.map(r =>
  '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>').join('') + '</table></body></html>';
const LIGNES_REELLES = [
  ['Currency', '104.2', '104.0'],
  ['Stock Market', '5812', '5790'],
  ['Government Bond 10Y', '4.31', '4.19'],
  ['Interest Rate', '3.75', '3.75'],
  ['Interbank Rate', '3.91', '3.90'],
  ['Deposit Interest Rate', '3.65', '3.65'],
  ['Government Budget', '-6.2', '-5.9'],
  ['Government Debt to GDP', '122', '120'],
  ['Inflation Rate', '3.1', '2.9'],
  ['Unemployment Rate', '4.9', '5.0'],
  ['Manufacturing PMI', '51.5', '51.9'],
  ['Services PMI', '52.8', '52.1'],
];

(async () => {
  // ── 1. LE SCRAPER RÉEL, SUR UNE PAGE RÉELLE ───────────────────────────────────────────────────
  titre('Le rendement est bien levé sur la page, sans se tromper de ligne');
  const axios = require('axios');
  const vraiGet = axios.get;
  let derniereUrl = '';
  const servir = html => { axios.get = async (u) => { derniereUrl = u; return { status: 200, data: html }; }; };

  delete require.cache[require.resolve(path.join(__dirname, '..', 'scrapers', 'tradingeconomics.js'))];
  servir(PAGE(LIGNES_REELLES));
  const TE = require(path.join(__dirname, '..', 'scrapers', 'tradingeconomics.js'));
  const r = await TE.fetchTEFundamental('USD');

  if (r && r.marches) vert('le scraper rend bien un bloc « marchés » à côté des fondamentaux');
  else { rouge('aucun bloc « marchés » rendu', 'le reste du banc ne peut rien éprouver'); }

  const o = r && r.marches && r.marches.oblig10;
  if (o && o.valeur === 4.31) vert('le 10 ans est lu à 4,31, la bonne ligne parmi douze');
  else rouge('le 10 ans n\'est pas lu correctement', 'obtenu : ' + JSON.stringify(o));
  if (o && o.precedent === 4.19) vert('… avec sa valeur précédente, qui donne la variation');
  else rouge('la valeur précédente manque', JSON.stringify(o));
  if (o && /^Government Bond 10Y$/.test(o.nom || '')) vert('… et le nom de la ligne lue est conservé (traçabilité)');
  else rouge('le nom de la ligne lue n\'est pas conservé');

  const d = r && r.marches && r.marches.directeur;
  if (d && d.valeur === 3.75) vert('le taux directeur est lu à 3,75, sans confondre avec « Interbank » ni « Deposit »');
  else rouge('le taux directeur est mal lu', 'obtenu : ' + JSON.stringify(d) + ' (pièges : Interbank 3.91, Deposit 3.65)');

  /* LE FONDAMENTAL NE DOIT RIEN PERDRE. Le Radar de Biais lit cet objet depuis le 11/08 : si la
     forme de `subs` ou de `parent` avait bougé en ajoutant `marches`, on aurait cassé le Radar pour
     gagner une carte. C'est exactement le genre d'échange qu'on ne fait pas. */
  if (r && Array.isArray(r.subs) && r.subs.length === 7) vert('les 7 fondamentaux du Radar de Biais sont intacts');
  else rouge('la forme des fondamentaux a changé', 'le Radar de Biais lit cet objet depuis le 11/08');
  if (r && typeof r.parent === 'string' && r.parent) vert('… et leur agrégat aussi');
  else rouge('l\'agrégat des fondamentaux a disparu');
  if (/tradingeconomics\.com\/united-states\/indicators/.test(derniereUrl)) vert('aucune adresse nouvelle : c\'est la page que le Radar charge déjà');
  else rouge('le scraper est allé ailleurs que sur la page déjà utilisée', derniereUrl);

  titre('Ce que la source ne publie pas reste vide, et se déclare');
  delete require.cache[require.resolve(path.join(__dirname, '..', 'scrapers', 'tradingeconomics.js'))];
  servir(PAGE(LIGNES_REELLES.filter(l => !/^Government Bond 10Y$/.test(l[0])).concat([['10Y Bond Yield', '4.31', '4.19']])));
  const TE2 = require(path.join(__dirname, '..', 'scrapers', 'tradingeconomics.js'));
  const r2 = await TE2.fetchTEFundamental('USD');
  const o2 = r2 && r2.marches && r2.marches.oblig10;
  /* La source pourrait renommer sa ligne. Le repli large (`re2`) doit alors la rattraper ; et s'il
     ne la rattrape pas, le diagnostic doit montrer comment elle s'appelle VRAIMENT. */
  if (o2 && o2.valeur === 4.31) vert('un intitulé voisin (« 10Y Bond Yield ») est rattrapé par le repli large');
  else {
    const cand = (r2 && r2.marches && r2.marches._candidats) || [];
    if (cand.some(c => /10Y Bond Yield/.test(c))) vert('l\'intitulé réel remonte dans les candidats du diagnostic (correction en une regex)');
    else rouge('ni rattrapé, ni déclaré : la carte serait vide sans qu\'on sache pourquoi', JSON.stringify(cand));
  }

  delete require.cache[require.resolve(path.join(__dirname, '..', 'scrapers', 'tradingeconomics.js'))];
  servir(PAGE(LIGNES_REELLES.filter(l => !/bond/i.test(l[0]))));
  const TE3 = require(path.join(__dirname, '..', 'scrapers', 'tradingeconomics.js'));
  const r3 = await TE3.fetchTEFundamental('USD');
  if (r3 && r3.marches && r3.marches.oblig10 === null) vert('aucune ligne obligataire du tout : la valeur vaut null, elle n\'est pas inventée');
  else rouge('une valeur a été fabriquée en l\'absence de ligne', JSON.stringify(r3 && r3.marches));
  const cand3 = (r3 && r3.marches && r3.marches._candidats) || [];
  if (Array.isArray(cand3) && cand3.some(c => /Interest Rate/i.test(c))) vert('… et les intitulés candidats de la page sont tout de même remontés');
  else rouge('le diagnostic ne remonte aucun candidat', JSON.stringify(cand3));

  axios.get = vraiGet;

  // ── 2. LE CALCUL SERVI ────────────────────────────────────────────────────────────────────────
  titre('Le calcul servi au desk');
  const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const iP = SRV.indexOf('async function _obligPayload(');
  let src = null;
  if (iP >= 0) {
    let prof = 0;
    for (let k = SRV.indexOf('{', iP); k < SRV.length; k++) {
      if (SRV[k] === '{') prof++;
      else if (SRV[k] === '}') { prof--; if (prof === 0) { src = SRV.slice(iP, k + 1); break; } }
    }
  }
  if (!src) {
    rouge('`_obligPayload` introuvable dans server.js', 'ce banc n\'éprouve plus le calcul, il faut le recâbler');
  } else {
    vert('`_obligPayload` extrait de server.js (' + src.length + ' caractères)');
    const CCY = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CHF'];
    const monter = (marchesParCcy, srcUtil) => {
      let cache = { ts: 0, data: null };
      const f = new Function('fetchTEAll', 'SB_CURRENCIES', '_obligCache', 'console',
        (srcUtil || src).replace(/^async function _obligPayload\(/, 'return async function _obligPayload(')
          .replace(/_obligCache = \{ ts: Date\.now\(\), data \};/, 'Object.assign(_obligCache, { ts: Date.now(), data });'));
      return f(async () => {
        const out = {};
        for (const c of CCY) out[c] = { marches: marchesParCcy[c] || {} };
        return out;
      }, CCY, cache, { warn() {} });
    };
    const M = (dix, prec, dir) => ({ oblig10: dix == null ? null : { valeur: dix, precedent: prec }, directeur: dir == null ? null : { valeur: dir } });

    const p = await monter({
      USD: M(4.31, 4.19, 3.75), EUR: M(2.58, 2.55, 2.65), GBP: M(4.62, 4.50, 3.75),
      CAD: M(3.41, 3.40, 2.25), AUD: M(4.55, 4.40, 3.60), NZD: M(4.80, 4.78, 2.75),
      JPY: M(1.62, 1.58, 0.75), CHF: M(0.52, 0.55, 0.00),
    })();

    const g = c => p.lignes.find(l => l.ccy === c);
    if (g('EUR').ecartUS === -1.73) vert('l\'écart au 10 ans américain est juste (EUR 2,58 contre USD 4,31)');
    else rouge('écart au 10 ans US faux', 'obtenu ' + g('EUR').ecartUS + ', attendu -1.73');
    if (g('USD').ecartUS === null) vert('… et l\'USD, qui est la référence, ne porte pas un zéro qu\'on lirait comme une mesure');
    else rouge('l\'USD porte un écart au lieu de rester la référence', String(g('USD').ecartUS));
    if (g('USD').dixBp === 12) vert('la variation est en POINTS DE BASE (4,31 contre 4,19 = +12 bp)');
    else rouge('variation en points de base fausse', 'obtenu ' + g('USD').dixBp);
    if (g('CHF').dixBp === -3) vert('… y compris à la baisse');
    else rouge('variation négative fausse', 'obtenu ' + g('CHF').dixBp);
    if (g('EUR').prime === -0.07) vert('la prime de terme est juste, et NÉGATIVE quand le marché price des baisses');
    else rouge('prime de terme fausse', 'obtenu ' + g('EUR').prime);
    if (p.etat === 'complet' && p.renseignees === 8) vert('l\'état est « complet » quand les huit répondent');
    else rouge('état faux', p.etat + ' / ' + p.renseignees);

    /* UNE SOURCE PARTIELLE NE DOIT PAS SE FAIRE PASSER POUR UNE SOURCE COMPLÈTE : c'est la même
       règle que partout dans ce dépôt, et elle a déjà été payée deux fois. */
    const p2 = await monter({ USD: M(4.31, 4.19, 3.75), EUR: M(2.58, 2.55, 2.65) })();
    if (p2.etat === 'partiel' && p2.renseignees === 2) vert('deux pays sur huit : l\'état dit « partiel », il ne se tait pas');
    else rouge('un chargement partiel passe pour complet', p2.etat + ' / ' + p2.renseignees);
    if (p2.lignes.find(l => l.ccy === 'GBP').dix === null) vert('… et le pays muet reste vide, jamais comblé');
    else rouge('un pays muet a reçu une valeur');

    const p3 = await monter({})();
    if (p3.etat === 'indisponible') vert('source entièrement muette : « indisponible », distinct de « partiel »');
    else rouge('une source muette ne se déclare pas', p3.etat);

    /* Sans valeur précédente, pas de variation : on n'affiche pas « 0 bp », qui se lirait comme
       « le marché n'a pas bougé » alors qu'on ne sait simplement pas. */
    const p4 = await monter({ USD: M(4.31, null, 3.75) })();
    if (p4.lignes.find(l => l.ccy === 'USD').dixBp === null) vert('sans valeur précédente, la variation est vide, pas « 0 bp »');
    else rouge('une variation a été fabriquée sans valeur précédente');

    // ── TÉMOIN ── on retire la mise à null de l'écart pour l'USD : le contrôle doit tomber.
    const mut = src.replace("l.ccy !== 'USD' && ", '');
    if (mut === src) rouge('la mutation du témoin n\'a rien changé', 'la garde a changé de forme, ce témoin ne prouve plus rien');
    else {
      const pm = await monter({ USD: M(4.31, 4.19, 3.75), EUR: M(2.58, 2.55, 2.65) }, mut)();
      if (pm.lignes.find(l => l.ccy === 'USD').ecartUS === 0) vert('(témoin) sans la garde, l\'USD affiche bien un zéro trompeur');
      else rouge('(témoin) la mutation ne mord pas');
    }
  }
})().then(() => {
  console.log(`\n${ko ? '\x1b[31m✗' : '\x1b[32m✓'} ${ok} contrôle${ok > 1 ? 's' : ''} au vert${ko ? `, \x1b[31m${ko} au rouge` : ''}\x1b[0m`);
  process.exit(ko ? 1 : 0);
}).catch(e => {
  console.log(`\n\x1b[31m✗ le banc lui-même a échoué : ${(e && e.stack) || e}\x1b[0m`);
  process.exit(1);
});
