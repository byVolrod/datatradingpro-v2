// emailWidget.js — rend les VRAIS widgets du desk en image PNG (via puppeteer), pour les e-mails.
// Un e-mail ne peut pas exécuter amCharts/JS ; on capture donc le widget réel (rendu avec les VRAIES
// données) et on sert un PNG que tous les clients mail (Gmail/Outlook) savent afficher.
// La page de rendu interne (/internal/email-widget/<type>) charge le vrai public/js/charts.js + amCharts
// et reçoit les données injectées côté serveur (aucune auth, aucun fetch client).
const puppeteer = require('puppeteer-extra');
const Stealth   = require('puppeteer-extra-plugin-stealth');
puppeteer.use(Stealth());

// Même résolution Chrome que le scraper FinancialJuice (Windows local / Linux VPS).
function _resolveChromeExec() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.env.CHROME_EXEC)               return process.env.CHROME_EXEC;
  if (process.platform === 'win32')  return 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const { existsSync } = require('fs');
  const known = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/nix/var/nix/profiles/default/bin/chromium'];
  const found = known.find(existsSync);
  if (found) return found;
  try { const { execSync } = require('child_process'); const p = execSync('which chromium 2>/dev/null || which chromium-browser 2>/dev/null || which google-chrome 2>/dev/null').toString().trim(); if (p) return p; } catch {}
  return 'chromium';
}
const CHROME_PATH = _resolveChromeExec();
const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}`;

// ─── Filet ANTI-IMAGE-CASSEE : derniere bonne image par widget, persistee sur DISQUE (survit aux
// redemarrages). Un mail ne doit JAMAIS afficher une image cassee — meme pendant un rendu lent/echoue
// ou un redemarrage du conteneur. On sert toujours la derniere bonne image, et on rafraichit en fond.
const _fs = require('fs');
const _path = require('path');
const _WCACHE_DIR = _path.join(process.env.DATA_DIR || __dirname, 'wcache');
try { _fs.mkdirSync(_WCACHE_DIR, { recursive: true }); } catch {}
/* ⚠️ INCIDENT DU 30/08 — « JAMAIS expire » a produit l'inverse d'un filet. Le mail « Semaine à
   venir » annonçait la semaine du 31 août dans son TEXTE et montrait les cartes du 17 AOÛT dans
   son IMAGE : les rendus frais échouaient depuis deux semaines EN SILENCE (le catch de fond était
   muet), et la « dernière bonne image », persistée sur le volume, n'avait pas de date de
   péremption : elle a resservi telle quelle, mail après mail. Une image périmée qui MENT sur des
   dates est PIRE qu'un espace vide. Le filet est donc borné (par type), et la panne se CRIE. */
const _lastGood = new Map();      // wk -> { png, ts } — l'âge est porté et BORNÉ par _ageMax
/* ══ LA VERSION DU RENDU ENTRE DANS LA CLÉ (02/09) ═══════════════════════════════════════════════
   DÉFAUT MESURÉ, ET IL EST SILENCIEUX. Le 01/09, la pastille de période active du widget « Force
   des Devises » est passée de l'aplat d'or plein à la pastille teintée. Le code servi a changé le
   jour même ; l'image envoyée dans les courriels, non — l'utilisateur l'a signalée deux fois.
   Pourquoi : la clé de cache décrit ce qu'on DEMANDE (type, période, devise, paramètres) et jamais
   comment on le DESSINE. Une image déjà rendue restait donc valable après un changement de rendu.
   Et ce n'est pas une affaire de dix minutes : le cache mémoire expire vite, mais le « dernier bon »
   vit sur le disque, dans un volume monté qui SURVIT aux déploiements, et il est servi tant qu'il
   n'a pas atteint `_ageMax` — jusqu'à trois jours. Un correctif visuel pouvait donc mettre trois
   jours à atteindre un client, sans que rien ne le signale.
   `WIDGET_VER` fait partie de la clé, mémoire ET disque : le bump rend d'un coup toutes les images
   du stock caduques, sans rien effacer (les anciennes s'éteignent d'elles-mêmes à la purge d'âge).
   ⚠️ À BUMPER À CHAQUE FOIS QU'ON TOUCHE AU DESSIN D'UN WIDGET — le gabarit HTML/CSS des routes
   `/internal/email-widget/*` de server.js, ou les dimensions de `SPECS` ci-dessus. Ce n'est pas une
   consigne qu'on se rappelle : `scripts/widget-cache-verif.js` empreinte ces gabarits et rougit si
   l'empreinte bouge sans que ce nombre bouge. */
const WIDGET_VER = 2;
function _wk(type, period) { return (String(type) + '_v' + WIDGET_VER + '_' + String(period)).replace(/[^a-z0-9]+/gi, '_'); }
function _diskPath(wk) { return _path.join(_WCACHE_DIR, wk + '.png'); }
try { for (const f of _fs.readdirSync(_WCACHE_DIR)) if (f.endsWith('.png')) { try { const p = _path.join(_WCACHE_DIR, f); _lastGood.set(f.slice(0, -4), { png: _fs.readFileSync(p), ts: _fs.statSync(p).mtimeMs }); } catch {} } } catch {}
function _saveLastGood(wk, png) { _lastGood.set(wk, { png, ts: Date.now() }); try { _fs.writeFile(_diskPath(wk), png, () => {}); } catch {} }
// Ce qui porte des DATES (agenda, calendrier) périme en 24 h ; le reste tolère 3 jours.
const _AGE_MAX = { 'week-ahead': 24 * 3600e3, calendar: 24 * 3600e3 };
const _AGE_MAX_DEFAUT = 72 * 3600e3;
function _ageMax(type) { return _AGE_MAX[type] || _AGE_MAX_DEFAUT; }
// La panne de rendu n'est plus silencieuse : une ligne de journal par type, au plus toutes les 10 min.
const _panneCriee = new Map();
function _criePanne(type, e, heuresPerimees) {
  const now = Date.now();
  if (now - (_panneCriee.get(type) || 0) < 10 * 60 * 1000) return;
  _panneCriee.set(type, now);
  console.error(`[email-widget] rendu ${type} en ÉCHEC : ${(e && e.message) || e}`
    + (heuresPerimees != null ? ` — dernière bonne image périmée (${heuresPerimees} h) : PLACEHOLDER servi, jamais une image qui ment sur ses dates` : ''));
}
const _FALLBACK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// Catalogue des widgets rendus (chaque type = une route de rendu + un sélecteur + une taille logique).
const SPECS = {
  strength:            { path: '/internal/email-widget/strength',          sel: '#stwrap',       w: 600, h: 336 },
  meter:               { path: '/internal/email-widget/meter',             sel: '#meter-wrap',   w: 640, h: 440 },
  regime:              { path: '/internal/email-widget/regime',            sel: '#risk-widget',  w: 600, h: 360 },
  'strength-snapshot': { path: '/internal/email-widget/strength-snapshot', sel: '#box',          w: 600, h: 380 },
  'risk-history':      { path: '/internal/email-widget/risk-history',      sel: '#box',          w: 600, h: 210 },
  vix:                 { path: '/internal/email-widget/vix',               sel: '#vixwrap',      w: 640, h: 360 },   // 01/09 : fond blanc, sans bandeau titre/valeur — dims alignées sur #vixwrap/#box (server.js)
  bias:                { path: '/internal/email-widget/bias',              sel: '#bias-content', w: 640, h: 470 },
  'week-ahead':        { path: '/internal/email-widget/week-ahead',        sel: '.wa-wrap',      w: 640, h: 900, clipLast: '.wa-card' },
  cot:                 { path: '/internal/email-widget/cot',              sel: '#cot-grid',     w: 640, h: 640, clipLast: '.cot-cell' },
  taux:                { path: '/internal/email-widget/taux',             sel: '#taux-grid',    w: 640, h: 760, clipLast: '.rtc' },
  'cb-tone':           { path: '/internal/email-widget/cb-tone',          sel: '#cbt-wrap',     w: 600, h: 780, clipLast: '.cbt-row' },
  eclairages:          { path: '/internal/email-widget/eclairages',       sel: '#eci-wrap',     w: 600, h: 560, clipLast: '.eci-card' },
  calendar:            { path: '/internal/email-widget/calendar',         sel: '#cal-mail',     w: 900, h: 900, clipLast: '.cal-row' },
  analystes:           { path: '/internal/email-widget/analystes',        sel: '#arlib-list',   w: 720, h: 900, clipLast: '.arl-row' },
  'mindset-methode':   { path: '/internal/email-widget/mindset-methode',  sel: '#art',          w: 600, h: 300 },
  'mindset-ego':       { path: '/internal/email-widget/mindset-ego',      sel: '#art',          w: 600, h: 300 },
};

// ─── Navigateur partagé (lancé à la demande, refermé après inactivité pour ménager la RAM du VPS) ───
let _browser = null, _launching = null, _idleTimer = null;
async function _getBrowser() {
  if (_browser && _browser.connected) return _browser;   // puppeteer v25 : propriete .connected (isConnected() supprime)
  if (_launching) return _launching;
  _launching = puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb'],
  }).then(b => {
    _browser = b; _launching = null;
    b.on('disconnected', () => { _browser = null; });
    return b;
  }).catch(e => { _launching = null; throw e; });
  return _launching;
}
function _scheduleIdleClose() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(async () => {
    if (_inflight.size) return _scheduleIdleClose();          // un rendu est en cours → on repousse
    try { if (_browser) await _browser.close(); } catch {}
    _browser = null;
  }, 3 * 60 * 1000);
}

// ─── Cache mémoire des PNG (par type+période) + déduplication des rendus concurrents ───
const TTL = 10 * 60 * 1000;   // 10 min : un mail ouvert plusieurs fois ne relance pas Chrome
const _cache = new Map();      // key -> { png, ts }
const _inflight = new Map();   // key -> Promise

// Filtre des paramètres supplémentaires : on n'accepte que des couples `cle=valeur` déjà encodés,
// dans un alphabet strict. Ils partent dans une URL ET dans une clé de cache : aucune chaîne libre.
function _extraSain(s) {
  return String(s || '').split('&')
    .filter(p => /^[A-Za-z0-9_.~-]{1,24}=[A-Za-z0-9_.%~+-]{0,160}$/.test(p))
    .slice(0, 4).join('&');
}
async function renderWidgetPng(type, opts = {}) {
  const spec = SPECS[type];
  if (!spec) throw new Error('widget inconnu: ' + type);
  const period = String(opts.period || 'week').replace(/[^a-z0-9]/gi, '') || 'week';
  // COURBE D'UNE SEULE DEVISE (15/08) : le Récap Hebdo du desk montre, sous chaque devise, SA propre
  // courbe de force et non le graphique des huit. `buildStrengthChart` sait déjà le faire via
  // `focusCurrency` ; il suffisait de faire descendre la devise jusqu'à la page de rendu.
  // La devise entre dans la CLÉ DE CACHE : sans cela, les huit devises partageraient une seule image
  // et le mail afficherait huit fois la courbe de la première.
  const ccy = /^[A-Z]{3}$/.test(String(opts.ccy || '').toUpperCase()) ? String(opts.ccy).toUpperCase() : '';
  // `extra` (24/08) : paramètres supplémentaires venus de l'URL du mail (ex. l'identité de l'événement
  // vedette du calendrier). Ils entrent dans la CLÉ DE CACHE, sinon deux événements différents
  // partageraient une seule image, exactement le piège déjà rencontré avec les huit devises ci-dessus.
  const extra = _extraSain(opts.extra);
  const key = type + ':v' + WIDGET_VER + ':' + period + (ccy ? ':' + ccy : '') + (extra ? ':' + extra : '');

  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.png;
  if (_inflight.has(key)) return _inflight.get(key);

  const job = (async () => {
    const browser = await _getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: spec.w + 24, height: spec.h + 24, deviceScaleFactor: 2 });   // 2x = net en HD
      /* Les pages de rendu ne sont plus publiques depuis le 21/08 : elles servaient en clair, sans
         aucune authentification, des widgets vendus par abonnement. Puppeteer se declare donc appel
         interne. Le serveur exige EN PLUS que la connexion vienne de la boucle locale : le jeton seul
         ne suffirait pas s il fuitait. */
      try { await page.setExtraHTTPHeaders({ 'x-dtp-internal': process.env.DTP_INTERNAL_TOKEN || '' }); } catch (e) {}
      await page.goto(`${BASE}${spec.path}?period=${period}${ccy ? '&ccy=' + ccy : ''}${extra ? '&' + extra : ''}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForFunction('window.__ready === true', { timeout: 20000 }).catch(() => {});   // chaque page de rendu pose __ready apres le rendu (+ delai d'animation)
      const el = await page.$(spec.sel);
      if (!el) throw new Error('element introuvable: ' + spec.sel);
      let shot;
      if (spec.clipLast) {
        // Certains conteneurs du desk gardent une hauteur "pleine fenetre" → on decoupe pile au bas du
        // dernier element de contenu (fini l'espace vide en bas), au lieu de capturer toute la boite.
        const clip = await page.evaluate((rootSel, lastSel) => {
          const root = document.querySelector(rootSel);
          if (!root) return { _err: 'no root ' + rootSel };
          const r = root.getBoundingClientRect();
          const items = document.querySelectorAll(lastSel);
          const last = items[items.length - 1];
          const bottom = last ? last.getBoundingClientRect().bottom : r.bottom;
          return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.max(1, r.width), height: Math.max(40, bottom - r.y + 16) };
        }, spec.sel, spec.clipLast);
        shot = clip
          ? await page.screenshot({ type: 'png', clip, captureBeyondViewport: true })
          : await el.screenshot({ type: 'png' });
      } else {
        shot = await el.screenshot({ type: 'png' });
      }
      const png = Buffer.from(shot);
      _cache.set(key, { png, ts: Date.now() });
      // ⚠️ CLÉ COMPLÈTE (30/08) : la sauvegarde utilisait `_wk(type, period)` SANS ccy/extra alors
      // que la lecture les inclut — la courbe d'UNE devise écrasait le « dernier bon » générique
      // du type (un mail pouvait montrer la courbe NZD comme force globale), et les images par
      // devise n'avaient JAMAIS de secours à elles. Même clé des deux côtés, point.
      _saveLastGood(_wk(type, period + (ccy ? '_' + ccy : '') + (extra ? '_' + extra : '')), png);
      return png;
    } finally {
      await page.close().catch(() => {});
    }
  })().finally(() => { _inflight.delete(key); _scheduleIdleClose(); });

  _inflight.set(key, job);
  return job;
}

// Version ROBUSTE pour les e-mails : ne jette JAMAIS, ne bloque jamais le client mail.
//  cache frais → direct · sinon derniere bonne image (memoire/disque) + rafraichit EN FOND ·
//  aucune image encore → rendu synchrone · echec → placeholder 1x1 (jamais d'image cassee ni de 500).
async function renderWidgetPngSafe(type, opts = {}) {
  if (!SPECS[type]) return _FALLBACK_PNG;
  const period = String((opts && opts.period) || 'week').replace(/[^a-z0-9]/gi, '') || 'week';
  // ⚠️ La devise DOIT entrer ici aussi. Cette couche recalcule sa propre clé : sans elle, les huit
  // courbes se partageraient une seule entrée de cache (et un seul « dernier bon » sur disque), et
  // le mail aurait affiché huit fois la même devise.
  const ccy = /^[A-Z]{3}$/.test(String((opts && opts.ccy) || '').toUpperCase()) ? String(opts.ccy).toUpperCase() : '';
  // Même raison pour `extra` : deux événements vedettes différents ne doivent jamais partager une
  // entrée de cache NI un « dernier bon » sur disque.
  const extra = _extraSain(opts && opts.extra);
  const key = type + ':v' + WIDGET_VER + ':' + period + (ccy ? ':' + ccy : '') + (extra ? ':' + extra : '');
  const wk = _wk(type, period + (ccy ? '_' + ccy : '') + (extra ? '_' + extra : ''));
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.png;
  const lg = _lastGood.get(wk);
  // Dernier bon ENCORE VALIDE → servi, et on rafraîchit en fond (la panne de fond se crie désormais).
  if (lg && Date.now() - lg.ts <= _ageMax(type)) { renderWidgetPng(type, opts).catch(e => _criePanne(type, e)); return lg.png; }
  /* Dernier bon PÉRIMÉ (ou absent) : rendu SYNCHRONE, et s'il échoue → PLACEHOLDER, jamais l'image
     périmée — c'est elle, le mensonge du 30/08 (cartes du 17 août dans le mail du 30). */
  try { return await renderWidgetPng(type, opts); }
  catch (e) { _criePanne(type, e, lg ? Math.round((Date.now() - lg.ts) / 3600e3) : null); return _FALLBACK_PNG; }
}
// Pre-chauffe (boot + periodique) : garantit qu'une bonne image est TOUJOURS prete (zero rendu a froid en mail).
async function prewarm(types) {
  for (const t of (types && types.length ? types : ['meter'])) {
    try { await renderWidgetPng(t, {}); } catch (e) { console.warn('[widget prewarm]', t, ':', e && e.message); }
  }
}
module.exports = { renderWidgetPng, renderWidgetPngSafe, prewarm, SPECS, CHROME_PATH, WIDGET_VER };
