import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, mkdir, chmod, appendFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { usageFilePath, appendUsage, readUsage, clearUsage } from '../src/usage/store.js';

const EV = (over = {}) => ({
  ts: '2026-10-03T14:02:11.482Z', sessionId: 'abc', provider: 'deepseek', selection: 'flash-1m', model: 'deepseek-flash',
  querySource: 'main', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 100, costUsd: 0.00001, ...over,
});

async function opts() {
  return { platform: process.platform === 'win32' ? 'win32' : 'linux', env: {}, home: await mkdtemp(path.join(tmpdir(), 'wc-usage-')) };
}

test('usageFilePath lives next to the provider env files', async () => {
  const o = await opts();
  assert.equal(usageFilePath(o), path.join(o.home, '.config', 'wrapper-code', 'usage.jsonl'));
});

test('appendUsage creates the directory and file (0600) and readUsage round-trips', async () => {
  const o = await opts();
  const file = await appendUsage([EV(), EV({ outputTokens: 7 })], o);
  assert.equal(file, usageFilePath(o));
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  await appendUsage([EV({ provider: 'ollama', costUsd: 0 })], o);
  const { events, skipped } = await readUsage(o);
  assert.equal(skipped, 0);
  assert.equal(events.length, 3);
  assert.equal(events[1].outputTokens, 7);
  assert.equal(events[2].provider, 'ollama');
  assert.equal((await readFile(file, 'utf8')).split('\n').filter(Boolean).length, 3, 'one JSON line per event');
});

test('readUsage returns empty when the file does not exist', async () => {
  assert.deepEqual(await readUsage(await opts()), { events: [], skipped: 0 });
});

test('readUsage skips corrupt or truncated lines and counts them', async () => {
  const o = await opts();
  const file = usageFilePath(o);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(EV())}\n{"ts":"x" broken\n${JSON.stringify({ hello: 'no fields' })}\n${JSON.stringify(EV({ model: 'm2' })).slice(0, 40)}`);
  const { events, skipped } = await readUsage(o);
  assert.equal(events.length, 1);
  assert.equal(skipped, 3);
});

test('appendUsage with no events writes nothing and creates no file', async () => {
  const o = await opts();
  await appendUsage([], o);
  assert.deepEqual(await readUsage(o), { events: [], skipped: 0 });
});

test('appendUsage recovers from truncated lines by prepending newline', async () => {
  const o = await opts();
  const file = usageFilePath(o);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(EV({ model: 'm1' })).slice(0, 30)}`);
  await appendUsage([EV({ model: 'm2' })], o);
  const { events, skipped } = await readUsage(o);
  assert.equal(events.length, 1);
  assert.equal(events[0].model, 'm2');
  assert.equal(skipped, 1);
});

test('appendUsage fixes file permissions to 0600', async () => {
  if (process.platform === 'win32') return;
  const o = await opts();
  const file = usageFilePath(o);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '{}');
  await chmod(file, 0o644);
  const before = (await stat(file)).mode & 0o777;
  await appendUsage([EV()], o);
  const after = (await stat(file)).mode & 0o777;
  assert.equal(before, 0o644, 'file started with default permissions');
  assert.equal(after, 0o600, 'appendUsage fixed permissions');
});

test('readUsage skips valid-JSON lines without a string model or with an unparseable ts', async () => {
  const o = await opts();
  await appendUsage([EV()], o);
  const { model, ...noModel } = EV();
  await writeFile(usageFilePath(o), `${JSON.stringify(EV())}\n${JSON.stringify(noModel)}\n${JSON.stringify(EV({ ts: 'not a date' }))}\n`);
  const { events, skipped } = await readUsage(o);
  assert.equal(events.length, 1);
  assert.equal(skipped, 2);
});

test('clearUsage without a filter removes the file and reports how many events went', async () => {
  const o = await opts();
  const file = await appendUsage([EV(), EV({ provider: 'ollama' })], o);
  assert.deepEqual(await clearUsage({}, o), { removed: 2 });
  await assert.rejects(stat(file), { code: 'ENOENT' });
  assert.deepEqual(await readUsage(o), { events: [], skipped: 0 });
});

test('clearUsage on a missing file removes nothing and does not fail', async () => {
  const o = await opts();
  assert.deepEqual(await clearUsage({}, o), { removed: 0 });
  assert.deepEqual(await clearUsage({ provider: 'deepseek' }, o), { removed: 0 });
});

test('clearUsage by provider keeps the other providers and the malformed lines, at 0600', async () => {
  const o = await opts();
  const file = await appendUsage([EV(), EV({ provider: 'ollama', outputTokens: 9 })], o);
  await appendFile(file, 'not json\n');
  await appendUsage([EV({ outputTokens: 11 })], o);
  assert.deepEqual(await clearUsage({ provider: 'deepseek' }, o), { removed: 2 });
  const text = await readFile(file, 'utf8');
  assert.equal(text.split('\n').filter(Boolean).length, 2);
  assert.match(text, /not json\n/);
  const { events, skipped } = await readUsage(o);
  assert.deepEqual(events.map((e) => [e.provider, e.outputTokens]), [['ollama', 9]]);
  assert.equal(skipped, 1);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(path.dirname(file))).sort(), ['usage.jsonl'], 'no temp file left behind');
});

test('clearUsage by provider with no matching line leaves the file untouched', async () => {
  const o = await opts();
  const file = await appendUsage([EV()], o);
  const before = await readFile(file, 'utf8');
  assert.deepEqual(await clearUsage({ provider: 'ollama' }, o), { removed: 0 });
  assert.equal(await readFile(file, 'utf8'), before);
});

test('clearUsage by provider removes the file when nothing is left', async () => {
  const o = await opts();
  const file = await appendUsage([EV()], o);
  assert.deepEqual(await clearUsage({ provider: 'deepseek' }, o), { removed: 1 });
  await assert.rejects(stat(file), { code: 'ENOENT' });
});

test('clearUsage accepts several provider ids at once', async () => {
  const o = await opts();
  await appendUsage([EV({ provider: 'alibaba' }), EV({ provider: 'qwencloud-token' }), EV({ provider: 'ollama' })], o);
  assert.deepEqual(await clearUsage({ provider: ['alibaba', 'qwencloud-token'] }, o), { removed: 2 });
  assert.deepEqual((await readUsage(o)).events.map((e) => e.provider), ['ollama']);
});
