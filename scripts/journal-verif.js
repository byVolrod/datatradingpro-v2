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
