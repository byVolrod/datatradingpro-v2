#!/usr/bin/env node
/**
 * notif-verif.js — LES TROIS CHIFFRES D'UNE ALERTE DE CALENDRIER
 * ------------------------------------------------------------------------------------------------
 * 01/09, référence fournie (volet « Notifications ») : les alertes de calendrier y sont rendues avec
 * un tableau ACTUAL / FORECAST / PREVIOUS sous le titre, au lieu d'une description en phrase.
 *
 * CE QUE CE BANC ÉPROUVE. Deux choses qu'aucun contrôle statique ne voit :
 *   1. L'EXTRACTION. Trois valeurs tirées d'un texte libre par expression régulière. Une regex qui
 *      rate le « Forecast » rend un bloc à deux colonnes crédible ; une regex qui prend le mauvais
 *      nombre rend un bloc FAUX, tout aussi crédible. On lui sert donc des libellés réels, aux
 *      formats réels (K, %, décimales, valeurs négatives), et on relit chaque case.
 *   2. LA COULEUR. Elle doit venir de `deviationClass`, la fonction du calendrier — pas d'une règle
 *      réécrite dans le volet. C'est elle qui sait que pour les inscriptions au chômage un chiffre
 *      PLUS BAS est favorable, et que « pile au consensus » est un état neutre distinct de
 *      « pas de référence ». Deux règles pour la même donnée finiraient par se contredire, et le
 *      volet dirait alors l'inverse du calendrier sur le même chiffre — c'est ce qu'on interdit ici.
 *
 *   node scripts/notif-verif.js       (s'abstient sans Chromium)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const RACINE = path.join(__dirname, '..');
const PORT = 4763;
let ok = 0, ko = 0;
const v = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); } else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

function trouverNavigateur() {
  const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    try { for (const d of fs.readdirSync(b)) for (const r of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, r)); } catch {}
  }
  return c.find(x => x && fs.existsSync(x)) || null;
}
function decouper(src, entete, fin) {
  const d = src.indexOf(entete);
  if (d < 0) return null;
  const f = src.indexOf(fin, d + entete.length);
  return f < 0 ? null : src.slice(d, f + fin.length);
}

(async () => {
  console.log('\n═══ NOTIF-VERIF — les trois chiffres d\'une alerte de calendrier ═══');
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.log('  · puppeteer-core absent → abstention.\n'); process.exit(0); }
  const exe = trouverNavigateur();
  if (!exe) { console.log('  · aucun Chromium → abstention.\n'); process.exit(0); }

  const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
  const CHA = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');
  const NUM = decouper(APP, "const _NP_NUM = ", '\n');
  /* L'extraction et le rendu sont deux fonctions depuis le 03/09 (les mêmes chiffres servent aussi
     aux publications groupées du fil) : on emporte les deux, sinon `_npABC` lève à la 1re ligne. */
  const VALS = decouper(APP, 'function _npABCVals(item) {', '\n}\n');
  const ABC = decouper(APP, 'function _npABC(item) {', '\n}\n');
  const DEV = decouper(CHA, 'const CAL_INVERTED_RX = ', '\nwindow.deviationClass = deviationClass;');
  const CEL = decouper(CHA, 'function calActualCell(actual, forecast, low, title) {', '\n}\n');
  v('_npABC et son extracteur de valeurs sont extractibles d\'app.js', !!ABC && !!NUM && !!VALS);
  v('deviationClass et calActualCell sont extractibles de charts.js', !!DEV && !!CEL);
  if (!ABC || !NUM || !DEV || !CEL || !VALS) { console.log('\n  ' + ok + ' vert(s), ' + ko + ' rouge(s)\n'); process.exit(1); }

  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (u === '/banc') {
      rs.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return rs.end('<!doctype html><html data-theme="dark"><head><meta charset="utf-8">'
        + '<link rel="stylesheet" href="/css/style.css"></head>'
        + '<body style="margin:0;background:#0c0c0e"><div class="np-panel"><div class="np-list">'
        + '<div class="np-item" id="p"></div></div></div></body></html>');
    }
    const f = path.join(RACINE, 'public', u.replace(/^\/+/, ''));
    if (!f.startsWith(path.join(RACINE, 'public')) || !fs.existsSync(f)) { rs.writeHead(404); return rs.end('404'); }
    rs.writeHead(200, { 'Content-Type': u.endsWith('.css') ? 'text/css' : 'text/plain' });
    fs.createReadStream(f).pipe(rs);
  }).listen(PORT);

  let nav = null;
  try {
    nav = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(String(e.message)));
    /* ⚠️ LA PAGE EST SERVIE AVEC LA VRAIE FEUILLE. Sans elle, les contrôles de couleur porteraient
       sur des NOMS DE CLASSE et rien d'autre : `cv-pos` présente dans le HTML ne prouve pas qu'un
       pixel vert soit peint — une règle plus spécifique ailleurs peut la neutraliser en silence.
       On relit donc la couleur CALCULÉE, celle que l'œil reçoit. */
    await page.goto('http://localhost:' + PORT + '/banc', { waitUntil: 'networkidle0' });

    const res = await page.evaluate((sNum, sAbc, sDev, sCel, sVals) => {
      /* ⚠️ UN SEUL eval POUR LES QUATRE MORCEAUX. Séparés, les `const` (_NP_NUM, CAL_INVERTED_RX)
         restent liés au bloc de LEUR eval et sont invisibles depuis le suivant : `_npABC` levait
         alors « _NP_NUM is not defined ». Groupés, les fonctions déclarées remontent bien dans la
         portée globale tout en fermant sur leurs constantes. */
      eval(sNum + '\n' + sDev + '\n' + sCel + '\n' + sVals + '\n' + sAbc);   // eslint-disable-line no-eval
      const cases = {
        // Format réel du fil : la description du calendrier écrit les trois valeurs en clair.
        claims:  { headline: 'US Initial Jobless Claims', description: 'Actual: 207K Forecast: 215K Previous: 219K' },
        // Un chiffre AU-DESSUS du consensus sur un indicateur normal : favorable.
        pmi:     { headline: 'US ISM Manufacturing PMI', description: 'Actual: 52.4 Forecast: 51.1 Previous: 50.9' },
        // Pile au consensus : troisième état, distinct de « pas de référence ».
        pile:    { headline: 'Euro Area Inflation Rate YoY', description: 'Actual: 2.3% Forecast: 2.3% Previous: 2.4%' },
        // En dessous : défavorable.
        sous:    { headline: 'US Retail Sales MoM', description: 'Actual: 0.1% Forecast: 0.4% Previous: 0.7%' },
        // Valeur négative, abréviations « Exp. » et « Prev. » du fil anglais.
        neg:     { headline: 'Spanish Unemployment Change', description: 'Actual: -57.2K Exp. -40.0K Prev. -12.4K' },
        // Aucune référence : rien à comparer, la description d'origine reste le meilleur rendu.
        seul:    { headline: 'Some Release', description: 'Actual: 3.4' },
        // Pas de publication du tout : une dépêche ordinaire ne doit JAMAIS produire ce bloc.
        news:    { headline: 'Gold gains as traders weigh Fed path', description: 'Bullion rose 1.2% on Tuesday as…' },
      };
      const out = {};
      // eslint-disable-next-line no-undef
      for (const k of Object.keys(cases)) out[k] = _npABC(cases[k]);
      const lire = h => {
        const d = document.getElementById('p'); d.innerHTML = h;
        return [...d.querySelectorAll('.np-abc-c')].map(c => ({
          lbl: (c.querySelector('i') || {}).textContent || '',
          val: (c.querySelector('b') || {}).textContent || '',
          cls: (c.querySelector('.cv-actual') || {}).className || '',
          teinte: (() => { const e = c.querySelector('.cv-actual') || c.querySelector('b');
            return e ? getComputedStyle(e).color : ''; })(),
        }));
      };
      return { brut: out, claims: lire(out.claims), pmi: lire(out.pmi), pile: lire(out.pile),
        sous: lire(out.sous), neg: lire(out.neg) };
    }, NUM, ABC, DEV, CEL, VALS);

    console.log('\n── 1. Chaque chiffre dans SA case ──');
    v('aucune exception à l\'exécution', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    v('les trois cases sont rendues', res.claims.length === 3, res.claims.length + ' case(s)');
    v('les intitulés sont ceux du desk, en français',
      res.claims.map(c => c.lbl).join('|') === 'RÉEL|PRÉVU|PRÉCÉDENT', res.claims.map(c => c.lbl).join('|'));
    v('le réel est le réel', /207K/.test(res.claims[0].val), res.claims[0].val);
    v('… la prévision est la prévision', /215K/.test(res.claims[1].val), res.claims[1].val);
    v('… et le précédent est le précédent', /219K/.test(res.claims[2].val), res.claims[2].val);
    v('les abréviations du fil anglais sont comprises (Exp. / Prev.)',
      /-57\.2K/.test(res.neg[0].val) && /-40\.0K/.test(res.neg[1].val) && /-12\.4K/.test(res.neg[2].val),
      res.neg.map(c => c.val).join(' | '));
    v('les pourcentages gardent leur unité', /2,?\.?3%/.test(res.pile[0].val), res.pile[0].val);

    console.log('\n── 2. La couleur est celle du calendrier, pas une seconde règle ──');
    /* Le contrôle qui justifie le banc : la POLARITÉ. Un chiffre de chômage plus bas que prévu est
       une BONNE surprise ; une règle naïve « plus haut = vert » l'aurait peint en rouge, et le volet
       aurait alors contredit le calendrier sur exactement la même publication. */
    v('inscriptions au chômage SOUS le consensus → vert (polarité inversée)',
      /cv-pos/.test(res.claims[0].cls), res.claims[0].cls);
    v('un PMI au-dessus du consensus → vert', /cv-pos/.test(res.pmi[0].cls), res.pmi[0].cls);
    v('des ventes au détail sous le consensus → rouge', /cv-neg/.test(res.sous[0].cls), res.sous[0].cls);
    v('un chiffre PILE au consensus → neutre (et non « sans couleur »)',
      /cv-neu/.test(res.pile[0].cls), res.pile[0].cls);
    /* ⚠️ ET ON RELIT LE PIXEL, PAS LA CLASSE. `cv-pos` dans le HTML ne prouve pas qu'un vert soit
       PEINT : une règle plus spécifique, un thème, un `!important` ailleurs peuvent la neutraliser
       sans rien casser d'autre. Le banc source-verif du 30/08 s'était fait prendre exactement ainsi
       — vert sur le défaut qu'il gardait. On lit donc la couleur calculée et on compare ses canaux. */
    const rgb = t => (String(t).match(/\d+/g) || []).map(Number);
    const vert = t => { const c = rgb(t); return c.length >= 3 && c[1] - c[0] > 40; };
    const rouge = t => { const c = rgb(t); return c.length >= 3 && c[0] - c[1] > 40; };

    v('… et le vert est réellement PEINT (canaux relus, pas la classe)', vert(res.claims[0].teinte), res.claims[0].teinte);
    v('… le rouge aussi', rouge(res.sous[0].teinte), res.sous[0].teinte);
    /* ⚠️ LE « CONFORME » EST BLANC/ENCRE, PAS AMBRE, ET C'EST UN ARBITRAGE DE L'UTILISATEUR
       (12/08, inscrit dans style.css au-dessus de `--st-flat`). Ce banc avait d'abord exigé l'ambre
       et sorti un rouge : c'est le CONTRÔLE qui avait tort. Un chiffre pile au consensus n'est ni
       une bonne ni une mauvaise surprise — il est simplement sans signal, et le blanc le dit. Ce
       qu'on éprouve ici, c'est donc qu'il n'emprunte NI le vert NI le rouge. */
    v('un chiffre conforme n\'emprunte ni le vert ni le rouge (arbitrage du 12/08 : blanc/encre)',
      !vert(res.pile[0].teinte) && !rouge(res.pile[0].teinte), res.pile[0].teinte);
    /* La prévision et le précédent ne doivent JAMAIS porter de couleur d'état : ce sont des repères,
       pas des résultats. Un consensus peint en vert dirait qu'il a « bien sorti », ce qui n'a
       aucun sens et brouillerait la seule couleur qui informe, celle du réel. */
    v('la prévision et le précédent restent neutres (ce sont des repères, pas des résultats)',
      !vert(res.claims[1].teinte) && !rouge(res.claims[1].teinte)
      && !vert(res.claims[2].teinte) && !rouge(res.claims[2].teinte),
      res.claims[1].teinte + ' | ' + res.claims[2].teinte);

    console.log('\n── 3. Trois colonnes ÉGALES, pour comparer d\'une ligne à l\'autre ──');
    /* Des colonnes qui se règlent sur leur contenu se décalent d'une alerte à l'autre : « 207K » et
       « 1818.0 » ne font pas la même largeur. Comparer deux publications à la verticale devient
       alors impossible — c'est pourtant l'usage même de cette liste. */
    const geo = await page.evaluate(() => {
      const d = document.getElementById('p');
      const l = [...d.querySelectorAll('.np-abc-c')].map(c => Math.round(c.getBoundingClientRect().width));
      return { l, deborde: d.scrollWidth > d.clientWidth + 1 };
    });
    v('les trois cases font la même largeur', geo.l.length === 3 && new Set(geo.l).size === 1, JSON.stringify(geo.l));
    v('le bloc ne déborde pas du volet', !geo.deborde, JSON.stringify(geo));

    console.log('\n── 4. Le bloc ne s\'invente pas ──');
    v('sans référence, pas de tableau (la description reste le meilleur rendu)', res.brut.seul === '', res.brut.seul);
    v('une dépêche ordinaire n\'en produit jamais', res.brut.news === '', res.brut.news);
  } catch (e) {
    ko++; console.log('  ✗ banc interrompu\n      → ' + e.message);
  } finally {
    try { if (nav) await nav.close(); } catch {}
    try { srv.close(); } catch {}
  }

  /* ═══ 5. L'APERÇU D'UNE ALERTE NE COUPE PLUS EN PLEIN MOT ═══════════════════════════════════
     28/08, capture : l'onglet DTP rendait « Pas de mess », « Vérification f », « j'comprends pas
     le t ». Un `.slice(0, 140)` nu, sans point de suspension, tombant au hasard dans un mot.
     ⚠️ ET LA MESURE COMPTE AUTANT QUE LA FORME : sur les 382 annonces, médiane 587 caractères pour
     140 affichés — 99 % au-delà de la fenêtre. Une nouveauté DTP n'a NI clic NI déplié (« l'item
     EST l'information », dit le code) : cet aperçu est TOUT ce que le client lira ici. */
  console.log('\n── 5. L\'aperçu d\'une alerte : coupé à la phrase, jamais au milieu d\'un mot ──');
  const _APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
  const SRC_AP = (() => {
    const d = _APP.indexOf('const _NP_APERCU_MAX =');
    const f = _APP.indexOf('\nfunction _npStripSrc', d);
    return (d < 0 || f < 0) ? null : _APP.slice(d, f);
  })();
  v('la fonction d\'aperçu est extractible d\'app.js', !!SRC_AP);
  /* LE DÉFAUT, NOMMÉ : plus aucune coupe aveugle au caractère dans le rendu d'une alerte. */
  v('plus de coupe aveugle dans le rendu d\'une alerte',
    !/_npStripSrc\(item\.description, item\.source\)\.slice\(/.test(_APP),
    'le `.slice()` nu est revenu — il coupe au milieu des mots');
  if (SRC_AP) {
    // eslint-disable-next-line no-eval
    const F = eval('(function(){' + SRC_AP + '\nreturn _npApercu;})()');
    const finitPropre = s => !s || /[.!?…»]$/.test(s);
    /* Le cas EXACT de la capture : la première phrase tient, on s'arrête dessus. */
    const long1 = 'Signalé capture à l\'appui : sur une dépêche géopolitique, le bouton « Impact marché » '
      + 'était bien là, et le clic ne faisait RIEN. Pas de message, pas d\'erreur en console, pas de panneau — '
      + 'rien du tout, et c\'est précisément ce qui rend ce défaut si déroutant pour qui le rencontre.';
    const cap1 = F(long1);
    /* Le texte d'essai DÉPASSE la fenêtre — sinon il reviendrait intact et le contrôle ne
       prouverait rien (première écriture : il faisait 178 caractères pour une fenêtre de 180). */
    v('le texte d\'essai déborde bien la fenêtre', long1.length > 180, long1.length + ' caractères');
    v('une première phrase qui tient devient l\'aperçu ENTIER', /faisait RIEN\.$/.test(cap1), cap1);
    v('… et il ne dépasse pas la fenêtre', cap1.length <= 180, cap1.length + ' caractères');
    /* ⚠️ LE CŒUR : aucun aperçu ne doit finir en plein mot. On l'éprouve sur DU TEXTE RÉEL — les
       382 annonces livrées — et pas sur trois phrases choisies pour passer. */
    const SRV2 = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
    /* ⚠️ ON BORNE LE TABLEAU AUX DEUX BOUTS. Écrit d'abord sans borne de fin, ce découpage aspirait
       tout le reste de server.js et ramassait 6 `desc:` qui ne sont pas des annonces — le banc
       accusait alors un code correct (« 128 aperçus trop longs »). Un banc qui lit trop large ment
       aussi sûrement qu'un banc qui lit trop court. */
    const _d0 = SRV2.indexOf('const DTP_UPDATES = [');
    const bloc = SRV2.slice(_d0, SRV2.indexOf('\n];', _d0));
    const rxD = /desc: '((?:[^'\\]|\\.)*)' \}/g;
    let mm; const tous = [];
    while ((mm = rxD.exec(bloc))) tous.push(mm[1].replace(/\\(.)/g, '$1'));
    v('les annonces livrées sont lisibles', tous.length > 300, tous.length + ' trouvées');
    /* ⚠️ `tous.map(F)` PASSE L'INDEX EN SECOND ARGUMENT, donc `max` recevait le numéro de l'entrée :
       la 250e était coupée à 250 caractères, la 3e à 3. Le banc a accusé le code de produire
       128 aperçus trop longs alors qu'il n'en produisait aucun. On appelle avec UN seul argument. */
    const apercus = tous.map(t => F(t));
    const sales = apercus.filter(a => !finitPropre(a));
    v('AUCUNE des ' + tous.length + ' annonces ne finit sans ponctuation', sales.length === 0,
      sales.slice(0, 3).map(x => '…' + x.slice(-40)).join(' | '));
    /* ⚠️ LE CONTRÔLE CI-DESSUS NE SUFFIT PAS, et la mutation l'a prouvé : couper au caractère près
       PUIS coller « … » le satisfait pleinement — on aurait « le clic ne faisait RI… », ponctué et
       faux. Ce qu'il faut éprouver, c'est que le texte gardé s'arrête sur un MOT ENTIER : l'aperçu
       privé de son ellipse doit être un préfixe du texte d'origine, et le caractère qui suit dans
       l'original doit être un blanc (ou la ponctuation que la coupe a elle-même retirée). */
    const finitSurMotEntier = (src, ap) => {
      const a2 = ap.replace(/\s»$/, '');                     // la fermeture de citation ajoutée
      const s2 = String(src).replace(/\s+/g, ' ').trim();
      /* ⚠️ D'ABORD : L'APERÇU EST-IL UN PRÉFIXE EXACT ? Si oui, RIEN n'a été ajouté — c'est une
         coupe à la phrase, donc par construction sur un mot entier. Ce test doit passer EN PREMIER :
         écrit dans l'autre sens, il prenait l'ellipse que le TEXTE porte lui-même (« …US trip… »)
         pour une ellipse ajoutée, et accusait un aperçu parfaitement correct. */
      if (s2.startsWith(a2)) return true;
      if (!/…$/.test(a2)) return false;                      // ni préfixe, ni ellipse : anormal
      const sansEllipse = a2.slice(0, -1);
      if (!s2.startsWith(sansEllipse)) return false;
      const suiv = s2.charAt(sansEllipse.length);
      return suiv === '' || /[\s,;:—–-]/.test(suiv);        // blanc, ou la ponctuation que la coupe retire
    };
    const coupes = tous.map((t, i) => [t, apercus[i]]).filter(([t, a2]) => !finitSurMotEntier(t, a2));
    v('… et AUCUNE ne coupe au milieu d\'un mot', coupes.length === 0,
      coupes.slice(0, 3).map(([, a2]) => '…' + a2.slice(-45)).join(' | '));
    const trop = apercus.filter(a => a.length > 190);
    v('… et aucune ne déborde la fenêtre', trop.length === 0, trop.length + ' au-delà de 190 car.');
    const phrases = apercus.filter(a => /[.!?]»?$/.test(a)).length;
    console.log('  · ' + Math.round(phrases / apercus.length * 100) + ' % finissent sur une phrase entière');
    /* UNE CITATION OUVERTE DOIT ÊTRE REFERMÉE : ces annonces citent constamment un client, et un
       « laissé pendant dans le vide se voit tout de suite. */
    const dese = apercus.filter(a => (a.match(/«/g) || []).length > (a.match(/»/g) || []).length);
    v('… et aucune ne laisse un guillemet ouvert', dese.length === 0,
      dese.slice(0, 2).join(' | '));
    /* CE QUI NE DOIT PAS CHANGER : un texte plus court que la fenêtre est rendu TEL QUEL, sans
       ellipse ajoutée — promettre une suite qui n'existe pas est aussi faux que couper. */
    v('un texte court passe intact', F('Corrigé.') === 'Corrigé.');
    v('… et vide reste vide', F('') === '' && F(null) === '');
    /* Une première phrase MINUSCULE ne doit pas produire un aperçu avare : on remplit la ligne. */
    const court = F('C\'est fait. ' + 'Le desk affiche désormais la variation de séance et celle de la semaine côte à côte, '
      + 'pour les indices comme pour les matières premières, avec la même grammaire de couleur.');
    v('une phrase d\'ouverture minuscule ne bride pas l\'aperçu', court.length > 60, court);
  }

  /* ═══ 6. PAS D'ESPACE ENTRE LE NOMBRE ET LE POURCENT ════════════════════════════════════════
     28/08 : « enlève l'espace entre le nombre et le %, ça fait IA : au lieu de 2,4 % mets 2,4% ».
     C'est un choix ASSUMÉ contre la typographie française (qui veut une insécable) — c'est le desk
     de l'utilisateur, et sur un desk un chiffre et son unité se lisent d'un bloc.
     ⚠️ DEUX FRONTS, ET LE SECOND EST LE VRAI. Les formateurs qui collent « % » à un nombre calculé
     ont été corrigés à la source (23 endroits). Mais l'essentiel du texte français du desk est
     ÉCRIT PAR L'IA — traductions, analyses, récaps — et un modèle qui rédige en français met
     l'espace de lui-même : le cas signalé venait de là. D'où une règle d'affichage, branchée dans
     les trois fonctions qui normalisent DÉJÀ du texte avant rendu. */
  console.log('\n── 6. Le pourcent est collé à son nombre ──');
  const SRC_PCT = (() => {
    const m = /function _sansEspacePct\(s\) \{[^\n]*\}/.exec(_APP);
    return m ? m[0] : null;
  })();
  v('la règle est extractible d\'app.js', !!SRC_PCT);
  if (SRC_PCT) {
    // eslint-disable-next-line no-eval
    const P = eval('(function(){' + SRC_PCT + '\nreturn _sansEspacePct;})()');
    v('le cas signalé est corrigé',
      P('Taux de chômage au Japon : 2,4 % en juillet, inférieur aux attentes (2,5 %).')
        === 'Taux de chômage au Japon : 2,4% en juillet, inférieur aux attentes (2,5%).');
    /* Les TROIS espaces : normale, insécable, insécable fine. Un modèle qui rédige en français
       produit volontiers une insécable — invisible à l'œil dans le code, bien présente à l'écran. */
    v('… l\'espace insécable aussi', P('12\u00a0%') === '12%');
    v('… et l\'insécable FINE, celle que produit le français soigné', P('12\u202f%') === '12%');
    v('… ainsi que les espaces multiples', P('12   %') === '12%');
    /* CE QUI NE DOIT PAS BOUGER : un « % » qui ne suit pas un chiffre n'est pas une unité. */
    v('un « % » isolé n\'est pas touché', P('Le signe % seul') === 'Le signe % seul');
    v('… ni un pourcent précédé d\'un mot', P('cent % sûr') === 'cent % sûr');
    v('un texte vide ne casse rien', P('') === '' && P(null) === '');
  }
  /* LES TROIS POINTS DE BRANCHEMENT : titres, puces, aperçus d'alerte. Chacun est une fonction qui
     normalisait DÉJÀ du texte — la règle n'ajoute pas un quatrième endroit à retenir. */
  v('la règle est branchée sur les titres (_mdStrip)', /function _mdStrip\(s\) \{\s*return _sansEspacePct\(s\)/.test(_APP));
  v('… sur les puces (Info / Analyse / Impact)', /_sansEspacePct\(_decodeEntities\(b\)/.test(_APP));
  v('… et sur les aperçus d\'alerte', /let t = _sansEspacePct\(s\)/.test(_APP));
  /* AUCUN FORMATEUR NE DOIT REVENIR À L'ESPACE. Le contrôle porte sur TOUS les fichiers du client
     et du serveur : c'est une règle de produit, pas une préférence de fichier. */
  {
    const fautifs = [];
    for (const f of ['public/js/app.js', 'public/js/widgets.js', 'public/js/charts.js',
                     'public/js/admin.js', 'public/js/home.js', 'server.js', 'mailer.js']) {
      let src; try { src = fs.readFileSync(path.join(RACINE, f), 'utf8'); } catch { continue; }
      const sansCom = src.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');
      if (/' %'|" %"|\$\{[^{}]*\} %/.test(sansCom)) fautifs.push(f);
    }
    v('aucun formateur ne remet l\'espace avant le %', fautifs.length === 0, fautifs.join(', '));
  }

  console.log('\n───────────────────────────────────────');
  console.log('  ' + ok + ' vert(s), ' + ko + ' rouge(s)\n');
  process.exit(ko ? 1 : 0);
})();
