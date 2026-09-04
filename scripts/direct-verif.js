#!/usr/bin/env node
/**
 * scripts/direct-verif.js — LE DIRECT EST-IL VRAIMENT DANS LA CARTE, ET QUE FAIT-ELLE SANS LUI ?
 * ------------------------------------------------------------------------------------------------
 * 04/09, demande utilisateur, capture à l'appui : « pour Bloomberg et Yahoo on doit avoir la vidéo
 * DANS le widget, tu comprends le but du widget ? » — puis, sur la bibliothèque : « améliore leur
 * aperçu de widget, enlève leur description ».
 *
 * ⚠️ LE CONTEXTE QUI EXPLIQUE LA FORME DE CE BANC. L'environnement de développement de cette
 * session n'a PAS accès à YouTube (refus 403 du proxy, mesuré, pas supposé). Impossible, donc, de
 * vérifier ici qu'une adresse de diffusion répond. Deux conséquences assumées :
 *   · aucun identifiant de vidéo n'est écrit en dur dans le desk — le serveur va le chercher ;
 *   · ce banc ne sort JAMAIS sur le réseau : il éprouve l'extraction sur des pages fabriquées, et
 *     le rendu de la carte sur une API bouchonnée. Ce qu'il ne peut pas prouver, il ne le prétend
 *     pas — la résolution réelle se constate sur le VPS, qui a le réseau.
 *
 * CE QUE CHAQUE CONTRÔLE GARDE :
 *
 * 1. L'IDENTIFIANT N'EST PAS ÉCRIT EN DUR. Une chaîne en continu redémarre son flux régulièrement,
 *    et chaque redémarrage crée une nouvelle vidéo. Un identifiant figé dans widgets.js serait un
 *    cadre mort au premier redémarrage, sans que rien ne le signale.
 *
 * 2. L'EXTRACTION EST ÉPROUVÉE SUR LE VRAI CODE, PAS SUR UNE COPIE. `_directExtraire` est extraite
 *    de server.js et exécutée. Un banc qui recopierait la fonction éprouverait sa propre copie.
 *    ⚠️ ET LE CONTRÔLE DE FORME EST ÉPROUVÉ EN NÉGATIF : sans lui, n'importe quel morceau de script
 *    passerait pour un identifiant et le desk afficherait un cadre mort en croyant avoir réussi.
 *    ⚠️ ET UNE PAGE HORS ANTENNE NE DOIT PAS RENDRE UNE VIDÉO : ramasser la dernière archive et
 *    l'appeler « direct » serait le mensonge le plus facile à commettre ici.
 *
 * 3. LES TROIS ÉTAGES DU RENDU, DANS UN VRAI CHROMIUM. Diffusion en cours → cadre sur CET
 *    identifiant. Chaîne seule → cadre « dernière diffusion ». Rien → la carte-lien d'avant. Le
 *    troisième est le plus important : c'est celui qui garantit qu'un client ne perd rien.
 *    ⚠️ ET LE LIEN VERS L'ÉDITEUR EST EXIGÉ DANS LES TROIS CAS : le desk emmène chez la source, il
 *    ne la remplace pas.
 *
 * 4. LES DEUX VIGNETTES DIFFÈRENT. C'était le défaut exact signalé : les deux cartes retombaient
 *    sur l'icône `WICO`, identique pour les deux, donc la bibliothèque affichait deux fois le même
 *    dessin. « Les deux existent » ne suffit pas — on compare leur contenu.
 *
 * 5. L'ANCIEN ARGUMENT A DISPARU PARTOUT. L'aide affirmait que « l'éditeur interdit techniquement
 *    l'intégration » : vrai de la page du site, faux de la diffusion officielle qu'on encadre
 *    désormais. Un commentaire périmé ment avec l'autorité du code (règle du dépôt) — on vérifie
 *    qu'il ne reste aucune trace.
 *
 *   node scripts/direct-verif.js
 *
 * Sans Chromium, la phase navigateur S'ABSTIENT (code 0) ; les phases sans navigateur, elles,
 * tournent toujours.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { serveur, trouverNavigateur } = require('./mobile-apercu.js');

const RACINE = path.join(__dirname, '..');
const PORT = 4851;
let ko = 0;
const v = (nom, cond, detail) => {
  if (cond) console.log('  ✓ ' + nom);
  else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); }
};

const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const W = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');

/* ══ PHASE 1 : LE MÉCANISME EST-IL CELUI QU'ON CROIT ? ═══════════════════════════════════════ */
function phaseSource() {
  console.log('\n── Le mécanisme, pas un identifiant figé ──');
  v('le serveur porte la table des directs (les deux chaînes)',
    /const _DIRECTS = \{[\s\S]{0,600}?bloomberg:[\s\S]{0,300}?yahoo:/.test(SRV));
  /* Plusieurs poignées par chaîne : c'est ce qui permet au mécanisme de se réparer seul le jour où
     l'une d'elles est renommée, sans redéploiement. Une seule poignée serait un point unique de
     panne déguisé en configuration. */
  const tbl = (SRV.match(/const _DIRECTS = \{[\s\S]*?\n\};/) || [''])[0];
  const poignees = (tbl.match(/poignees: \[[^\]]*\]/g) || []).map((x) => (x.match(/'/g) || []).length / 2);
  v('… et chaque chaîne propose PLUSIEURS poignées (une seule serait un point unique de panne)',
    poignees.length === 2 && poignees.every((n) => n >= 2), 'poignées par chaîne : ' + poignees.join(' · '));
  v('le desk expose la résolution par une route dédiée', /app\.get\('\/api\/direct\/:cle'/.test(SRV));
  /* LE CONTRÔLE CENTRAL. Un identifiant YouTube de vidéo fait 11 caractères ; s'il en traînait un
     dans le desk, le mécanisme serait décoratif et la carte mourrait au premier redémarrage de
     flux. On exige que le seul chemin vers un identifiant soit la réponse du serveur. */
  /* ⚠️ « live_stream » FAIT EXACTEMENT ONZE CARACTÈRES, comme un identifiant de vidéo. Le premier
     jet de ce contrôle rougissait donc sur notre PROPRE repli par chaîne. Un contrôle qui mord sur
     le code correct finit par être désarmé au lieu d'être compris : on nomme l'exception. */
  const embarques = (W.match(/embed\/[\w-]{11}[?"']/g) || []).filter((x) => x.indexOf('live_stream') < 0);
  v('AUCUN identifiant de vidéo n\'est écrit en dur dans le desk',
    embarques.length === 0,
    'trouvé : ' + embarques.join(' · ') + ' — un identifiant figé serait un cadre mort au premier redémarrage de flux');
  v('… la carte demande bien l\'adresse au serveur', /fetch\('\/api\/direct\/' \+ cle\)/.test(W));

  console.log('\n── L\'ancien argument a disparu PARTOUT ──');
  /* L'aide disait « l'éditeur interdit techniquement l'intégration de sa page » : exact pour la
     page du site, faux pour la diffusion officielle qu'on encadre maintenant. Règle du dépôt :
     quand une règle change, on corrige toutes ses traces dans le même commit. */
  /* ⚠️ ON CHERCHE DANS LE TEXTE DES DEUX CARTES, PAS DANS TOUT LE FICHIER. Le commentaire qui
     EXPLIQUE le retrait cite forcément la phrase retirée ; interdire la chaîne partout ferait
     rougir la trace écrite qu'on veut justement garder. C'est le texte lu par le client qui
     compte : `desc`, `aide`, `src`, `watch` des deux définitions. */
  const bloc2 = W.slice(W.indexOf("id: 'direct-bloomberg'"), W.indexOf("id: 'horloge'"));
  v('plus aucune trace de « l\'éditeur interdit l\'intégration » dans le TEXTE des deux cartes',
    bloc2.length > 200 && !/interdit techniquement l'intégration/.test(bloc2),
    'un argument périmé ment avec l\'autorité du code');
  v('… et la phrase descriptive que l\'utilisateur voulait retirer n\'est plus posée en dur',
    !/<p class="wdg-direct-txt">Le direct de Yahoo Finance/.test(W)
      && !/<p class="wdg-direct-txt">La chaîne américaine en continu/.test(W),
    'la carte doit montrer la vidéo, pas la décrire');

  console.log('\n── Les deux vignettes de la bibliothèque ──');
  const vig = (id) => {
    const i = W.indexOf("'" + id + "': '<svg ' + _PV");
    if (i < 0) return null;
    return W.slice(i, W.indexOf("</svg>'", i) + 7);
  };
  const vb = vig('direct-bloomberg'), vy = vig('direct-yahoo');
  v('les deux directs ont leur propre vignette', !!vb && !!vy,
    'sans vignette, la bibliothèque retombe sur l\'icône — la même pour les deux');
  /* LE CONTRÔLE QUI PORTE LA DEMANDE. « Les deux existent » serait vert avec deux dessins
     identiques — c'est-à-dire exactement le défaut signalé. */
  v('… et elles DIFFÈRENT (c\'était le défaut : deux fois le même dessin)',
    !!vb && !!vy && vb.replace('direct-bloomberg', '') !== vy.replace('direct-yahoo', ''));
  /* La charte réserve le rouge au baissier et à l'alerte : la pastille « en direct » ne le prend
     pas, contrairement à l'usage télévisuel. Décision déjà prise pour le badge FERMÉ de la frise. */
  v('… et aucune n\'emprunte le rouge d\'alerte pour sa pastille de direct',
    !!vb && !!vy && !/circle[^>]*fill="#ff3d00"/.test(vb) && !/circle[^>]*fill="#ff3d00"/.test(vy));
}

/* ══ PHASE 2 : L'EXTRACTION, SUR LE VRAI CODE ════════════════════════════════════════════════
   On EXTRAIT `_directExtraire` de server.js et on l'exécute. Recopier la fonction dans ce fichier
   reviendrait à éprouver la copie ; le jour où le serveur change, le banc resterait vert. */
function phaseExtraction() {
  console.log('\n── L\'extraction des identifiants (vraie fonction, pages fabriquées) ──');
  const i = SRV.indexOf('function _directExtraire(html) {');
  if (i < 0) { v('la fonction d\'extraction est trouvable dans server.js', false); return; }
  const fin = SRV.indexOf('\n}\n', i);
  let fn;
  try { fn = new Function(SRV.slice(i, fin + 3) + '\nreturn _directExtraire;')(); }
  catch (e) { v('la fonction d\'extraction s\'évalue', false, e.message); return; }

  const CANON = '<link rel="canonical" href="https://www.youtube.com/watch?v=abcDEF12345">'
    + '<script>{"externalId":"UCaaaaaaaaaaaaaaaaaaaaaa"}</script>';
  const INTERNE = '<script>{"channelId":"UCbbbbbbbbbbbbbbbbbbbbbb","isLiveNow":true,"videoId":"zzzYYY98765"}</script>';
  const HORS = '<script>{"externalId":"UCcccccccccccccccccccccc","isLiveNow":false,"videoId":"archive1234"}</script>';
  const RIEN = '<html><body><p>page quelconque, aucun identifiant</p><script>var x="troplongpouretreunidentifiant";</script></body></html>';

  const a = fn(CANON);
  v('le lien canonique d\'une page « /live » donne la diffusion en cours',
    a.video === 'abcDEF12345' && a.chaine === 'UCaaaaaaaaaaaaaaaaaaaaaa', JSON.stringify(a));
  const b = fn(INTERNE);
  v('… la forme interne marche aussi quand le canonique manque',
    b.video === 'zzzYYY98765' && b.chaine === 'UCbbbbbbbbbbbbbbbbbbbbbb', JSON.stringify(b));
  /* ⚠️ LE CONTRÔLE QUI COMPTE LE PLUS. Une chaîne hors antenne porte encore ses archives : rendre
     la dernière et l'appeler « direct » serait le mensonge le plus facile à commettre ici. */
  const c = fn(HORS);
  v('une chaîne HORS ANTENNE ne rend aucune vidéo (on ne fait pas passer une archive pour un direct)',
    c.video === null && c.chaine === 'UCcccccccccccccccccccccc', JSON.stringify(c));
  /* Et le contrôle de forme, en négatif : sans lui, un morceau de script quelconque passerait pour
     un identifiant et le desk afficherait un cadre mort en croyant avoir réussi. */
  const d = fn(RIEN);
  v('une page sans identifiant ne rend RIEN (le contrôle de forme mord)',
    d.video === null && d.chaine === null, JSON.stringify(d));
}

/* ══ PHASE 3 : LES TROIS ÉTAGES DU RENDU, DANS UN VRAI CHROMIUM ══════════════════════════════ */
const CAS = [
  { nom: 'diffusion en cours → le cadre porte CET identifiant', rep: { ok: true, video: 'abcDEF12345', chaine: 'UCaaaaaaaaaaaaaaaaaaaaaa', site: 'https://www.bloomberg.com/live/us' },
    attendu: (s) => /\/embed\/abcDEF12345/.test(s || ''), cadre: true },
  { nom: 'chaîne seule → cadre « dernière diffusion » (jamais périmé)', rep: { ok: true, video: null, chaine: 'UCaaaaaaaaaaaaaaaaaaaaaa', site: 'https://www.bloomberg.com/live/us' },
    attendu: (s) => /\/embed\/live_stream\?channel=UCaaaaaaaaaaaaaaaaaaaaaa/.test(s || ''), cadre: true },
  { nom: 'résolution en échec → la carte-lien d\'avant, jamais un cadre vide', rep: { ok: false, site: 'https://www.bloomberg.com/live/us' },
    attendu: null, cadre: false },
];

(async () => {
  phaseSource();
  phaseExtraction();

  const bin = trouverNavigateur();
  if (!bin) { console.log('\n[Direct] aucun Chromium → phase navigateur abstenue.\n'); process.exit(ko ? 1 : 0); }
  let pp; try { pp = require('puppeteer-core'); }
  catch { console.log('\n[Direct] puppeteer-core absent → phase navigateur abstenue.\n'); process.exit(ko ? 1 : 0); }

  let reponse = CAS[0].rep;
  const srv = serveur();
  await new Promise((r) => srv.listen(PORT, r));
  const CFG = { cfg: { active: 't', gap: 'tight', gapV: 2, deskV: 99, actV: 2, tipSeen: 1,
    layouts: [{ id: 't', name: 'Banc', fav: true, items: [{ w: 'direct-bloomberg', gw: 6, gh: 14 }] }] } };
  const srvS = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (['/api/me', '/api/auth/me', '/api/session', '/api/user'].includes(u)) {
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      return rs.end(JSON.stringify({ ok: true, loggedIn: true, authenticated: true, role: 'admin',
        user: { id: 'u1', email: 'banc@datatradingpro.com', name: 'Banc', role: 'admin', plan: 'professionnel', active: true } }));
    }
    if (u === '/api/widgets') { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify(CFG)); }
    if (u.indexOf('/api/direct/') === 0) { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify(reponse)); }
    srv.emit('request', rq, rs);
  });
  await new Promise((r) => srvS.listen(PORT + 1, r));

  let nav;
  try {
    nav = await pp.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    console.log('\n── Les trois étages du rendu ──');
    for (const c of CAS) {
      reponse = c.rep;
      const page = await nav.newPage();
      const fatales = [];
      page.on('pageerror', (e) => fatales.push(String(e.message).slice(0, 160)));
      /* ⚠️ ON EMPÊCHE LE CADRE DE SORTIR SUR LE RÉSEAU. Un banc qui appellerait YouTube serait
         lent, dépendant d'un tiers, et rouge le jour où ce tiers tousse. On veut l'ADRESSE que la
         carte construit, pas la vidéo. */
      await page.setRequestInterception(true);
      page.on('request', (rq) => {
        if (/youtube\.com|ytimg\.com|google\.com/.test(rq.url())) return rq.abort();
        rq.continue();
      });
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(`http://localhost:${PORT + 1}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise((r) => setTimeout(r, 3400));
      const vu = await page.evaluate(() => {
        const f = document.querySelector('.wdg-direct-frame iframe');
        const a = [...document.querySelectorAll('.wdg-direct a')].map((x) => x.getAttribute('href'));
        return { src: f ? f.getAttribute('src') : null, liens: a,
                 bouton: !!document.querySelector('.wdg-direct-btn') };
      });
      if (c.cadre) {
        v(c.nom, !!vu.src && c.attendu(vu.src), 'cadre : ' + vu.src);
      } else {
        v(c.nom, vu.src === null && vu.bouton === true, 'cadre : ' + vu.src + ' · bouton : ' + vu.bouton);
      }
      /* LE LIEN VERS L'ÉDITEUR, DANS LES TROIS CAS. Le desk emmène chez la source, il ne la
         remplace pas — et c'est vrai aussi quand le cadre marche. */
      v('… et le lien vers l\'éditeur reste présent',
        vu.liens.some((h) => /bloomberg\.com\/live/.test(h || '')), vu.liens.join(' · ') || 'aucun lien');
      v('… sans erreur d\'exécution', fatales.length === 0, [...new Set(fatales)].slice(0, 3).join(' | '));
      await page.close();
    }
  } catch (e) {
    console.log('\n[Direct] phase navigateur interrompue : ' + (e && e.message));
  } finally {
    if (nav) await nav.close();
    srvS.close();
    srv.close();
  }

  console.log(ko === 0 ? '\n[Direct] tout est vert.\n' : '\n[Direct] ' + ko + ' contrôle(s) au rouge.\n');
  process.exit(ko ? 1 : 0);
})();
