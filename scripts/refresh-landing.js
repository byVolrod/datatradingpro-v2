#!/usr/bin/env node
/*
 * Cron HEBDO (samedi) — lance sur le VPS. Re-grab la VRAIE force des devises (semaine) + le dernier
 * Weekly Market Recap via l'endpoint interne token-gate (/internal/landing-snapshot), regenere les blocs
 * FORCE + ANALYST de landing/index.html (remplacements idempotents par structure), puis commit + push.
 * Aucun changement -> no-op. Necessite l'env LANDING_SNAPSHOT_TOKEN (meme valeur que cote serveur).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'landing', 'index.html');
const TOKEN = process.env.LANDING_SNAPSHOT_TOKEN || '';
const PORT = process.env.SNAPSHOT_PORT || process.env.PORT || 3000;

const COL = { USD:'#e8eaed', GBP:'#2bee6b', EUR:'#ff3b30', AUD:'#3b82f6', CHF:'#ffd60a', CAD:'#be8bff', NZD:'#ff5cae', JPY:'#22d3ee' };
const IBG = { USD:'#cfd3d9', GBP:'#95f6b5', EUR:'#ff9d97', AUD:'#9dc0fb', CHF:'#ffea84', CAD:'#dec5ff', NZD:'#ffaed6', JPY:'#90e9f6' };
const MONTHS = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];

function getSnapshot() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/internal/landing-snapshot', headers: { 'x-snapshot-token': TOKEN }, timeout: 30000 }, r => {
      let body = ''; r.on('data', c => body += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, json: JSON.parse(body) }); } catch (e) { reject(new Error('JSON invalide (' + r.statusCode + '): ' + body.slice(0, 120))); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

function buildForce(series) {
  const names = Object.keys(COL).filter(c => series[c] && series[c].length);
  const N = 60, x0 = 6, x1 = 294; const ds = {}; let maxAbs = 0.0001;
  names.forEach(c => { const a = series[c]; const v = []; for (let i = 0; i < N; i++) v.push(a[Math.floor(i * (a.length - 1) / (N - 1))].v); ds[c] = v; v.forEach(x => { if (Math.abs(x) > maxAbs) maxAbs = Math.abs(x); }); });
  const yOf = v => Math.round((100 - (v / maxAbs) * 68) * 10) / 10;
  const xOf = i => Math.round((x0 + (x1 - x0) * (i / (N - 1))) * 10) / 10;
  const lines = {}; names.forEach(c => { lines[c] = ds[c].map((v, i) => xOf(i) + ',' + yOf(v)).join(' '); });
  const finals = names.map(c => ({ c, val: ds[c][N - 1] })).sort((a, b) => b.val - a.val);
  return { lines, finals };
}

function applyForce(html, series) {
  const { lines, finals } = buildForce(series);
  for (const c of Object.keys(lines)) {
    const re = new RegExp('(class="dk-cs2-ln" stroke="' + COL[c] + '" points=")[^"]*(")');
    if (re.test(html)) html = html.replace(re, '$1' + lines[c] + '$2');
  }
  const badges = finals.map((f, i) => {
    const top = Math.round(10 + 78 * i / (finals.length - 1));
    const s = (f.val >= 0 ? '+' : '') + f.val.toFixed(2);
    return '      <span class="dk-cs2-b" style="top:' + top + '%"><b style="background:' + COL[f.c] + '">' + f.c + '</b><i style="background:' + IBG[f.c] + '">' + s + '</i></span>';
  }).join('\n');
  html = html.replace(/(<div class="dk-cs2-ends">)[\s\S]*?(<\/div>)/, '$1\n' + badges + '\n    $2');
  return { html, finals };
}

function applyReport(html, recap, finals) {
  if (!recap || !recap.title) return html;
  const d = new Date(recap.timestamp || Date.now());
  const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0');
  const colon = recap.title.indexOf(':');
  const title = (colon > 0 && colon < 40) ? recap.title.slice(colon + 1).trim() : recap.title.trim();
  const top = finals[0], bot = finals[finals.length - 1];
  const fmt = f => (f.val >= 0 ? '+' : '') + f.val.toFixed(2).replace('.', ',');
  const excerpt = 'Force des devises sur la semaine : ' + top.c + ' ' + fmt(top) + ' en tête, ' + bot.c + ' ' + fmt(bot) + ' à la traîne ; le marché reste guidé par le pétrole, la géopolitique et l’inflation US.';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sub = (re, val) => { if (re.test(html)) html = html.replace(re, '$1' + val + '$2'); };
  sub(/(<span class="dk-analyst-src">)[^<]*(<\/span>)/, 'Récap Hebdo des Marchés');
  sub(/(<span class="dk-analyst-time">)[^<]*(<\/span>)/, dd + ' ' + MONTHS[d.getMonth()] + ' · sam.');
  sub(/(<div class="dk-analyst-title">)[^<]*(<\/div>)/, esc(title.slice(0, 110)));
  sub(/(<div class="dk-analyst-excerpt">)[^<]*(<\/div>)/, esc(excerpt));
  sub(/(<span class="dk-analyst-date">)[^<]*(<\/span>)/, dd + '/' + mm);
  return html;
}

function git(cmd) { return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); }

async function main() {
  if (!TOKEN) { console.error('[refresh-landing] LANDING_SNAPSHOT_TOKEN manquant'); process.exit(1); }
  // base propre = origin/main (evite toute divergence ; tout commit du cron est deja sur origin)
  try { git('git fetch --quiet origin main'); git('git reset --hard --quiet origin/main'); }
  catch (e) { console.error('[refresh-landing] sync origin KO:', e.message); process.exit(1); }

  const { status, json } = await getSnapshot();
  if (status !== 200 || !json || !json.strength || !json.strength.series) {
    console.error('[refresh-landing] snapshot KO', status, JSON.stringify(json || {}).slice(0, 140)); process.exit(1);
  }
  let html = fs.readFileSync(FILE, 'utf8'); const before = html;
  const f = applyForce(html, json.strength.series);
  html = applyReport(f.html, json.weeklyRecap, f.finals);
  if (html === before) { console.log('[refresh-landing] aucun changement'); return; }
  fs.writeFileSync(FILE, html);

  git('git add landing/index.html');
  git('git -c user.name="DTP Landing Cron" -c user.email="cron@datatradingpro.com" commit -m "auto: maj hebdo maquettes landing (force des devises + recap reels)"');
  git('git push origin main');
  try { git('git push backup main'); } catch (e) { console.warn('[refresh-landing] push backup ignore:', e.message); }
  console.log('[refresh-landing] OK — force + recap mis a jour (updatedAt ' + (json.strength.updatedAt || '?') + ')');
}

if (require.main === module) main().catch(e => { console.error('[refresh-landing] erreur:', e.message); process.exit(1); });
module.exports = { applyForce, applyReport, buildForce };
