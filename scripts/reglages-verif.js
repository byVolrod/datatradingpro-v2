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
  const FILTRE = decouper(WID, '    filtrerChoix: function (input) {', '\n    },\n');
  v('_optsHtml est extractible de widgets.js', !!OPTS);
  v('filtrerChoix est extractible de widgets.js', !!FILTRE, 'la méthode publique est absente de l\'objet DTPWidgets');
  if (!OPTS || !FILTRE) { console.log('\n  ' + ok + ' vert(s), ' + ko + ' rouge(s)\n'); process.exit(1); }

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
  } catch (e) {
    ko++; console.log('  ✗ banc interrompu\n      → ' + e.message);
  } finally {
    try { if (nav) await nav.close(); } catch {}
  }

  console.log('\n───────────────────────────────────────');
  console.log('  ' + ok + ' vert(s), ' + ko + ' rouge(s)\n');
  process.exit(ko ? 1 : 0);
})();
