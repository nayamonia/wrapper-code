import { readdir, lstat, readlink, symlink, unlink, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import path from 'node:path';

// What stays with each account: its login, its sessions and Claude Code's runtime state.
// Everything else in ~/.claude is the person's setup and is shared by symlink.
export const PER_ACCOUNT = new Set([
  '.credentials.json', '.claude.json', 'history.jsonl', 'projects', 'file-history', 'todos',
  'shell-snapshots', 'session-env', 'statsig', 'ide', 'debug', 'logs', '.wrapper-code-account',
]);

async function lstatOrNull(file) {
  try {
    return await lstat(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function linkShared(accountDir, { home }) {
  const source = path.join(home, '.claude');
  let names;
  try {
    names = await readdir(source);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    names = [];
  }
  const shared = new Set(names.filter((name) => !PER_ACCOUNT.has(name)));
  for (const name of shared) {
    const link = path.join(accountDir, name);
    const target = path.join(source, name);
    const st = await lstatOrNull(link);
    if (st && !st.isSymbolicLink()) continue; // the account's own file or folder wins
    if (st) {
      if ((await readlink(link)) === target) continue;
      await unlink(link);
    }
    await symlink(target, link);
  }
  // Our links whose entry left ~/.claude (or became per-account) go; other links stay.
  for (const name of await readdir(accountDir)) {
    if (shared.has(name)) continue;
    const link = path.join(accountDir, name);
    const st = await lstatOrNull(link);
    if (st?.isSymbolicLink() && path.dirname(await readlink(link)) === source) await unlink(link);
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// User-scope MCP servers live in ~/.claude.json next to the login metadata, so that file is
// never shared; only its mcpServers key is copied into the account's own .claude.json.
export async function syncMcpServers(accountDir, { home, warn }) {
  let source;
  try {
    source = JSON.parse(await readFile(path.join(home, '.claude.json'), 'utf8'));
  } catch {
    return 'skipped';
  }
  const servers = isPlainObject(source) ? source.mcpServers : undefined;
  if (!isPlainObject(servers)) return 'skipped';

  const file = path.join(accountDir, '.claude.json');
  let current = {};
  try {
    current = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      if (!(err instanceof SyntaxError)) throw err;
      warn(`${file} is not valid JSON; your MCP servers were not copied into this account.`);
      return 'invalid';
    }
  }
  if (!isPlainObject(current)) {
    warn(`${file} is not a JSON object; your MCP servers were not copied into this account.`);
    return 'invalid';
  }
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ ...current, mcpServers: servers }, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
  return 'synced';
}
