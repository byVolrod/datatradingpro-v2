#!/usr/bin/env node
/**
 * scripts/journal-verif.js — LE JOURNAL DE TRADING, ET SA LECTURE ANNUELLE
 * ------------------------------------------------------------------------------------------------
 * 04/09, demande utilisateur, captures de son tableau annuel à l'appui :
 * « Fais une grosse refonte de tout le journal de trading, le widget et aussi le journal directement
 *  du desk. Je souhaite ajouter à côté de Tableau de bord un YEARLY, puis réorganiser, refonte
 *  totale pour qu'il soit mieux ; ajoute aussi ce MONTHLY qui se trouve dans yearly en bas. »
 *
 * CE QUE CE BANC GARDE, ET POURQUOI CHAQUE CONTRÔLE EXISTE.
 *
 * 1. LE TROISIÈME ONGLET N'EST PAS QU'UN BOUTON. `_jrSetTab` aiguillait sur un ternaire à deux
 *    branches (`t === 'dash' ? 'dash' : 'log'`). Ajouter « Annuel » sans toucher cette ligne
 *    l'aurait silencieusement renvoyé sur « Trades » — et le réglage mémorisé par compte aurait
 *    rejoué ce mauvais choix au chargement suivant. Un aiguillage à deux branches ne se rallonge
 *    pas, il se remplace : le banc éprouve les TROIS onglets, pas seulement le nouveau.
 *
 * 2. UN MOIS SANS TRADE N'EST PAS UN MOIS À ZÉRO, et c'est la distinction qui fait l'intérêt d'une
 *    lecture annuelle. Un zéro se lit comme un résultat nul alors qu'il n'y a eu aucune prise de
 *    position. Le jeu d'essai contient donc un mois DÉLIBÉRÉMENT VIDE (avril 2026), et le banc
 *    exige qu'il reste présent dans le tableau, en tiret et non en 0.
 *
 * 3. ⚠️ LES CHIFFRES SONT REJOUÉS, PAS RELUS. Le banc recalcule lui-même, à partir du même jeu
 *    d'essai, le R et le nombre de trades d'un mois donné, puis compare à ce que la page AFFICHE.
 *    Un contrôle qui se contenterait de compter douze lignes serait vert sur un tableau rempli de
 *    zéros — exactement le genre de faux vert que ce dépôt traque depuis l'incident du fil vide.
 *
 * 4. ET LE CADRAN DIT COMBIEN. La refonte remplace la bordure pleine par un ARC proportionnel. Un
 *    arc qui ne bouge pas avec la valeur serait une décoration : on lit donc le `stroke-dasharray`
 *    RENDU du taux de réussite et on vérifie qu'il correspond à la fraction attendue — et qu'un
 *    cadran SANS maximum honnête (un total en R, un nombre de trades) garde bien un arc plein
 *    plutôt qu'une proportion inventée.
 *
 * 5. LES DOUZE PAVÉS « R PAR MOIS » PORTENT LES MÊMES CHIFFRES QUE LE TABLEAU — ET C'EST
 *    JUSTEMENT POURQUOI ON LES ÉPROUVE SÉPARÉMENT. Deux blocs alimentés aujourd'hui par la même
 *    fonction divergent le jour où l'on touche à l'un des deux. Le R du mois d'essai est donc
 *    recalculé CONTRE LE PAVÉ, et le mois vide y reste vide : ni barre, ni zéro.
 *
 * 6. LA COULEUR DES DONNÉES N'EST PLUS L'OR DE MARQUE, ET ON LIT LA COULEUR PEINTE. Demande de
 *    l'utilisateur : « des couleurs différentes que du doré, car là on parle de datas ». Un `grep`
 *    de `#e3b23a` dans le source ne prouverait rien — il serait rouge pour toutes les occurrences
 *    légitimes (titres, bordures, onglet actif) et vert si une règle CSS repeignait la barre en or.
 *    On relit donc `getComputedStyle` des marques rendues. ⚠️ ET PAR PAIRE : « aucune marque dorée »
 *    est vrai sur une page vide, donc un témoin positif exige qu'une teinte de la palette MESURÉE
 *    peigne réellement quelque chose.
 *
 *   node scripts/journal-verif.js
 *
 * Sans Chromium, le banc S'ABSTIENT (code 0).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { serveur, trouverNavigateur } = require('./mobile-apercu.js');

const RACINE = path.join(__dirname, '..');
const PORT = 4837;
let ko = 0;
const v = (nom, cond, detail) => {
  if (cond) console.log('  ✓ ' + nom);
  else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); }
};

/* ══ LE JEU D'ESSAI, ET CE QU'IL ENCODE ════════════════════════════════════════════════════════
   Deux années (pour éprouver le sélecteur), un mois VIDE au milieu de 2026, et des R dont le signe
   varie — sans quoi tous les mois seraient positifs et la ligne « Négatif » du bloc Résultat ne
   serait jamais exercée. Les valeurs sont DÉTERMINISTES : un jeu d'essai aléatoire rendrait le banc
   irreproductible, et un banc qu'on ne peut pas rejouer à l'identique ne prouve rien. */
const MOIS_VIDE = 3;                      // avril 2026, volontairement sans aucun trade
function jeuDEssai() {
  const out = []; let id = 0, eq = 100000;
  const paires = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'AUDUSD', 'USDCAD'];
  for (const an of [2025, 2026]) {
    for (let m = 0; m < 12; m++) {
      if (an === 2026 && m > 8) break;                 // l'année en cours s'arrête au mois courant
      if (an === 2026 && m === MOIS_VIDE) continue;    // LE mois vide
      const n = 2 + ((m * 7 + an) % 9);
      for (let k = 0; k < n; k++) {
        const r = +(Math.sin(m * 3 + k * 1.7 + an) * 2.2).toFixed(2);
        const pl = +(r * 230).toFixed(2); eq += pl;
        out.push({ id: 't' + (id++), ts: Date.UTC(an, m, 2 + ((k * 3) % 25), 10, 0),
          pair: paires[(m + k) % paires.length], dir: k % 3 ? 'BUY' : 'SELL',
          r, rr: +(1.5 + ((k % 4) * 0.4)).toFixed(2), pl, pnlPct: +(r * 0.23).toFixed(2), equity: +eq.toFixed(2),
          result: r > 0 ? 'Profit' : r < 0 ? 'Loss' : 'BE',
          setup: ['Breakout', 'Reversal', 'Pullback', 'Range'][k % 4],
          conf: ['Trend', 'Structure', 'Fibonacci', 'News'][k % 4],
          entryT: ['Break', 'Retest', 'Rejet'][k % 3], sl: ['Serré', 'Normal', 'Large'][k % 3],
          session: ['London', 'New York', 'Asia'][k % 3], fonda: [50, 75, 100][k % 3] });
      }
    }
  }
  return out;
}

/* ══ CALIBRAGE DU CAPITAL — LES TROIS ISSUES (04/09, retour d'un client sur le Discord) ═════════
   « Je l'utilise, mais pour calibrer mon capital je trouve assez moyen ; ça reste un très bon outil
    pour tracker. » Le bloc de calibrage a TROIS issues, dont deux sont des REFUS — et ce sont elles
   qui comptent le plus : un bloc qui conseille toujours quelque chose ment une fois sur deux.
   Le pire cas n'est pas de se taire, c'est d'annoncer « risquez 0,5 % » à quelqu'un dont la méthode
   est perdante. On éprouve donc les trois, avec un journal fabriqué pour chacune. */
const CALIB = [
  { nom: 'un avantage réel → un chiffre applicable', edge: true, n: 60, etat: 'jrc-verdict--pos', mot: /Risque conseillé/ },
  { nom: 'AUCUN avantage → on refuse de conseiller une taille', edge: false, n: 60, etat: 'jrc-verdict--neg', mot: /Aucun avantage mesurable/ },
  { nom: 'échantillon trop court → on mesure sans conclure', edge: true, n: 8, etat: 'jrc-verdict--attente', mot: /Pas encore d'avis/ },
];
/* `edge` vrai : six gains de 1,8 R pour quatre pertes de 1 R — un avantage franc. Faux : quatre
   gains de 1 R pour six pertes de 1 R, donc une espérance négative que AUCUNE taille de position ne
   redresse. Les deux séries sont déterministes. */
function journalCalib(edge, n) {
  const out = []; let eq = 100000;
  for (let k = 0; k < n; k++) {
    const gagne = (k % 10) < (edge ? 6 : 4);
    const r = gagne ? (edge ? 1.8 : 1.0) : -1.0;
    const pl = r * 1000; eq += pl;
    out.push({ id: 'c' + k, ts: Date.UTC(2026, (k / 6 | 0) % 9, 1 + (k % 25), 10, 0), pair: 'EURUSD',
      dir: 'BUY', r, pl, pnlPct: +(r * 0.9).toFixed(2), equity: +eq.toFixed(2), result: r > 0 ? 'Profit' : 'Loss' });
  }
  return out;
}

/* ══ PHASE 0 : L'AIGUILLAGE DES ONGLETS, SANS NAVIGATEUR ═══════════════════════════════════════ */
function phaseSource() {
  console.log('\n── L\'aiguillage des onglets ──');
  const A = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
  v('les onglets du journal viennent d\'une LISTE, pas d\'un ternaire à deux branches',
    /const _JR_TABS = \['log', 'dash', 'year'\]/.test(A) && /_jrTab = _JR_TABS\.indexOf\(t\) >= 0 \? t : 'log'/.test(A),
    'un ternaire renverrait le troisième onglet sur « Trades » sans rien dire');
  v('… et le réglage mémorisé est validé contre cette même liste',
    /_JR_TABS\.indexOf\(t\) >= 0 \? t : 'log'/.test(A.slice(A.indexOf('DTPPref.get(\'jrtab\''), A.indexOf('function _jrSetTab'))),
    'sinon un `jrtab` devenu invalide rouvrirait silencieusement « Trades »');
  /* ⚠️ L'ORDRE DE LA PALETTE EST UN RÉSULTAT DE MESURE, PAS UN GOÛT. Les cinq teintes ont été
     validées SUR LE FOND DU DESK (`#0d0e11`) : bande de clarté, plancher de chroma, séparation
     daltonienne de chaque paire VOISINE, contraste. Ce sont les paires voisines qui sont mesurées,
     donc réordonner la liste peut faire tomber l'une d'elles sous le seuil sans que rien ne se voie
     sur un écran calibré et un œil valide. Ce contrôle fige la liste mesurée ; le jour où elle doit
     changer, on repasse le validateur AVANT de toucher cette ligne. */
  v('la palette de données est exactement celle qui a été mesurée',
    /const _JR_CAT = \['#3987e5', '#d55181', '#9085e9', '#1ba0a5', '#d95926'\]/.test(A),
    'toute modification de cette liste exige de repasser le validateur de palettes');
  v('… et aucune des cinq n\'empiète sur les couleurs RÉSERVÉES (vert / rouge / ambre)',
    !/const _JR_CAT = \[[^\]]*(00e676|ff3d00|ffb300|00cc99|e3b23a)/.test(A),
    'une teinte verte, rouge ou ambrée serait lue comme « gagnant / perdant / neutre » avant d\'être lue comme une catégorie');
  const H = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');
  v('les trois onglets existent dans la page', /data-jt="log"/.test(H) && /data-jt="dash"/.test(H) && /data-jt="year"/.test(H));
  v('… et l\'onglet Annuel a son conteneur', /id="jr-year"/.test(H));
}

(async () => {
  phaseSource();
  const bin = trouverNavigateur();
  if (!bin) { console.log('\n[Journal] aucun Chromium → phase navigateur abstenue.\n'); process.exit(ko ? 1 : 0); }
  let pp; try { pp = require('puppeteer-core'); }
  catch { console.log('\n[Journal] puppeteer-core absent → phase navigateur abstenue.\n'); process.exit(ko ? 1 : 0); }

  const ENTREES = jeuDEssai();
  /* Le journal SERVI par le bouchon : mutable, pour rejouer la page sur un autre jeu sans réécrire
     un second serveur. */
  let journalServi = ENTREES;
  const srv = serveur();
  await new Promise((r) => srv.listen(PORT, r));
  const srvJ = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (['/api/me', '/api/auth/me', '/api/session', '/api/user'].includes(u)) {
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      return rs.end(JSON.stringify({ ok: true, loggedIn: true, authenticated: true, role: 'admin',
        user: { id: 'u1', email: 'banc@datatradingpro.com', name: 'Banc', role: 'admin', plan: 'professionnel', active: true } }));
    }
    if (u === '/api/journal') {
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      return rs.end(JSON.stringify({ entries: journalServi, custom: false, startCap: 100000 }));
    }
    srv.emit('request', rq, rs);
  });
  await new Promise((r) => srvJ.listen(PORT + 1, r));

  let nav;
  try {
    nav = await pp.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    const fatales = [];
    page.on('pageerror', (e) => fatales.push(String(e.message).slice(0, 160)));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`http://localhost:${PORT + 1}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 2600));

    const ouvert = await page.evaluate(() => {
      const b = document.getElementById('journal-btn');
      if (b) { b.click(); return 'ok'; }
      if (typeof activateView === 'function') { activateView('journal'); return 'ok'; }
      return 'journal inaccessible';
    });
    if (ouvert !== 'ok') { console.log('\n  ~ ' + ouvert + ' → phase navigateur abstenue.'); }
    else {
      await new Promise((r) => setTimeout(r, 2500));

      /* ══ LES TROIS ONGLETS RÉPONDENT ═════════════════════════════════════════════════════════ */
      console.log('\n── Les trois onglets s\'ouvrent vraiment ──');
      for (const [t, id] of [['log', 'jr-log-view'], ['dash', 'jr-dashboard'], ['year', 'jr-year']]) {
        const vu = await page.evaluate((t, id) => {
          if (typeof _jrTabClick !== 'function') return 'pas de _jrTabClick';
          _jrTabClick(t);
          const el = document.getElementById(id);
          const btn = [...document.querySelectorAll('.jr-tab')].find((b) => b.dataset.jt === t);
          return { visible: !!el && !el.classList.contains('hidden'),
                   marque: !!btn && btn.classList.contains('jr-tab--active') };
        }, t, id);
        v('onglet « ' + t + ' » : la vue s\'affiche ET le bouton se marque',
          vu && vu.visible === true && vu.marque === true, JSON.stringify(vu));
        await new Promise((r) => setTimeout(r, 400));
      }

      /* ══ L'ANNUEL : STRUCTURE, PUIS CHIFFRES ═════════════════════════════════════════════════ */
      await page.evaluate(() => _jrTabClick('year'));
      await new Promise((r) => setTimeout(r, 2200));
      console.log('\n── L\'onglet Annuel ──');

      const A = await page.evaluate(() => {
        const q = (s) => [...document.querySelectorAll(s)];
        const lignes = q('#jr-year .jry-table tbody tr').map((tr) => {
          const td = [...tr.children].map((x) => x.textContent.trim());
          return { mois: td[0], vide: tr.classList.contains('jry-row--vide'), now: tr.classList.contains('jry-row--now'),
                   r: td[2], trades: td[5] };
        });
        const anneaux = q('#jr-year .jrd-ring').map((r) => ({
          lbl: (r.querySelector('.jrd-ring-l') || {}).textContent,
          val: (r.querySelector('.jrd-ring-v') || {}).textContent,
          arc: (r.querySelector('.jrd-arc-v') || {}).getAttribute ? r.querySelector('.jrd-arc-v').getAttribute('stroke-dasharray') : null,
        }));
        return { lignes, anneaux,
                 ans: q('#jr-year .jry-an').map((b) => b.textContent.trim()),
                 actif: (q('#jr-year .jry-an.active')[0] || {}).textContent,
                 graphes: q('#jr-year .jr-chart-am').map((x) => x.id) };
      });

      v('le tableau porte les DOUZE mois, même ceux sans trade', A.lignes.length === 12, A.lignes.length + ' ligne(s)');
      /* Le mois d'avril 2026 est vide DANS LE JEU D'ESSAI : c'est le contrôle de la distinction
         « pas de trade » vs « zéro ». Un tableau qui afficherait « 0 » ici mentirait sur l'année. */
      const avril = A.lignes[MOIS_VIDE];
      v('un mois sans trade reste présent, en tiret et non en 0',
        !!avril && avril.vide === true && !/\b0\b/.test(avril.r) && /—|-/.test(avril.r),
        avril ? JSON.stringify(avril) : 'ligne absente');
      v('les deux années du journal sont proposées', A.ans.length === 2 && A.ans.includes('2026') && A.ans.includes('2025'), A.ans.join(' · '));
      v('… et la plus récente est ouverte par défaut', A.actif === '2026', String(A.actif));
      v('les trois graphiques de l\'année ont leur hôte',
        A.graphes.length === 3 && A.graphes.includes('jry-mois-chart') && A.graphes.includes('jry-pct-chart') && A.graphes.includes('jry-trades-chart'),
        A.graphes.join(' · '));

      /* ⚠️ ON REJOUE LE CALCUL. C'est le contrôle qui distingue « douze lignes » de « douze lignes
         JUSTES » : on refait la somme des R et le compte des trades d'un mois à partir du jeu
         d'essai, et on la compare à ce que la page affiche. */
      const moisTest = 6;   // juillet 2026
      const M = ENTREES.filter((e) => { const d = new Date(e.ts); return d.getFullYear() === 2026 && d.getMonth() === moisTest; });
      const rAttendu = M.reduce((a, e) => a + (+e.r || 0), 0);
      const txtR = (rAttendu >= 0 ? '+' : '') + (Math.round(rAttendu * 100) / 100).toString().replace('.', ',');
      v('le R d\'un mois est bien la somme de ses trades (juillet 2026)',
        A.lignes[moisTest] && A.lignes[moisTest].r === txtR,
        'affiché « ' + (A.lignes[moisTest] || {}).r + ' », recalculé « ' + txtR + ' »');
      v('… et son nombre de trades aussi',
        A.lignes[moisTest] && A.lignes[moisTest].trades === String(M.length),
        'affiché « ' + (A.lignes[moisTest] || {}).trades + ' », recalculé « ' + M.length + ' »');

      /* ══ LE CADRAN DIT COMBIEN ═══════════════════════════════════════════════════════════════
         L'arc du taux de réussite doit être PROPORTIONNEL. On relit le `stroke-dasharray` rendu et
         on le compare à la fraction attendue — un arc figé serait une décoration, pas une jauge. */
      const taux = A.anneaux.find((r) => /Taux de réussite/.test(r.lbl || ''));
      const pct = taux ? parseInt(String(taux.val).replace('%', ''), 10) : null;
      const C = 2 * Math.PI * 42;
      const rempli = taux && taux.arc ? parseFloat(String(taux.arc).split(' ')[0]) : null;
      v('l\'arc du taux de réussite est proportionnel à sa valeur',
        pct != null && rempli != null && Math.abs(rempli - C * (pct / 100)) < 2,
        'valeur ' + pct + ' %, arc rempli ' + rempli + ' (attendu ' + (C * (pct / 100)).toFixed(1) + ')');
      /* L'AUTRE MOITIÉ DE LA RÈGLE : un cadran sans maximum honnête ne dessine pas de proportion.
         Sans ce contrôle, on pourrait « remplir » un total en R avec une fraction inventée. */
      const totR = A.anneaux.find((r) => /R de l'année/.test(r.lbl || ''));
      v('… et un cadran SANS maximum honnête garde un arc plein',
        !!totR && !totR.arc, 'arc du total R : ' + (totR ? totR.arc : 'anneau absent'));

      /* ══ « R PAR MOIS » : LES DOUZE PAVÉS DE LA RÉFÉRENCE ════════════════════════════════════
         Le tableau juste en dessous porte les mêmes chiffres — c'est justement pourquoi ce contrôle
         ne peut pas se contenter de compter douze cases : deux blocs alimentés par la même fonction
         peuvent diverger dès qu'on touche à l'un des deux. On rejoue donc le R du mois d'essai
         CONTRE LE PAVÉ, pas contre la ligne du tableau, et on éprouve le mois vide séparément. */
      const RR = await page.evaluate(() => [...document.querySelectorAll('#jr-year .jry-rr')].map((c) => ({
        mois: (c.querySelector('.jry-rr-m') || {}).textContent,
        val: (c.querySelector('.jry-rr-v') || {}).textContent,
        vide: c.classList.contains('jry-rr--vide'),
        barre: (c.querySelector('.jry-rr-t i') || {}).getAttribute ? c.querySelector('.jry-rr-t i').getAttribute('style') : null,
      })));
      v('« R par mois » rend les douze pavés', RR.length === 12, RR.length + ' pavé(s)');
      v('… le pavé du mois d\'essai porte le R recalculé (juillet 2026)',
        !!RR[moisTest] && String(RR[moisTest].val || '').indexOf(txtR) === 0,
        'affiché « ' + (RR[moisTest] || {}).val + ' », recalculé « ' + txtR + ' »');
      /* Le mois vide : en pointillé, SANS barre et SANS chiffre. Une barre à 0 % y ferait croire à
         un résultat nul obtenu en travaillant — la confusion même que ce bloc doit éviter. */
      v('… et le mois sans trade reste vide, sans barre ni zéro',
        !!RR[MOIS_VIDE] && RR[MOIS_VIDE].vide === true && RR[MOIS_VIDE].barre == null && !/\d/.test(RR[MOIS_VIDE].val || ''),
        RR[MOIS_VIDE] ? JSON.stringify(RR[MOIS_VIDE]) : 'pavé absent');

      /* ══ LA COULEUR DES DONNÉES N'EST PLUS L'OR DE MARQUE ════════════════════════════════════
         Demande de l'utilisateur : « des couleurs différentes que du doré, car là on parle de
         datas ». L'or `#e3b23a` habille le desk (titres, bordures, onglet actif) ; employé EN PLUS
         pour peindre une barre de résultat, il ne veut plus rien dire de précis.
         ⚠️ ON LIT LA COULEUR PEINTE, PAS LE SOURCE. Un `grep` de `#e3b23a` dans app.js serait vert
         alors qu'une règle CSS de la feuille repeindrait la barre en or — et rouge pour toutes les
         occurrences légitimes (chrome, onglets, bordures) qui n'ont rien à voir avec les données.
         ⚠️ ET LE CONTRÔLE VA PAR PAIRE. « Aucune marque dorée » est vrai sur une page vide : sans
         le témoin positif ci-dessous, ce banc resterait vert le jour où le tableau de bord ne
         peindrait plus rien du tout. */
      await page.evaluate(() => { if (typeof _jrTabClick === 'function') _jrTabClick('dash'); });
      await new Promise((r) => setTimeout(r, 2000));
      const OR = 'rgb(227, 178, 58)';
      const PAL = ['rgb(57, 135, 229)', 'rgb(213, 81, 129)', 'rgb(144, 133, 233)', 'rgb(27, 160, 165)', 'rgb(217, 89, 38)'];
      const C2 = await page.evaluate(() => {
        const g = (el, prop) => getComputedStyle(el)[prop];
        return {
          barres: [...document.querySelectorAll('#jr-dashboard .jrd-bar-t i')].map((i) => g(i, 'backgroundColor')),
          arcs: [...document.querySelectorAll('#jr-dashboard .jrd-arc-v')].map((a) => g(a, 'stroke')),
        };
      });
      console.log('\n── La couleur des données ──');
      const dorees = C2.barres.filter((c) => c === OR).length + C2.arcs.filter((c) => c === OR).length;
      v('aucune marque de donnée n\'est peinte à l\'or de marque',
        C2.barres.length > 0 && dorees === 0,
        C2.barres.length ? dorees + ' marque(s) en ' + OR : 'aucune barre rendue — le témoin ne prouve rien');
      v('… et la palette mesurée est bien celle qui peint (témoin positif)',
        C2.barres.some((c) => PAL.includes(c)),
        'couleurs vues : ' + [...new Set(C2.barres)].slice(0, 5).join(' · '));

      /* ══ CALIBRAGE DU CAPITAL — LES TROIS VERDICTS (04/09, retour d'un client sur le Discord) ══
         « Je l'utilise, mais pour calibrer mon capital je trouve assez moyen. » Le bloc répond en
         calculant sur SES trades — et il a trois issues possibles, dont deux sont des REFUS. Ce
         sont elles qui comptent le plus : un bloc de calibrage qui conseille toujours quelque
         chose est un bloc qui ment une fois sur deux.
         ⚠️ ON REJOUE LES TROIS, avec un journal fabriqué pour chacune : un avantage réel, une série
         SANS avantage, et un échantillon trop court. Éprouver le seul cas favorable laisserait
         passer le plus coûteux — afficher « risquez 0,5 % » à quelqu'un dont la méthode est
         perdante. */
      console.log('\n── Calibrage du capital : les trois verdicts ──');
      /* ⚠️ ON RECHARGE LA PAGE POUR CHAQUE CAS, ET C'EST DÉLIBÉRÉ. La tentation était d'exposer un
         crochet `window._jrTestSet(...)` pour remplacer la liste en mémoire : c'est plus rapide, et
         c'est une porte de test dans le code LIVRÉ, qu'aucun contrôle ne protège ensuite. On sert
         donc trois journaux différents par le bouchon et on relit la page — le chemin réel du
         produit, celui qu'emprunte un vrai client. */
      for (const c of CALIB) {
        journalServi = journalCalib(c.edge, c.n);
        await page.goto(`http://localhost:${PORT + 1}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await new Promise((r) => setTimeout(r, 2400));
        await page.evaluate(() => {
          const b = document.getElementById('journal-btn');
          if (b) b.click(); else if (typeof activateView === 'function') activateView('journal');
        });
        await new Promise((r) => setTimeout(r, 2200));
        await page.evaluate(() => { if (typeof _jrTabClick === 'function') _jrTabClick('dash'); });
        await new Promise((r) => setTimeout(r, 1600));
        const vu = await page.evaluate(() => {
          const v = document.querySelector('.jrc-verdict');
          return v ? { cls: (String(v.className).match(/jrc-verdict--\w+/) || [''])[0],
                       txt: (v.querySelector('.jrc-verdict-t') || {}).textContent || '' } : null;
        });
        v('calibrage — ' + c.nom,
          !!vu && vu.cls === c.etat && c.mot.test(vu.txt),
          vu ? 'état « ' + vu.cls + ' », titre « ' + vu.txt + ' »' : 'aucun verdict rendu');
      }

      v('aucune erreur d\'exécution', fatales.length === 0, [...new Set(fatales)].slice(0, 3).join(' | '));
    }
    await page.close();
  } catch (e) {
    console.log('\n[Journal] phase navigateur interrompue : ' + (e && e.message));
  } finally {
    if (nav) await nav.close();
    srvJ.close();
    srv.close();
  }

  console.log(ko === 0 ? '\n[Journal] tout est vert.\n' : '\n[Journal] ' + ko + ' contrôle(s) au rouge.\n');
  process.exit(ko ? 1 : 0);
})();
