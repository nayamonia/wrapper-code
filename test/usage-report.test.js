import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSince, aggregate, renderReport, runUsage } from '../src/usage/report.js';
import { appendUsage, usageFilePath } from '../src/usage/store.js';
import { appendFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const ev = (ts, provider, model, over = {}) => ({
  ts, sessionId: 's', provider, selection: 'x', model, querySource: 'main',
  inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 10, costUsd: 0.001, ...over,
});
const EV_ONE = ev('2026-10-03T11:00:00Z', 'deepseek', 'deepseek-flash');
const EVENTS = [
  ev('2026-10-03T11:00:00Z', 'deepseek', 'deepseek-flash'),
  ev('2026-10-03T11:30:00Z', 'deepseek', 'deepseek-flash', { outputTokens: 300 }),
  ev('2026-10-02T11:00:00Z', 'deepseek', 'deepseek-v4-pro', { costUsd: 0.5 }),
  ev('2026-09-20T11:00:00Z', 'ollama', 'qwen3-code:14b', { costUsd: 0 }),
  ev('2026-08-01T11:00:00Z', 'qwencloud', 'auto', { costUsd: null }),
];

test('parseSince understands hours, days and all', () => {
  assert.equal(parseSince('24h', NOW), NOW - 24 * 3600e3);
  assert.equal(parseSince('7d', NOW), NOW - 7 * 86400e3);
  assert.equal(parseSince('all', NOW), 0);
  assert.equal(parseSince('soon', NOW), null);
  assert.equal(parseSince('0d', NOW), null);
});

test('aggregate groups by provider and model inside the window, with token totals and no cost fields', () => {
  const { groups, total } = aggregate(EVENTS, { since: NOW - 30 * 86400e3 });
  assert.deepEqual(groups.map((g) => [g.provider, g.model, g.requests, g.outputTokens]), [
    ['deepseek', 'deepseek-flash', 2, 400],
    ['deepseek', 'deepseek-v4-pro', 1, 100],
    ['ollama', 'qwen3-code:14b', 1, 100],
  ]);
  assert.equal(total.requests, 4);
  assert.equal(total.inputTokens, 4000);
  for (const bucket of [...groups, total]) {
    assert.equal('costUsd' in bucket, false);
    assert.equal('unpriced' in bucket, false);
  }
});

test('aggregate with --since all includes older events', () => {
  const { groups, total } = aggregate(EVENTS, { since: 0 });
  assert.equal(groups.find((g) => g.model === 'auto').requests, 1);
  assert.equal(total.requests, 5);
});

test('aggregate filters by provider and splits by day when asked', () => {
  const { groups } = aggregate(EVENTS, { since: 0, provider: 'deepseek', byDay: true });
  assert.deepEqual(groups.map((g) => [g.day, g.model, g.requests]), [
    ['2026-10-02', 'deepseek-v4-pro', 1],
    ['2026-10-03', 'deepseek-flash', 2],
  ]);
});

test('renderReport prints a token table with a total row and the skipped-lines footer, and no cost', () => {
  const r = aggregate(EVENTS, { since: 0 });
  const text = renderReport({ ...r, skipped: 2, since: 'all' });
  assert.match(text, /provider\s+model\s+requests\s+in\s+out\s+cache read\s+cache write$/m);
  assert.match(text, /deepseek\s+deepseek-flash\s+2\s+2\.0k\s+400\s+0\s+0$/m);
  assert.match(text, /qwencloud\s+auto\s+1\s+1\.0k\s+100\s+0\s+0$/m);
  assert.match(text, /total\s+5\s+5\.0k\s+700\s+0\s+0$/m);
  assert.match(text, /2 malformed lines skipped/);
  assert.doesNotMatch(text, /cost|\$|unpriced/);
});

test('runUsage reads the store, applies flags and supports --json; empty store says so', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'wc-report-'));
  const cfg = { platform: 'linux', env: {}, home };
  const out = () => { const c = []; return { write: (s) => { c.push(String(s)); return true; }, text: () => c.join('') }; };
  let o = out();
  assert.equal(await runUsage([], { cfg, stdout: o, stderr: out(), now: NOW }), 0);
  assert.match(o.text(), /no usage recorded yet/);
  await appendUsage(EVENTS, cfg);
  o = out();
  assert.equal(await runUsage(['--since', '7d', '--provider', 'deepseek', '--json'], { cfg, stdout: o, stderr: out(), now: NOW }), 0);
  const json = JSON.parse(o.text());
  assert.equal(json.since, '7d');
  assert.equal(json.groups.length, 2);
  assert.equal(json.total.requests, 3);
  assert.equal('costUsd' in json.total, false);
  const err = out();
  assert.equal(await runUsage(['--since', 'yesterday'], { cfg, stdout: out(), stderr: err, now: NOW }), 1);
  assert.match(err.text(), /usage: --since expects 24h, 7d, 30d or all/);
});

test('runUsage survives a corrupt-but-valid-JSON line and counts it in the footer', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'wc-report-'));
  const cfg = { platform: 'linux', env: {}, home };
  await appendUsage([EV_ONE], cfg);
  await appendFile(usageFilePath(cfg), `${JSON.stringify({ ts: '2026-10-03T11:00:00Z', provider: 'x', inputTokens: 1 })}\n`);
  const c = []; const stdout = { write: (s) => { c.push(String(s)); return true; } };
  assert.equal(await runUsage(['--since', 'all'], { cfg, stdout, stderr: stdout, now: NOW }), 0);
  assert.match(c.join(''), /deepseek-flash/);
  assert.match(c.join(''), /1 malformed lines skipped/);
});
