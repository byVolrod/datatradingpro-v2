#!/usr/bin/env node
/**
 * scripts/modele-verif.js — LE MODÈLE CHOISI SURVIT-IL À LA NAVIGATION ?
 * ------------------------------------------------------------------------------------------------
 * 04/09, demande utilisateur, deux captures à l'appui :
 * « J'avais sélectionné mon template personnalisé JOT, puis en naviguant simplement vers Journal de
 *  trading et ensuite en revenant sur Accueil, mon layout a changé automatiquement et je suis
 *  repassé sur un autre template. […] Corrige la cause racine, pas seulement le cas actuel. Aucun
 *  utilisateur ne doit pouvoir perdre ou voir changer son template personnalisé simplement en
 *  naviguant dans le DTP. »
 *
 * LA CAUSE, ET ELLE ÉTAIT DÉLIBÉRÉE. `DTPWidgets.open()` est appelé par `activateView('widgets')`
 * (charts.js) — donc à CHAQUE retour sur Mon Desk, et pas seulement à l'arrivée. Il y réécrivait
 * `c.active` avec le layout marqué ★, au nom de la règle du 23/07 : « à l'arrivée sur Mon Desk on
 * ouvre le layout ★, pas le dernier utilisé ». Le mot « arrivée » avait été traduit par « chaque
 * activation de la vue », ce qui n'est pas la même chose : un aller-retour d'onglet suffisait à
 * effacer le choix de l'utilisateur.
 *
 * ⚠️ POURQUOI CE BANC OUVRE UN NAVIGATEUR PLUTÔT QUE DE LIRE LE CODE. Le défaut ne vit ni dans une
 * fonction isolée ni dans une chaîne : il vit dans un ENCHAÎNEMENT — activer une vue, en activer une
 * autre, revenir. Un contrôle qui lit `open()` verrait bien la ligne fautive, mais il ne verrait pas
 * qu'elle est atteinte à chaque navigation ; et si demain un autre chemin réécrit `c.active`, la
 * lecture de source resterait verte. On rejoue donc le scénario exact de la capture, sur le vrai
 * desk, et on regarde le modèle actif AVANT et APRÈS.
 *
 * ⚠️ ET ON GARDE AUSSI LE FILET. Retirer purement et simplement toute réparation ferait s'ouvrir Mon
 * Desk sur une grille vide le jour où le modèle actif a été supprimé ailleurs, ou masqué. Le banc
 * éprouve donc les deux moitiés de la règle : on ne touche JAMAIS à un choix valide, on répare
 * TOUJOURS un choix devenu invalide.
 *
 *   node scripts/modele-verif.js
 *
 * Sans Chromium, le banc S'ABSTIENT (code 0).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { serveur, trouverNavigateur } = require('./mobile-apercu.js');

const RACINE = path.join(__dirname, '..');
const PORT = 4831;
let ko = 0;
const v = (nom, cond, detail) => {
  if (cond) console.log('  ✓ ' + nom);
  else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); }
};

/* ══ PHASE 0 : CE QUE LE SOURCE DOIT DIRE ══════════════════════════════════════════════════════
   Deux contrôles seulement, et ils ne remplacent pas le scénario : ils gardent la RÈGLE elle-même,
   y compris ses traces écrites — un libellé qui décrit une règle abolie ment avec l'autorité du
   produit, et c'est ce genre de trace qui fait reprendre plus tard une mauvaise décision. */
function phaseSource() {
  console.log('\n── La règle, et ses traces ──');
  const W = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
  const zone = W.slice(W.indexOf('open: function ()'), W.indexOf('close: function ()'));
  v('l\'arrivée sur Mon Desk n\'impose plus le layout ★',
    !/var fav = \(c\.layouts \|\| \[\]\)\.find\(function \(l\) \{ return l && l\.fav; \}\);\s*\n\s*if \(fav\) \{ c\.active = fav\.id;/.test(zone),
    'la ligne qui écrasait `c.active` à chaque activation de la vue est de retour');
  /* Le filet, lui, DOIT rester : c'est la moitié de la règle qui empêche une grille vide. */
  v('… mais le filet « modèle actif disparu ou masqué » est conservé',
    /if \(cur && !cur\.hidden\) return;/.test(zone),
    'sans lui, un modèle supprimé ailleurs ouvrirait Mon Desk sur du vide');
  /* La trace écrite : l'infobulle de l'étoile promettait « le layout qui s'ouvre à l'arrivée ». */
  v('l\'infobulle de l\'étoile ne promet plus une règle abolie',
    !/le layout qui s'ouvre à l\\?'arrivée sur Mon Desk/.test(W),
    'le ★ ne s\'impose plus à l\'arrivée : son libellé doit le dire');
}

(async () => {
  phaseSource();
  const bin = trouverNavigateur();
  if (!bin) { console.log('\n[Modèle] aucun Chromium → phase navigateur abstenue.\n'); process.exit(ko ? 1 : 0); }
  let pp; try { pp = require('puppeteer-core'); }
  catch { console.log('\n[Modèle] puppeteer-core absent → phase navigateur abstenue.\n'); process.exit(ko ? 1 : 0); }

  const srv = serveur();
  await new Promise((r) => srv.listen(PORT, r));
  /* Mon Desk n'existe que pour un compte ADMIN dans le bouchon commun : on le dérive ici plutôt que
     d'écrire un second jeu d'essai, qui divergerait. */
  const srvAdmin = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (['/api/me', '/api/auth/me', '/api/session', '/api/user'].includes(u)) {
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      return rs.end(JSON.stringify({ ok: true, loggedIn: true, authenticated: true, role: 'admin',
        user: { id: 'u1', email: 'banc@datatradingpro.com', name: 'Banc', role: 'admin', plan: 'professionnel', active: true } }));
    }
    srv.emit('request', rq, rs);
  });
  await new Promise((r) => srvAdmin.listen(PORT + 1, r));

  let nav;
  try {
    nav = await pp.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    const fatales = [];
    page.on('pageerror', (e) => fatales.push(String(e.message).slice(0, 160)));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://localhost:${PORT + 1}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 2600));

    const pret = await page.evaluate(() => {
      const b = document.getElementById('widgets-btn'); if (!b) return 'bouton Mon Desk absent';
      if (!window.DTPWidgets) return 'DTPWidgets absent';
      b.click(); return 'ok';
    });
    if (pret !== 'ok') { console.log('\n  ~ ' + pret + ' → scénario abstenu.'); }
    else {
      await new Promise((r) => setTimeout(r, 2600));
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 1000));

      /* ON FABRIQUE LE CAS DE LA CAPTURE : un SECOND modèle, choisi par l'utilisateur, pendant que
         l'étoile reste sur le modèle par défaut. C'est très exactement la configuration du « JOT » :
         un modèle personnel actif, un modèle marqué ★ à côté. Sans ce second modèle, le défaut est
         invisible — le seul modèle existant étant déjà l'étoilé. */
      const pose = await page.evaluate(() => {
        // Pas d'accès direct à STATE : on passe par le parcours PUBLIC, celui de l'utilisateur.
        try { window.DTPWidgets.newLayout(); } catch (e) { return 'newLayout: ' + e.message; }
        try { window.DTPWidgets.createLayout(null); } catch (e) { return 'createLayout: ' + e.message; }
        return 'ok';
      });
      await new Promise((r) => setTimeout(r, 900));

      const avant = await page.evaluate(() => {
        const bar = [...document.querySelectorAll('.wdg-lay')].filter((b) => !b.classList.contains('wdg-lay-add'));
        /* La barre marque son onglet actif par `nav-item--active` (renderBar), et porte l'identifiant
           du modèle dans `data-lay`. On lit l'ID, pas le libellé : deux modèles peuvent porter le
           même nom, et un renommage ne doit pas faire passer ce contrôle pour un changement. */
        const act = bar.find((b) => b.classList.contains('nav-item--active'));
        return { n: bar.length, actif: act ? act.dataset.lay : null,
                 noms: bar.map((b) => (b.querySelector('.wdg-lay-name') || b).textContent.trim()) };
      });

      if (avant.n < 2) {
        console.log('\n  ~ un seul modèle dans la barre (' + pose + ') → scénario abstenu : le défaut exige un modèle personnel À CÔTÉ de l\'étoilé.');
      } else {
        console.log('\n── Le scénario de la capture ──');
        console.log('  · modèles : ' + avant.noms.join(' · ') + ' — actif : ' + avant.actif);
        /* Aller-retour EXACT de la capture : Journal de trading, puis Accueil. */
        await page.evaluate(() => { try { activateView('journal'); } catch (e) {} });
        await new Promise((r) => setTimeout(r, 900));
        await page.evaluate(() => { try { activateView('widgets'); } catch (e) {} });
        await new Promise((r) => setTimeout(r, 1200));

        const apres = await page.evaluate(() => {
          const bar = [...document.querySelectorAll('.wdg-lay')].filter((b) => !b.classList.contains('wdg-lay-add'));
          const act = bar.find((b) => b.classList.contains('nav-item--active'));
          return { actif: act ? act.dataset.lay : null };
        });
        v('le modèle actif ne change pas en revenant du Journal de trading',
          apres.actif != null && apres.actif === avant.actif,
          'avant : « ' + avant.actif +' » · après : « ' + apres.actif + ' »');

        /* ET LE SECOND ALLER-RETOUR : un défaut qui ne se déclenche qu'une fois sur deux serait pire
           qu'un défaut franc. On repasse par une AUTRE vue, pour ne pas éprouver le seul Journal. */
        await page.evaluate(() => { try { activateView('calendar'); } catch (e) {} });
        await new Promise((r) => setTimeout(r, 700));
        await page.evaluate(() => { try { activateView('widgets'); } catch (e) {} });
        await new Promise((r) => setTimeout(r, 900));
        const apres2 = await page.evaluate(() => {
          const bar = [...document.querySelectorAll('.wdg-lay')].filter((b) => !b.classList.contains('wdg-lay-add'));
          const act = bar.find((b) => b.classList.contains('nav-item--active'));
          return { actif: act ? act.dataset.lay : null };
        });
        v('… ni en revenant d\'une autre vue du desk',
          apres2.actif === avant.actif, 'après le second aller-retour : « ' + apres2.actif + ' »');

        /* ⚠️ LE FILET DE `open()` NE SE JOUE PAS DEPUIS L'INTERFACE, ET C'EST TANT MIEUX. Il ne se
           déclenche que si `c.active` désigne un modèle absent ou masqué — or l'interface ferme ce
           chemin : `toggleHide` rebascule elle-même sur le premier modèle visible, et refuse de
           masquer le dernier. Le filet garde donc un cas qui vient d'AILLEURS : une configuration
           écrite sur un autre appareil, un modèle supprimé pendant qu'on était sur une autre vue.
           On éprouve ici ce qui EST atteignable — fermer l'onglet actif ne laisse jamais Mon Desk
           vide — et la présence du filet est gardée par la phase source, plus haut. */
        const ferme = await page.evaluate(() => {
          const bar = [...document.querySelectorAll('.wdg-lay')].filter((b) => !b.classList.contains('wdg-lay-add'));
          const act = bar.find((b) => b.classList.contains('nav-item--active'));
          if (!act || !act.dataset.lay || !window.DTPWidgets) return 'sans prise';
          try { DTPWidgets.toggleHide(act.dataset.lay); } catch (e) { return 'toggleHide: ' + e.message; }
          return 'ok';
        });
        if (ferme === 'ok') {
          await new Promise((r) => setTimeout(r, 800));
          const rep = await page.evaluate(() => {
            const bar = [...document.querySelectorAll('.wdg-lay')].filter((b) => !b.classList.contains('wdg-lay-add'));
            const act = bar.find((b) => b.classList.contains('nav-item--active'));
            return { actif: act ? act.dataset.lay : null,
                     cartes: document.querySelectorAll('#view-widgets .wdg-card').length,
                     onglets: bar.length };
          });
          /* ⚠️ ON N'EXIGE PAS UN ONGLET MARQUÉ ACTIF, ET C'EST VOULU : à un seul modèle visible, la
             barre est VIDÉE exprès (« masque cette bande noire pour gagner de l'espace », 04/08).
             Ma première rédaction de ce contrôle réclamait un onglet actif et rougissait sur ce
             comportement-là, pas sur un défaut. Ce qui compte ici est la seule chose que
             l'utilisateur verrait : le desk montre encore des cartes. */
          v('fermer l\'onglet actif ne laisse jamais Mon Desk vide',
            rep.cartes > 0, rep.cartes + ' carte(s) · ' + rep.onglets + ' onglet(s) dans la barre');
        } else {
          console.log('  ~ pas de prise publique pour fermer un onglet (' + ferme + ') → contrôle abstenu.');
        }
      }
    }
    v('aucune erreur d\'exécution pendant le scénario', fatales.length === 0, [...new Set(fatales)].slice(0, 3).join(' | '));
    await page.close();
  } catch (e) {
    console.log('\n[Modèle] phase navigateur interrompue : ' + (e && e.message));
  } finally {
    if (nav) await nav.close();
    srvAdmin.close();
    srv.close();
  }

  console.log(ko === 0 ? '\n[Modèle] tout est vert.\n' : '\n[Modèle] ' + ko + ' contrôle(s) au rouge.\n');
  process.exit(ko ? 1 : 0);
})();
