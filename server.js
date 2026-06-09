const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = 8080;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm'
};

const server = http.createServer((req, res) => {
  let safeUrl = req.url.split('?')[0];
  console.log(`${req.method} ${safeUrl}`);

  // CORS Bypass Proxy for waifu2x models CDN
  if (safeUrl.startsWith('/models/')) {
    const targetUrl = 'https://unlimited.waifu2x.net' + req.url;
    console.log(`[Proxy] fetching: ${targetUrl}`);
    
    https.get(targetUrl, (proxyRes) => {
      res.statusCode = proxyRes.statusCode;
      
      // Copy headers from target response
      for (const key in proxyRes.headers) {
        res.setHeader(key, proxyRes.headers[key]);
      }
      
      // Override headers to allow CORS & isolation
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      proxyRes.pipe(res);
    }).on('error', (err) => {
      console.error('[Proxy Error]:', err);
      res.statusCode = 500;
      res.end('Proxy Error: ' + err.message);
    });
    return;
  }

  // Static File Server
  if (safeUrl === '/') {
    safeUrl = '/index.html';
  }
  
  const filePath = path.join(__dirname, safeUrl);
  
  if (!filePath.startsWith(__dirname)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    res.setHeader('Content-Type', contentType);
    // Crucial headers for SharedArrayBuffer multithreading
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
