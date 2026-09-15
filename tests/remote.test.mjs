import http from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

test('remote gateway gates assets and API, blocks foreign origins and source access', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'petshop-remote-test-'));
  const config = { username: 'jp', password: randomBytes(24).toString('base64url'), origin: 'https://remote.invalid' };
  const configPath = path.join(dir, 'access.json');
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const child = spawn(process.execPath, ['scripts/remote-gateway.mjs'], {
    env: { ...process.env, PETSHOP_REMOTE_PORT: '14322', PETSHOP_REMOTE_CONFIG: configPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Gateway start timed out')), 5000);
      child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Gateway exited ${code}`)); });
    });
    const auth = 'Basic ' + Buffer.from(`jp:${config.password}`).toString('base64');
    const request = (url, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: 14322, path: url, method, headers: { host: 'remote.invalid', ...headers } }, res => {
        res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: { get: name => res.headers[name] } }));
      });
      req.on('error', reject); req.end();
    });
    for (const url of ['/', '/api/catalog', '/api/runs', '/assets/private.js']) {
      const res = await request(url);
      assert.equal(res.status, 401, url);
      assert.match(res.headers.get('www-authenticate'), /Basic/);
    }
    assert.equal((await request('/', { authorization: 'Basic ' + Buffer.from('jp:wrong').toString('base64') })).status, 401);
    assert.equal((await request('/', { authorization: auth })).status, 200);
    assert.equal((await request('/api/health', { authorization: auth })).status, 200);
    assert.equal((await request('/api/events', { authorization: auth })).status, 204);
    assert.equal((await request('/server/index.ts', { authorization: auth })).status, 404);
    assert.equal((await request('/.petshop/remote/access.json', { authorization: auth })).status, 404);
    assert.equal((await request('/', { authorization: auth, host: 'evil.invalid' })).status, 403);
    assert.equal((await request('/api/runs', { authorization: auth, origin: 'https://evil.invalid' }, 'POST')).status, 403);
    assert.equal((await request('/api/runs', { authorization: auth, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }, 'POST')).status, 403);
  } finally {
    child.kill('SIGTERM');
    await rm(dir, { recursive: true, force: true });
  }
});
