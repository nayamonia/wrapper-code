import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readlink, lstat, readdir, symlink, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PER_ACCOUNT, linkShared, syncMcpServers } from '../src/accounts/share.js';

const isWin = process.platform === 'win32';
const tmp = () => mkdtemp(path.join(tmpdir(), 'wc-share-'));

async function fixture() {
  const home = await tmp();
  const src = path.join(home, '.claude');
  await mkdir(path.join(src, 'skills'), { recursive: true });
  await mkdir(path.join(src, 'projects'), { recursive: true });
  for (const f of ['CLAUDE.md', 'FRIDAY.md', 'settings.json', 'history.jsonl', '.credentials.json']) await writeFile(path.join(src, f), f);
  const dir = path.join(home, 'acct');
  await mkdir(dir);
  return { home, src, dir };
}

test('linkShared links every entry but the per-account state', { skip: isWin }, async () => {
  const { home, src, dir } = await fixture();
  await linkShared(dir, { home });
  assert.deepEqual((await readdir(dir)).sort(), ['CLAUDE.md', 'FRIDAY.md', 'settings.json', 'skills']);
  for (const name of ['CLAUDE.md', 'FRIDAY.md', 'settings.json', 'skills']) {
    assert.equal(await readlink(path.join(dir, name)), path.join(src, name), name);
  }
  for (const name of ['projects', 'history.jsonl', '.credentials.json', '.claude.json', '.wrapper-code-account']) {
    assert.ok(PER_ACCOUNT.has(name), name);
  }
});

test('linkShared keeps a real file, fixes a wrong link and drops a dangling one', { skip: isWin }, async () => {
  const { home, src, dir } = await fixture();
  await writeFile(path.join(dir, 'settings.json'), 'own');
  await symlink('/somewhere/else', path.join(dir, 'CLAUDE.md'));
  await symlink(path.join(src, 'gone.md'), path.join(dir, 'gone.md'));
  await linkShared(dir, { home });
  assert.equal(await readFile(path.join(dir, 'settings.json'), 'utf8'), 'own');
  assert.equal(await readlink(path.join(dir, 'CLAUDE.md')), path.join(src, 'CLAUDE.md'));
  await assert.rejects(lstat(path.join(dir, 'gone.md')), { code: 'ENOENT' });
});

test('linkShared leaves a link pointing outside ~/.claude alone when its name is not shared', { skip: isWin }, async () => {
  const { home, dir } = await fixture();
  await symlink('/elsewhere/notes', path.join(dir, 'notes'));
  await linkShared(dir, { home });
  assert.equal(await readlink(path.join(dir, 'notes')), '/elsewhere/notes');
});

test('linkShared links nothing when ~/.claude is missing, and a second run changes nothing', { skip: isWin }, async () => {
  const empty = await tmp();
  const dir = path.join(empty, 'acct');
  await mkdir(dir);
  await linkShared(dir, { home: empty });
  assert.deepEqual(await readdir(dir), []);
  const { home, dir: d2 } = await fixture();
  await linkShared(d2, { home });
  const first = (await readdir(d2)).sort();
  await linkShared(d2, { home });
  assert.deepEqual((await readdir(d2)).sort(), first);
});

test('linkShared removes the link when a shared entry is deleted from ~/.claude', { skip: isWin }, async () => {
  const { home, src, dir } = await fixture();
  await linkShared(dir, { home });
  await rm(path.join(src, 'FRIDAY.md'));
  await linkShared(dir, { home });
  await assert.rejects(lstat(path.join(dir, 'FRIDAY.md')), { code: 'ENOENT' });
});

async function mcpFixture() {
  const home = await tmp();
  const dir = path.join(home, 'acct');
  await mkdir(dir);
  return { home, dir, file: path.join(dir, '.claude.json') };
}

test('syncMcpServers copies mcpServers and keeps the other account keys, mode 0600', { skip: isWin }, async () => {
  const { home, dir, file } = await mcpFixture();
  await writeFile(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { a: { command: 'x' } }, oauthAccount: { emailAddress: 'main@x' } }));
  await writeFile(file, JSON.stringify({ oauthAccount: { emailAddress: 'work@x' }, mcpServers: { old: {} } }));
  assert.equal(await syncMcpServers(dir, { home, warn: () => assert.fail('no warning') }), 'synced');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { oauthAccount: { emailAddress: 'work@x' }, mcpServers: { a: { command: 'x' } } });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('syncMcpServers creates the account file when it is missing', async () => {
  const { home, dir, file } = await mcpFixture();
  await writeFile(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { a: {} } }));
  assert.equal(await syncMcpServers(dir, { home, warn: () => {} }), 'synced');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { mcpServers: { a: {} } });
});

test('syncMcpServers leaves the account alone when the source is missing, empty or invalid', async () => {
  for (const source of [null, '{}', 'not json', JSON.stringify({ mcpServers: [] })]) {
    const { home, dir, file } = await mcpFixture();
    if (source !== null) await writeFile(path.join(home, '.claude.json'), source);
    await writeFile(file, JSON.stringify({ mcpServers: { keep: {} } }));
    assert.equal(await syncMcpServers(dir, { home, warn: () => {} }), 'skipped', String(source));
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { mcpServers: { keep: {} } });
  }
});

test('syncMcpServers warns and skips when the account file is not valid JSON', async () => {
  const { home, dir, file } = await mcpFixture();
  await writeFile(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { a: {} } }));
  await writeFile(file, '{broken');
  const warnings = [];
  assert.equal(await syncMcpServers(dir, { home, warn: (m) => warnings.push(m) }), 'invalid');
  assert.equal(await readFile(file, 'utf8'), '{broken');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /MCP servers were not copied/);
});
