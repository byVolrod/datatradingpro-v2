#!/usr/bin/env node
/**
 * scripts/pourcent-verif.js — LE POURCENT COLLE À SON NOMBRE, PARTOUT
 *
 * POURQUOI. Demande répétée de l'utilisateur, la seconde fois avec sa portée : « enlève l'espace
 * entre le chiffre et le %, comme je t'ai demandé, sur tout le desk ET le site vitrine ». Le mot
 * qu'il emploie la première fois dit d'où vient le défaut : « ça fait IA ». La typographie
 * française veut une espace insécable avant le signe pourcent ; les modèles l'appliquent
 * scrupuleusement, et le desk héritait d'un texte qui SIGNALE la machine à chaque chiffre.
 * C'est donc un écart ASSUMÉ à la règle typographique — c'est le desk de l'utilisateur, et sur un
 * desk un chiffre et son unité se lisent d'un bloc.
 *
 * ⚠️ LA PREMIÈRE PASSE N'AVAIT COUVERT QU'UN TIERS DU PRODUIT, ET LE BANC NE L'A PAS VU.
 * Le contrôle d'alors cherchait le motif d'un formateur (`' %'` entre guillemets) dans SEPT fichiers
 * nommés à la main. Il est resté vert alors que :
 *   · `seance.js` fabriquait « +0,31 % » — le fichier n'était pas dans la liste ;
 *   · `server.js` portait `.replace(/(\d)\s*%/g, '$1 %')`, une règle qui INSÉRAIT l'espace dans la
 *     Synthèse des Marchés — le motif cherché ne reconnaît pas cette écriture-là ;
 *   · 73 chaînes livrées (aides des widgets, presets de la calculatrice, prompts, démo de la
 *     vitrine, e-mails) portaient l'espace en dur — le contrôle ne cherchait que des formateurs.
 * D'où le BALAYAGE ci-dessous : tout le dépôt, pas une liste ; le texte livré, pas un motif de
 * code. Une liste de fichiers sera toujours en retard d'un fichier.
 *
 *   node scripts/pourcent-verif.js
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const RACINE = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const AI = fs.readFileSync(path.join(RACINE, 'ai.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* ══ 1. LA RÈGLE ELLE-MÊME, CÔTÉ DESK ═════════════════════════════════════════════════════════ */
console.log('\n── La règle d\'affichage du desk ──');
const SRC_PCT = (/function _sansEspacePct\(s\) \{[^\n]*\}/.exec(APP) || [])[0] || null;
v('la règle est extractible d\'app.js', !!SRC_PCT);
if (SRC_PCT) {
  const P = new Function(SRC_PCT + '\nreturn _sansEspacePct;')();
  v('le cas signalé est corrigé',
    P('Taux de chômage au Japon : 2,4 % en juillet, inférieur aux attentes (2,5 %).')
      === 'Taux de chômage au Japon : 2,4% en juillet, inférieur aux attentes (2,5%).');
  /* LES TROIS ESPACES. Un modèle qui rédige en français produit volontiers une insécable :
     invisible à l'œil dans le code, bien présente à l'écran. */
  v('… l\'espace insécable aussi', P('12 %') === '12%');
  v('… et l\'insécable FINE, celle du français soigné', P('12 %') === '12%');
  v('… ainsi que les espaces multiples', P('12   %') === '12%');
  /* ⚠️ CE QUI NE DOIT PAS BOUGER : un « % » qui ne suit pas un chiffre n'est pas une unité. */
  v('un « % » isolé n\'est pas touché', P('Le signe % seul') === 'Le signe % seul');
  v('… ni un pourcent précédé d\'un mot', P('cent % sûr') === 'cent % sûr');
  v('un texte vide ne casse rien', P('') === '' && P(null) === '');
}

/* ══ 2. LES SIX POINTS DE BRANCHEMENT DU CLIENT ═══════════════════════════════════════════════
   Trois existaient (titres, puces, aperçus d'alerte). Trois ont été ajoutés, et ils couvrent le
   cas que le serveur ne peut PAS couvrir : le texte déjà en CACHE, généré avant la règle. Le
   serveur normalise ce qu'il PRODUIT ; le desk affiche aussi ce qu'il a stocké. */
console.log('\n── Les six points de branchement du desk ──');
v('les titres (_mdStrip)', /function _mdStrip\(s\) \{\s*return _sansEspacePct\(s\)/.test(APP));
v('les puces (Info / Analyse / Impact)', /_sansEspacePct\(_decodeEntities\(b\)/.test(APP));
v('les aperçus d\'alerte', /let t = _sansEspacePct\(s\)/.test(APP));
v('le chat macro, bufferisé ET streaming (_aiMd)', /function _aiMd\(s\) \{ return _aiEsc\(_sansEspacePct\(s\)\)/.test(APP));
v('les récaps de séance (_emphasize)', /return _sansEspacePct\(_devisesEnCodes\(text\)\)/.test(APP));
v('le Quotidien / Hebdo (_wrInline)', /\n  s = _sansEspacePct\(s\);/.test(APP));

/* ══ 3. LA CHAÎNE IA — UN SEUL FILET POUR TOUS LES FOURNISSEURS ═══════════════════════════════
   Le serveur normalisait déjà `aiSmart` et les traductions : deux portes sur trois. Restaient le
   chat macro en streaming, les appels Claude directs, et tout ce qui passe par `generateText` sans
   passer par `aiSmart`. `generateText` est le point commun à TOUS les fournisseurs. */
console.log('\n── La chaîne IA : un filet commun à tous les fournisseurs ──');
const SRC_SEP = (/function sansEspacePourcent\(t\) \{[\s\S]*?\n\}/.exec(AI) || [])[0] || null;
v('ai.js porte la règle', !!SRC_SEP);
if (SRC_SEP) {
  const S = new Function(SRC_SEP + '\nreturn sansEspacePourcent;')();
  v('un texte de modèle est normalisé', S('sort à 2,4 % contre 2,5 % attendu') === 'sort à 2,4% contre 2,5% attendu');
  v('… insécable comprise', S('l\'inflation à 3,1 % a/a') === "l'inflation à 3,1% a/a");
  /* ⚠️ CES FONCTIONS RENDENT AUSSI AUTRE CHOSE QU'UNE CHAÎNE. Les convertir transformerait une
     panne (`null`) en texte « null » affiché au client. */
  v('un échec (null) reste un échec', S(null) === null);
  v('un objet n\'est pas aplati en chaîne', typeof S({ a: 1 }) === 'object');
  /* INNOCUITÉ VIS-À-VIS DU JSON : beaucoup d'appelants font un JSON.parse sur cette valeur. */
  v('une réponse JSON reste analysable', (() => {
    const j = S('{"txt":"hausse de 2,4 %","n":3}');
    try { return JSON.parse(j).txt === 'hausse de 2,4%'; } catch { return false; }
  })());
}
v('typoDesk enchaîne les deux règles typographiques',
  /function typoDesk\(t\) \{ return sansEspacePourcent\(sansCadratin\(t\)\); \}/.test(AI));
/* LES CINQ SORTIES de la chaîne. En laisser une seule sur `sansCadratin` rouvrirait la porte pour
   tout un fournisseur — et c'est invisible tant qu'on n'interroge pas CE fournisseur-là. */
{
  /* Quatre sorties rendent directement, la cinquième passe par une variable avant de compter le
     succès : le motif couvre les deux écritures, sinon le compte serait faux sans qu'aucune sortie
     ne manque — un banc qui rougit à tort finit débranché. */
  const sorties = AI.match(/(?:return|const out =) typoDesk\(/g) || [];
  const restantes = AI.match(/(?:return|const out =) sansCadratin\(/g) || [];
  v('les cinq sorties de la chaîne passent par typoDesk', sorties.length === 5 && restantes.length === 0,
    sorties.length + ' sortie(s) sur typoDesk, ' + restantes.length + ' encore sur sansCadratin seul');
}
v('le serveur garde son filet sur aiSmart', /return _pctColle\(await _aiSmartBrut\(/.test(SRV));
v('… et sur les traductions', /r\.translations = r\.translations\.map\(_pctColle\)/.test(SRV));

/* ══ 4. LES DEUX FORMATEURS QUI FABRIQUENT DES POURCENTAGES ═══════════════════════════════════
   Ceux-là n'écrivent pas « 2,4 % » en dur : ils le CALCULENT. Aucun balayage de texte ne peut les
   voir — dans le code source il n'y a qu'un `+ ' %'` sans le moindre chiffre devant. */
console.log('\n── Les formateurs qui fabriquent le pourcentage ──');
{
  const S = require(path.join(RACINE, 'seance.js'));
  v('la Photo de séance colle son pourcent', S.pct(0.31) === '+0,31%', S.pct(0.31));
  v('… au négatif aussi', S.pct(-1.13) === '−1,13%', S.pct(-1.13));
  v('… et « stable » reste « stable »', S.pct(0.001) === 'stable');
  v('la ligne de performance suit', S.lignePerf([{ label: 'DAX', pct: -1.13 }]) === 'DAX −1,13%',
    S.lignePerf([{ label: 'DAX', pct: -1.13 }]));
}
/* ⚠️ LA RÈGLE QUI FAISAIT L'INVERSE. `_frNombres` INSÉRAIT l'espace, par fidélité à la typographie
   française : la Synthèse des Marchés remettait donc l'espace que tout le reste du desk venait
   d'enlever. C'est le contrôle le plus important du fichier — il éprouve une régression qui s'est
   déjà produite, dans ce sens exact. */
{
  const d = SRV.indexOf('function _frNombres(t)');
  const f = d < 0 ? -1 : SRV.indexOf('\n}\n', d);
  v('_frNombres est extractible de server.js', d >= 0 && f > d);
  if (d >= 0 && f > d) {
    const F = new Function(SRV.slice(d, f + 3) + '\nreturn _frNombres;')();
    v('elle RETIRE l\'espace, elle ne l\'ajoute plus', F('hausse de 0,5 % sur la séance') === 'hausse de 0,5% sur la séance',
      F('hausse de 0,5 % sur la séance'));
    v('… et laisse tranquille ce qui est déjà collé', F('hausse de 0,5%') === 'hausse de 0,5%');
    /* CE QU'ELLE DOIT CONTINUER DE FAIRE — la conversion des nombres anglais reste son métier. */
    v('la décimale anglaise devient une virgule', F('CPI at 2.4') === 'CPI at 2,4', F('CPI at 2.4'));
    v('le millier anglais devient une espace', F('gold at 4,647') === 'gold at 4 647', F('gold at 4,647'));
    v('une date reste une date', F('le 21.08.2026') === 'le 21.08.2026', F('le 21.08.2026'));
  }
}

/* ══ 5. LE BALAYAGE — TOUT LE TEXTE LIVRÉ, PAS UNE LISTE DE FICHIERS ══════════════════════════
   ⚠️ C'EST LE SEUL CONTRÔLE QUI AURAIT ATTRAPÉ LES 73 CHAÎNES OUBLIÉES. Il part de `git ls-files`
   — donc un fichier ajouté demain est balayé sans que personne y pense — et il lit le TEXTE LIVRÉ,
   pas des motifs de code.
   ⚠️ LES COMMENTAIRES SONT ÉPARGNÉS, DÉLIBÉRÉMENT. Ils n'atteignent aucun client, et plusieurs
   documentent la règle elle-même : les réécrire mécaniquement les rendrait faux. Le classement se
   fait PAR LIGNE, et c'est un choix : un vrai tokenizer JS déraille sur la première expression
   régulière contenant une apostrophe (/['’]/) — au premier essai il a silencieusement pris trente
   commentaires pour du code.
   ⚠️ ET `scripts/` EST HORS BALAYAGE, pour une raison de fond : les bancs portent des corpus
   d'ENTRÉE, où l'espace est justement ce qu'on donne à corriger. */
console.log('\n── Le balayage du texte livré ──');
{
  const EXCLUS = /^(scripts|migrations|node_modules)\//;
  const DOCS = new Set(['CLAUDE.md', 'RESTORE.md', 'DEPLOIEMENT.md', 'SYNOLOGY.md']);
  let fichiers = [];
  try {
    fichiers = cp.execSync('git ls-files', { cwd: RACINE, encoding: 'utf8' }).split('\n')
      .filter(f => f && /\.(js|html|css|md)$/.test(f) && !EXCLUS.test(f) && !/\.min\.js$/.test(f) && !DOCS.has(f));
  } catch { /* hors dépôt git : le balayage s'abstient plutôt que de mentir */ }
  v('le dépôt est lisible pour le balayage', fichiers.length > 20, fichiers.length + ' fichier(s)');

  const RX = /([0-9])[   ]+%/g;
  const balayer = (txt, html) => {
    const trouve = [];
    let bloc = false;
    txt.split('\n').forEach((l, i) => {
      const t = l.trim();
      const paires = html ? [['<!--', '-->'], ['/*', '*/']] : [['/*', '*/']];
      const etait = bloc;
      for (const [o, fm] of paires) { if (!bloc && t.includes(o) && !t.includes(fm)) { bloc = fm; break; } }
      if (bloc && etait && t.includes(bloc)) bloc = false;
      if (etait || bloc) return;                                   // dans un bloc de commentaire
      if (/^(\/\/|\/\*|\*|<!--|#)/.test(t)) return;                // ligne de commentaire
      // Commentaire de FIN de ligne : « // » ou « /* » précédé d'une espace (le « // » d'une URL
      // suit toujours un « : », il n'est donc jamais pris pour un commentaire).
      const bornes = [l.search(/\s\/\//), l.search(/\s\/\*/)].filter(x => x >= 0);
      const cm = bornes.length ? Math.min(...bornes) : Infinity;
      let m; RX.lastIndex = 0;
      while ((m = RX.exec(l))) { if (m.index < cm) trouve.push((i + 1) + ': ' + t.slice(0, 100)); }
    });
    return trouve;
  };

  const fautifs = [];
  for (const f of fichiers) {
    let txt; try { txt = fs.readFileSync(path.join(RACINE, f), 'utf8'); } catch { continue; }
    if (!/[0-9][   ]+%/.test(txt)) continue;
    balayer(txt, path.extname(f) === '.html').forEach(h => fautifs.push(f + ':' + h));
  }
  v('aucun texte livré ne sépare le nombre de son pourcent', fautifs.length === 0,
    fautifs.slice(0, 8).join('\n      → ') + (fautifs.length > 8 ? '\n      → … et ' + (fautifs.length - 8) + ' autre(s)' : ''));

  /* ⚠️ ET LE BALAYAGE DOIT SAVOIR VOIR. Un contrôle « zéro faute » qui ne cherche rien est vert
     pour toujours : on lui donne donc une faute pour de bon, et on vérifie qu'il la trouve — dans
     les trois espaces, et dans une page HTML comme dans un fichier JS. */
  v('… et le balayage voit une faute qu\'on lui glisse (espace normale)',
    balayer('var t = "hausse de 2,4 % sur la semaine";', false).length === 1);
  v('… l\'insécable', balayer('var t = "hausse de 2,4 %";', false).length === 1);
  v('… l\'insécable fine', balayer('var t = "hausse de 2,4 %";', false).length === 1);
  v('… dans le corps d\'une page HTML', balayer('<p>Rendement de 3,4 % sur un an</p>', true).length === 1);
  /* … ET NE PAS VOIR CE QUI N'EN EST PAS. Sans ces quatre-là, un balayage qui crierait sur tout
     serait « vert » au premier commentaire venu et on le débrancherait. */
  v('… mais pas dans un commentaire de ligne', balayer('// une réserve de 40 % du quota', false).length === 0);
  v('… ni dans un bloc /* … */', balayer('/* le disque est à 84 %\n   depuis le 21/08 */', false).length === 0);
  v('… ni dans un commentaire de FIN de ligne', balayer('var l = 8.5;   // 7,5 % tronquait « CNY »', false).length === 0);
  v('… ni dans un commentaire HTML', balayer('<!-- la mosaïque occupait 24 % de l\'écran -->', true).length === 0);
  /* Le « // » d'une URL n'est pas un commentaire : sans cette garde, tout ce qui suit une adresse
     sur la même ligne échapperait au balayage. */
  v('… et une URL ne fait pas écran au reste de la ligne',
    balayer('var u = "https://x.fr"; var t = "2,4 %";', false).length === 1);

  /* ⚠️ L'ANGLE MORT DU BALAYAGE, TROUVÉ PAR L'AUDIT (28/08) : il lit le texte SOURCE, où le chiffre
     n'existe pas encore — `l.rate.toFixed(2) + ' %'` s'affiche « 4,25 % » et le balayage n'y voit
     RIEN, le nombre n'arrivant qu'à l'exécution. Dix widgets écrivaient ainsi (39 concaténations
     mesurées dans un vrai Chromium). On interdit donc LA FORME elle-même : une chaîne concaténée
     qui COMMENCE par « espace-pourcent » n'a qu'un seul sens — coller un % à la valeur d'avant.
     La prose (« Risque % », « Variations en % ») ne commence jamais une chaîne ainsi. */
  {
    const rxColle = /\+\s*(['"`]) %/g;
    const fautifs2 = [];
    for (const f of ['public/js/widgets.js', 'public/js/app.js', 'public/js/charts.js', 'public/js/home.js']) {
      let txt; try { txt = fs.readFileSync(path.join(RACINE, f), 'utf8'); } catch { continue; }
      let m; while ((m = rxColle.exec(txt))) fautifs2.push(f + ':' + (txt.slice(0, m.index).split('\n').length));
    }
    v('aucune concaténation « + \' %\' » : le pourcent se colle aussi quand le chiffre n\'arrive qu\'à l\'exécution',
      fautifs2.length === 0, fautifs2.slice(0, 6).join(' · ') + (fautifs2.length > 6 ? ' · … et ' + (fautifs2.length - 6) + ' autre(s)' : ''));
    v('… et ce balayage-là voit aussi la faute qu\'on lui glisse',
      (() => { let c = 0; 'x = v.toFixed(1) + \' %\';'.replace(rxColle, () => { c++; return ''; }); return c === 1; })());
  }
}

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);
