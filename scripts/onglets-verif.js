#!/usr/bin/env node
/**
 * scripts/onglets-verif.js — DÉPLACER UN ONGLET SANS RIEN DÉSALIGNER.
 *
 * POURQUOI. Un panneau à onglets tient sur SIX structures indexées POSITIONNELLEMENT, sans aucune
 * clé stable : `tabs` (les widgets), `tabLabels` (les noms), `tabIcons` (les icônes), `tabGrid`
 * (les dispositions composites), les clés de `tabCfg` (« 3 », « 3-1 » : les réglages) et `_tabAct`
 * (l'onglet affiché). Déplacer un onglet en n'en réindexant que cinq ne casse RIEN de visible tout
 * de suite : le nom, l'icône ou les réglages glissent simplement sur l'onglet voisin. On s'en rend
 * compte trois jours plus tard, sans savoir quel geste l'a produit.
 *
 * Le même piège a déjà mordu : `removeTab` réindexait `tabs`, `tabLabels`, `tabGrid` et `tabCfg`
 * mais PAS `tabIcons` — retirer un onglet décalait donc l'icône de tous les suivants, en silence.
 * Le défaut est corrigé, et rejoué ici pour qu'il ne revienne pas.
 *
 * On extrait le VRAI `_reordonnerOnglets` de public/js/widgets.js — pas une copie — pour que le
 * contrôle suive le code plutôt qu'une transcription qui dériverait.
 *
 *   node scripts/onglets-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
let ko = 0, ok = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

const DEB = SRC.indexOf('  function _reordonnerOnglets(it, from, to) {');
if (DEB < 0) { console.log('\n  ✗ _reordonnerOnglets introuvable dans widgets.js\n'); process.exit(1); }
const FIN = SRC.indexOf('\n  }\n', DEB);
const bouger = new Function(SRC.slice(DEB, FIN + 4) + '\nreturn _reordonnerOnglets;')();

// Un panneau complet : sept onglets, chacun avec son nom, son icône, une disposition composite en
// 3e position, et des réglages posés sur trois onglets dont une CASE d'onglet composite.
const panneau = () => ({
  tabs:      ['risque', 'force', 'grille', 'cot', 'dmx', 'saison', 'monde'],
  tabLabels: ['RISQUE', 'FORCE', 'BAROMÈTRE', 'COT', 'DMX', 'SAISONNALITÉ', 'MONDE'],
  tabIcons:  ['jauge', 'balance', 'grille', 'cot', 'dmx', 'calendrier', 'globe'],
  tabGrid:   ['', '', '2x2|a,b,c,d', '', '', '', ''],
  tabCfg:    { '0': { p: 'risque' }, '2-1': { p: 'case' }, '6': { p: 'monde' } },
  _tabAct: 2,
});
// Ce que porte l'onglet à la position j — les six structures lues ensemble.
const contenu = (it, j) => JSON.stringify([it.tabs[j], it.tabLabels[j], it.tabIcons[j], it.tabGrid[j],
  it.tabCfg[String(j)] || null, it.tabCfg[j + '-1'] || null]);

console.log('\n── 1. Tout ce que porte un onglet le suit ──');
{
  const av = panneau(), avant = av.tabs.map((_, j) => contenu(av, j));
  const ap = panneau();
  v('un déplacement valide est accepté', bouger(ap, 0, 2) === true);
  v('l\'ordre des onglets est le bon', ap.tabs.join(',') === 'force,grille,risque,cot,dmx,saison,monde', ap.tabs.join(','));
  v('le nom suit son onglet', contenu(ap, 2) === avant[0], contenu(ap, 2) + ' ≠ ' + avant[0]);
  v('l\'icône aussi', ap.tabIcons.join(',') === 'balance,grille,jauge,cot,dmx,calendrier,globe', ap.tabIcons.join(','));
  v('la disposition composite aussi', ap.tabGrid[1] === '2x2|a,b,c,d' && ap.tabGrid[2] === '', ap.tabGrid.join('|'));
  v('les réglages de l\'onglet aussi', JSON.stringify(ap.tabCfg['2']) === '{"p":"risque"}', JSON.stringify(ap.tabCfg));
  v('les réglages d\'une CASE d\'onglet composite aussi', JSON.stringify(ap.tabCfg['1-1']) === '{"p":"case"}', JSON.stringify(ap.tabCfg));
  v('aucun onglet n\'a perdu son contenu', ap.tabs.map((_, j) => contenu(ap, j)).sort().join('§') === avant.slice().sort().join('§'));
  v('rien n\'est dupliqué ni perdu', new Set(ap.tabs).size === new Set(av.tabs).size && ap.tabs.length === 7);
}

console.log('\n── 2. L\'onglet AFFICHÉ suit son contenu, jamais sa position ──');
{
  const a = panneau(); bouger(a, 0, 2);
  v('l\'onglet regardé était le 3e, il est maintenant le 2e', a._tabAct === 1, String(a._tabAct));
  const b = panneau(); bouger(b, 2, 5);
  v('déplacer l\'onglet regardé le suit', b._tabAct === 5 && b.tabs[5] === 'grille', b._tabAct + '/' + b.tabs[5]);
  const c = panneau(); bouger(c, 5, 6);
  v('un déplacement qui ne le concerne pas ne le bouge pas', c._tabAct === 2 && c.tabs[2] === 'grille');
}

console.log('\n── 3. Un déplacement impossible ne touche à rien ──');
{
  const base = JSON.stringify(panneau());
  [['sur place', 3, 3], ['avant le premier', 0, -1], ['après le dernier', 6, 7],
   ['depuis un index inexistant', 9, 0], ['depuis un index négatif', -1, 2]].forEach(([nom, f, t]) => {
    const it = panneau();
    const r = bouger(it, f, t);
    v(`« ${nom} » est refusé`, r === false, 'a rendu ' + r);
    v(`« ${nom} » laisse le panneau intact`, JSON.stringify(it) === base);
  });
  v('un objet sans onglets est refusé', bouger({}, 0, 1) === false);
  v('un objet nul est refusé', bouger(null, 0, 1) === false);
}

console.log('\n── 4. Les tableaux incomplets ne corrompent rien ──');
/* `tabLabels` / `tabIcons` / `tabGrid` sont plus COURTS que `tabs` dès qu'on ajoute un onglet :
   l'ajout n'écrit que `tabs`, tout le reste se lit ailleurs en `arr[j] || ''`. Réindexer sans
   combler les trous poserait des `undefined` — un nom d'onglet affiché « undefined » se voit. */
{
  const it = { tabs: ['a', 'b', 'c'], tabLabels: ['A'], tabIcons: [], _tabAct: 0 };
  v('le déplacement passe', bouger(it, 0, 2) === true);
  v('les trous sont comblés, pas propagés', it.tabLabels.join(',') === ',,A' && it.tabLabels.length === 3, JSON.stringify(it.tabLabels));
  v('aucun undefined dans les noms', it.tabLabels.every(x => typeof x === 'string'), JSON.stringify(it.tabLabels));
  v('aucun undefined dans les icônes', it.tabIcons.every(x => typeof x === 'string') && it.tabIcons.length === 3, JSON.stringify(it.tabIcons));
  v('les onglets, eux, sont intacts', it.tabs.join(',') === 'b,c,a', it.tabs.join(','));
  const sansCfg = { tabs: ['a', 'b'] };
  v('un panneau minimal ne casse pas', bouger(sansCfg, 0, 1) === true && sansCfg.tabs.join(',') === 'b,a');
}

console.log('\n── 5. Les réglages inconnus sont conservés, pas jetés ──');
{
  const it = panneau(); it.tabCfg['zz'] = { garde: 1 };
  bouger(it, 1, 4);
  v('une clé hors format survit au déplacement', JSON.stringify(it.tabCfg['zz']) === '{"garde":1}', JSON.stringify(it.tabCfg));
}

console.log('\n── 6. Le geste est branché des DEUX côtés ──');
/* « que ça se mette à jour dans le panneau à onglet quand on déplace » : le volet de réglages ET la
   barre d'onglets de la carte. Sans le second, deux vérités s'affichent en même temps. */
v('une poignée est posée sur chaque ligne', /class="wdg-set-tabgrip" draggable="true" data-j="/.test(SRC));
v('elle est absente quand il n\'y a qu\'un onglet', /var _grip = tl\.length > 1/.test(SRC));
v('les flèches ↑ ↓ déplacent au clavier', /event\.key===\\'ArrowUp\\'\|\|event\.key===\\'ArrowDown\\'/.test(SRC));
v('le volet est re-rendu', /moveTab: function[\s\S]{0,700}?_syncPanel\(i\);/.test(SRC));
v('LA CARTE aussi (la barre d\'onglets suit)', /moveTab: function[\s\S]{0,700}?API\.refresh\(i\);/.test(SRC));
v('le focus reste sur la poignée déplacée', /moveTab: function[\s\S]{0,1200}?wdg-set-tabgrip\[data-j="/.test(SRC));
v('le glisser-déposer est câblé sur le VOLET, pas sur la liste', /function _wireTabsDnD\(pop, i\)[\s\S]{0,400}?pop\.addEventListener\('dragstart'/.test(SRC));
v('câblé une seule fois par volet', /if \(!pop \|\| pop\._tabsWired\) return; pop\._tabsWired = true;/.test(SRC));
v('re-câblé à chaque ouverture (la carte est reconstruite)', /if \(willOpen && kind === 's' && target\) _wireTabsDnD\(target, idx\);/.test(SRC));
v('le décalage d\'un cran est corrigé au dépôt', /if \(from < cible\) cible--;/.test(SRC));
v('les repères de dépôt reprennent ceux du gestionnaire de desks', /\.wdg-set-tabrow\.wdg-drop-before/.test(fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8')));

console.log('\n── 7. Le défaut voisin, corrigé au passage ──');
/* `removeTab` réindexait tabs, tabLabels, tabGrid et tabCfg — mais PAS tabIcons. Retirer le 2e
   onglet décalait donc l'icône de tous les suivants d'un cran, sans erreur ni trace. */
v('retirer un onglet retire AUSSI son icône', /if \(Array\.isArray\(it\.tabIcons\)\) it\.tabIcons\.splice\(j, 1\);/.test(SRC));
v('l\'annulation restaure les icônes', /if \(snap\.tabIcons\) itRef\.tabIcons = snap\.tabIcons\.slice\(\); else delete itRef\.tabIcons;/.test(SRC));
v('le snapshot les emporte', /tabIcons: it\.tabIcons \|\| null,/.test(SRC));

/* ── PHASE NAVIGATEUR : LE GLISSER-DÉPOSER, POUR DE VRAI ────────────────────────────────────────
   Tout ce qui précède prouve le CALCUL. Rien n'y prouve que le geste arrive jusqu'à lui : un
   écouteur posé au mauvais endroit, un `closest` qui ne remonte pas, un `preventDefault` oublié sur
   `dragover` (sans lui, Chrome N'ÉMET JAMAIS `drop` — la panne classique du glisser-déposer HTML5,
   et parfaitement invisible en lecture de code). On extrait donc le VRAI `_wireTabsDnD`, on le pose
   sur un volet reconstitué dans un Chromium, et on glisse.
   Sans navigateur disponible, la phase s'abstient — elle ne rend jamais un poste inutilisable. */
const D2 = SRC.indexOf('  function _wireTabsDnD(pop, i) {');
const F2 = D2 < 0 ? -1 : SRC.indexOf('\n  }\n', D2);
if (D2 < 0) { v('_wireTabsDnD est extractible', false, 'introuvable dans widgets.js'); }

const CABLAGE = D2 < 0 ? '' : SRC.slice(D2, F2 + 4);
const LIGNES = SRC.match(/return '<div class="wdg-set-row wdg-set-tabrow" data-j="' \+ j \+ '">'/) ? true : false;

(async () => {
  console.log('\n── 8. Le glisser-déposer dans un vrai Chromium ──');
  v('la ligne d\'onglet porte son index', LIGNES);
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch { console.log('  · puppeteer-core absent → phase navigateur abstenue.'); return fin(); }
  const bin = (() => {
    const bases = ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
    const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
    for (const b of bases) {
      try { for (const d of fs.readdirSync(b)) for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, rel)); } catch {}
    }
    return c.find(x => x && fs.existsSync(x)) || null;
  })();
  if (!bin) { console.log('  · aucun Chromium trouvé → phase navigateur abstenue.'); return fin(); }

  let nav;
  try {
    nav = await puppeteer.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    await page.setContent('<div id="pop" class="wdg-pop"></div>');
    const r = await page.evaluate((cablage, n) => {
      var appels = [];
      // Le volet, tel que le rend _setPanelHtml : des lignes .wdg-set-tabrow[data-j] avec leur poignée.
      var pop = document.getElementById('pop');
      var h = '';
      for (var j = 0; j < n; j++) {
        h += '<div class="wdg-set-row wdg-set-tabrow" data-j="' + j + '" style="height:30px">'
          + '<button class="wdg-set-tabgrip" draggable="true" data-j="' + j + '">x</button>'
          + '<input value="onglet ' + j + '"></div>';
      }
      pop.innerHTML = h;
      var API = { moveTab: function (i, from, to) { appels.push([i, from, to]); } };
      var HOST_ID = 'nimporte';
      eval(cablage + '; _wireTabsDnD(pop, 7);');
      var lignes = pop.querySelectorAll('.wdg-set-tabrow');
      var glisser = function (de, vers, bas) {
        var dt = new DataTransfer();
        lignes[de].querySelector('.wdg-set-tabgrip')
          .dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        var b = lignes[vers].getBoundingClientRect();
        var y = b.top + (bas ? b.height * 0.8 : b.height * 0.2);
        var ov = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y });
        lignes[vers].dispatchEvent(ov);
        var repere = lignes[vers].className;
        var accepte = ov.defaultPrevented;      // sans preventDefault, Chrome n'émettra jamais `drop`
        lignes[vers].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
        lignes[vers].dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
        return { repere: repere, accepte: accepte };
      };
      var bas = glisser(0, 3, true);            // moitié BASSE de la 4e ligne → après elle
      var haut = glisser(5, 2, false);          // moitié HAUTE de la 3e ligne → avant elle
      // Un glissement qui ne part PAS d'une poignée ne doit rien déclencher.
      var dt2 = new DataTransfer();
      lignes[1].querySelector('input').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt2 }));
      lignes[4].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt2, clientY: 0 }));
      return { appels: appels, bas: bas, haut: haut, restes: pop.querySelectorAll('.wdg-drop-before,.wdg-drop-after').length };
    }, CABLAGE, 7);

    v('le survol accepte le dépôt (preventDefault sur dragover)', r.bas.accepte && r.haut.accepte,
      'sans lui Chrome n\'émet jamais `drop`');
    v('un repère de dépôt s\'affiche sous la ligne visée', /wdg-drop-after/.test(r.bas.repere), r.bas.repere);
    v('…et au-dessus quand on vise le haut de la ligne', /wdg-drop-before/.test(r.haut.repere), r.haut.repere);
    v('deux glissements → deux déplacements', r.appels.length === 2, JSON.stringify(r.appels));
    v('déposer sous la 4e ligne place l\'onglet en 4e position', JSON.stringify(r.appels[0]) === '[7,0,3]', JSON.stringify(r.appels[0]));
    v('déposer au-dessus de la 3e ligne l\'y place', JSON.stringify(r.appels[1]) === '[7,5,2]', JSON.stringify(r.appels[1]));
    v('glisser hors d\'une poignée ne déplace rien', r.appels.length === 2);
    v('aucun repère ne reste affiché après le dépôt', r.restes === 0, String(r.restes));
  } catch (e) {
    v('la phase navigateur s\'exécute', false, e.message);
  } finally { if (nav) try { await nav.close(); } catch {} }
  fin();
})();

function fin() {
  console.log(`\n${ko === 0 ? '✓ TOUT PASSE' : '✗ ' + ko + ' ÉCHEC(S)'} — ${ok} contrôle(s) OK, ${ko} KO\n`);
  process.exit(ko ? 1 : 0);
}
