import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readMarker, writeMarker, removeAccountDir } from './store.js';

export const TEMP_PREFIX = 'wrapper-code-temp-';

// mkdtemp creates the directory with mode 0700.
export async function createTempAccount({ tmpRoot = tmpdir(), pid = process.pid, now = new Date() } = {}) {
  const dir = await mkdtemp(path.join(tmpRoot, TEMP_PREFIX));
  await writeMarker(dir, { name: 'temp', createdAt: now.toISOString(), temp: true, pid });
  return dir;
}

// Logout first: the docs do not promise that deleting the directory clears its Keychain
// entry. If logout fails the directory stays, so a later sweep can try again.
export async function teardownTemp(dir, { logout }) {
  const result = await logout(dir);
  if (result.code !== 0) return { removed: false, result };
  await removeAccountDir(dir);
  return { removed: true, result };
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export async function sweepTemp({ tmpRoot = tmpdir(), logout, isAlive = pidAlive }) {
  let names;
  try {
    names = await readdir(tmpRoot);
  } catch {
    return 0;
  }
  let cleaned = 0;
  for (const name of names) {
    if (!name.startsWith(TEMP_PREFIX)) continue;
    const dir = path.join(tmpRoot, name);
    const marker = await readMarker(dir);
    if (!marker || marker.temp !== true) continue;
    if (Number.isInteger(marker.pid) && isAlive(marker.pid)) continue;
    if ((await teardownTemp(dir, { logout })).removed) cleaned += 1;
  }
  return cleaned;
}
