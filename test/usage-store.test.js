import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { usageFilePath, appendUsage, readUsage } from '../src/usage/store.js';

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
