'use strict';

// Tiny development server for clean puppy URLs such as http://localhost:8080/sample-puppy.
// Uses only Node.js built-in modules; no dependencies or build step are required.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }

  if (pathname === '/shipping') {
    res.writeHead(301, { Location: '/shipping/' });
    return res.end();
  }
  if (pathname === '/shipping/') pathname = '/shipping/index.html';

  if (pathname === '/') pathname = '/index.html';

  // Existing files (HTML, CSS, JS, images) are served normally.
  let filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  // Every puppy slug is routed to the shared Firestore-powered profile template.
  if (/^\/dashboard\/?$/i.test(pathname)) {
    filePath = path.join(ROOT, 'dashboard', 'index.html');
  } else if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    // Any one-segment slug uses the shared puppy template. The profile script
    // loads the listing from Firestore and shows not-found when no document exists.
    const slug = pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      filePath = path.join(ROOT, 'puppy.html');
    }
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Papillon Puppies is running at http://localhost:${PORT}`);
  console.log('Clean routes: /<puppy-slug>, /shipping/, /dashboard (API-backed listings require Cloudflare Pages Functions)');
});
