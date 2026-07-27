// Banc TEMPORAIRE (supprimé avant commit) : panel admin avec des utilisateurs réalistes, pour CLIQUER
// réellement sur Modifier / MDP / Suspendre / Déconnecter / Suppr. et capturer les erreurs JS.
const http = require('http'), fs = require('fs'), path = require('path');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const now = Date.now();
const users = [
  { id: 11, name: 'Alex',    email: 'alexianbusiness18@gmail.com', role: 'client', plan: 'essai',          active: 1, expires_at: now + 4 * 86400000, last_login: now - 3 * 86400000, created_at: now - 30 * 86400000 },
  { id: 12, name: 'Klem',    email: 'clem.flahaut@yahoo.com',      role: 'client', plan: 'professionnel',  active: 1, expires_at: now + 2 * 86400000, last_login: now - 12 * 86400000, created_at: now - 60 * 86400000 },
  { id: 13, name: 'Alexis',  email: 'alexispierson6@gmail.com',    role: 'client', plan: 'professionnel',  active: 1, expires_at: now + 3 * 86400000, last_login: now - 11 * 86400000, created_at: now - 45 * 86400000 },
  { id: 14, name: 'Etienne', email: 'etienne.pourol17@gmail.com',  role: 'client', plan: 'professionnel',  active: 1, expires_at: now + 6 * 86400000, last_login: now - 1 * 86400000, created_at: now - 20 * 86400000 },
];
const API = {
  '/api/auth/me': { loggedIn: true, user: { name: 'Admin DTP', email: 'admin@dtp.com', role: 'admin' } },
  '/api/admin/users': { users },
  '/api/admin/overview': { chatUnread: 0 },
  '/api/admin/finance': { kpis: [] },
  '/api/admin/chat': { threads: [] },
  '/api/support/users': { online: [] },
};
http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(API[url] || { ok: true }));
  }
  let p = decodeURIComponent(url); if (p === '/') p = '/admin.html';
  fs.readFile(path.join(__dirname, 'public', p), (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    let body = data;
    if (p === '/admin.html') {
      // capture TOUTES les erreurs JS (chargement + clics) pour diagnostic
      body = Buffer.from(data.toString('utf8').replace('</head>', `<script>
        window.__errs = [];
        window.addEventListener('error', function(e){ window.__errs.push((e.message||'')+' @'+(e.filename||'').split('/').pop()+':'+e.lineno); });
        window.addEventListener('unhandledrejection', function(e){ window.__errs.push('PROMISE: '+(e.reason&&e.reason.message||e.reason)); });
      </script></head>`), 'utf8');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(body);
  });
}).listen(4179, () => console.log('banc admin sur http://localhost:4179'));
