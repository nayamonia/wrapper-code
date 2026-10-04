import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseApiRequests, startUsageReceiver } from '../src/usage/receiver.js';

// Receivers opened by a test are closed after it even when an assertion fails first,
// otherwise the open server keeps the file hanging instead of failing.
const opened = [];
async function start(opts) {
  const r = await startUsageReceiver(opts);
  opened.push(r);
  return r;
}
afterEach(async () => {
  while (opened.length) await opened.pop().close();
});

const FIXTURE = JSON.parse(await readFile(new URL('./fixtures/otlp-api-request.json', import.meta.url), 'utf8'));

function record(attrs, body = 'claude_code.api_request') {
  return { body: { stringValue: body }, attributes: Object.entries(attrs).map(([key, value]) => ({ key, value })) };
}
const wrap = (...records) => ({ resourceLogs: [{ scopeLogs: [{ logRecords: records }] }] });

test('parseApiRequests maps the real fixture to one event with numeric fields', () => {
  const { events, malformed } = parseApiRequests(FIXTURE);
  assert.equal(malformed, 0);
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(typeof e.model, 'string');
  assert.ok(e.model.length > 0);
  for (const k of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'durationMs']) {
    assert.equal(typeof e[k], 'number', k);
    assert.ok(Number.isInteger(e[k]) && e[k] >= 0, k);
  }
  assert.ok(e.outputTokens > 0, 'the pong reply produced output tokens');
  assert.equal(e.querySource, 'sdk');
});

test('parseApiRequests accepts intValue strings, doubleValue and stringValue numbers', () => {
  const payload = wrap(record({
    model: { stringValue: 'm' }, query_source: { stringValue: 'main' },
    input_tokens: { intValue: '1234' }, output_tokens: { doubleValue: 5 }, cache_read_tokens: { stringValue: '7' },
    cache_creation_tokens: { intValue: '0' }, duration_ms: { intValue: '42' },
  }));
  const { events } = parseApiRequests(payload);
  assert.deepEqual(events[0], { model: 'm', querySource: 'main', inputTokens: 1234, outputTokens: 5, cacheReadTokens: 7, cacheCreationTokens: 0, durationMs: 42 });
});

test('parseApiRequests ignores other events and counts api_request records without token fields as malformed', () => {
  const payload = wrap(
    record({ prompt_length: { intValue: '3' } }, 'claude_code.user_prompt'),
    record({ model: { stringValue: 'm' } }),
    record({ 'event.name': { stringValue: 'api_request' }, model: { stringValue: 'm2' }, output_tokens: { intValue: '1' } }, ''),
  );
  const { events, malformed } = parseApiRequests(payload);
  assert.equal(malformed, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].model, 'm2');
  assert.equal(events[0].inputTokens, 0, 'missing counters default to 0 when at least one token field is present');
  assert.equal(events[0].querySource, 'unknown');
});

test('parseApiRequests tolerates an empty or malformed envelope', () => {
  assert.deepEqual(parseApiRequests({}), { events: [], malformed: 0 });
  assert.deepEqual(parseApiRequests({ resourceLogs: 'nope' }), { events: [], malformed: 0 });
});

test('startUsageReceiver exposes the seven env vars with its port and token', async () => {
  const r = await start({ onEvent: () => {}, lingerMs: 0 });
  assert.deepEqual(r.env, {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_METRICS_EXPORTER: 'none',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${r.port}`,
    OTEL_EXPORTER_OTLP_HEADERS: `x-wrapper-usage-token=${r.token}`,
    OTEL_LOGS_EXPORT_INTERVAL: '2000',
  });
  assert.match(r.token, /^[0-9a-f]{64}$/);
});

test('POST /v1/logs with the token delivers events; without it is 403 and counted as rejected', async () => {
  const got = [];
  const r = await start({ onEvent: (e, at) => got.push({ e, at }), lingerMs: 0 });
  const url = `http://127.0.0.1:${r.port}/v1/logs`;
  const bad = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(FIXTURE) });
  assert.equal(bad.status, 403);
  const ok = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-wrapper-usage-token': r.token }, body: JSON.stringify(FIXTURE) });
  assert.equal(ok.status, 200);
  assert.equal(got.length, 1);
  assert.match(got[0].at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(r.stats, { batches: 1, events: 1, malformed: 0, rejected: 1 });
});

test('POST /v1/metrics and unknown routes answer 204 and are ignored', async () => {
  const r = await start({ onEvent: () => {}, lingerMs: 0 });
  const res = await fetch(`http://127.0.0.1:${r.port}/v1/metrics`, { method: 'POST', headers: { 'x-wrapper-usage-token': r.token }, body: '{}' });
  assert.equal(res.status, 204);
  assert.equal((await fetch(`http://127.0.0.1:${r.port}/anything`)).status, 204);
  assert.equal(r.stats.batches, 0);
});

test('close() keeps accepting batches during the linger window', async () => {
  const got = [];
  const r = await start({ onEvent: (e) => got.push(e), lingerMs: 300 });
  const closing = r.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const res = await fetch(`http://127.0.0.1:${r.port}/v1/logs`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-wrapper-usage-token': r.token }, body: JSON.stringify(FIXTURE) });
  assert.equal(res.status, 200);
  await closing;
  assert.equal(got.length, 1);
  await assert.rejects(fetch(`http://127.0.0.1:${r.port}/v1/logs`, { method: 'POST' }), 'server is closed after the linger');
});

test('a batch with invalid JSON is answered 400 and counted as neither event nor malformed', async () => {
  const r = await start({ onEvent: () => {}, lingerMs: 0 });
  const res = await fetch(`http://127.0.0.1:${r.port}/v1/logs`, { method: 'POST', headers: { 'x-wrapper-usage-token': r.token }, body: '{nope' });
  assert.equal(res.status, 400);
  assert.deepEqual(r.stats, { batches: 0, events: 0, malformed: 0, rejected: 0 });
});

test('close({ now: true }) ends the linger immediately', async () => {
  const r = await start({ lingerMs: 60000 });
  const started = Date.now();
  await r.close({ now: true });
  assert.ok(Date.now() - started < 2000);
});
