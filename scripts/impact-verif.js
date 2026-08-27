#!/usr/bin/env node
/* ═══ « IMPACT MARCHÉ » : CE QUI Y A DROIT, ET CE QU'ON DEMANDE À L'IA ═════════════════════════
   10/09, retour d'un client relayé par le propriétaire, verbatim :
     « c'est un outil qui spot l'entièreté du forex c'est cool mais les drivers sur marché ce n'est
      pas ça et c'est dommage »

   LE DÉFAUT TENAIT EN UNE LIGNE. `_enrichImpacts` exigeait un MARQUEUR DE CONSENSUS dans le titre
   (`vs`, `expected`, `forecast`, `previous`, `actual`). Autrement dit, seule une statistique publiée
   au format « X vs Y attendu » recevait une lecture d'impact. Une décision de taux, un compte rendu
   de banque centrale, un blocage d'Hormuz, un embargo pétrolier — ce qui DÉPLACE les marchés — n'en
   recevaient aucune. Le desk savait lire la surprise d'un chiffre, pas l'événement qui fait le marché.

   ⚠️ CE BANC GARDE LES DEUX MOITIÉS DU COMPROMIS, et c'est tout son objet. Le marqueur de consensus
   n'était pas une lubie : il GARANTIT que l'IA a de la matière (le publié face à l'attendu) et ne
   peut pas broder. Le supprimer aurait rendu éligible n'importe quelle dépêche et rouvert la
   fabrication que le dépôt a déjà payée deux fois. On a donc ouvert une SECONDE porte, avec sa
   propre garantie de matière et sa propre consigne. Les contrôles ci-dessous vérifient que la
   première porte n'a pas été élargie en douce, et que la seconde ne laisse pas passer n'importe quoi.

   ⚠️ ON EXTRAIT LES VRAIES EXPRESSIONS de server.js — pas une transcription. Une copie resterait
   verte le jour où l'original change, c'est-à-dire exactement le jour qui compte. */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + String(d).slice(0, 300) : '')); } };
const ligne = rx => (rx.exec(SRV) || [])[1] || null;
const bloc = rx => (rx.exec(SRV) || [''])[0];

console.log('\n── 1. Les deux portes, éprouvées sur de vrais titres ──');
const srcCb   = ligne(/const _CB_NEWS = (new Set\([^;]+\));/);
const srcCcy  = ligne(/const _CB_CCY = (\{[^;]+\});/);
const srcGeo  = ligne(/const GEO_TIER1_RE = (\/.+\/i);/);
/* `isGeoDeal` s'appuie sur trois regex déclarées juste au-dessus d'elle : on les emmène, sinon
   l'extraction lève « GEO_DEAL_HARD_RE is not defined » — ce qui prouve au passage qu'on a bien
   extrait la VRAIE fonction et non une paraphrase. */
const srcDeal = bloc(/const GEO_DEAL_HARD_RE = [\s\S]*?function isGeoDeal\([\s\S]*?\n\}/);
const srcA    = ligne(/const _impChiffree = ([\s\S]*?);\n/);
const srcB    = ligne(/const _impEvenement = ([\s\S]*?);\n/);
v('les constantes de tri sont extractibles', !!srcCb && !!srcCcy && !!srcGeo && !!srcDeal);
v('les deux portes sont extractibles', !!srcA && !!srcB, (srcA || '') + ' || ' + (srcB || ''));

if (srcCb && srcCcy && srcGeo && srcDeal && srcA && srcB) {
  /* Les parenthèses ne sont pas décoratives : `eval('{ Fed: "USD" }')` lit un BLOC, pas un objet,
     et lève « Unexpected token : ». */
  const _CB_NEWS = eval(srcCb), _CB_CCY = eval('(' + srcCcy + ')'), GEO_TIER1_RE = eval(srcGeo);
  eval(srcDeal);   // isGeoDeal
  /* On rebâtit le test EXACTEMENT comme la boucle le fait : `h` et `item` en portée, puis les deux
     expressions telles qu'écrites dans server.js. */
  const porte = (headline, category) => {
    const h = String(headline), item = { category };
    const _impChiffree = eval(srcA);
    const _impEvenement = eval(srcB);
    return _impChiffree ? 'A' : (_impEvenement ? 'B' : '—');
  };

  console.log('\n  · porte A — la statistique publiée (comportement d\'origine, INCHANGÉ)');
  v('« US CPI 3.2% vs 3.1% expected » entre par A', porte('US CPI 3.2% vs 3.1% expected', 'US Data') === 'A');
  v('« Nonfarm Payrolls 187K, forecast 170K » entre par A', porte('Nonfarm Payrolls 187K, forecast 170K', 'US Data') === 'A');
  /* ⚠️ LE CŒUR DE LA GARDE D'ORIGINE. Un chiffre SANS consensus n'a pas de surprise à lire : il ne
     doit toujours PAS entrer par A. Si ce contrôle passe au vert un jour, la première porte a été
     élargie et l'IA commente des chiffres qu'elle ne peut comparer à rien. */
  v('un chiffre SANS consensus n\'entre PAS par A', porte('Gold trades at 2415 an ounce', 'Market Analysis') !== 'A');
  v('une annonce à venir n\'entre pas par A', porte('US CPI due Thursday', 'US Data') !== 'A');

  console.log('\n  · porte B — l\'événement sans chiffre (nouveau)');
  v('un propos de la Fed entre par B', porte('Fed\'s Hammack says now is the time to tackle inflation', 'Fed') === 'B');
  v('une décision BCE entre par B', porte('ECB leaves deposit rate unchanged', 'ECB') === 'B');
  v('un blocage d\'Hormuz entre par B', porte('Iran threatens to close the Strait of Hormuz', 'Geopolitical') === 'B');
  v('un embargo pétrolier entre par B', porte('EU agrees oil embargo on Russian crude', 'Global News') === 'B');
  v('des frappes aériennes entrent par B', porte('Air strikes reported near the capital', 'Geopolitical') === 'B');
  /* La seconde porte ne doit pas devenir un fourre-tout : le fil fait plus de mille dépêches/jour. */
  v('une dépêche ordinaire n\'entre par AUCUNE porte', porte('Company X names new chief financial officer', 'Global News') === '—');
  v('un mouvement de marché banal non plus', porte('Euro edges higher in thin trade', 'FX Flows') === '—');
  /* Une statistique chiffrée reste en A même si sa catégorie est une banque centrale : sinon on lui
     servirait la consigne « aucun chiffre » alors qu'elle en a un. */
  v('une stat chiffrée de catégorie Fed reste en A', porte('US Core PCE 2.6% vs 2.7% expected', 'Fed') === 'A');

  console.log('\n  · les deux tables de banques centrales ne divergent pas');
  /* La porte B s'ouvre sur `_CB_NEWS` ; la devise exposée se lit dans `_CB_CCY`. Une banque ajoutée
     à l'une sans l'autre passerait la porte puis perdrait sa paire — en silence. */
  const sansDevise = [..._CB_NEWS].filter(c => !_CB_CCY[c]);
  v('chaque banque de _CB_NEWS a sa devise dans _CB_CCY', sansDevise.length === 0, sansDevise.join(', '));
  const sansPorte = Object.keys(_CB_CCY).filter(c => !_CB_NEWS.has(c));
  v('… et aucune devise n\'est déclarée pour une banque qui n\'ouvre pas la porte', sansPorte.length === 0, sansPorte.join(', '));
  v('les devises sont des codes ISO à trois lettres', Object.values(_CB_CCY).every(c => /^[A-Z]{3}$/.test(c)), JSON.stringify(_CB_CCY));
}

console.log('\n── 2. Ce qu\'on demande à l\'IA, selon la matière dont elle dispose ──');
const boucle = bloc(/async function _enrichImpacts\(\)[\s\S]*?\n\}/);
v('la boucle est extractible', boucle.length > 1500, String(boucle.length));
v('deux consignes distinctes, choisies sur la porte', /_impEvenement \? `Tu es l'économiste/.test(boucle));
/* ⚠️ LE POINT QUI COMPTE. Servir la consigne « statistique » à un événement sans chiffre, c'est
   réclamer une surprise face à un consensus qui n'existe pas — et un modèle à qui l'on demande un
   écart qu'il n'a pas L'INVENTE. Le dépôt a payé ce mécanisme deux fois. */
v('la consigne « événement » dit qu\'il n\'y a AUCUN chiffre', /IL N'Y A AUCUN CHIFFRE PUBLIÉ/.test(boucle));
v('… et l\'interdit explicitement d\'en inventer', /N'en invente pas : ni pourcentage, ni niveau/.test(boucle));
v('… elle demande le MÉCANISME de transmission', /par quel canal cet événement atteint les marchés/i.test(boucle));
v('… et nomme les canaux plausibles', /prime de risque|approvisionnement|refuge/.test(boucle));
/* Un fait géopolitique n'expose pas une paire de devises au hasard : c'est l'énergie et les refuges. */
v('… en orientant la géopolitique vers l\'énergie et les refuges', /expose d'abord l'énergie et les refuges/.test(boucle));
v('la consigne « statistique » garde sa règle du conforme', /un chiffre CONFORME aux attentes N'EST PAS une surprise/.test(boucle));
/* La posture de banque centrale est injectée dans les deux cas, mais la phrase qui l'accompagne doit
   suivre la matière : demander de « confronter le chiffre » à un événement qui n'en a pas est
   exactement l'invitation à en inventer un. */
v('la phrase de posture suit la porte', /CONFRONTE l\\'événement à CETTE posture/.test(boucle) && /CONFRONTE le chiffre à CETTE posture/.test(boucle));
v('… et redit à l\'événement qu\'il n\'a pas de chiffre', /Ne parle d\\'aucun chiffre : tu n\\'en as pas/.test(boucle));
/* La devise d'un événement de banque centrale n'est pas dans son titre : sans la table, le prompt
   tournerait sans paire exposée ni posture à confronter. */
v('la devise d\'un événement BC vient de sa catégorie', /_impCcyDuTitre\(h\) \|\| \(_CB_CCY\[item\.category\]/.test(boucle));
/* ⚠️ AUCUN EXEMPLE CHIFFRÉ DANS LES CONSIGNES : le dépôt a déjà vu une ligne CPI et un paragraphe
   Iran recopiés tels quels depuis un prompt, dans des séances qui ne les portaient pas. */
const consignes = boucle.slice(boucle.indexOf('const prompt ='));
v('aucun pourcentage n\'est offert à la recopie dans les consignes', !/%\s*(?:vs|contre|attendu)/i.test(consignes),
  (consignes.match(/.{0,40}%\s*(?:vs|contre|attendu).{0,30}/i) || [''])[0]);

console.log('\n── 3. Les garde-fous de dépense n\'ont pas bougé ──');
v('le plafond journalier tient toujours', /_impCount >= IMPACT_MAX_JOUR/.test(boucle));
v('… et le débit par cycle aussi', /perCycle <= 0/.test(boucle));
v('la fenêtre de fraîcheur reste à 6 h', /6 \* 60 \* 60 \* 1000/.test(boucle));
v('le cache durable évite de repayer', /auth\.aiCacheGet\(ck\)/.test(boucle) && /auth\.aiCacheSet\(ck/.test(boucle));
v('… et mémorise MÊME LE VIDE (pas de retente en boucle)', /cache même vide/.test(boucle));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec' : '✓ ' + ok + ' contrôles au vert'));
process.exit(ko ? 1 : 0);
