#!/usr/bin/env node
/**
 * reglages-verif.js — LA RECHERCHE DES LISTES LONGUES DU PANNEAU DE RÉGLAGES
 * ------------------------------------------------------------------------------------------------
 * 01/09, référence fournie (« Price Chart Settings ») : le panneau de réglages de la référence
 * s'ouvre sur un champ de recherche de symbole. Chez nous le sélecteur de paire du graphique compte
 * quarante-deux entrées, présentées en deux colonnes de pastilles qu'il fallait balayer à l'œil.
 *
 * POURQUOI CE BANC. Le champ est posé par une CHAÎNE HTML (`_optsHtml`) et son filtre est appelé par
 * un attribut `oninput="DTPWidgets.filtrerChoix(this)"`. Ni `node -c` ni `js-verif` ne voient dans
 * une chaîne : un nom de méthode mal orthographié, une méthode jamais ajoutée à l'objet public, un
 * conteneur qui n'est pas le parent attendu — tout cela passe les contrôles statiques et produit une
 * `ReferenceError` à CHAQUE FRAPPE, dans un panneau qui, lui, s'affiche parfaitement. C'est le même
 * genre d'angle mort que l'incident du 25/08 (fil d'actualité vide, syntaxe irréprochable).
 * On monte donc le vrai `_optsHtml`, on branche le vrai `filtrerChoix`, et on TAPE.
 *
 *   node scripts/reglages-verif.js       (s'abstient sans Chromium)
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
const v = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); } else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

function trouverNavigateur() {
  const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    try { for (const d of fs.readdirSync(b)) for (const r of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, r)); } catch {}
  }
  return c.find(x => x && fs.existsSync(x)) || null;
}

/* Découpe d'un bloc de code délimité par son en-tête et une accolade fermante à la MÊME
   indentation. Les deux morceaux éprouvés vivent à des endroits éloignés du module (le générateur
   de HTML près du début, la méthode publique cinq mille lignes plus bas) : c'est justement parce
   qu'ils sont éloignés qu'ils peuvent se désaccorder sans que personne ne le remarque. */
function decouper(src, entete, fin) {
  const d = src.indexOf(entete);
  if (d < 0) return null;
  const f = src.indexOf(fin, d + entete.length);
  return f < 0 ? null : src.slice(d, f + fin.length);
}

(async () => {
  console.log('\n═══ REGLAGES-VERIF — la recherche des listes longues ═══');
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.log('  · puppeteer-core absent → abstention.\n'); process.exit(0); }
  const exe = trouverNavigateur();
  if (!exe) { console.log('  · aucun Chromium → abstention.\n'); process.exit(0); }

  const WID = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
  const OPTS = decouper(WID, '  function _optsHtml(idx, w, it, setter, cell) {', '\n  }\n');
  const CTX = decouper(WID, '  function _ctxHead(w, it) {', '\n  }\n');
  const FILTRE = decouper(WID, '    filtrerChoix: function (input) {', '\n    },\n');
  v('_optsHtml est extractible de widgets.js', !!OPTS);
  v('_ctxHead est extractible de widgets.js', !!CTX);
  v('filtrerChoix est extractible de widgets.js', !!FILTRE, 'la méthode publique est absente de l\'objet DTPWidgets');
  if (!OPTS || !FILTRE || !CTX) { console.log('\n  ' + ok + ' vert(s), ' + ko + ' rouge(s)\n'); process.exit(1); }

  /* LE NOM APPELÉ PAR L'ATTRIBUT EST-IL CELUI QUI EXISTE ? Contrôle statique, mais c'est LE point de
     rupture de ce mécanisme : la chaîne et la méthode ne se voient pas l'une l'autre. */
  const appels = (WID.match(/DTPWidgets\.([A-Za-z_$][\w$]*)\s*\(/g) || [])
    .map(s => s.replace(/^DTPWidgets\./, '').replace(/\s*\($/, ''));
  /* La clé peut être écrite `nom: function (…)` OU `nom: nom,` (renvoi vers une fonction du
     module) — les deux formes coexistent dans l'objet public, ne chercher que la première déclare
     `editTab` et `aide` manquantes alors qu'elles sont là. */
  const manquants = [...new Set(appels)].filter(n => !new RegExp('^\\s{4}' + n + '\\s*:', 'm').test(WID));
  v('toute méthode DTPWidgets appelée depuis un attribut HTML existe bien dans l\'objet public',
    manquants.length === 0, 'introuvable(s) : ' + manquants.join(', '));

  let nav = null;
  try {
    nav = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(String(e.message)));
    await page.setContent('<!doctype html><html data-theme="dark"><head><meta charset="utf-8"></head>'
      + '<body><div id="p"></div></body></html>');

    const res = await page.evaluate(async (srcOpts, srcFiltre) => {
      window.esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      window._argC = c => (c == null ? '' : ',' + c);
      window.opt = (it, w, k) => (it && it.cfg && it.cfg[k]) || (w.opts.find(o => o.k === k) || {}).def;
      eval(srcOpts);                                        // eslint-disable-line no-eval
      window.DTPWidgets = eval('({' + srcFiltre + '})');    // eslint-disable-line no-eval

      // Une liste LONGUE (au-dessus du seuil) et une liste COURTE, pour éprouver le seuil lui-même.
      const longue = [];
      for (const a of ['EUR', 'GBP', 'USD', 'JPY', 'CHF', 'AUD']) for (const b of ['USD', 'JPY', 'CAD']) longue.push([a + b, a + '/' + b]);
      longue.push(['XAUUSD', 'Or / USD'], ['ZURICH', 'Zürich']);      // 20 entrées, dont une accentuée
      const courte = [['1h', '1 heure'], ['4h', '4 heures'], ['1j', '1 jour']];
      const W = { opts: [
        { k: 'paire', lbl: 'Paire', type: 'choix', def: 'EURUSD', choix: longue },
        { k: 'ut', lbl: 'Unité', type: 'choix', def: '1h', choix: courte },
      ] };
      // eslint-disable-next-line no-undef
      document.getElementById('p').innerHTML = _optsHtml(0, W, { cfg: {} });

      const boites = [...document.querySelectorAll('.wdg-set-chipbox')];
      const champ = document.querySelector('.wdg-set-rech');
      /* Le compte de référence se prend DANS la boîte du champ, pas dans le document : la liste
         courte pose ses propres pastilles à côté et fausserait le total (mesuré : 23 au lieu de 20). */
      const avant = [...champ.parentNode.querySelectorAll('.wdg-set-chip')].filter(b => !b.hidden).length;

      function taper(t) {
        champ.value = t;
        champ.dispatchEvent(new Event('input', { bubbles: true }));
        // Le vrai chemin de production passe par l'attribut : on l'emprunte aussi.
        // eslint-disable-next-line no-new-func
        new Function('el', champ.getAttribute('oninput')).call(champ, champ);
        const boite = champ.parentNode;
        return {
          visibles: [...boite.querySelectorAll('.wdg-set-chip')].filter(b => !b.hidden).map(b => b.textContent),
          vide: !boite.querySelector('.wdg-set-vide').hidden,
        };
      }
      const r = { boites: boites.length, champs: document.querySelectorAll('.wdg-set-rech').length, avant };
      r.gbp = taper('gbp');
      r.accent = taper('zurich');
      r.rien = taper('qqqq');
      r.reset = taper('');
      r.attribut = champ.getAttribute('oninput');
      return r;
    }, OPTS, FILTRE);

    console.log('\n── 1. Le champ n\'apparaît QUE sur les listes longues ──');
    /* Le seuil est la seule raison pour laquelle ce champ ne dérange personne : trois unités de
       temps sous un champ de recherche seraient du bruit. */
    v('la liste de 20 entrées reçoit un champ de recherche', res.champs === 1, res.champs + ' champ(s)');
    v('la liste de 3 entrées n\'en reçoit pas', res.boites === 2 && res.champs === 1,
      res.boites + ' boîte(s), ' + res.champs + ' champ(s)');

    console.log('\n── 2. Taper filtre vraiment (et par le chemin de production) ──');
    v('l\'attribut appelle bien DTPWidgets.filtrerChoix', /DTPWidgets\.filtrerChoix\(this\)/.test(res.attribut), res.attribut);
    v('aucune exception à la frappe', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    v('« gbp » ne laisse que les paires GBP', res.gbp.visibles.length === 3 && res.gbp.visibles.every(t => /GBP/.test(t)),
      JSON.stringify(res.gbp.visibles));
    /* La comparaison SANS ACCENTS : « zurich » doit trouver « Zürich ». Sans ce repli, le champ
       punit exactement la frappe rapide qu'il promet — et l'utilisateur conclut que l'entrée
       n'existe pas. */
    v('« zurich » trouve « Zürich » (accents ignorés)', res.accent.visibles.join('') === 'Zürich',
      JSON.stringify(res.accent.visibles));
    v('une recherche sans résultat le DIT au lieu de laisser un vide', res.rien.visibles.length === 0 && res.rien.vide,
      JSON.stringify(res.rien));
    v('vider le champ rend toutes les entrées', res.reset.visibles.length === res.avant && !res.reset.vide,
      res.reset.visibles.length + '/' + res.avant);

    console.log('\n── 3. Le contexte affiché dans l\'en-tête de la carte ──');
    /* Deux cartes du même widget côte à côte portaient le même titre : c'est le seul motif de ce
       badge. On éprouve donc qu'il DISTINGUE — deux réglages différents, deux textes différents —
       et qu'il reste court, sans quoi il mangerait l'en-tête au lieu de l'informer. */
    const ctx = await page.evaluate((srcCtx) => {
      window.opt = (it, w, k) => (it && it.cfg && it.cfg[k] !== undefined ? it.cfg[k] : (w.opts.find(o => o.k === k) || {}).def);
      eval(srcCtx);                                         // eslint-disable-line no-eval
      const W = { opts: [
        { k: 'paire', lbl: 'Paire', type: 'choix', def: 'EURUSD', choix: [['EURUSD', 'EUR/USD'], ['GBPJPY', 'GBP/JPY']] },
        { k: 'ut', lbl: 'Unité', type: 'choix', def: '1h', choix: [['1h', '1 heure'], ['4h', '4 heures']] },
        { k: 'vue', lbl: 'Vue', type: 'choix', def: 'a', choix: [['a', 'Troisième choix jamais affiché']] },
        { k: 'grille', lbl: 'Grille', type: 'bascule', def: true },
        { k: 'n', lbl: 'Lignes', type: 'nombre', def: 10, min: 1, max: 20 },
      ] };
      const LONG = { opts: [{ k: 'x', lbl: 'X', type: 'choix', def: 'a',
        choix: [['a', 'Un libellé démesurément long qui ne tiendrait jamais dans un en-tête de carte']] }] };
      const NU = { opts: [{ k: 'b', lbl: 'B', type: 'bascule', def: true }] };
      // eslint-disable-next-line no-undef
      return { defaut: _ctxHead(W, { cfg: {} }), autre: _ctxHead(W, { cfg: { paire: 'GBPJPY', ut: '4h' } }),
        // eslint-disable-next-line no-undef
        long: _ctxHead(LONG, { cfg: {} }), nu: _ctxHead(NU, { cfg: {} }), vide: _ctxHead({}, {}) };
    }, CTX);
    v('le badge nomme les réglages courants', ctx.defaut === 'EUR/USD · 1 heure', JSON.stringify(ctx.defaut));
    v('deux cartes réglées différemment portent des badges différents',
      ctx.autre === 'GBP/JPY · 4 heures' && ctx.autre !== ctx.defaut, JSON.stringify(ctx.autre));
    v('il s\'arrête à DEUX réglages (un en-tête n\'est pas un panneau)', !/jamais affiché/.test(ctx.defaut), ctx.defaut);
    v('bascules et nombres sont ignorés (ils ne disent pas de quoi parle la carte)',
      ctx.nu === '', JSON.stringify(ctx.nu));
    v('un libellé démesuré est tronqué', ctx.long.length <= 34 && /…$/.test(ctx.long), ctx.long + ' (' + ctx.long.length + ')');
    v('un widget sans réglage ne porte pas de badge vide', ctx.vide === '', JSON.stringify(ctx.vide));
  } catch (e) {
    ko++; console.log('  ✗ banc interrompu\n      → ' + e.message);
  } finally {
    try { if (nav) await nav.close(); } catch {}
  }

  /* ═══ L'ESPACEMENT DU DESK SE RÈGLE OÙ L'ON CHOISIT LA DISPOSITION (09/09) ══════════════════
     Demande user : « ça tu dois le mettre quand on choisit la disposition du layout, et pas dans
     la bibliothèque de widgets où l'on voit les widgets ». Le réglage décide de la respiration
     ENTRE les widgets posés — une propriété de la DISPOSITION — et il vivait dans l'écran où l'on
     choisit QUELS widgets ajouter, à côté des filtres par catégorie.
     ⚠️ DÉPLACER LE BLOC NE SUFFIT PAS, et c'est tout l'objet de ces contrôles : son état actif est
     posé par `_syncDensity()`, qui était appelé à l'ouverture de la BIBLIOTHÈQUE. Déplacer le HTML
     sans déplacer cet appel aurait ouvert le panneau avec DEUX boutons éteints — le réglage en
     place, et l'écran affirmant le contraire. */
  {
    const HTML = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');
    const WDG = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
    const _bloc = (rx) => (rx.exec(HTML) || [''])[0];
    const mgr = _bloc(/<div class="wdg-lib" id="wdg-mgr">[\s\S]*?\n    <\/div>/);
    const lib = _bloc(/<div class="wdg-lib" id="wdg-lib">[\s\S]*?\n    <\/div>/);
    v('le réglage d\'espacement est dans le gestionnaire de layouts', /id="wdg-density"/.test(mgr), mgr.slice(0, 120) || '(panneau introuvable)');
    v('… et plus dans la bibliothèque de widgets', !/id="wdg-density"/.test(lib), (lib.match(/.{0,60}wdg-density.{0,20}/) || [''])[0]);
    v('… il n\'existe qu\'à UN endroit (pas de copie oubliée)', (HTML.match(/id="wdg-density"/g) || []).length === 1);
    /* L'état actif doit suivre le panneau, sinon le réglage s'ouvre sans être allumé. */
    const openMgr = (/openManager: function \(\)[\s\S]{0,700}/.exec(WDG) || [''])[0];
    const openLib = (/openLib: function \(\)[\s\S]{0,500}/.exec(WDG) || [''])[0];
    v('l\'état actif est posé à l\'ouverture du gestionnaire', /_syncDensity\(\)/.test(openMgr), openMgr.slice(0, 160));
    v('… et plus à celle de la bibliothèque (appel devenu inutile)', !/_syncDensity\(\)/.test(openLib));
    /* Le panneau reste OUVERT pendant qu'on bascule : le bouton doit se rafraîchir tout seul. */
    const setGap = (/setGap: function \(m\)[\s\S]{0,700}?\n    \},/.exec(WDG) || [''])[0];
    v('basculer l\'espacement rafraîchit le bouton sans rouvrir', /_syncDensity\(\)/.test(setGap), setGap.slice(0, 200));
    v('… après le rendu, pas avant', setGap.indexOf('renderGrid()') < setGap.indexOf('_syncDensity()'));
  }

  console.log('\n───────────────────────────────────────');
  console.log('  ' + ok + ' vert(s), ' + ko + ' rouge(s)\n');
  process.exit(ko ? 1 : 0);
})();
