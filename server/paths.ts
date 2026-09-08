import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STATE = path.resolve(process.env.PETSHOP_STATE || path.join(ROOT, '.petshop'));
export const CODEX_HOME = path.resolve(process.env.PETSHOP_CODEX_HOME || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
export const AGENTS = path.join(CODEX_HOME, 'agents');
export const expand = (p: string) => path.resolve(p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);
export async function ensureDirs() { await Promise.all([STATE, AGENTS, path.join(STATE, 'bodies'), path.join(STATE, 'runs')].map(p => fs.mkdir(p, { recursive: true }))); }
export async function atomicJson(file: string, value: unknown) {
  const tmp = `${file}.${process.pid}.tmp`; await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await fs.rename(tmp, file);
}
export const validId = (id: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id);
export function assertId(id: string) { if (!validId(id)) throw new Error('Use letters, numbers, underscores or hyphens for the ID.'); }
