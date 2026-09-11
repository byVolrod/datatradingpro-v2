#!/usr/bin/env node
/**
 * scripts/machine-verif.js — LE PANNEAU ADMIN MONTRE-T-IL VRAIMENT LA MACHINE ?
 * ------------------------------------------------------------------------------------------------
 * 11/09, demande utilisateur : « Dans le panel admin je dois voir les performances du serveur ainsi
 * que le stockage du disque dur et aussi un schéma d'architecture de l'infrastructure du DTP si
 * possible dynamique. »
 *
 * CE QUI MANQUAIT N'ÉTAIT PAS LA MESURE, C'ÉTAIT L'ÉCRAN. Le serveur surveille son disque toutes
 * les 5 minutes depuis le 07/09 et sa mémoire toutes les 30 secondes depuis bien plus longtemps.
 * `/api/admin/disque` existait, complet, et AUCUNE ligne d'admin.js ne l'appelait. Un garde-fou
 * que personne ne regarde ne prévient personne : c'est la maladie que ce dépôt traque depuis le
 * keep-alive resté vert deux mois et demi en ne pinguant rien.
 *
 * CE QUE CE BANC ÉPROUVE, ET POURQUOI CHAQUE CONTRÔLE EXISTE.
 *
 * 1. ⚠️ ON OUVRE VRAIMENT L'ONGLET. Les cartes existent dans le DOM même quand leur onglet est
 *    masqué. Un banc qui interroge le DOM sans ouvrir l'onglet mesure une boîte de hauteur nulle
 *    et se croit vert (leçon de desinscription-verif, 04/09).
 * 2. ⚠️ ON LIT LES CHIFFRES RENDUS, PAS LA PRÉSENCE DES BLOCS. Trois cartes vides seraient trois
 *    cartes présentes. Le banc sert des valeurs RECONNAISSABLES (1234 Mo, 87%) et exige de les
 *    retrouver à l'écran : c'est la seule façon de distinguer « câblé » de « déclaré ».
 * 3. ⚠️ UN ÉTAT INCONNU DOIT ÊTRE GRIS, JAMAIS VERT. La maladie du faux vert commence toujours par
 *    une valeur manquante traitée en succès. Le banc rejoue donc une charge SANS `systeme` ni
 *    `disque` et vérifie que le schéma ne peint rien en vert.
 * 4. ⚠️ ET LE SCHÉMA NE PEUT PAS CONTREDIRE LES CARTES : il est peint depuis la MÊME charge. Le
 *    banc le vérifie en changeant l'état des bases et en regardant la brique correspondante.
 *
 * Sans navigateur disponible, la phase s'abstient (code 0) au lieu de bloquer.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
const PORT = 4867;
let ko = 0;
const v = (nom, cond, detail) => { if (cond) console.log('  ✓ ' + nom); else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };

function trouverNavigateur() {
  const cands = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    try { for (const d of fs.readdirSync(b)) for (const r of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) cands.push(path.join(b, d, r)); } catch (e) {}
  }
  return cands.find(c => c && fs.existsSync(c)) || null;
}

/* ── PHASE SOURCE : ce qui se lit sans navigateur, et qui doit rester vrai ─────────────────────── */
function phaseSource() {
  console.log('\n── Le serveur expose bien la machine et son disque ──');
  const srv = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
  const adm = fs.readFileSync(path.join(RACINE, 'public/js/admin.js'), 'utf8');
  const html = fs.readFileSync(path.join(RACINE, 'public/admin.html'), 'utf8');

  v('le moniteur admin renvoie l\'état de la machine', /systeme:\s*\(\(\)\s*=>/.test(srv),
    'clé `systeme` absente de /api/admin/ai-monitor : le panneau n\'aurait rien à afficher');
  v('… et celui du disque', /disque:\s*\(\(\)\s*=>/.test(srv), 'clé `disque` absente de la charge du moniteur');
  /* ⚠️ LE RETARD DE BOUCLE EST LA MESURE QUI DIT « ÇA RAME », et c'est la seule que Node ne donne
     pas toute faite. Sans elle, une charge processeur reste invisible : la mémoire ne bouge pas. */
  v('… y compris le retard de la boucle d\'événements', /_boucleRetardMs/.test(srv) && /retardMs:/.test(srv),
    'sans lui, une charge processeur est invisible : elle ne se voit pas dans la mémoire');
  /* Une mesure de mémoire jugée contre la limite du CONTENEUR ne dit rien : c'est au seuil
     d'action que le serveur ferme les navigateurs. */
  v('… et la mémoire est rapportée AVEC son seuil d\'action', /seuilMo:\s*_MEM_SEUIL_MO/.test(srv),
    'sans le seuil, une barre de mémoire ne dit pas à quel moment il se passe quelque chose');

  v('le panneau porte les trois blocs', /id="aim-systeme"/.test(html) && /id="aim-disque"/.test(html) && /id="aim-infra"/.test(html),
    'un bloc manque dans admin.html');
  /* ⚠️ DÉCLARER UNE FONCTION DE RENDU NE LA BRANCHE PAS. Trois fonctions parfaites que personne
     n'appelle laissent trois cartes vides, sans la moindre erreur. */
  v('… et les trois rendus sont APPELÉS, pas seulement déclarés',
    /aimRenderSysteme\(d\);\s*aimRenderDisque\(d\);\s*aimRenderSchema\(d\);/.test(adm),
    'les rendus ne sont pas dans le cycle de rafraîchissement : les cartes resteraient vides');
  /* ⚠️ LE NOM DU SCHÉMA NE DOIT PAS ÉCRASER CELUI DES CARTES EMAIL/EGRESS/BASES. Une seconde
     déclaration du même nom REMPLACE la première en silence, et `js-verif` ne le voit pas. */
  v('… et aucun nom de rendu n\'est déclaré deux fois',
    (adm.match(/function aimRenderInfra\s*\(/g) || []).length === 1 && (adm.match(/function aimRenderSchema\s*\(/g) || []).length === 1,
    'un doublon remplacerait l\'autre en silence, et trois cartes resteraient vides sans erreur');
  return ko;
}

/* ── PHASE NAVIGATEUR : on ouvre le VRAI panneau et on lit ce qui est PEINT ───────────────────── */
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

/* Des valeurs RECONNAISSABLES : on doit pouvoir les retrouver à l'écran sans ambiguïté. */
const MONITEUR = (variante) => {
  const base = {
    now: Date.now(), range: 24, budget: {}, providers: {}, health: {}, cache: {},
    categoriesToday: {}, claudeToday: {}, trend: [], backoff: {}, healthDetail: [],
    mail: { ok: true, sent: 41, failed: 0, ovh: { configured: true }, lastProvider: 'ovh' },
    egress: { bytes1h: 1048576, bytes24h: 10485760, cap1h: 52428800, cap24h: 524288000, tripped: false },
    db: { count: 4, okCount: 4, nodes: [
      { name: 'principale', host: 'a.supabase.co', state: 'ok', ms: 42, quarLect: false },
      { name: 'db2', host: 'b.supabase.co', state: 'ok', ms: 51, quarLect: false },
      { name: 'db3', host: 'c.supabase.co', state: 'ok', ms: 63, quarLect: false },
      { name: 'db4', host: 'd.supabase.co', state: 'ok', ms: 58, quarLect: false },
    ], keepalive: { ok: 4, last: Date.now() - 3600e3 } },
    whop: { ts: Date.now() - 600e3, checked: 37, fixed: 2, created: 0 },
    whopBans: null,
    alerts: { log: [], incidents: {} },
    systeme: { rssMo: 1234, heapMo: 210, heapTotalMo: 260, externeMo: 12, limiteMo: 2048, seuilMo: 1126,
               memPct: 60, retardMs: 17, charge1: 0.42, coeurs: 2, chargeParCoeur: 0.21, uptimeS: 7200, node: 'v22.0.0', niveau: 0 },
    disque: { pct: 87, libreGo: 4.2, totalGo: 40, niveau: 2, nom: 'à surveiller', jours: 11, vitesseGoH: 0.12,
              tendance: 'stable', sentinelleAgeMin: 7, motif: '', frein: false, t: Date.now() },
  };
  if (variante === 'inconnu') { base.systeme = null; base.disque = null; base.mail = null; base.egress = null; base.db = null; base.whop = null; }
  if (variante === 'bases-ko') { base.db.okCount = 1; base.db.nodes[1].state = 'erreur'; base.db.nodes[2].quarLect = true; base.db.nodes[3].state = 'restreint'; }
  return base;
};

(async () => {
  phaseSource();
  const bin = trouverNavigateur();
  if (!bin) { console.log('\n[Machine] aucun Chromium → phase navigateur abstenue.\n'); process.exit(ko ? 1 : 0); }
  let pp; try { pp = require('puppeteer-core'); }
  catch { console.log('\n[Machine] puppeteer-core absent → phase navigateur abstenue.\n'); process.exit(ko ? 1 : 0); }

  let variante = 'normal';
  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    const json = o => { rs.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); rs.end(JSON.stringify(o)); };
    if (u === '/api/auth/me' || u === '/api/me') return json({ loggedIn: true, authenticated: true, user: { id: '0', role: 'admin', name: 'Admin', email: 'admin@x.fr' } });
    if (u === '/api/admin/ai-monitor') return json(MONITEUR(variante));
    if (u.indexOf('/api/') === 0) return json({ ok: true });
    const f = path.join(PUB, (u === '/' || u === '/admin' ? '/admin.html' : u).replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end('404'); }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
    fs.createReadStream(f).pipe(rs);
  });
  await new Promise(r => srv.listen(PORT, r));

  let nav = null;
  try {
    nav = await pp.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
    await page.setViewport({ width: 1500, height: 1100 });
    await page.goto('http://localhost:' + PORT + '/admin.html', { waitUntil: 'networkidle0', timeout: 45000 });
    /* ⚠️ ON OUVRE L'ONGLET POUR DE VRAI : les cartes existent dans le DOM même masquées, et toute
       mesure sur un élément en `display:none` rend zéro. */
    const ouvrir = async () => {
      await page.evaluate(() => { try { admTab('aimon'); } catch (e) {} });
      await new Promise(r => setTimeout(r, 1600));
    };
    await ouvrir();

    const lire = () => page.evaluate(() => {
      const t = id => { const e = document.getElementById(id); return e ? (e.textContent || '').replace(/\s+/g, ' ').trim() : null; };
      const inf = document.getElementById('aim-infra');
      const svg = inf && inf.querySelector('svg');
      const traits = svg ? [...svg.querySelectorAll('rect')].map(r => r.getAttribute('stroke')) : [];
      return { sys: t('aim-systeme'), disque: t('aim-disque'), infra: inf ? (inf.textContent || '').replace(/\s+/g, ' ').trim() : null,
               svgLarge: svg ? svg.getBoundingClientRect().width : 0, traits,
               visible: !!(document.getElementById('tab-aimon') && document.getElementById('tab-aimon').offsetHeight > 0) };
    });

    console.log('\n── Le panneau admin, ouvert pour de vrai ──');
    let L = await lire();
    v('le panneau s\'ouvre sans exception', errs.length === 0, errs.slice(0, 2).join(' | '));
    v('l\'onglet Moniteur est bien AFFICHÉ', L.visible, 'onglet masqué : toute mesure de géométrie rendrait zéro');

    /* 2. LES CHIFFRES SONT LÀ, pas seulement les cartes. */
    v('la carte Machine montre la mémoire mesurée', /1234 Mo/.test(L.sys || ''), 'rendu : ' + String(L.sys).slice(0, 120));
    v('… avec le seuil auquel le serveur agit', /1126 Mo/.test(L.sys || ''),
      'sans le seuil, une barre de mémoire ne dit pas quand il va se passer quelque chose');
    v('… et le retard de traitement', /17 ms/.test(L.sys || ''), 'rendu : ' + String(L.sys).slice(0, 120));
    v('la carte Disque montre l\'occupation réelle', /87%/.test(L.disque || ''), 'rendu : ' + String(L.disque).slice(0, 120));
    v('… et l\'espace libre', /4\.2 Go libres sur 40 Go/.test(L.disque || ''), 'rendu : ' + String(L.disque).slice(0, 120));
    /* La sentinelle est le watchdog SYSTÈME : muette, il n'y a plus de filet et personne ne le sait. */
    v('… et l\'âge de la sentinelle système', /7 min/.test(L.disque || ''), 'rendu : ' + String(L.disque).slice(0, 120));

    /* 4. LE SCHÉMA EST DYNAMIQUE : il porte les mêmes chiffres que les cartes. */
    v('le schéma d\'architecture est dessiné', L.svgLarge > 200, 'largeur rendue : ' + Math.round(L.svgLarge) + ' px');
    v('… et il porte les chiffres de la MÊME mesure que les cartes',
      /1234 Mo/.test(L.infra || '') && /87%/.test(L.infra || '') && /4\/4 joignables/.test(L.infra || ''),
      'rendu : ' + String(L.infra).slice(0, 200));

    /* Il SUIT l'état : on casse les bases et la brique doit changer de couleur. */
    variante = 'bases-ko';
    await page.evaluate(() => { try { aimLoad(); } catch (e) { try { admTab('dash'); admTab('aimon'); } catch (e2) {} } });
    await new Promise(r => setTimeout(r, 1800));
    L = await lire();
    v('… et il SUIT l\'état : bases dégradées, le schéma le dit',
      /1\/4 joignables/.test(L.infra || '') && /resynchro/i.test(L.infra || ''),
      'rendu : ' + String(L.infra).slice(0, 200));

    /* 3. LE TÉMOIN QUI COMPTE : un état INCONNU ne doit jamais être peint en vert. */
    variante = 'inconnu';
    await page.evaluate(() => { try { aimLoad(); } catch (e) { try { admTab('dash'); admTab('aimon'); } catch (e2) {} } });
    await new Promise(r => setTimeout(r, 1800));
    L = await lire();
    const verts = (L.traits || []).filter(c => c === '#22c55e').length;
    v('témoin : sans données, le schéma ne peint AUCUNE brique en vert', verts === 0,
      verts + ' brique(s) vertes sur une charge vide : c\'est le faux vert, exactement');
    v('… et il le dit, au lieu de rester muet', /inconnu|pas encore|jamais/i.test(L.infra || ''),
      'rendu : ' + String(L.infra).slice(0, 200));
    v('… la carte Disque aussi', /première mesure|indisponible/i.test(L.disque || ''), 'rendu : ' + String(L.disque).slice(0, 120));
    v('aucune exception pendant tout le parcours', errs.length === 0, errs.slice(0, 2).join(' | '));

    await page.close();
  } catch (e) {
    v('la phase navigateur s\'exécute', false, e && e.message);
  } finally {
    if (nav) try { await nav.close(); } catch (e) {}
    srv.close();
  }

  console.log(ko === 0 ? '\n[Machine] tout est vert.\n' : '\n[Machine] ' + ko + ' contrôle(s) au rouge.\n');
  process.exit(ko ? 1 : 0);
})();
