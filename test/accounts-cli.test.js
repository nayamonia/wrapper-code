import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, stat, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main, HELP } from '../src/cli.js';
import { accountDir, createAccountDir } from '../src/accounts/store.js';
import { appendUsage } from '../src/usage/store.js';

const isWin = process.platform === 'win32';
const tmp = () => mkdtemp(path.join(tmpdir(), 'wc-acli-'));
function sink() {
  const chunks = [];
  return { write: (s) => { chunks.push(String(s)); return true; }, text: () => chunks.join('') };
}

async function setup() {
  const home = await tmp();
  await mkdir(path.join(home, '.claude', 'skills'), { recursive: true });
  await writeFile(path.join(home, '.claude', 'CLAUDE.md'), 'mine');
  await writeFile(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { a: {} } }));
  const tmpRoot = await tmp();
  const auth = [];
  const deps = (over = {}) => ({
    stdout: sink(), stderr: sink(), platform: 'linux', env: { ANTHROPIC_API_KEY: 'k' }, home, tmpRoot,
    resolveClaudeImpl: () => '/c',
    authImpl: async (sub, o) => { auth.push({ sub, ...o }); return { code: 0 }; },
    pidAliveImpl: () => false,
    ...over,
  });
  const cfg = { platform: 'linux', env: {}, home };
  return { home, tmpRoot, auth, deps, cfg };
}

test('accounts with none prints the hint', async () => {
  const { deps } = await setup();
  const d = deps();
  assert.equal(await main(['accounts'], d), 0);
  assert.equal(d.stdout.text(), 'No accounts yet. Add one with: wrapper-code accounts add <name>\n');
});

test('accounts add creates the dir, links the setup and logs in with the account dir and no auth vars', { skip: isWin }, async () => {
  const { home, auth, deps, cfg } = await setup();
  const d = deps();
  assert.equal(await main(['accounts', 'add', 'trabalho'], d), 0);
  const dir = accountDir('trabalho', cfg);
  assert.equal(await readlink(path.join(dir, 'CLAUDE.md')), path.join(home, '.claude', 'CLAUDE.md'));
  assert.equal(auth.length, 1);
  assert.equal(auth[0].sub, 'login');
  assert.equal(auth[0].configDir, dir);
  assert.equal(auth[0].inherit, true);
  assert.equal('ANTHROPIC_API_KEY' in auth[0].env, false);
  assert.match(d.stdout.text(), /wrapper-code claude --account trabalho/);
});

test('accounts add rejects bad, reserved and existing names, and creates nothing for them', async () => {
  const { deps, cfg } = await setup();
  for (const name of ['../x', 'Trabalho', 'temp', undefined]) {
    const d = deps();
    assert.equal(await main(['accounts', 'add', ...(name ? [name] : [])], d), 1, String(name));
    assert.match(d.stderr.text(), /Invalid account name|reserved/);
  }
  await createAccountDir(accountDir('dup', cfg), { name: 'dup', createdAt: 'x', temp: false });
  const d = deps();
  assert.equal(await main(['accounts', 'add', 'dup'], d), 1);
  assert.match(d.stderr.text(), /already exists/);
});

test('accounts add removes the dir when login fails and exits with its code', async () => {
  const { deps, cfg } = await setup();
  const d = deps({ authImpl: async () => ({ code: 3 }) });
  assert.equal(await main(['accounts', 'add', 'falha'], d), 3);
  await assert.rejects(stat(accountDir('falha', cfg)), { code: 'ENOENT' });
});

test('accounts lists name, e-mail and last use from usage', async () => {
  const { deps, cfg } = await setup();
  await createAccountDir(accountDir('trabalho', cfg), { name: 'trabalho', createdAt: 'x', temp: false });
  await writeFile(path.join(accountDir('trabalho', cfg), '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'eu@empresa.com' } }));
  await createAccountDir(accountDir('pessoal', cfg), { name: 'pessoal', createdAt: 'x', temp: false });
  await appendUsage([{ ts: '2026-10-08T10:00:00Z', sessionId: 's', provider: 'claude', selection: 'trabalho', model: 'm', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }], cfg);
  const d = deps();
  assert.equal(await main(['accounts'], d), 0);
  const lines = d.stdout.text().trimEnd().split('\n');
  assert.match(lines[0], /^ACCOUNT +EMAIL +LAST USED$/);
  assert.match(lines[1], /^pessoal +- +never$/);
  assert.match(lines[2], /^trabalho +eu@empresa\.com +2026-10-08$/);
});

test('accounts sweeps leftover temp sessions and says how many', async () => {
  const { tmpRoot, auth, deps } = await setup();
  const { createTempAccount } = await import('../src/accounts/temp.js');
  const left = await createTempAccount({ tmpRoot, pid: 999999 });
  const d = deps();
  await main(['accounts'], d);
  assert.deepEqual(auth.map((a) => [a.sub, a.configDir]), [['logout', left]]);
  assert.match(d.stdout.text(), /^Cleaned 1 leftover temporary session\(s\)\.$/m);
});

test('accounts remove asks, logs out, then deletes; --yes skips the question', async () => {
  const { auth, deps, cfg } = await setup();
  await createAccountDir(accountDir('a1', cfg), { name: 'a1', createdAt: 'x', temp: false });
  const asked = [];
  const d = deps({ confirmImpl: async (q) => { asked.push(q); return true; } });
  assert.equal(await main(['accounts', 'remove', 'a1'], d), 0);
  assert.match(asked[0], /^Remove account a1 \(-\)\? It will be logged out and its sessions deleted\. \[y\/N\] $/);
  assert.deepEqual(auth.map((a) => a.sub), ['logout']);
  await assert.rejects(stat(accountDir('a1', cfg)), { code: 'ENOENT' });

  await createAccountDir(accountDir('a2', cfg), { name: 'a2', createdAt: 'x', temp: false });
  const d2 = deps({ confirmImpl: async () => assert.fail('must not ask') });
  assert.equal(await main(['accounts', 'remove', 'a2', '--yes'], d2), 0);
});

test('accounts remove without a terminal and without --yes refuses and keeps the account', async () => {
  const { auth, deps, cfg } = await setup();
  await createAccountDir(accountDir('a1', cfg), { name: 'a1', createdAt: 'x', temp: false });
  const d = deps({ confirmImpl: async () => null });
  assert.equal(await main(['accounts', 'remove', 'a1'], d), 1);
  assert.match(d.stderr.text(), /pass --yes/);
  assert.equal(auth.length, 0);
  assert.ok((await stat(accountDir('a1', cfg))).isDirectory());
});

test('accounts remove of an unknown name lists the accounts; a failed logout still removes with a warning', async () => {
  const { deps, cfg } = await setup();
  await createAccountDir(accountDir('a1', cfg), { name: 'a1', createdAt: 'x', temp: false });
  const d = deps();
  assert.equal(await main(['accounts', 'remove', 'nope', '--yes'], d), 1);
  assert.match(d.stderr.text(), /Unknown account "nope"\. Accounts: a1\./);
  const d2 = deps({ authImpl: async () => ({ code: 1 }) });
  assert.equal(await main(['accounts', 'remove', 'a1', '--yes'], d2), 0);
  assert.match(d2.stderr.text(), /may remain in the Keychain/);
  await assert.rejects(stat(accountDir('a1', cfg)), { code: 'ENOENT' });
});

test('accounts on Windows is not supported', async () => {
  const { deps } = await setup();
  const d = deps({ platform: 'win32' });
  assert.equal(await main(['accounts'], d), 1);
  assert.equal(d.stderr.text(), 'Claude accounts are supported on macOS and Linux only.\n');
});

test('accounts with an unknown subcommand prints its usage', async () => {
  const { deps } = await setup();
  const d = deps();
  assert.equal(await main(['accounts', 'rename', 'x'], d), 1);
  assert.match(d.stderr.text(), /Usage: wrapper-code accounts \[add <name> \| remove <name> \[--yes\]\]/);
});

test('--help documents accounts and the two claude flags', () => {
  assert.match(HELP, /wrapper-code accounts \[add <name> \| remove <name> \[--yes\]\]/);
  assert.match(HELP, /wrapper-code claude --account <name>/);
  assert.match(HELP, /wrapper-code claude --temp/);
});

test('accounts remove without claude on PATH refuses before asking or deleting', async () => {
  const { auth, deps, cfg } = await setup();
  await createAccountDir(accountDir('a1', cfg), { name: 'a1', createdAt: 'x', temp: false });
  const d = deps({ resolveClaudeImpl: () => null, confirmImpl: async () => assert.fail('must not ask') });
  assert.equal(await main(['accounts', 'remove', 'a1', '--yes'], d), 1);
  assert.match(d.stderr.text(), /claude not found on PATH/);
  assert.equal(auth.length, 0);
  assert.ok((await stat(accountDir('a1', cfg))).isDirectory());
});

test('accounts add survives Ctrl-C during login, removes the dir and restores signal handlers', { skip: isWin }, async () => {
  const { deps, cfg } = await setup();
  const sigs = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const before = sigs.map((s) => process.listenerCount(s));
  let during;
  const d = deps({
    authImpl: async () => {
      during = sigs.map((s) => process.listenerCount(s));
      return { code: 130 };
    },
  });
  assert.equal(await main(['accounts', 'add', 'ctrlc'], d), 130);
  sigs.forEach((_, i) => assert.ok(during[i] > before[i], sigs[i]));
  await assert.rejects(stat(accountDir('ctrlc', cfg)), { code: 'ENOENT' });
  assert.deepEqual(sigs.map((s) => process.listenerCount(s)), before);
});
