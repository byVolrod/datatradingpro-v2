#!/usr/bin/env node
/**
 * scripts/briefing-verif.js — LE BRIEFING DU MATIN NE PEUT RIEN AFFIRMER SANS SOURCE (V3, 24/09)
 * ------------------------------------------------------------------------------------------------
 * On EXÉCUTE le vrai module (briefing.js) sur un état de desk réaliste, puis on lui soumet des
 * réponses de modèle piégées : un chiffre inventé, une citation vers un fait inexistant, un point
 * sans source, une consigne de trading. Aucune ne doit passer. Témoins : chaque garde retirée fait
 * rougir son contrôle (le banc lit bien le module, il ne récite pas sa copie).
 *
 *   node scripts/briefing-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(R, 'briefing.js'), 'utf8');
const SRV = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };
const charger = src => { const m = { exports: {} }; new Function('module', 'exports', 'require', src)(m, m.exports, require); return m.exports; };
const B = charger(SRC);

const NOW = Date.UTC(2026, 8, 24, 6, 35);   // jeudi 24/09, 08 h 35 à Paris
const T = (h, m) => Date.UTC(2026, 8, 24, h, m);
const CTX = {
  now: NOW,
  risque: { label: 'WEAK RISK-ON', score: 23, ts: NOW - 60e3, assets: [{ label: 'S&P', chg: 0.8, dir: 1 }, { label: 'AUDJPY', chg: 0.3, dir: 1 }, { label: 'Or', chg: -0.4, dir: -1 }, { label: 'VIX', chg: 2.1, dir: -1 }] },
  force: { ts: NOW - 120e3, series: { USD: [{ v: 0.12 }], EUR: [{ v: -0.05 }], JPY: [{ v: -0.21 }], GBP: [{ v: 0.3 }], AUD: [{ v: 0.02 }], CHF: [{ v: -0.09 }], CAD: [{ v: 0.07 }], NZD: [{ v: -0.11 }] } },
  calendrier: { ts: NOW - 3600e3, items: [
    { timestamp: T(12, 30), currency: 'USD', title: 'Core PCE Price Index MoM', impact: 'High', forecast: '0.3%', previous: '0.2%' },
    { timestamp: T(8, 0), currency: 'EUR', title: 'German Ifo Business Climate', impact: 'Medium', forecast: '88.5', previous: '88.9' },
    { timestamp: T(7, 30), currency: 'CHF', title: 'SNB Interest Rate Decision', impact: 'High', actual: '0%', forecast: '0%' },
    { timestamp: T(3, 0), currency: 'CNY', title: 'Industrial Profits', impact: 'High' },                       // hors G8 → ignoré
    { timestamp: Date.UTC(2026, 8, 25, 12, 30), currency: 'USD', title: 'GDP', impact: 'High' },                  // demain → ignoré
  ] },
  taux: { ts: NOW - 7200e3, banks: [
    { code: 'USD', rate: 4, next: '28/10', nextDays: 34, scenario: { hold: 72, hike: 25, cut: 3 }, source: 'market', provider: 'CME FedWatch' },
    { code: 'NZD', rate: 2.25, next: '08/10', nextDays: 14, scenario: { hold: 60, hike: 0, cut: 40 }, source: 'model' },
  ] },
  titres: [{ headline: 'Fed\'s Waller: another hike is on the table', _titreFr: 'Waller (Fed) : une nouvelle hausse reste sur la table', currency: 'USD', timestamp: NOW - 2 * 3600e3 }],
};

console.log('\n── 1. La fiche de faits : seulement ce que le desk affiche, sourcé et daté ──');
const F = B.ficheDeFaits(CTX);
const txt = F.map(f => f.id + ' ' + f.txt).join('\n');
v('chaque fait porte un identifiant, une source et une heure', F.length >= 8 && F.every((f, i) => f.id === 'F' + (i + 1) && f.source && f.txt), F.length + ' faits');
v('régime de risque traduit, avec le décompte réel des facteurs (3 / 1)', /Risk-on léger \(score 23\) · 3 facteurs risk-on, 1 risk-off/.test(txt), txt.split('\n')[0]);
v('force des devises classée de la plus forte à la plus faible', /GBP \+0,30 · USD \+0,12 · CAD \+0,07 · AUD \+0,02 · EUR −0,05 · CHF −0,09 · NZD −0,11 · JPY −0,21/.test(txt));
v('agenda : seulement AUJOURD\'HUI (heure de Paris) et les devises du desk', /14:30 · USD · Core PCE/.test(txt) && /09:30 · CHF · SNB Interest Rate Decision \(impact fort\) · publié 0%/.test(txt) && !/Industrial Profits|GDP/.test(txt));
v('taux : la source est dite, et une estimation n\'est pas présentée comme un pricing de marché',
  F.some(f => /^Fed : taux 4% · prochaine réunion 28\/10 \(dans 34 j\) · pricing maintien 72%/.test(f.txt) && /CME FedWatch/.test(f.source))
  && F.some(f => /^RBNZ/.test(f.txt) && /estimation DTP/.test(f.source)));
v('une dépêche utilise sa traduction française quand elle existe', /Waller \(Fed\) : une nouvelle hausse/.test(txt));
v('une source absente ne produit aucun fait (jamais un fait vide)', B.ficheDeFaits({ now: NOW }).length === 0);

console.log('\n── 2. La consigne ──');
const P = B.promptBriefing(F, 'jeudi 24 septembre');
v('la fiche entière est dans la consigne, et les règles aussi', F.every(f => P.includes('[' + f.id + '] ' + f.txt)) && /AUCUN chiffre qui ne figure pas/.test(P) && /JAMAIS de consigne de trading/.test(P));

console.log('\n── 3. La vérification : rien ne passe sans source ──');
const id = re => (F.find(f => re.test(f.txt)) || {}).id;
const fR = id(/^Régime/), fF = id(/^Force des devises/), fPce = id(/Core PCE/), fFed = id(/^Fed :/), fFort = id(/^Devise la plus forte/);
const reponse = {
  titre: 'Un risk-on prudent avant le PCE [F1]',
  synthese: `Le marché ouvre en risk-on léger [${fR}]. Le dollar reste recherché avant le PCE de 14h30 [${fF}][${fPce}]. Le yen devrait chuter de 3% [${fF}].`,
  sections: [
    { titre: 'Régime de marché', points: [
      `Le régime est au risk-on léger, avec 3 facteurs risk-on contre 1 risk-off [${fR}].`,
      `Le S&P gagne 1,5% et porte le mouvement [${fR}].`,                                // chiffre inventé (0,8 réel)
      'Les actions mènent la danse sans surprise.' ] },                                     // aucune source
    { titre: 'Devises à suivre', points: [
      `La livre domine la séance à +0,30 quand le yen cède 0,21 [${fFort}].`,
      `Achetez le GBP/JPY sur ce décalage de force [${fFort}].`,                            // consigne
      `L'euro reste en retrait [F99].` ] },                                                 // citation fantôme
    { titre: 'Agenda du jour', points: [`Le Core PCE de 14:30 est attendu à 0,3% après 0,2% [${fPce}].`] },
    { titre: 'Banques centrales', points: [`La Fed est pricée à 72% pour un maintien le 28/10 [${fFed}].`, `Le taux de la Fed est à 4,00% [${fFed}].`] },
  ],
};
const V = B.validerBriefing(reponse, F);
const tous = V ? V.sections.flatMap(s => s.points.map(p => p.txt)) : [];
v('le briefing vérifié est publié (assez de points sourcés)', !!V && tous.length >= 5, JSON.stringify(V && V.motifs));
v('un chiffre ABSENT des faits cités écarte le point (S&P 1,5% inventé ; yen −3% dans la synthèse)', !tous.some(t => /1,5%/.test(t)) && !V.synthese.some(p => /3%/.test(p.txt)) && V.motifs.chiffre === 2, JSON.stringify(V.motifs));
v('un point sans source est écarté', !tous.some(t => /mènent la danse/.test(t)) && V.motifs.sansSource >= 2);
v('une citation vers un fait inexistant ne compte pas', !tous.some(t => /euro reste en retrait/.test(t)));
v('une consigne de trading est écartée, même sourcée', !tous.some(t => /Achetez/.test(t)) && V.motifs.consigne === 1);
v('les nombres sont comparés en VALEUR (4,00% = 4% ; 0,21 cite −0,21 ; 14:30)', tous.some(t => /4,00%/.test(t)) && tous.some(t => /cède 0,21/.test(t)) && tous.some(t => /14:30/.test(t)));
v('la synthèse est filtrée PHRASE par phrase (2 gardées, la fausse retirée)', V.synthese.length === 2, JSON.stringify(V.synthese.map(p => p.txt)));
v('chaque point garde ses citations valides, et le décompte des écartés est exposé', V.sections[0].points[0].cites[0] === fR && V.ecartes === 5 && V.total === 12, V.ecartes + ' / ' + V.total);
v('le titre ne garde pas de citation brute', !/\[F\d/.test(V.titre));
v('trop peu de points vérifiés → rien n\'est publié (pas de briefing creux)', B.validerBriefing({ titre: 'x', sections: [{ titre: 'Régime de marché', points: [`Seul point sourcé [${fR}].`] }] }, F) === null);
v('une réponse illisible → null, sans exception', B.validerBriefing('pas de JSON ici', F) === null && B.validerBriefing(null, F) === null);

console.log('\n── 4. Témoins : chaque garde, retirée, fait rougir son contrôle ──');
const t1 = SRC.replace('if (orphelin) { motifs.chiffre++; return null; }', '');
v('(témoin) la mutation retire bien le contrôle des chiffres', t1 !== SRC);
{ const V2 = charger(t1).validerBriefing(reponse, F); v('(témoin) sans lui, le S&P à 1,5% inventé passe', V2 && V2.sections.flatMap(s => s.points).some(p => /1,5%/.test(p.txt))); }
const t2 = SRC.replace('if (_RX_CONSIGNE.test(sansCites)) { motifs.consigne++; return null; }', '');
v('(témoin) la mutation retire bien le contrôle des consignes', t2 !== SRC);
{ const V3 = charger(t2).validerBriefing(reponse, F); v('(témoin) sans lui, « Achetez le GBP/JPY » passe', V3 && V3.sections.flatMap(s => s.points).some(p => /Achetez/.test(p.txt))); }

console.log('\n── 5. Branché côté serveur (admin + V2 seulement) ──');
v('les routes du briefing sont réservées à l\'admin ET à la V2 active', /app\.get\('\/api\/v2\/briefing', requireAdmin,/.test(SRV) && /app\.post\('\/api\/v2\/briefing\/regen', requireAdmin,/.test(SRV) && /if \(!_v2Actif\(\)\) return res\.status\(404\)\.end\(\);/.test(SRV));
v('la génération ne dépense jamais de crédit payant (noClaude) et passe par la vérification', /_briefingGenerer[\s\S]{0,4000}ai\.generateText\(briefingMod\.promptBriefing\(faits, [^)]*\), 1800, \{ noClaude: true/.test(SRV) && /briefingMod\.validerBriefing\(/.test(SRV));
v('persisté (ai_cache) et relu au démarrage', /auth\.aiCacheSet\('briefing:v1:' \+ /.test(SRV) && /auth\.aiCacheGet\('briefing:v1:' \+ /.test(SRV));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);
