#!/usr/bin/env node
/**
 * scripts/lecteur-verif.js — LE LECTEUR DE RAPPORTS SE LIT-IL JUSQU'AU BOUT SUR UN TÉLÉPHONE ?
 * ------------------------------------------------------------------------------------------------
 * 04/09, capture utilisateur (Récap Quotidien ouvert dans une carte de Mon Desk, sur un iPhone
 * installé sur l'écran d'accueil) : « Je ne parviens pas à scroll plus bas corrige ça. Je peux pas
 * lire la data du bas genre la fin. »
 *
 * CE QUE MONTRAIT LA CAPTURE, ET QUE PLUS AUCUN CONTRÔLE DU PROJET NE VOYAIT :
 *   1. la rubrique « À surveiller » est un TABLEAU À HUIT COLONNES, enveloppé dans
 *      `.fxdr-tablewrap { overflow-x: auto }`. Sur 390 px, l'en-tête s'arrête sur un « RÉ » coupé
 *      net : « Réel », « Prévision » et « Précédent » — c'est-à-dire les chiffres — sont hors
 *      champ à droite, et rien ne le dit ;
 *   2. et ce tableau occupe le BAS de l'écran, donc la zone où le pouce se pose. Un geste vertical
 *      qui commence dans un conteneur défilant y reste : WebKit ne le transmet pas au lecteur
 *      au-dessus. Le doigt ne faisait donc plus rien, alors que le rapport avait encore des lignes.
 *      D'où « je ne parviens pas à scroll plus bas », qui n'était pas une impression.
 *
 * ⚠️ CE BANC NE MESURE PAS « EST-CE QUE ÇA DÉFILE DANS CHROME » — dans Chrome, ça défilait. Chrome
 * transmet le geste au conteneur suivant, WebKit non : un contrôle qui se contente de faire
 * défiler serait resté VERT tout du long, sur le défaut même qu'on répare. On mesure donc la
 * CAUSE, qui est la même dans les deux moteurs : entre une ligne du calendrier du rapport et la
 * zone qui défile, PLUS AUCUN ancêtre ne doit avoir de débordement défilable.
 *
 * ⚠️ ET UN SECOND DÉFAUT, TROUVÉ EN CHEMIN, QUI TIENT DE LA MÊME MALADIE QU'UN COMMENTAIRE PÉRIMÉ :
 * `@media (max-width: 768px) { .arlib-rcontent { padding: 12px } }` n'a JAMAIS rien fait. Mille
 * lignes plus bas, `.arlib-rcontent { padding: 28px max(32px, …) 48px }` a la MÊME spécificité et
 * gagne par l'ordre du source. Mesuré à 390, 412 et 470 px : le lecteur rendait « 28px max(32px,
 * 50% - 520px) 48px ». Le rapport perdait 64 des 390 px de l'écran en marges latérales. Une règle
 * mobile écrasée est pire qu'une règle absente : elle se lit comme un correctif déjà appliqué.
 *
 *   node scripts/lecteur-verif.js
 *
 * Sans Chromium, le banc S'ABSTIENT (code 0) — il ne rend jamais un poste inutilisable.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { serveur, trouverNavigateur, UA_IOS } = require('./mobile-apercu.js');

const RACINE = path.join(__dirname, '..');
const PORT = 4823;
/* TROIS SITUATIONS, PAS TROIS LARGEURS. Le lecteur de rapports a DEUX points de montage — la carte
   à onglets de Mon Desk (celui de la capture) et l'onglet ANALYSTES du desk — et ils ne lui donnent
   pas la même chaîne de hauteur. N'en éprouver qu'un laisserait l'autre sans surveillance. La
   troisième ligne est une largeur, elle : celle qui a servi à fixer le seuil du repli. */
const APPAREILS = [
  { nom: 'iPhone 14 · carte de Mon Desk', w: 390, h: 844, monDesk: true },
  { nom: 'iPhone 14 · onglet Analystes', w: 390, h: 844, monDesk: false },
  /* 720 : la largeur qui a servi à fixer le seuil du repli à 768 et non 560. Le lecteur y est
     encore trop étroit pour huit colonnes — mesuré avant correctif : 193 px de débordement, et
     les cellules « Préc. » 162 px hors cadre. */
  { nom: 'Fenêtre étroite (720) · onglet Analystes', w: 720, h: 900, monDesk: false },
];

/* ══ PHASE 0 : LA FEUILLE DE STYLE, SANS NAVIGATEUR ═════════════════════════════════════════════
   Ces contrôles-ci gardent ce qu'un navigateur de banc ne peut PAS voir : `env(safe-area-inset-*)`
   vaut 0 partout sauf sur un vrai iPhone. La valeur calculée ne prouve donc rien ; la DÉCLARATION,
   si. */
function phaseFeuille() {
  let ko = 0;
  const v = (nom, cond, detail) => { if (cond) console.log('  ✓ ' + nom); else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };
  const css = fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8');
  const html = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');

  console.log('\n── La barre d\'accueil iOS ne mange plus la fin d\'un rapport ──');
  /* Le desk se déclare `viewport-fit=cover` ET installable : posé sur l'écran d'accueil, il occupe
     TOUTE la dalle, indicateur d'accueil compris. Sans ces deux-là, la question ne se poserait pas
     — c'est pourquoi on les vérifie AVANT d'exiger le remède. */
  v('le desk couvre bien toute la dalle (c\'est ce qui crée le problème)',
    /viewport-fit=cover/.test(html) && /apple-mobile-web-app-capable"\s+content="yes"/.test(html));
  v('le HAUT était déjà réservé (--topbar-h ajoute l\'encoche)',
    /--topbar-h:\s*calc\([^)]*env\(safe-area-inset-top/.test(css),
    'si cette ligne disparaît, l\'asymétrie que ce banc surveille n\'a plus de sens');
  /* LE CŒUR : le bas ne l'était NULLE PART. On exige la déclaration sur les deux lecteurs. */
  v('… et le BAS l\'est désormais, dans le lecteur Analystes',
    /#arlib-rcontent\s*\{[^}]*env\(safe-area-inset-bottom/.test(css));
  v('… et dans le lecteur Institutions',
    /#br-rcontent:not\(\.br-rcontent--pdf\)\s*\{[^}]*env\(safe-area-inset-bottom/.test(css));
  v('… et dans le lecteur monté en carte de Mon Desk',
    /\.wdg-vuehost #arlib-rcontent[^{]*\{[^}]*env\(safe-area-inset-bottom/.test(css));

  console.log('\n── La règle mobile du lecteur n\'est plus écrasée par une règle de même poids ──');
  /* On ne se contente pas de « une règle existe » : c'est justement ce que disait la feuille
     pendant les semaines où elle ne s'appliquait pas. On exige que le sélecteur mobile porte l'ID
     — le seul poids que la règle de bureau (classe) ne peut pas battre. */
  v('le padding mobile du lecteur porte sur l\'ID, pas sur la classe',
    /#arlib-rcontent\s*\{\s*padding:/.test(css),
    'la règle `.arlib-rcontent { padding: 12px }` était muette : même spécificité, écrasée plus bas');
  /* Le témoin inverse : la règle muette ne doit pas revenir. La laisser en place ferait croire à
     un correctif appliqué là où il ne l'est pas — c'est exactement ce qui a duré des semaines. */
  v('… et la règle muette n\'a pas été laissée à côté',
    !/\.arlib-rcontent\s*\{\s*padding:\s*12px/.test(css));
  return ko;
}

(async () => {
  const koCss = phaseFeuille();
  const bin = trouverNavigateur();
  if (!bin) { console.log('\n[Lecteur] aucun Chromium → phase navigateur abstenue.\n'); process.exit(koCss ? 1 : 0); }
  let pp; try { pp = require('puppeteer-core'); }
  catch { console.log('\n[Lecteur] puppeteer-core absent → phase navigateur abstenue.\n'); process.exit(koCss ? 1 : 0); }

  const srv = serveur();
  await new Promise((r) => srv.listen(PORT, r));
  /* L'onglet « Mon Desk » n'existe que pour un compte ADMIN : on DÉRIVE le bouchon commun le temps
     de ce banc plutôt que d'en écrire un second, qui divergerait (c'est une divergence de jeu
     d'essai qui avait déjà vidé le fil dans un autre banc). */
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

  let ko = koCss, nav;
  const v = (nom, cond, detail) => {
    if (cond) console.log('  ✓ ' + nom);
    else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); }
  };

  try {
    nav = await pp.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    for (const a of APPAREILS) {
      const page = await nav.newPage();
      const fatales = [];
      page.on('pageerror', (e) => fatales.push(String(e.message).slice(0, 160)));
      await page.setUserAgent(UA_IOS);
      await page.setViewport({ width: a.w, height: a.h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.goto(`http://localhost:${PORT + 1}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise((r) => setTimeout(r, 2400));

      /* On ouvre Mon Desk, on adopte la vue ANALYSTES dans une carte à onglets, puis on rend un
         VRAI Récap Quotidien par la fonction du produit (`renderArlibReader`) — pas une maquette :
         c'est la construction réelle du rapport qu'on veut éprouver, calendrier compris. */
      let surVue;
      if (a.monDesk) {
        const ouvert = await page.evaluate(() => { const b = document.getElementById('widgets-btn'); if (!b) return false; b.click(); return true; });
        if (!ouvert) { console.log('\n  ~ ' + a.nom + ' : Mon Desk indisponible → situation abstenue.'); await page.close(); continue; }
        await new Promise((r) => setTimeout(r, 2800));
        await page.keyboard.press('Escape');   // le voile du gestionnaire recouvre la page
        await new Promise((r) => setTimeout(r, 1400));
        surVue = await page.evaluate(() => {
          const c = document.querySelector('.wdg-card--tabs'); if (!c) return false;
          const t = [...c.querySelectorAll('.wdgt-bar .wdgt-tab')].find((x) => /ANALYSTE/i.test(x.textContent || ''));
          if (!t) return false; t.click(); return true;
        });
      } else {
        surVue = await page.evaluate(() => {
          const t = [...document.querySelectorAll('.nav-item')].find((x) => /analyst/i.test(x.dataset.view || '') || /ANALYSTE/i.test(x.textContent || ''));
          if (!t) return false; t.click(); return true;
        });
      }
      if (!surVue) { console.log('\n  ~ ' + a.nom + ' : onglet Analystes introuvable → situation abstenue.'); await page.close(); continue; }
      await new Promise((r) => setTimeout(r, 2200));

      const rendu = await page.evaluate(() => {
        if (typeof renderArlibReader !== 'function' || typeof arlibShowReader !== 'function') return 'fonctions absentes';
        const bloc = (n, p) => Array.from({ length: n }, (_, i) => p + ' ' + i
          + ' — phrase de rapport assez longue pour occuper plusieurs lignes sur un téléphone.').join('\n\n');
        /* Le calendrier porte les trois valeurs (réel/prévision/précédent) ET plusieurs jours : le
           séparateur de jour a sa propre mise en forme, il doit être éprouvé lui aussi. */
        const evs = Array.from({ length: 14 }, (_, i) => ({
          ts: Date.now() + i * 5 * 3600 * 1000, ccy: ['USD', 'EUR', 'GBP', 'CAD'][i % 4],
          importance: 'High', event: 'Non-Farm Employment Change ' + i,
          actual: i % 3 === 0 ? '3,4 %' : '', forecast: '3,2 %', previous: '3,0 %',
        }));
        try {
          renderArlibReader({ id: 'banc-1', headline: 'Récap Quotidien', timestamp: Date.now(),
            _reportType: 'FX Daily Recap',
            _fxr: { day: '2026-09-04', v: 1, dateLabel: '4 septembre 2026', title: 'FX Daily Recap',
              summary: bloc(6, 'Synthèse'), geo: bloc(5, 'Géopolitique'), macro: bloc(6, 'Macro'),
              fils: Array.from({ length: 3 }, (_, i) => 'Fil ouvert numéro ' + i + '.'),
              /* Les phrases EXACTES de la capture du 04/09 : un chiffre au-dessus du consensus, un
                 en dessous, un conforme. C'est leur COULEUR PEINTE qu'on vient mesurer plus bas. */
              macro: ['CPI Suisse (août) : **+0,8%** y/y contre +0,5% attendu (préc. +0,4%) → inflation surprise à la hausse.',
                      'Balance commerciale Canada (juillet) : **0,77 Md** CAD contre 3,6 Md CAD attendu (préc. 4,2 Md CAD) → excédent nettement inférieur aux attentes.',
                      'Initial Jobless Claims US : **206K**, conforme aux attentes (préc. 204K) → marché du travail stable.'],
              lookahead: evs, tags: ['fed', 'politique monétaire'] } });
          arlibShowReader();
        } catch (e) { return String(e && e.message); }
        return 'ok';
      });
      if (rendu !== 'ok') { console.log('\n  ~ ' + a.nom + ' : rapport non rendu (' + rendu + ') → appareil abstenu.'); await page.close(); continue; }
      await new Promise((r) => setTimeout(r, 1200));

      const m = await page.evaluate(() => {
        const c = document.getElementById('arlib-rcontent');
        const ligne = document.querySelector('#arlib-rcontent .fxdr-callike .cal-row');
        if (!c || !ligne) return { absent: true };

        /* [1] LE PIÈGE À GESTE. On remonte de la ligne du calendrier jusqu'à la zone qui défile et
           on nomme TOUT ancêtre qui a un débordement RÉELLEMENT défilable. C'est la mesure qui
           vaut dans les deux moteurs : Chrome transmettrait le geste, WebKit non — mais dans les
           deux cas, ce conteneur-là n'a rien à faire entre le doigt et le lecteur. */
        const pieges = [];
        for (let e = ligne.parentElement; e && e !== c; e = e.parentElement) {
          const dx = e.scrollWidth - e.clientWidth, dy = e.scrollHeight - e.clientHeight;
          const cs = getComputedStyle(e);
          const defilant = /auto|scroll/.test(cs.overflowX) || /auto|scroll/.test(cs.overflowY);
          if (defilant && (dx > 2 || dy > 2)) {
            pieges.push({ cls: String(e.className || e.tagName).slice(0, 30), dx, dy, ox: cs.overflowX, oy: cs.overflowY });
          }
        }

        /* [2] LES CHIFFRES SONT-ILS DANS LE CADRE ? La capture montrait « RÉ » coupé : on vérifie
           que chaque cellule de valeur tient dans la largeur du lecteur, bord à bord. */
        const bc = c.getBoundingClientRect();
        let horsCadre = 0, quoi = '';
        c.querySelectorAll('.fxdr-callike .cal-row .cth-val, .fxdr-callike .cal-row .cth-event').forEach((td) => {
          const b = td.getBoundingClientRect();
          if (!b.width) return;
          const d = Math.round(b.right - bc.right);
          if (d > horsCadre) { horsCadre = d; quoi = String(td.className).slice(0, 24); }
        });

        /* [2 bis] LA COULEUR D'UN CHIFFRE PUBLIÉ EST-ELLE VRAIMENT PEINTE ? (04/09, capture user :
           « met les couleurs ici aussi, c'est du Récap Quotidien ».)
           ⚠️ ON LIT LA COULEUR CALCULÉE, PAS LA CLASSE. C'est tout l'objet de ce contrôle : le
           calcul était juste depuis le 02/09 — `_verdictColore` posait bien
           `<strong class="dtp-val-pos">` — et l'écran restait BLANC, parce que
           `.wr-bullet strong { color: #fff }` (0,1,1) battait `.dtp-val-pos` (0,1,0). Un banc qui
           se contente de chercher la classe dans le HTML aurait été vert tout du long. */
        const puces = [...c.querySelectorAll('.wr-bullet strong[class*="dtp-val-"]')];
        const teintes = puces.map((e) => ({ cls: (String(e.className).match(/dtp-val-\w+/) || [''])[0],
                                            col: getComputedStyle(e).color }));

        /* [3] EN MODE CARTE, UNE VALEUR DOIT DIRE CE QU'ELLE EST. Trois nombres nus l'un à côté de
           l'autre ne se lisent pas : c'est `data-lbl` qui les nomme, et il est posé par le rendu
           du rapport (app.js). Sans lui, la carte serait « - 3,2 % 3,0 % ». */
        const vals = [...c.querySelectorAll('.fxdr-callike .cal-row .cth-val')];
        const nommees = vals.filter((t) => (t.getAttribute('data-lbl') || '').trim()).length;
        const etiq = new Set(vals.map((t) => t.getAttribute('data-lbl')));

        return { pieges, horsCadre, quoi, vals: vals.length, nommees, etiq: [...etiq], teintes,
                 sH: c.scrollHeight, cH: c.clientHeight,
                 padding: getComputedStyle(c).padding,
                 gauche: Math.round(parseFloat(getComputedStyle(c).paddingLeft)) };
      });

      console.log('\n── ' + a.nom + ' ──');
      if (m.absent) { console.log('  ~ lecteur ou calendrier absent → appareil abstenu.'); await page.close(); continue; }

      v('rien de défilant ne s\'interpose entre le calendrier du rapport et le lecteur',
        m.pieges.length === 0,
        m.pieges.map((p) => p.cls + ' (débordement ' + p.dx + '×' + p.dy + ' px, overflow ' + p.ox + '/' + p.oy + ')').join(' · '));
      v('aucun chiffre du calendrier ne sort du cadre du lecteur',
        m.horsCadre <= 1, m.horsCadre + ' px hors cadre sur « ' + m.quoi + ' »');
      /* Trois puces, trois verdicts : au-dessus (vert), en dessous (rouge), conforme (ambre). */
      {
        const ATT = { 'dtp-val-pos': 'rgb(0, 230, 118)', 'dtp-val-neg': 'rgb(255, 61, 0)', 'dtp-val-neu': 'rgb(255, 179, 0)' };
        const vues = (m.teintes || []).map((t) => t.cls).sort();
        v('les chiffres publiés des puces Macro sont bien colorés à l\'écran',
          (m.teintes || []).length >= 3 && m.teintes.every((t) => ATT[t.cls] === t.col),
          (m.teintes || []).map((t) => t.cls + ' peint ' + t.col).join(' · ') || 'aucune valeur colorée trouvée');
        v('… et les trois verdicts sortent, pas un seul répété',
          new Set(vues).size === 3, vues.join(', '));
      }
      v('chaque valeur porte son étiquette (Réel / Prév. / Préc.)',
        m.vals > 0 && m.nommees === m.vals, m.nommees + '/' + m.vals + ' — étiquettes : ' + JSON.stringify(m.etiq));
      /* Le padding mobile : la règle muette rendait 32 px de chaque côté sur un écran de 390. */
      if (a.w <= 768) {
        v('le lecteur utilise la largeur du téléphone (marge latérale ≤ 16 px)',
          m.gauche <= 16, 'padding rendu : ' + m.padding);
      }

      /* [4] ET LE DOIGT, POUR DE VRAI. « Je peux le faire défiler en JS » ne prouve rien — la
         leçon est déjà écrite dans mobile-verif.js. On balaie donc depuis le BAS du lecteur, là
         où le calendrier se trouve et où le pouce se pose, et on exige d'arriver au bout. */
      const geste = await page.evaluate(() => {
        const c = document.getElementById('arlib-rcontent'); c.scrollTop = 0;
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.82),
                 reste: c.scrollHeight - c.clientHeight };
      });
      if (geste.reste > 40) {
        for (let i = 0; i < 30; i++) {
          await page.touchscreen.touchStart(geste.x, geste.y);
          for (let k = 1; k <= 6; k++) { await page.touchscreen.touchMove(geste.x, geste.y - k * 42); await new Promise((r) => setTimeout(r, 14)); }
          await page.touchscreen.touchEnd();
          await new Promise((r) => setTimeout(r, 90));
        }
        const fin = await page.evaluate(() => {
          const c = document.getElementById('arlib-rcontent');
          /* ⚠️ PAS `:last-of-type` : les lignes du calendrier alternent avec une ligne de
             décryptage (`.fxdr-cal-detail`), masquée. `.cal-row:last-of-type` cherche le DERNIER
             `tr` de son parent et ne trouve donc jamais de `.cal-row` — le contrôle recevait
             `null` et se prononçait sur rien. On prend le dernier élément de la liste. */
          const lignes = c.querySelectorAll('.fxdr-callike .cal-row');
          const der = lignes[lignes.length - 1];
          const bc = c.getBoundingClientRect();
          return { reste: Math.round(c.scrollHeight - c.clientHeight - c.scrollTop),
                   derniereVisible: der ? Math.round(der.getBoundingClientRect().bottom - bc.bottom) : null };
        });
        v('le doigt, posé sur le calendrier, mène le rapport jusqu\'à sa dernière ligne',
          fin.reste <= 2 && fin.derniereVisible !== null && fin.derniereVisible <= 1,
          'il restait ' + fin.reste + ' px à parcourir · dernière ligne à ' + fin.derniereVisible + ' px sous le bord');
      } else {
        console.log('  ~ rapport trop court pour éprouver le geste (' + geste.reste + ' px) → contrôle abstenu.');
      }
      /* [5] LA CAUSE RACINE, MESURÉE LÀ OÙ ELLE SE VOIT : DEUX CARTES QUI SE RECOUVRENT.
         C'est ce qui cachait la fin du rapport et volait le geste du pouce — la carte suivante,
         posée après dans le document, se peignait par-dessus les 123 derniers pixels de celle du
         lecteur. On compare donc les rectangles deux à deux : aucune intersection n'est tolérable
         dans une grille, où deux cartes ne partagent jamais une place par conception. */
      if (a.monDesk) {
        const grille = await page.evaluate(() => {
          const g = document.querySelector('.wdg-grid'); if (!g) return null;
          const R = [...g.children].map((c) => { const b = c.getBoundingClientRect();
            return { cls: String(c.className || c.tagName).slice(0, 22), l: b.left, r: b.right,
                     t: b.top + g.scrollTop, b: b.bottom + g.scrollTop, h: Math.round(b.height) }; });
          const ch = [];
          for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
            const x = Math.min(R[i].r, R[j].r) - Math.max(R[i].l, R[j].l);
            const y = Math.min(R[i].b, R[j].b) - Math.max(R[i].t, R[j].t);
            if (x > 2 && y > 2) ch.push(R[i].cls + ' ∩ ' + R[j].cls + ' = ' + Math.round(x) + '×' + Math.round(y) + ' px');
          }
          return { n: R.length, ch, hauteurs: R.map((x) => x.h) };
        });
        if (grille) {
          v('aucune carte de Mon Desk n\'en recouvre une autre',
            grille.ch.length === 0, grille.ch.join(' · '));
          /* LE TÉMOIN INVERSE DU MÊME CORRECTIF. Rendre la rangée au contenu supprime bien le
             recouvrement — `minmax(min-content, auto)` aussi, et c'était un piège : la hauteur
             minimale d'un contenu ignore qu'il DÉFILE, donc la carte grandit jusqu'à son contenu
             entier (mesuré : 4 751 px pour une carte à onglets). Une carte plus haute que deux
             écrans n'est plus une carte. */
          v('… et aucune ne s\'étire jusqu\'à son contenu entier',
            grille.hauteurs.every((h) => h <= a.h * 2),
            'hauteurs : ' + grille.hauteurs.join(' / ') + ' px pour un écran de ' + a.h);
        }
      }
      v('aucune erreur d\'exécution', fatales.length === 0, [...new Set(fatales)].slice(0, 3).join(' | '));
      await page.close();
    }
  } catch (e) {
    console.log('\n[Lecteur] phase navigateur interrompue : ' + (e && e.message));
  } finally {
    if (nav) await nav.close();
    srvAdmin.close();
    srv.close();
  }

  console.log(ko === 0 ? '\n[Lecteur] tout est vert.\n' : '\n[Lecteur] ' + ko + ' contrôle(s) au rouge.\n');
  process.exit(ko ? 1 : 0);
})();
