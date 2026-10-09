import { mkdir, readdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { configDir } from '../config.js';

// The file that makes a directory a wrapper-code account. Only marked directories are
// listed, swept or removed, so nothing else is ever deleted by mistake.
export const MARKER = '.wrapper-code-account';
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function validateName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name) || name.length > 32) {
    return `Invalid account name "${name ?? ''}": use lowercase letters, digits and dashes, up to 32 characters, starting with a letter or digit.`;
  }
  if (name === 'temp') return 'The name "temp" is reserved for wrapper-code claude --temp.';
  return null;
}

export function accountsDir(opts) {
  return path.join(configDir(opts), 'accounts');
}

export function accountDir(name, opts) {
  const error = validateName(name);
  if (error) throw new Error(error);
  return path.join(accountsDir(opts), name);
}

export async function readMarker(dir) {
  try {
    const marker = JSON.parse(await readFile(path.join(dir, MARKER), 'utf8'));
    return marker && typeof marker === 'object' ? marker : null;
  } catch {
    return null;
  }
}

export async function writeMarker(dir, marker) {
  await writeFile(path.join(dir, MARKER), `${JSON.stringify(marker)}\n`, { mode: 0o600 });
}

export async function createAccountDir(dir, marker) {
  await mkdir(path.dirname(dir), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(dir), 0o700);
  await mkdir(dir, { mode: 0o700 });
  await chmod(dir, 0o700);
  await writeMarker(dir, marker);
}

export async function listAccounts(opts) {
  const root = accountsDir(opts);
  let names;
  try {
    names = await readdir(root);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const accounts = [];
  for (const name of names.sort()) {
    const dir = path.join(root, name);
    const marker = await readMarker(dir);
    if (marker && marker.temp !== true && validateName(name) === null) accounts.push({ name, dir, marker });
  }
  return accounts;
}

// fs.rm unlinks symlinks instead of following them, so the shared ~/.claude stays intact.
export async function removeAccountDir(dir) {
  await rm(dir, { recursive: true, force: true });
}

// The account's .claude.json holds its metadata (not its token): e-mail and organization.
// One e-mail can belong to several organizations (a personal plan and a Team, say), so the
// organization is what tells two such accounts apart.
const text = (v) => (typeof v === 'string' && v ? v : null);

export async function accountInfo(dir) {
  try {
    const account = JSON.parse(await readFile(path.join(dir, '.claude.json'), 'utf8'))?.oauthAccount;
    return { email: text(account?.emailAddress), org: text(account?.organizationName) };
  } catch {
    return { email: null, org: null };
  }
}
