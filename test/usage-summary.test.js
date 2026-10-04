import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abbreviate, summarize, summaryLines } from '../src/usage/summary.js';

const ev = (over = {}) => ({ inputTokens: 1000, outputTokens: 100, cacheReadTokens: 5000, cacheCreationTokens: 200, costUsd: 0.01, ...over });
const base = { providerName: 'DeepSeek', selection: 'flash-1m', startedAt: Date.parse('2026-10-03T10:00:00Z'), endedAt: Date.parse('2026-10-03T10:42:00Z'), file: '/h/.config/wrapper-code/usage.jsonl', malformed: 0 };

test('abbreviate uses k and M with one decimal', () => {
  assert.equal(abbreviate(950), '950');
  assert.equal(abbreviate(128400), '128.4k');
  assert.equal(abbreviate(1100000), '1.1M');
  assert.equal(abbreviate(0), '0');
});

test('summarize totals tokens and cost, counting unpriced events', () => {
  const s = summarize([ev(), ev({ costUsd: null }), ev({ costUsd: 0.02 })]);
  assert.deepEqual(s, { requests: 3, inputTokens: 3000, outputTokens: 300, cacheReadTokens: 15000, cacheCreationTokens: 600, costUsd: 0.03, unpriced: 1 });
  assert.equal(summarize([ev({ costUsd: null })]).costUsd, null);
  assert.equal(summarize([]).requests, 0);
});

test('summaryLines prints the three-line block with duration, totals and cost', () => {
  const lines = summaryLines({ ...base, events: [ev(), ev()] });
  assert.equal(lines[0], 'wrapper-code · DeepSeek (flash-1m) · 42 min');
  assert.equal(lines[1], '  requests 2 · in 2.0k · out 200 · cache read 10.0k · cache write 400');
  assert.equal(lines[2], '  estimated cost $0.02 · saved to /h/.config/wrapper-code/usage.jsonl');
});

test('summaryLines says cost unknown, or a lower bound when some events are unpriced', () => {
  assert.match(summaryLines({ ...base, events: [ev({ costUsd: null })] })[2], /^  cost unknown · saved to/);
  assert.match(summaryLines({ ...base, events: [ev(), ev({ costUsd: null })] })[2], /^  estimated cost ≥ \$0\.01 \(1 unpriced\) · saved to/);
});

test('summaryLines reports zero events with the reason and counts malformed records', () => {
  assert.deepEqual(summaryLines({ ...base, events: [], reason: 'telemetry disabled' }), ['wrapper-code · DeepSeek (flash-1m) · 42 min', '  no usage captured (telemetry disabled)']);
  assert.deepEqual(summaryLines({ ...base, events: [] }), ['wrapper-code · DeepSeek (flash-1m) · 42 min', '  no usage captured (no api_request events arrived)']);
  assert.match(summaryLines({ ...base, events: [ev()], malformed: 2 })[2], /· 2 malformed records ignored$/);
});

test('summaryLines on a color TTY paints the night panel and resets every line', () => {
  const lines = summaryLines({ ...base, events: [ev()], truecolor: true });
  for (const l of lines) {
    assert.ok(l.startsWith('\x1b[48;2;11;11;20m'));
    assert.ok(l.endsWith('\x1b[0m'));
  }
  assert.equal(lines[0].replace(/\x1b\[[0-9;]*m/g, '').trimEnd(), 'wrapper-code · DeepSeek (flash-1m) · 42 min');
});

test('summaryLines reports malformed count even when no events survive', () => {
  const lines = summaryLines({ ...base, events: [], malformed: 2 });
  assert.equal(lines[1], '  no usage captured (no api_request events arrived) · 2 malformed records ignored');
});
