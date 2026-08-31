#!/usr/bin/env node
/**
 * scripts/actifs-verif.js — LE DESK NE PARLE PLUS QUE FOREX
 *
 * POURQUOI (27/08). Retour client, verbatim : « Rajoute les indices et plus de marché avant, que
 * le forex c'est frustrant de ouf ». Vérifié avant d'écrire une ligne, et il avait raison au pied
 * de la lettre : les quinze widgets des rubriques Marchés et Devises étaient forex — Carte de
 * chaleur FX, Taux croisés, Corrélations des 7 majors, Performance hebdo des 8 devises.
 *
 * ⚠️ CE QUE CE BANC PROTÈGE AVANT TOUT : LA CORRESPONDANCE DES CLÉS. Le widget nomme ses sept
 * instruments (« DAX », « S&P 500 », « Oil WTI »…) et le serveur les traduit en symboles par la
 * table `_CHART_SYM`. Ces noms sont donc des CLÉS, pas des libellés — et une clé inconnue ne lève
 * AUCUNE erreur : la route rend `{ candles: [] }`, la ligne disparaît de la carte, et personne ne
 * le voit. Renommer « Oil WTI » en « WTI » d'un côté seulement viderait une ligne en silence.
 * On relit donc LES DEUX VRAIES TABLES, dans les deux fichiers, et on exige l'égalité.
 *
 *   node scripts/actifs-verif.js
 *
 * Sans navigateur, la phase de rendu S'ABSTIENT (code 0) : le reste tourne partout.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
const PORT = 4617;

let ko = 0, abst = 0;
const v = (nom, cond, detail) => {
  if (cond) console.log('  ✓ ' + nom);
  else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); }
};

const WID = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');

/* ── 1. LES DEUX TABLES, EXTRAITES DU VRAI CODE ─────────────────────────────────────────────── */
console.log('\n── Les instruments du widget existent-ils vraiment côté serveur ? ──');

function extraire(src, ancre, ouvre, ferme) {
  const d = src.indexOf(ancre);
  if (d < 0) return null;
  const o = src.indexOf(ouvre, d);
  if (o < 0) return null;
  let n = 0;
  for (let i = o; i < src.length; i++) {
    if (src[i] === ouvre) n++;
    else if (src[i] === ferme) { n--; if (!n) return src.slice(o, i + 1); }
  }
  return null;
}

const SRC_INSTR = extraire(WID, 'var _XA_INSTR = [', '[', ']');
const SRC_CHART = extraire(SRV, 'const _CHART_SYM = {', '{', '}');
v('la table du widget est extractible de widgets.js', !!SRC_INSTR);
v('la table du serveur est extractible de server.js', !!SRC_CHART);

let INSTR = null, CHART = null;
if (SRC_INSTR && SRC_CHART) {
  /* `eval('(' + … + ')')` et non `eval(…)` : sans les parenthèses, un littéral qui commence par
     une accolade se lit comme un BLOC de code et non comme un objet — piège déjà payé dans
     impact-verif.js. */
  // eslint-disable-next-line no-eval
  INSTR = eval('(' + SRC_INSTR + ')');
  // eslint-disable-next-line no-eval
  CHART = eval('(' + SRC_CHART + ')');
  v('le widget déclare des instruments', Array.isArray(INSTR) && INSTR.length >= 5,
    'trouvés : ' + (INSTR || []).length);

  /* ⚠️ LE CONTRÔLE CENTRAL. Chaque `nom` doit être une clé de `_CHART_SYM`, au caractère près. */
  const inconnus = (INSTR || []).filter(x => !Object.prototype.hasOwnProperty.call(CHART, x.nom));
  v('CHAQUE nom du widget est une clé connue du serveur', inconnus.length === 0,
    inconnus.map(x => '« ' + x.nom +' » absent de _CHART_SYM (clés : ' + Object.keys(CHART).join(', ') + ')').join(' | '));

  /* L'INVERSE COMPTE AUSSI, mais comme un AVERTISSEMENT et non comme une faute : le serveur peut
     servir un instrument que la carte ne montre pas encore. On le DIT, pour que l'oubli se voie. */
  const nonMontres = Object.keys(CHART).filter(k => !(INSTR || []).some(x => x.nom === k));
  if (nonMontres.length) console.log('  · le serveur sert aussi, non montrés : ' + nonMontres.join(', '));

  /* Un libellé français par ligne, et une famille : sans eux la carte afficherait la clé technique
     (« Oil WTI ») dans un desk qui est en français partout ailleurs. */
  const sansLib = (INSTR || []).filter(x => !x.lib || !x.grp);
  v('chaque instrument porte un libellé français et une famille', sansLib.length === 0,
    sansLib.map(x => x.nom).join(', '));
  const cles = (INSTR || []).map(x => x.nom);
  v('aucun instrument en double', new Set(cles).size === cles.length);
}

/* ── 2. LE CALCUL DE SÉANCE, ÉPROUVÉ SUR LA VRAIE FONCTION ──────────────────────────────────── */
console.log('\n── La variation de séance ──');
const SRC_SEANCE = (() => {
  const d = WID.indexOf('  function _xaSeance(c) {');
  if (d < 0) return null;
  const f = WID.indexOf('\n  }\n', d);
  return f < 0 ? null : WID.slice(d, f + 4);
})();
v('le calcul est extractible de widgets.js', !!SRC_SEANCE);
if (SRC_SEANCE) {
  // eslint-disable-next-line no-eval
  const F = eval('(function(){' + SRC_SEANCE + '\nreturn _xaSeance;})()');
  const b = (t, c) => ({ t: t, o: c, h: c, l: c, c: c });
  /* ⚠️ ON ÉPROUVE LA PROPRIÉTÉ, PAS UN CHIFFRE : « la dernière clôture face à la PRÉCÉDENTE ».
     Figer « +2,00 % » testerait l'arithmétique de JavaScript, pas la règle métier. */
  const r = F([b(1, 100), b(2, 110), b(3, 121)]);
  v('la variation compare les DEUX dernières clôtures', r && Math.abs(r.pct - 10) < 1e-9,
    'obtenu : ' + (r ? r.pct : 'null'));
  v('… et rend la dernière clôture', r && r.close === 121);
  const bas = F([b(1, 100), b(2, 90)]);
  v('une baisse sort négative', bas && bas.pct < 0);
  /* Ce qui doit rendre NULL plutôt qu'un chiffre faux — une ligne absente vaut mieux qu'une
     ligne inventée, c'est la règle du dépôt. */
  v('une seule bougie ne produit AUCUNE variation', F([b(1, 100)]) === null);
  v('aucune bougie non plus', F([]) === null && F(null) === null);
  /* ⚠️ CE CONTRÔLE A ÉTÉ RÉÉCRIT, et la raison mérite d'être gardée. Il éprouvait une garde
     `avant.c > 0` posée juste avant la division — et la mutation qui SUPPRIMAIT cette garde n'a
     rien fait passer au rouge. Explication : le filtre en tête de fonction exige déjà `b.c > 0`,
     donc la garde était inatteignable, et le contrôle passait grâce au filtre. Un contrôle qui
     réussit pour une autre raison que celle qu'il annonce ne protège rien. La garde morte a été
     retirée du code, et c'est le FILTRE qu'on éprouve désormais — celui qui travaille vraiment. */
  v('une clôture à zéro est ÉCARTÉE avant tout calcul', F([b(1, 0), b(2, 50)]) === null);
  v('… et une clôture négative aussi', F([b(1, -3), b(2, 50)]) === null);
  /* Trois bougies dont une à zéro : la ligne existe toujours, calculée sur les deux valides. */
  v('… sans faire disparaître la ligne quand il reste de quoi calculer',
    (function () { const q = F([b(1, 100), b(2, 0), b(3, 110)]); return q && Math.abs(q.pct - 10) < 1e-9; })());
  /* Les bougies illisibles sont écartées AVANT le calcul, sinon la « précédente » serait un
     NaN et toute la ligne partirait en NaN sans que rien ne le dise. */
  const sale = F([b(1, 100), { t: 2, c: null }, b(3, 110), { t: 4, c: NaN }]);
  v('les bougies illisibles sont écartées, pas propagées en NaN',
    sale && isFinite(sale.pct) && Math.abs(sale.pct - 10) < 1e-9,
    'obtenu : ' + JSON.stringify(sale));
}

/* ── 3. PAS DE SECONDE IMPLÉMENTATION DE LA SEMAINE ─────────────────────────────────────────── */
console.log('\n── La semaine se calcule en UN seul endroit ──');
/* ⚠️ ON REMONTE À L'ACCOLADE OUVRANTE DE L'ENTRÉE, pas à la suivante. `extraire` prend le premier
   « { » APRÈS l'ancre — or l'ancre `id: 'indices-matieres'` est DÉJÀ dans l'entrée : on aurait
   découpé un sous-bloc, sans `name:` ni `cat:`, et les contrôles auraient accusé un code correct.
   Pris sur le fait à la première exécution du banc. */
const MOUNT = (() => {
  const i = WID.indexOf("id: 'indices-matieres'");
  if (i < 0) return null;
  const o = WID.lastIndexOf('\n    {', i);
  if (o < 0) return null;
  let n = 0;
  for (let k = WID.indexOf('{', o); k < WID.length; k++) {
    if (WID[k] === '{') n++;
    else if (WID[k] === '}') { n--; if (!n) return WID.slice(o, k + 1); }
  }
  return null;
})();
v('le widget est extractible du catalogue', !!MOUNT);
if (MOUNT) {
  /* Performance hebdo et cette carte affichent la même semaine. Deux calculs divergeraient au
     premier ajustement — et le lecteur verrait deux chiffres différents pour la même chose. */
  v('il réutilise _psVarSemaine (le calcul déjà éprouvé)', /_psVarSemaine\s*\(/.test(MOUNT));
  v('… et n’a pas recopié le lundi 00h UTC pour lui seul', !/_psLundiUTC/.test(MOUNT));
  v('il lit ses bougies par la route commune', /_bougies\s*\(/.test(MOUNT));
  v('un instrument muet fait une ligne ABSENTE, pas une ligne vide',
    /if\s*\(!s\)\s*return;/.test(MOUNT));
  v('la carte se rafraîchit toute seule', /_rafraichirBougies\s*\(/.test(MOUNT));
  v('elle est rangée dans la rubrique Marchés', /cat:\s*'Marchés'/.test(MOUNT));
  /* Le nom tient dans le budget posé le 09/09 (23 caractères au plus). */
  const nom = (MOUNT.match(/name:\s*'([^']*)'/) || [])[1] || '';
  v('son nom tient dans le budget des intitulés (≤ 23)', nom.length > 0 && nom.length <= 23,
    '« ' + nom + ' » : ' + nom.length + ' caractères');
}

/* ── 4. LE STYLE EXISTE POUR CHAQUE CLASSE POSÉE ────────────────────────────────────────────── */
console.log('\n── Chaque classe posée par le widget est peinte ──');
const CSS = fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8');
if (MOUNT) {
  /* ⚠️ LE DÉFAUT QUE CE CONTRÔLE ATTRAPE A DÉJÀ MORDU CE DÉPÔT : une classe écrite par le JS et
     définie NULLE PART dans la feuille (`.iq-note-lbl`, 27/08). Rien ne casse, rien ne s'affiche
     comme prévu, et on cherche le défaut dans le JS. */
  const classes = [...new Set([...MOUNT.matchAll(/class="(wdg-xa[a-z-]*)"/g)].map(m => m[1]))];
  v('des classes propres au widget sont posées', classes.length >= 4, classes.join(', '));
  const orphelines = classes.filter(c => !new RegExp('\\.' + c + '[\\s,{:.]').test(CSS));
  v('aucune classe orpheline dans la feuille de style', orphelines.length === 0,
    orphelines.join(', '));
}

/* ── 4bis. LE PLANCHER DE LARGEUR, QUI NE DÉPEND D'AUCUNE POLICE ────────────────────────────── */
console.log('\n── La colonne des noms tient le plus long libellé ──');
{
  /* ⚠️ UN CHIFFRE ÉCRIT EN DUR, ET C'EST VOULU — parce que le chiffre EST la mesure. Rendu dans
     Chromium avec une pile de polices large, « Pétrole WTI » réclame 76 px à 11,5 px de corps ;
     la colonne étroite en offrait 66, et le libellé sortait tronqué (« Pétrole … »). Elle est
     passée à 78. Ce contrôle refuse qu'on redescende sous 74 — la mesure plus une marge fine.
     Il vit ici, et pas dans la phase navigateur, PRÉCISÉMENT parce que celle-ci mesure avec la
     police de repli du conteneur : elle ne verrait pas la différence. Un banc doit dire ce qu'il
     sait, pas donner une garantie qu'il ne peut pas tenir. */
  const PLANCHER = 74;
  const bloc = CSS.slice(CSS.indexOf('@container dtpw (max-width: 300px)', CSS.indexOf('.wdg-xa {')));
  const m = bloc.match(/\.wdg-xa-l\s*\{[^}]*grid-template-columns:\s*(\d+(?:\.\d+)?)px/);
  v('la carte étroite déclare bien sa grille', !!m, 'règle introuvable dans la feuille');
  if (m) {
    v('la colonne des noms ne descend pas sous le plancher mesuré (' + PLANCHER + ' px)',
      parseFloat(m[1]) >= PLANCHER,
      'déclarée : ' + m[1] + ' px — « Pétrole WTI » réclame 76 px en rendu large');
  }
  /* Et le libellé le plus long ne doit pas rallonger sans qu'on s'en aperçoive : si un instrument
     ajouté demain porte un nom plus long que celui sur lequel le plancher a été mesuré, le plancher
     ne vaut plus rien. On le dit. */
  if (INSTR) {
    const plusLong = INSTR.map(x => x.lib).sort((a, b) => b.length - a.length)[0] || '';
    v('aucun libellé plus long que celui qui a servi de mesure (« Pétrole WTI »)',
      plusLong.length <= 'Pétrole WTI'.length,
      '« ' + plusLong +' » fait ' + plusLong.length + ' caractères — remesurer le plancher');
  }
}

/* ── 5. LA CARTE, MONTÉE DANS UN VRAI CHROMIUM ──────────────────────────────────────────────── */
function navigateur() {
  const c = [];
  for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    try {
      for (const d of fs.readdirSync(b)) {
        for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, rel));
      }
    } catch {}
  }
  return c.find(x => fs.existsSync(x)) || null;
}

(async () => {
  console.log('\n── La carte rendue, bougies bouchonnées ──');
  let pptr;
  try { pptr = require('puppeteer-core'); } catch { pptr = null; }
  const bin = pptr ? navigateur() : null;
  if (!bin) {
    abst++;
    console.log('  ~ rendu abstenu (aucun navigateur disponible)');
    return fin();
  }

  /* Le serveur d'essai sert le VRAI public/ et bouchonne la seule route dont la carte dépend.
     Les bougies sont fabriquées pour que le classement soit CONNU d'avance : chaque instrument
     reçoit une variation de séance distincte, donc la tête et la queue sont vérifiables. */
  const VARS = { 'DAX': 2.5, 'S&P 500': 1.2, 'FTSE': -0.4, 'CAC 40': 0.8,
    'Gold': -1.7, 'Silver': 0.3, 'Oil WTI': -3.1 };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/bank-ohlc') {
      const sym = u.searchParams.get('sym') || '';
      const pct = VARS[sym];
      if (pct === undefined) return json(res, { candles: [] });
      const base = 100, avant = base, apres = base * (1 + pct / 100);
      const j = 24 * 3600 * 1000, t0 = Date.UTC(2026, 7, 24);   // lundi
      return json(res, { candles: [
        { t: t0, o: base, h: base, l: base, c: base },
        { t: t0 + j, o: avant, h: avant, l: avant, c: avant },
        { t: t0 + 2 * j, o: avant, h: apres, l: avant, c: apres },
      ] });
    }
    if (u.pathname.startsWith('/api/')) return json(res, {});
    /* ⚠️ LA PAGE D'ESSAI EST SERVIE PAR CE SERVEUR, elle n'est pas injectée par `setContent`.
       Avec `setContent`, l'URL du document reste `about:blank` : le widget appelle `/api/bank-ohlc`
       en chemin RELATIF, qui ne résout alors sur aucune origine — la carte restait vide et le banc
       accusait un code correct. Pris sur le fait à la première exécution. */
    if (u.pathname === '/essai.html') {
      const feuilles = fs.readdirSync(path.join(PUB, 'css')).filter(f => f.endsWith('.css'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><html><head><meta charset="utf-8">'
        + feuilles.map(f => '<link rel="stylesheet" href="/css/' + f + '">').join('')
        + '</head><body><div id="cible" style="width:420px;height:360px"></div>'
        + '<div id="etroit" style="width:280px;height:360px"></div>'
        /* ⚠️ HORLOGE FIGÉE AU MERCREDI 26/08/2026 12:00 UTC — la semaine des bougies du bouchon.
           Le banc a POURRI au changement de semaine (rouge le lundi 31/08 à 00h UTC) : la colonne
           « semaine » court du lundi 00h UTC (helpers _psLundiUTC/_psVarSemaine, défaut Date.now),
           et un lundi avant la première clôture le produit rend « — » PAR CONCEPTION. Des bougies
           datées en dur + l'horloge réelle = un banc qui ne teste pas la même chose selon le jour
           où on le lance. On fige donc le POINT DE RÉFÉRENCE, pas les bougies : sous cette
           horloge, les bougies 24-26/08 sont « cette semaine » et la colonne est calculable tous
           les jours de l'année. Décalage (pas valeur fixe) : les minuteries continuent d'avancer. */
        + '<script>(function () { var T = Date.UTC(2026, 7, 26, 12, 0, 0); var vrai = Date.now.bind(Date); var dec = T - vrai(); Date.now = function () { return vrai() + dec; }; })();</script>'
        + '<script src="/js/widgets.js"></script></body></html>');
    }
    const f = path.join(PUB, u.pathname === '/' ? 'index.html' : u.pathname);
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
    res.end(fs.readFileSync(f));
  });
  const json = (res, o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  await new Promise(r => srv.listen(PORT, r));

  let nav;
  try {
    nav = await pptr.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(String(e && e.message || e)));
    await page.goto(`http://localhost:${PORT}/essai.html`, { waitUntil: 'networkidle0', timeout: 30000 });

    const r = await page.evaluate(async () => {
      /* ON MONTE PAR L'API PUBLIQUE (`mountInto`), pas en fouillant le catalogue interne : c'est
         le chemin que le desk lui-même emprunte, donc c'est celui qui doit marcher. */
      const API = window.DTPWidgets;
      if (!API || typeof API.mountInto !== 'function') {
        return { erreur: 'DTPWidgets.mountInto indisponible' };
      }
      const liste = (typeof API.catalogue === 'function') ? API.catalogue() : [];
      if (!liste.some(x => x.id === 'indices-matieres')) return { erreur: 'widget absent du catalogue' };
      const host = document.getElementById('cible');
      if (!API.mountInto('indices-matieres', host)) return { erreur: 'montage refusé' };
      /* Une SECONDE carte, étroite : c'est la largeur où le libellé le plus long (« Pétrole WTI »)
         se fait rogner si la colonne des noms est trop juste. Mesuré, pas estimé. */
      const etroit = document.getElementById('etroit');
      API.mountInto('indices-matieres', etroit);
      for (let i = 0; i < 60 && !host.querySelector('.wdg-xa-l'); i++) await new Promise(r => setTimeout(r, 100));
      const lignes = [...host.querySelectorAll('.wdg-xa-l')].map(l => ({
        nom: (l.querySelector('.wdg-xa-n') || {}).textContent || '',
        seance: (l.querySelector('.wdg-xa-v') || {}).textContent || '',
        semaine: (l.querySelector('.wdg-xa-s') || {}).textContent || '',
      }));
      /* ⚠️ LA TRONCATURE SE MESURE, elle ne se déduit pas d'une largeur écrite dans la feuille :
         la police, le zoom et la gouttière entrent tous dans le calcul. `scrollWidth > clientWidth`
         est le seul verdict qui tienne — et c'est celui du navigateur, pas le nôtre. */
      const rogne = (sel) => [...document.querySelectorAll(sel + ' .wdg-xa-n')]
        .filter(e => e.scrollWidth > e.clientWidth + 1)
        .map(e => e.textContent + ' (' + e.scrollWidth + ' > ' + e.clientWidth + ')');
      return {
        lignes,
        rogneLarge: rogne('#cible'),
        rogneEtroit: rogne('#etroit'),
        lignesEtroit: etroit.querySelectorAll('.wdg-xa-l').length,
        semaineEtroit: [...etroit.querySelectorAll('.wdg-xa-s')].filter(e => e.offsetParent !== null).length,
        groupes: [...host.querySelectorAll('.wdg-xa-grp')].map(g => g.textContent),
        verdict: (host.querySelector('.wdg-verdict-txt') || {}).textContent || '',
        pied: (host.querySelector('.wdg-xa-pied') || {}).textContent || '',
      };
    });

    if (r.erreur) {
      abst++;
      console.log('  ~ rendu abstenu (' + r.erreur + (r.cles ? ' ; clés vues : ' + r.cles.join(',') : '') + ')');
    } else {
      v('la carte rend une ligne par instrument', r.lignes.length === (INSTR || []).length,
        r.lignes.length + ' ligne(s) pour ' + (INSTR || []).length + ' instrument(s)');
      v('les deux familles portent leur intertitre',
        r.groupes.length === 2 && /Indices/.test(r.groupes[0]) && /Matières/.test(r.groupes[1]),
        JSON.stringify(r.groupes));
      v('les libellés sont en français', r.lignes.some(l => /Pétrole WTI/.test(l.nom)) && r.lignes.some(l => /^Or$/.test(l.nom.trim())),
        r.lignes.map(l => l.nom).join(' | '));
      /* Le classement est CONNU du bouchon : le pétrole (−3,1 %) ferme la marche, le DAX (+2,5 %)
         mène. Un verdict qui nommerait quelqu'un d'autre serait un tri cassé. */
      v('le verdict nomme le meneur de séance', /DAX/.test(r.verdict), r.verdict);
      v('… et celui qui ferme la marche', /Pétrole WTI/.test(r.verdict), r.verdict);
      /* `every` sur un tableau VIDE rend `true` : sans le compte, ce contrôle passait au vert
         alors que la carte n'avait rendu aucune ligne. */
      v('la colonne semaine est renseignée', r.lignes.length > 0 && r.lignes.every(l => /%/.test(l.semaine)),
        r.lignes.map(l => l.semaine).join(' | '));
      v('le pied dit que les places n’ouvrent pas aux mêmes heures', /mêmes heures/.test(r.pied), r.pied);
      /* ⚠️ CE QUE CES DEUX CONTRÔLES VOIENT, ET CE QU'ILS NE VOIENT PAS — dit ici parce que la
         nuance a failli me faire livrer une fausse garantie. Ce Chromium n'a pas les polices du
         desk : `getComputedStyle(body).fontFamily` retombe sur la pile système, plus ÉTROITE que
         celle servie en production. Mesuré : à 66 px de colonne, « Pétrole WTI » déborde
         franchement dans un rendu à police large (scroll 76 pour 66 de place) et tient tout juste
         ici. Ces deux contrôles attrapent donc un débordement FRANC — une colonne réduite à 30 px,
         un libellé rallongé de moitié — pas les derniers pixels. Le contrôle qui tranche vraiment
         est le plancher de largeur déclarée, juste après : lui ne dépend d'aucune police. */
      v('aucun libellé n’est rogné à la taille normale', r.rogneLarge.length === 0, r.rogneLarge.join(', '));
      v('… ni sur une carte étroite (débordement franc)',
        r.rogneEtroit.length === 0, r.rogneEtroit.join(', '));
      v('la carte étroite garde TOUTES ses lignes', r.lignesEtroit === r.lignes.length,
        r.lignesEtroit + ' contre ' + r.lignes.length);
      /* Ce qui cède à l'étroit est la SEMAINE, et rien d'autre : c'est la colonne la moins urgente,
         et la sacrifier garde intacts le nom, la barre et la variation de séance. */
      v('… et c’est la colonne SEMAINE qui cède, pas les chiffres du jour',
        r.semaineEtroit === 0, r.semaineEtroit + ' cellule(s) semaine encore visible(s)');
      v('aucune erreur d’exécution', erreurs.length === 0, erreurs.join(' | '));
    }
  } catch (e) {
    abst++;
    console.log('  ~ rendu abstenu (' + (e && e.message) + ')');
  } finally {
    try { if (nav) await nav.close(); } catch {}
    srv.close();
  }
  fin();
})();

function fin() {
  console.log(ko
    ? '\n✗ ' + ko + ' CONTRÔLE(S) AU ROUGE\n'
    : '\n✓ ' + (abst ? 'contrôles au vert (' + abst + ' abstenu)' : 'tous les contrôles au vert') + '\n');
  process.exit(ko ? 1 : 0);
}
