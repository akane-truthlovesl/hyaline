// Static server for the game. `npm start`, then open one of the printed addresses on a phone
// that is on the same network.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

export function serve(port = 8080, quiet = false) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, '0.0.0.0', () => {
    const actual = server.address().port;
    if (!quiet) {
      console.log(`Hyaline is being served.\n  this machine:  http://localhost:${actual}/`);
      for (const list of Object.values(os.networkInterfaces())) for (const a of list || [])
        if (a.family === 'IPv4' && !a.internal) console.log(`  on the network: http://${a.address}:${actual}/`);
      console.log('Add ?dev to the address for a performance readout.');
    }
    resolve({ server, port: actual });
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) serve(+(process.env.PORT || process.argv[2] || 8080));
