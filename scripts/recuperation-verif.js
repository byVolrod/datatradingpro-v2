#!/usr/bin/env node
/**
 * recuperation-verif.js — RETROUVER CE QU'UNE BASE DÉTIENT ENCORE.
 * ------------------------------------------------------------------------------------------------
 * 16/09. Retour user : « mon layout JOT a disparu », puis « rétablis ». Vérification faite sur la
 * base principale : RIEN n'était perdu (journal intact, 37 trades, 21 colonnes, personnalisation en
 * place) mais une disposition manquait — et il n'existait AUCUN moyen de regarder ce que les trois
 * autres bases détenaient.
 *
 * LE MÉCANISME. `ai_cache` est dual-écrite sur quatre nœuds, et la lecture arbitre à la FRAÎCHEUR
 * (`_lireFraicheur`, posé le 03/09 pour qu'une base revenue de pause ne serve plus un modèle de
 * juin). Angle mort : une écriture RÉCENTE et PAUVRE masque une écriture ANCIENNE et RICHE. Rien
 * n'est perdu, tout est caché — et du point de vue du client, c'est exactement pareil.
 *
 * Ce banc EXÉCUTE `_recupRichesse` et `_recupResume`, le vrai code de server.js, et éprouve les
 * gardes des deux routes sur les cas qui comptent. Témoin de mutation compris.
 */
const fs = require('fs');
const path = require('path');

let ok = 0, ko = 0;
const vert = m => { ok++; console.log('  \x1b[32m✓\x1b[0m ' + m); };
const rouge = (m, d) => { ko++; console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); };
const titre = t => console.log('\n── ' + t + ' ──');

const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function extraire(nom) {
  const i = SRV.indexOf('function ' + nom + '(');
  if (i < 0) return null;
  let prof = 0;
  for (let k = SRV.indexOf('{', i); k < SRV.length; k++) {
    if (SRV[k] === '{') prof++;
    else if (SRV[k] === '}') { prof--; if (prof === 0) return SRV.slice(i, k + 1); }
  }
  return null;
}

titre('Le banc tient bien le vrai code');
const SRC_R = extraire('_recupRichesse');
const SRC_S = extraire('_recupResume');
if (!SRC_R || !SRC_S) {
  rouge('`_recupRichesse` / `_recupResume` introuvables dans server.js', 'banc à recâbler');
  console.log('\n\x1b[31m✗ 0 au vert, 1 au rouge\x1b[0m');
  process.exit(1);
}
vert('les deux fonctions sont extraites de server.js');
const richesse = new Function(SRC_R + '\nreturn _recupRichesse;')();
const resume = new Function(SRC_S + '\nreturn _recupResume;')();

const L = (n, items) => ({ id: 'l' + n, name: 'L' + n, items: Array.from({ length: items }, (_, i) => ({ id: 'w' + i })) });
const RICHE  = { layouts: [L(1, 4), L(2, 3), L(3, 5)] };   // 3 dispositions, 12 widgets
const PAUVRE = { layouts: [L(1, 3)] };                      // 1 disposition, 3 widgets — l'état constaté

titre('Comparer deux versions de la MÊME clé');
if (richesse(RICHE) > richesse(PAUVRE)) vert('une version à 3 dispositions pèse plus qu\'une version à 1');
else rouge('la comparaison ne discrimine pas', richesse(RICHE) + ' vs ' + richesse(PAUVRE));
if (richesse({ layouts: [L(1, 9)] }) > richesse({ layouts: [L(1, 2)] })) vert('à nombre de dispositions égal, les widgets départagent');
else rouge('les widgets ne départagent pas');
if (richesse(null) === 0 && richesse(undefined) === 0) vert('une clé absente pèse zéro');
else rouge('une clé absente ne pèse pas zéro');
if (richesse({ entries: Array(37).fill({}), cols: Array(21).fill({}) }) > richesse({ entries: [], cols: [] }))
  vert('un journal de 37 trades pèse plus qu\'un journal vide');
else rouge('les journaux ne se comparent pas');
/* L'HISTORIQUE COMPTE AUSSI : c'est souvent lui qui détient encore la version perdue. */
if (richesse({ v: [{ at: 1, cfg: RICHE }] }) > richesse({ v: [{ at: 1, cfg: PAUVRE }] }))
  vert('une sauvegarde riche est reconnue à travers son enveloppe d\'historique');
else rouge('l\'historique n\'est pas pesé : la version la plus précieuse serait ignorée');

titre('Le résumé dit ce qu\'il faut pour choisir, et rien de privé');
{
  const r = resume(RICHE);
  if (/3 disposition/.test(r) && /12 widget/.test(r)) vert('le résumé annonce dispositions et widgets : ' + r);
  else rouge('le résumé n\'est pas exploitable', r);
  const j = resume({ entries: Array(37).fill({}), cols: Array(21).fill({}), custom: true });
  if (/37 trade/.test(j) && /21 colonne/.test(j) && /personnalis/.test(j)) vert('et pour un journal : ' + j);
  else rouge('le résumé du journal est incomplet', j);
  /* Un résumé ne doit contenir AUCUN contenu : ni nom de paire, ni note, ni montant. */
  const priv = resume({ entries: [{ pair: 'EURUSD', note: 'secret', pnl: 1234 }], cols: [] });
  if (!/EURUSD|secret|1234/.test(priv)) vert('aucun contenu privé ne fuit dans le résumé : ' + priv);
  else rouge('le résumé laisse fuir du contenu privé', priv);
}

titre('Les gardes des routes');
{
  /* La route ne renvoie JAMAIS la valeur : un administrateur choisit une version, il ne lit pas le
     journal de quelqu'un. */
  const i = SRV.indexOf("app.get('/api/admin/recuperation'");
  const bloc = i < 0 ? '' : SRV.slice(i, SRV.indexOf("app.post('/api/admin/recuperation/realigner'", i));
  if (!bloc) rouge('route de constat introuvable');
  else {
    if (/valeur: undefined/.test(bloc)) vert('le constat renvoie un résumé, jamais le contenu');
    else rouge('le constat renvoie le contenu privé à l\'écran');
    if (/divergent/.test(bloc)) vert('… et signale explicitement les bases qui divergent');
    else rouge('rien ne signale une divergence : il faudrait la repérer à l\'œil');
  }
  const j = SRV.indexOf("app.post('/api/admin/recuperation/realigner'");
  const bloc2 = j < 0 ? '' : SRV.slice(j, j + 2600);
  if (!bloc2) rouge('route de réalignement introuvable');
  else {
    if (/requireAdmin/.test(SRV.slice(j, j + 120))) vert('le réalignement est réservé à l\'administration');
    else rouge('le réalignement n\'est pas protégé');
    if (/_RECUP_FAMILLES\.some\(f => f\.cle\(uid\) === cle\)/.test(bloc2)) vert('la clé doit appartenir au compte demandé (une route bornée)');
    else rouge('n\'importe quelle clé de la base pourrait être recopiée');
    if (/appauvrirAssume/.test(bloc2)) vert('réaligner vers PLUS PAUVRE demande une confirmation explicite');
    else rouge('on peut appauvrir sans le vouloir : l\'intention n\'est pas demandée');
    if (/auth\.aiCacheSet\(cle, src\.valeur\)/.test(bloc2)) vert('l\'écriture passe par le chemin normal (diffusion aux quatre nœuds)');
    else rouge('l\'écriture ne passe pas par `aiCacheSet` : elle serait écrasée au passage suivant');
    if (!/delete|\.remove\(|truncate/i.test(bloc2)) vert('aucune suppression dans le chemin de réparation');
    else rouge('le chemin de réparation contient une suppression');
  }
}

titre('Témoin : sans la pesée de l\'historique, la taille en octets se trompe');
{
  /* PREMIÈRE ÉCRITURE DE CE TÉMOIN : il exigeait que les deux pèsent PAREIL sans la ligne. Faux, et
     le banc me l'a dit. Sans elle on retombe sur `JSON.stringify(v).length`, qui ordonne encore —
     seulement il ordonne la VERBOSITÉ, pas la valeur. On éprouve donc ce qui compte vraiment : un
     historique PAUVRE aux noms bavards doit peser MOINS qu'un historique RICHE aux noms courts.
     C'est exactement le cas où se tromper coûte cher : on restaurerait la mauvaise version. */
  const bavard = { v: [{ at: 1, cfg: { layouts: [{ id: 'x', name: 'Disposition de travail principale du matin '.repeat(12), items: [{ id: 'un-widget-au-nom-tres-long' }] }] } }] };
  const dense  = { v: [{ at: 1, cfg: { layouts: [{ id: 'a', name: 'A', items: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }] },
                                                 { id: 'b', name: 'B', items: [{ id: 'w4' }, { id: 'w5' }] },
                                                 { id: 'c', name: 'C', items: [{ id: 'w6' }] }] } }] };
  if (richesse(dense) > richesse(bavard)) vert('avec la pesée : l\'historique le plus RICHE gagne, malgré des noms plus courts');
  else rouge('la pesée se laisse berner par la verbosité', richesse(dense) + ' vs ' + richesse(bavard));

  const mute = SRC_R.replace(/if \(Array\.isArray\(v\.v\)\)[^\n]*\n/, '');
  if (mute === SRC_R) {
    rouge('la mutation n\'a rien changé au source', 'la pesée a changé de forme : ce témoin ne prouve plus rien');
  } else {
    const r2 = new Function(mute + '\nreturn _recupRichesse;')();
    if (r2(dense) <= r2(bavard)) vert('(témoin) sans elle, le bavard l\'emporte : on restaurerait la mauvaise version');
    else rouge('(témoin) la mutation ne mord pas', r2(dense) + ' vs ' + r2(bavard));
  }
}
console.log(`\n${ko ? '\x1b[31m✗' : '\x1b[32m✓'} ${ok} contrôle${ok > 1 ? 's' : ''} au vert${ko ? `, \x1b[31m${ko} au rouge` : ''}\x1b[0m`);
process.exit(ko ? 1 : 0);
