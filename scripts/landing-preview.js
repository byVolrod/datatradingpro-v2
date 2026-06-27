// Dev-only static server for the landing/ directory (no deps) — used to preview the
// landing page locally (the main Express app only serves public/). Not part of prod.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'landing');
const PORT = process.env.PORT || 4178;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2'
};

http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  let fp = path.normalize(path.join(ROOT, p));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(fp, (e, st) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    if (st.isDirectory()) fp = path.join(fp, 'index.html');
    fs.readFile(fp, (e2, buf) => {
      if (e2) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      res.end(buf);
    });
  });
}).listen(PORT, () => console.log('landing preview on http://localhost:' + PORT));
