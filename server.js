// Zero-dependency server: serves this folder and proxies /api/* to a Markus server.
// Same origin for the browser, so Markus's login cookie works without CORS tricks.
//   node server.js                       -> http://localhost:3000, Markus at http://localhost:8056
//   MARKUS_URL=http://host:8056 PORT=4000 node server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const MARKUS = new URL(process.env.MARKUS_URL || 'http://localhost:8056');
const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const proxied = http.request(
      { hostname: MARKUS.hostname, port: MARKUS.port, path: req.url, method: req.method,
        headers: { ...req.headers, host: MARKUS.host, origin: MARKUS.origin } },
      (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); },
    );
    proxied.on('error', () => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":"Markus server not reachable"}'); });
    req.pipe(proxied);
    return;
  }
  const name = req.url.split('?')[0] === '/' ? 'index.html' : path.basename(req.url.split('?')[0]);
  const file = path.join(ROOT, name);
  if (!TYPES[path.extname(file)] || !fs.existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`UniAssist on http://localhost:${PORT}  (proxying /api to ${MARKUS.origin})`));
