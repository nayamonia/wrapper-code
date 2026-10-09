import { mkdtemp, readdir, lstat } from 'node:fs/promises';
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

// Only our own private folders: /tmp can be shared, and a planted look-alike (a symlink, or a
// folder owned by someone else or open to others) must never get a logout run against it.
async function isOwnPrivateDir(dir) {
  let st;
  try {
    st = await lstat(dir);
  } catch {
    return false;
  }
  if (!st.isDirectory() || st.isSymbolicLink()) return false;
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return false;
  return (st.mode & 0o077) === 0;
}

export async function sweepTemp({ tmpRoot = tmpdir(), logout, isAlive = pidAlive, warn = () => {} }) {
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
    if (!(await isOwnPrivateDir(dir))) continue;
    const marker = await readMarker(dir);
    if (!marker || marker.temp !== true) continue;
    if (Number.isInteger(marker.pid) && isAlive(marker.pid)) continue;
    try {
      if ((await teardownTemp(dir, { logout })).removed) cleaned += 1;
    } catch (err) {
      warn(`could not clean the leftover temporary session ${dir}: ${err.message}`);
    }
  }
  return cleaned;
}
