import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSince, aggregate, renderReport, runUsage } from '../src/usage/report.js';
import { appendUsage } from '../src/usage/store.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const ev = (ts, provider, model, over = {}) => ({
  ts, sessionId: 's', provider, selection: 'x', model, querySource: 'main',
  inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 10, costUsd: 0.001, ...over,
});
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

test('aggregate groups by provider and model inside the window, with cost and unpriced counts', () => {
  const { groups, total } = aggregate(EVENTS, { since: NOW - 30 * 86400e3 });
  assert.deepEqual(groups.map((g) => [g.provider, g.model, g.requests, g.outputTokens, g.costUsd]), [
    ['deepseek', 'deepseek-flash', 2, 400, 0.002],
    ['deepseek', 'deepseek-v4-pro', 1, 100, 0.5],
    ['ollama', 'qwen3-code:14b', 1, 100, 0],
  ]);
  assert.equal(total.requests, 4);
  assert.equal(total.costUsd, 0.502);
  assert.equal(total.unpriced, 0);
});

test('aggregate with --since all includes unpriced events and marks them', () => {
  const { groups, total } = aggregate(EVENTS, { since: 0 });
  const auto = groups.find((g) => g.model === 'auto');
  assert.equal(auto.costUsd, null);
  assert.equal(auto.unpriced, 1);
  assert.equal(total.unpriced, 1);
  assert.equal(total.costUsd, 0.502, 'null costs do not poison the total');
});

test('aggregate filters by provider and splits by day when asked', () => {
  const { groups } = aggregate(EVENTS, { since: 0, provider: 'deepseek', byDay: true });
  assert.deepEqual(groups.map((g) => [g.day, g.model, g.requests]), [
    ['2026-10-02', 'deepseek-v4-pro', 1],
    ['2026-10-03', 'deepseek-flash', 2],
  ]);
});

test('renderReport prints a table with a total row and the skipped-lines footer', () => {
  const r = aggregate(EVENTS, { since: 0 });
  const text = renderReport({ ...r, skipped: 2, since: 'all' });
  assert.match(text, /provider\s+model\s+requests\s+in\s+out\s+cache read\s+cache write\s+est\. cost/);
  assert.match(text, /deepseek\s+deepseek-flash\s+2\s+2\.0k\s+400\s+0\s+0\s+\$0\.00/);
  assert.match(text, /qwencloud\s+auto\s+1\s+1\.0k\s+100\s+0\s+0\s+unknown/);
  assert.match(text, /total\s+5\s+.*≥ \$0\.50 \(1 unpriced\)/);
  assert.match(text, /2 malformed lines skipped/);
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
  const err = out();
  assert.equal(await runUsage(['--since', 'yesterday'], { cfg, stdout: out(), stderr: err, now: NOW }), 1);
  assert.match(err.text(), /usage: --since expects 24h, 7d, 30d or all/);
});
