import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MARKER, validateName, accountsDir, accountDir, readMarker, createAccountDir,
  listAccounts, removeAccountDir, accountEmail,
} from '../src/accounts/store.js';

const isWin = process.platform === 'win32';
const tmp = () => mkdtemp(path.join(tmpdir(), 'wc-acc-'));
const cfgFor = (home) => ({ platform: 'linux', env: {}, home });

test('validateName accepts lowercase names up to 32 chars and rejects the rest', () => {
  for (const ok of ['a', 'trabalho', 'conta-2', '0x', 'a'.repeat(32)]) assert.equal(validateName(ok), null, ok);
  for (const bad of ['', 'Trabalho', '-x', 'a/b', '../x', 'a b', 'a.b', 'a'.repeat(33), undefined, 7]) {
    assert.match(validateName(bad), /Invalid account name/, String(bad));
  }
  assert.match(validateName('temp'), /reserved/);
});

test('accountDir lives under the config dir accounts folder', async () => {
  const home = await tmp();
  assert.equal(accountsDir(cfgFor(home)), path.join(home, '.config', 'wrapper-code', 'accounts'));
  assert.equal(accountDir('trabalho', cfgFor(home)), path.join(home, '.config', 'wrapper-code', 'accounts', 'trabalho'));
});

test('accountDir refuses an invalid name instead of building a path', async () => {
  assert.throws(() => accountDir('../x', cfgFor('/h')), /Invalid account name/);
});

test('createAccountDir writes the marker with mode 0700 dirs', { skip: isWin }, async () => {
  const home = await tmp();
  const dir = accountDir('trabalho', cfgFor(home));
  await createAccountDir(dir, { name: 'trabalho', createdAt: '2026-10-09T00:00:00.000Z', temp: false });
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  assert.equal((await stat(accountsDir(cfgFor(home)))).mode & 0o777, 0o700);
  assert.deepEqual(await readMarker(dir), { name: 'trabalho', createdAt: '2026-10-09T00:00:00.000Z', temp: false });
});

test('listAccounts returns marked saved accounts sorted, ignoring unmarked dirs', async () => {
  const home = await tmp();
  const cfg = cfgFor(home);
  await createAccountDir(accountDir('zeta', cfg), { name: 'zeta', createdAt: 'x', temp: false });
  await createAccountDir(accountDir('alfa', cfg), { name: 'alfa', createdAt: 'x', temp: false });
  await mkdir(path.join(accountsDir(cfg), 'stray'));
  assert.deepEqual((await listAccounts(cfg)).map((a) => a.name), ['alfa', 'zeta']);
});

test('listAccounts is empty when the accounts folder does not exist', async () => {
  assert.deepEqual(await listAccounts(cfgFor(await tmp())), []);
});

test('readMarker is null for a missing or invalid marker', async () => {
  const dir = await tmp();
  assert.equal(await readMarker(dir), null);
  await writeFile(path.join(dir, MARKER), '{nope');
  assert.equal(await readMarker(dir), null);
});

test('removeAccountDir deletes the dir and never follows its symlinks', { skip: isWin }, async () => {
  const home = await tmp();
  const shared = path.join(home, '.claude');
  await mkdir(path.join(shared, 'skills'), { recursive: true });
  await writeFile(path.join(shared, 'skills', 'keep.md'), 'keep');
  await writeFile(path.join(shared, 'CLAUDE.md'), 'mine');
  const dir = accountDir('trabalho', cfgFor(home));
  await createAccountDir(dir, { name: 'trabalho', createdAt: 'x', temp: false });
  await symlink(path.join(shared, 'skills'), path.join(dir, 'skills'));
  await symlink(path.join(shared, 'CLAUDE.md'), path.join(dir, 'CLAUDE.md'));
  await removeAccountDir(dir);
  await assert.rejects(stat(dir), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(shared, 'skills', 'keep.md'), 'utf8'), 'keep');
  assert.equal(await readFile(path.join(shared, 'CLAUDE.md'), 'utf8'), 'mine');
  assert.deepEqual((await readdir(shared)).sort(), ['CLAUDE.md', 'skills']);
});

test('accountEmail reads oauthAccount.emailAddress, null when absent or unreadable', async () => {
  const dir = await tmp();
  assert.equal(await accountEmail(dir), null);
  await writeFile(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'eu@empresa.com' } }));
  assert.equal(await accountEmail(dir), 'eu@empresa.com');
  await writeFile(path.join(dir, '.claude.json'), JSON.stringify({ other: 1 }));
  assert.equal(await accountEmail(dir), null);
  await writeFile(path.join(dir, '.claude.json'), 'not json');
  assert.equal(await accountEmail(dir), null);
});
