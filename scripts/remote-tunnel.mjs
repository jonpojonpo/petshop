import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, '.petshop/remote/access.json');
const proc = spawn(path.join(os.homedir(), '.local/bin/cloudflared'), ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:4322', '--protocol', 'http2'], { stdio: ['ignore', 'pipe', 'pipe'] });
let buffer = '';
const observe = data => {
  buffer = (buffer + data.toString()).slice(-16000);
  const url = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (url) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.origin !== url[0]) {
      config.origin = url[0];
      fs.writeFileSync(configPath + '.tmp', JSON.stringify(config, null, 2), { mode: 0o600 });
      fs.renameSync(configPath + '.tmp', configPath);
      console.log('Petshop remote URL: ' + url[0]);
    }
  }
};
proc.stdout.on('data', observe);
proc.stderr.on('data', data => { observe(data); process.stderr.write(data); });
proc.on('exit', code => process.exit(code || 1));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => proc.kill(signal));
