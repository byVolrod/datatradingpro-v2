#!/usr/bin/env node
/**
 * branding-verif.js — LES CONTRÔLES DU DESK TIENNENT-ILS SUR UNE SEULE GRILLE ?
 * ------------------------------------------------------------------------------------------------
 * 01/09, demande utilisateur, référence de terminal à l'appui : « s'il y a des incohérences sur le
 * branding, l'identité visuelle, l'UX/UI […] la largeur des boutons, tout en détail au millimètre
 * près, fais l'audit et améliore ».
 *
 * CE QU'UN AUDIT « AU MILLIMÈTRE » PEUT ÊTRE, ET CE QU'IL NE PEUT PAS. Il ne peut pas être une
 * opinion sur le goût — celui-là se règle par des captures. Il peut être une MESURE : deux
 * commandes de la même famille, côte à côte dans le même panneau, doivent faire la même hauteur. Ce
 * n'est pas une préférence, c'est ce qui distingue une grille d'un empilement.
 *
 * MESURÉ SUR LE DESK RÉEL AVANT CORRECTIF : trois boutons de 33, 34 et 36,6 px DANS LE MÊME
 * PANNEAU, et trois champs de saisie de 28,4, 31,2 et 35,1 px d'un volet à l'autre. Aucune de ces
 * valeurs n'avait été choisie : elles tombaient d'un padding et d'une interligne écrits à des dates
 * différentes. Le bouton « Copier » du lien de parrainage, lui, héritait de 42 px parce que le champ
 * d'à côté gardait sa marge basse à l'intérieur d'une rangée en `align-items: stretch`.
 *
 * Ce banc ouvre le VRAI desk et relit les hauteurs peintes. Il ne juge pas les largeurs : un bouton
 * principal a le droit d'être plus large que son voisin, c'est une hiérarchie. Deux hauteurs
 * différentes n'en sont pas une.
 *
 *   node scripts/branding-verif.js       (s'abstient sans Chromium)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
const PORT = 4783;
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' };
const UTIL = { id: 1, email: 'a@b.c', name: 'Test', role: 'client', active: true, plan: 'professionnel' };
let ok = 0, ko = 0;
const v = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); } else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

function trouverNavigateur() {
  const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    try { for (const d of fs.readdirSync(b)) for (const r of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, r)); } catch {}
  }
  return c.find(x => x && fs.existsSync(x)) || null;
}

(async () => {
  console.log('\n═══ BRANDING-VERIF — les contrôles sur une seule grille ═══');
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.log('  · puppeteer-core absent → abstention.\n'); process.exit(0); }
  const exe = trouverNavigateur();
  if (!exe) { console.log('  · aucun Chromium → abstention.\n'); process.exit(0); }

  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (u.startsWith('/api/')) {
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      return rs.end(JSON.stringify({ items: [], total: 0, ok: true, loggedIn: true, authenticated: true, user: UTIL, ...UTIL }));
    }
    const f = path.join(PUB, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end('404'); }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
    fs.createReadStream(f).pipe(rs);
  }).listen(PORT);

  let nav = null;
  try {
    nav = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto('http://localhost:' + PORT + '/index.html', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 4000));

    const m = await page.evaluate(() => {
      const hauteurs = sel => [...document.querySelectorAll(sel)]
        .filter(e => e.getBoundingClientRect().height > 0)
        .map(e => Math.round(e.getBoundingClientRect().height * 10) / 10);
      const detail = sel => [...document.querySelectorAll(sel)]
        .filter(e => e.getBoundingClientRect().height > 0)
        .map(e => ({ cls: e.className, h: Math.round(e.getBoundingClientRect().height * 10) / 10 }));
      const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dtp-zoom')) || 1;
      const ctl = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ctl-h')) || 0;
      return {
        zoom, ctl,
        boutons: hauteurs('.pd-btn, .pd-ref-join, .pd-ref-recheck'),
        boutonsD: detail('.pd-btn, .pd-ref-join, .pd-ref-recheck'),
        champs: hauteurs('.pd-input, .ai-input, .chat-input'),
        champsD: detail('.pd-input, .ai-input, .chat-input'),
        icones: hauteurs('.wdg-ico'),
        onglets: hauteurs('.nav-item'),
        icoBtn: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ico-btn')) || 0,
      };
    });

    const unique = a => [...new Set(a)];
    console.log('\n── 1. Les commandes des volets tiennent sur une hauteur ──');
    v('des boutons de volet sont bien présents à la mesure', m.boutons.length >= 2, m.boutons.length + ' bouton(s)');
    /* LE CONTRÔLE. Trois boutons du même panneau à trois hauteurs, ça ne se voit pas bouton par
       bouton — ça se voit sur la colonne, qui cesse d'être une grille. */
    v('tous les boutons de volet font la MÊME hauteur', unique(m.boutons).length === 1,
      JSON.stringify(m.boutonsD));
    v('des champs de saisie sont présents à la mesure', m.champs.length >= 2, m.champs.length + ' champ(s)');
    v('tous les champs de volet font la MÊME hauteur', unique(m.champs).length === 1,
      JSON.stringify(m.champsD));
    /* Et la même que les boutons : un champ et son bouton d'action vivent côte à côte (« lien +
       Copier »), leur écart se lit immédiatement. */
    v('… et c\'est la MÊME que les boutons', unique(m.boutons.concat(m.champs)).length === 1,
      'boutons ' + JSON.stringify(unique(m.boutons)) + ' / champs ' + JSON.stringify(unique(m.champs)));
    /* La hauteur mesurée doit être celle du TOKEN, pas une coïncidence : sinon le token ne pilote
       rien et le prochain padding écrit ailleurs recassera l'alignement sans rien signaler. */
    v('la hauteur mesurée est bien celle du token --ctl-h',
      m.ctl > 0 && Math.abs(m.boutons[0] - m.ctl * m.zoom) <= 1,
      'mesuré ' + m.boutons[0] + ' px, token ' + m.ctl + ' px × zoom ' + m.zoom);

    console.log('\n── 2. Les canons posés le 22/08 tiennent toujours ──');
    /* Le bouton-icône d'en-tête avait été harmonisé le 22/08 (il était défini CINQ fois à des
       tailles différentes). On vérifie qu'aucun ajout depuis ne l'a repris à son compte. */
    if (m.icones.length) {
      v('tous les boutons-icônes d\'en-tête sont carrés et de même taille', unique(m.icones).length === 1,
        JSON.stringify(unique(m.icones)));
      v('… à la taille canonique --ico-btn', Math.abs(m.icones[0] - m.icoBtn * m.zoom) <= 1,
        'mesuré ' + m.icones[0] + ' px, token ' + m.icoBtn + ' px');
    } else {
      console.log('  · aucun bouton-icône monté sur cet écran — contrôle sans objet ici.');
    }
    v('les onglets de navigation font tous la même hauteur',
      m.onglets.length === 0 || unique(m.onglets).length === 1, JSON.stringify(unique(m.onglets)));
  } catch (e) {
    ko++; console.log('  ✗ banc interrompu\n      → ' + e.message);
  } finally {
    try { if (nav) await nav.close(); } catch {}
    try { srv.close(); } catch {}
  }

  console.log('\n───────────────────────────────────────');
  console.log('  ' + ok + ' vert(s), ' + ko + ' rouge(s)\n');
  process.exit(ko ? 1 : 0);
})();
