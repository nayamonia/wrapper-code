import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAuth } from '../src/accounts/auth.js';
import { TEMP_PREFIX, createTempAccount, teardownTemp, sweepTemp, pidAlive } from '../src/accounts/temp.js';
import { readMarker, writeMarker } from '../src/accounts/store.js';

const isWin = process.platform === 'win32';
const tmp = () => mkdtemp(path.join(tmpdir(), 'wc-temp-'));

function fakeChild({ exitCode = 0, never = false } = {}) {
  const child = new EventEmitter();
  child.kills = [];
  child.kill = (sig) => { child.kills.push(sig); };
  if (!never) setImmediate(() => child.emit('exit', exitCode, null));
  return child;
}

test('runAuth runs claude auth <sub> with CLAUDE_CONFIG_DIR and the given stdio', async () => {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return fakeChild({ exitCode: 0 }); };
  const r = await runAuth('logout', { claudePath: '/c', configDir: '/acct', env: { A: '1' }, spawnImpl });
  assert.deepEqual(r, { code: 0 });
  assert.equal(calls[0].cmd, '/c');
  assert.deepEqual(calls[0].args, ['auth', 'logout']);
  assert.equal(calls[0].opts.env.CLAUDE_CONFIG_DIR, '/acct');
  assert.equal(calls[0].opts.env.A, '1');
  assert.equal(calls[0].opts.stdio, 'ignore');
  await runAuth('login', { claudePath: '/c', configDir: '/acct', env: {}, inherit: true, spawnImpl });
  assert.equal(calls[1].opts.stdio, 'inherit');
});

test('runAuth reports a non-zero exit, a spawn error and a timeout without rejecting', async () => {
  assert.equal((await runAuth('logout', { claudePath: '/c', configDir: '/d', env: {}, spawnImpl: () => fakeChild({ exitCode: 2 }) })).code, 2);
  const thrown = await runAuth('logout', { claudePath: '/c', configDir: '/d', env: {}, spawnImpl: () => { throw new Error('ENOENT'); } });
  assert.equal(thrown.code, 1);
  let child;
  const timed = await runAuth('logout', { claudePath: '/c', configDir: '/d', env: {}, timeoutMs: 20, spawnImpl: () => (child = fakeChild({ never: true })) });
  assert.equal(timed.code, 1);
  assert.equal(timed.timedOut, true);
  assert.deepEqual(child.kills, ['SIGTERM']);
});

test('createTempAccount makes a 0700 dir with a temp marker carrying the pid', { skip: isWin }, async () => {
  const root = await tmp();
  const dir = await createTempAccount({ tmpRoot: root, pid: 4242, now: new Date('2026-10-09T00:00:00Z') });
  assert.ok(path.basename(dir).startsWith(TEMP_PREFIX));
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  assert.deepEqual(await readMarker(dir), { name: 'temp', createdAt: '2026-10-09T00:00:00.000Z', temp: true, pid: 4242 });
});

test('teardownTemp logs out then deletes; keeps the dir when logout fails', async () => {
  const root = await tmp();
  const order = [];
  const dir = await createTempAccount({ tmpRoot: root, pid: 1 });
  const ok = await teardownTemp(dir, { logout: async (d) => { order.push(['logout', d, (await readdir(d)).length > 0]); return { code: 0 }; } });
  assert.equal(ok.removed, true);
  assert.deepEqual(order, [['logout', dir, true]], 'logout ran while the dir still existed');
  await assert.rejects(stat(dir), { code: 'ENOENT' });

  const kept = await createTempAccount({ tmpRoot: root, pid: 1 });
  const bad = await teardownTemp(kept, { logout: async () => ({ code: 1, timedOut: true }) });
  assert.equal(bad.removed, false);
  assert.equal(bad.result.timedOut, true);
  assert.ok((await stat(kept)).isDirectory());
});

test('sweepTemp cleans dead-pid temp dirs only, and ignores unmarked ones', async () => {
  const root = await tmp();
  const dead = await createTempAccount({ tmpRoot: root, pid: 111 });
  const live = await createTempAccount({ tmpRoot: root, pid: 222 });
  const unmarked = path.join(root, `${TEMP_PREFIX}zzzzzz`);
  await mkdir(unmarked);
  const notTemp = path.join(root, `${TEMP_PREFIX}saved1`);
  await mkdir(notTemp);
  await writeMarker(notTemp, { name: 'x', temp: false });
  const loggedOut = [];
  const n = await sweepTemp({ tmpRoot: root, isAlive: (pid) => pid === 222, logout: async (d) => { loggedOut.push(d); return { code: 0 }; } });
  assert.equal(n, 1);
  assert.deepEqual(loggedOut, [dead]);
  await assert.rejects(stat(dead), { code: 'ENOENT' });
  for (const d of [live, unmarked, notTemp]) assert.ok((await stat(d)).isDirectory(), d);
});

test('sweepTemp returns 0 when the tmp root is unreadable', async () => {
  assert.equal(await sweepTemp({ tmpRoot: '/nonexistent/wc', isAlive: () => false, logout: async () => ({ code: 0 }) }), 0);
});

test('pidAlive is true for this process and false for an impossible pid', () => {
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(2 ** 22 + 12345), false);
});
