import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveClaude, launchClaude, quoteForCmd } from '../src/launch.js';

const isWin = process.platform === 'win32';

async function tmp() {
  return mkdtemp(path.join(tmpdir(), 'wc-launch-'));
}

test('resolveClaude finds an executable named claude on PATH (POSIX)', { skip: isWin }, async () => {
  const dir = await tmp();
  const file = path.join(dir, 'claude');
  await writeFile(file, '#!/bin/sh\n');
  await chmod(file, 0o755);
  assert.equal(resolveClaude({ platform: 'linux', env: { PATH: `/nonexistent${path.delimiter}${dir}` } }), file);
});

test('resolveClaude skips a non-executable file on POSIX', { skip: isWin }, async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'claude'), '');
  await chmod(path.join(dir, 'claude'), 0o644);
  assert.equal(resolveClaude({ platform: 'linux', env: { PATH: dir } }), null);
});

test('resolveClaude skips a directory named claude and keeps searching', async () => {
  const dirA = await tmp();
  const dirB = await tmp();
  await mkdir(path.join(dirA, 'claude'));
  const file = path.join(dirB, isWin ? 'claude.cmd' : 'claude');
  await writeFile(file, '');
  if (!isWin) await chmod(file, 0o755);
  const found = resolveClaude({
    platform: process.platform,
    env: { PATH: `${dirA}${path.delimiter}${dirB}`, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
  });
  assert.equal(found, file);
});

test('resolveClaude honors PATHEXT on win32 and finds claude.cmd', async () => {
  const dir = await tmp();
  const file = path.join(dir, 'claude.cmd');
  await writeFile(file, '@echo off\r\n');
  assert.equal(
    resolveClaude({ platform: 'win32', env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' } }),
    file,
  );
});

test('resolveClaude returns null on an empty PATH', () => {
  assert.equal(resolveClaude({ platform: 'linux', env: {} }), null);
});

test('quoteForCmd leaves simple args alone and double-quotes the rest', () => {
  assert.equal(quoteForCmd('--resume'), '--resume');
  assert.equal(quoteForCmd('a b'), '"a b"');
  assert.equal(quoteForCmd('say "hi"'), '"say \\"hi\\""');
  assert.equal(quoteForCmd(''), '""');
});

test('launchClaude passes env and args to the child and propagates its exit code', async () => {
  const dir = await tmp();
  const script = path.join(dir, 'fake-claude.mjs');
  const out = path.join(dir, 'out.json');
  await writeFile(script, `
    import { writeFileSync } from 'node:fs';
    writeFileSync(process.env.FAKE_OUT, JSON.stringify({ argv: process.argv.slice(2), model: process.env.ANTHROPIC_MODEL }));
    process.exit(Number(process.env.FAKE_EXIT));
  `);
  const result = await launchClaude({
    claudePath: process.execPath,
    args: [script, '--resume', 'a b'],
    env: { ...process.env, FAKE_OUT: out, FAKE_EXIT: '7', ANTHROPIC_MODEL: 'deepseek-flash[1m]' },
  });
  assert.equal(result.code, 7);
  assert.deepEqual(JSON.parse(await readFile(out, 'utf8')), { argv: ['--resume', 'a b'], model: 'deepseek-flash[1m]' });
});

test('launchClaude resolves code 1 with the error when spawn fails', async () => {
  const result = await launchClaude({ claudePath: path.join(await tmp(), 'missing'), args: [], env: process.env });
  assert.equal(result.code, 1);
  assert.ok(result.error);
});

test('launchClaude uses a shell with quoted args only for .cmd/.bat paths', async () => {
  const calls = [];
  const fakeSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { on: (event, cb) => { if (event === 'exit') setImmediate(() => cb(0, null)); } };
  };
  await launchClaude({ claudePath: 'C:\\x\\claude.cmd', args: ['a b'], env: {}, spawnImpl: fakeSpawn });
  await launchClaude({ claudePath: '/usr/bin/claude', args: ['a b'], env: {}, spawnImpl: fakeSpawn });
  assert.equal(calls[0].opts.shell, true);
  assert.deepEqual(calls[0].args, ['"a b"']);
  assert.equal(calls[0].cmd, '"C:\\x\\claude.cmd"');
  assert.equal(calls[1].opts.stdio, 'inherit');
  assert.deepEqual(calls[1].args, ['a b']);
});

test('resolveClaude on win32 with both claude and claude.cmd returns claude.cmd', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'claude'), '#!/bin/sh\n');
  await writeFile(path.join(dir, 'claude.cmd'), '@echo off\r\n');
  const found = resolveClaude({
    platform: 'win32',
    env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
  });
  assert.equal(found, path.join(dir, 'claude.cmd'));
});

test('launchClaude installs SIGINT listener and removes it on exit', async () => {
  const initialCount = process.listenerCount('SIGINT');
  let exitCb;
  const fakeSpawn = (cmd, args, opts) => {
    return {
      on: (event, cb) => {
        if (event === 'exit') {
          exitCb = cb;
        }
      },
    };
  };
  const promise = launchClaude({ claudePath: '/usr/bin/claude', args: [], env: {}, spawnImpl: fakeSpawn });
  await new Promise((r) => setImmediate(r));
  // Listener should have been added while child runs
  assert.equal(process.listenerCount('SIGINT'), initialCount + 1);
  // Complete the child
  exitCb(0, null);
  await promise;
  // Listener should be removed after exit
  assert.equal(process.listenerCount('SIGINT'), initialCount);
});

test('launchClaude forwards SIGTERM to child', async () => {
  const kills = [];
  let exitCb;
  const fakeSpawn = (cmd, args, opts) => {
    return {
      on: (event, cb) => {
        if (event === 'exit') {
          exitCb = cb;
        }
      },
      kill: (sig) => {
        kills.push(sig);
      },
    };
  };
  const promise = launchClaude({ claudePath: '/usr/bin/claude', args: [], env: {}, spawnImpl: fakeSpawn });
  await new Promise((r) => setImmediate(r));
  process.emit('SIGTERM');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(kills, ['SIGTERM']);
  // Complete the child
  exitCb(0, null);
  await promise;
});

test('launchClaude exit with SIGTERM signal resolves with signal', async () => {
  const fakeSpawn = (cmd, args, opts) => ({
    on: (event, cb) => {
      if (event === 'exit') {
        setImmediate(() => cb(null, 'SIGTERM'));
      }
    },
  });
  const result = await launchClaude({ claudePath: '/usr/bin/claude', args: [], env: {}, spawnImpl: fakeSpawn });
  assert.equal(result.code, 1);
  assert.equal(result.signal, 'SIGTERM');
});

test('launchClaude forwards SIGHUP to child and removes its handler after exit', async () => {
  const kills = [];
  let exitCb;
  const before = process.listenerCount('SIGHUP');
  const fakeSpawn = () => ({
    on: (event, cb) => { if (event === 'exit') exitCb = cb; },
    kill: (sig) => { kills.push(sig); },
  });
  const promise = launchClaude({ claudePath: '/usr/bin/claude', args: [], env: {}, spawnImpl: fakeSpawn });
  await new Promise((r) => setImmediate(r));
  process.emit('SIGHUP');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(kills, ['SIGHUP']);
  exitCb(0, null);
  await promise;
  assert.equal(process.listenerCount('SIGHUP'), before);
});
