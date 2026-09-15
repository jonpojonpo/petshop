import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = process.env.PETSHOP_REMOTE_CONFIG || path.join(root, '.petshop/remote/access.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (!config.password || config.password.length < 24) throw new Error('A strong remote password is required.');
const expected = crypto.createHash('sha256').update(`${config.username}:${config.password}`).digest();
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" });
  // Read the exact tunnel origin on each request, allowing tunnel rotation without restarting.
  let origin, host;
  try {
    origin = JSON.parse(fs.readFileSync(configPath, 'utf8')).origin;
    const parsed = new URL(origin);
    if (parsed.protocol === 'https:' && parsed.origin === origin) host = parsed.host;
  } catch {}
  if (!host || req.headers.host !== host) return res.status(403).send('Unknown host.');
  if (req.headers.origin && req.headers.origin !== origin) return res.status(403).send('Cross-origin request rejected.');
  if (req.headers['sec-fetch-site'] === 'cross-site' && req.headers['sec-fetch-mode'] !== 'navigate')
    return res.status(403).send('Cross-site request rejected.');
  if (!['GET', 'HEAD'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site')
    return res.status(403).send('Cross-site request rejected.');
  const header = req.headers.authorization || '';
  const supplied = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString('utf8') : '';
  const actual = crypto.createHash('sha256').update(supplied).digest();
  if (!crypto.timingSafeEqual(actual, expected)) {
    res.set('WWW-Authenticate', 'Basic realm="Petshop", charset="UTF-8"');
    return res.status(401).send('Sign in to your Petshop.');
  }
  next();
});
app.use('/api', (req, res) => {
  // Quick tunnels cannot carry SSE. The remote UI polls the same persisted run events.
  if (req.path === '/events') return res.status(204).end();
  const headers = { host: '127.0.0.1:4321', origin: 'http://127.0.0.1:4321' };
  for (const name of ['content-type', 'content-length', 'accept'])
    if (req.headers[name]) headers[name] = req.headers[name];
  const upstream = http.request({ hostname: '127.0.0.1', port: 4321,
    path: req.originalUrl, method: req.method, headers, timeout: 120000 }, response => {
    res.status(response.statusCode || 502);
    for (const name of ['content-type', 'content-disposition'])
      if (response.headers[name]) res.set(name, response.headers[name]);
    response.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
  upstream.on('error', () => { if (!res.headersSent) res.status(502).send('Petshop is reconnecting. Please try again.'); else res.end(); });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
});
// Only the built application is served. Never expose the development server or source files.
app.use(express.static(path.join(root, 'dist'), { dotfiles: 'deny', cacheControl: false }));
app.get('/', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
app.use((_req, res) => res.status(404).send('Not found.'));
app.listen(Number(process.env.PETSHOP_REMOTE_PORT || 4322), '127.0.0.1', () => console.log('Petshop authenticated gateway ready.'));
