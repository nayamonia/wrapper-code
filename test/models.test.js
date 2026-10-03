import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverModels, joinUrl, describeFetchError } from '../src/setup/models.js';
import ollama from '../src/providers/ollama.js';

const TAGS = {
  models: [
    { name: 'qwen3-code:14b', details: { parameter_size: '14.8B', context_length: 40960 }, capabilities: ['completion', 'tools', 'thinking'] },
    { name: 'gemma3:4b', details: { parameter_size: '4.3B', context_length: 131072 }, capabilities: ['completion', 'vision'] },
    { name: 'ancient:1b', details: { parameter_size: '1B' } },
  ],
};

function fakeFetch(status, body) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, statusText: 'X', json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { calls, fetchImpl };
}

test('joinUrl tolerates a trailing slash on the base URL', () => {
  assert.equal(joinUrl('http://localhost:11434/', '/api/tags'), 'http://localhost:11434/api/tags');
  assert.equal(joinUrl('http://localhost:11434', '/api/tags'), 'http://localhost:11434/api/tags');
  assert.equal(joinUrl('http://h:1//', '/api/tags'), 'http://h:1/api/tags');
});

test('discoverModels normalizes /api/tags, sorts by name and flags tool support', async () => {
  const { calls, fetchImpl } = fakeFetch(200, TAGS);
  const result = await discoverModels(ollama, 'http://localhost:11434/', { fetchImpl });
  assert.equal(calls[0].url, 'http://localhost:11434/api/tags');
  assert.equal(result.ok, true);
  assert.deepEqual(result.models, [
    { name: 'ancient:1b', parameterSize: '1B', contextLength: null, tools: null },
    { name: 'gemma3:4b', parameterSize: '4.3B', contextLength: 131072, tools: false },
    { name: 'qwen3-code:14b', parameterSize: '14.8B', contextLength: 40960, tools: true },
  ]);
});

test('discoverModels reports an HTTP error with status', async () => {
  const { fetchImpl } = fakeFetch(500, { error: 'boom' });
  const result = await discoverModels(ollama, 'http://localhost:11434', { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
});

test('discoverModels reports an unreachable server as status 0 naming the URL', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const result = await discoverModels(ollama, 'http://localhost:9', { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.match(result.message, /http:\/\/localhost:9/);
  assert.match(result.message, /ECONNREFUSED/);
});

test('discoverModels treats a response without a models array as an error', async () => {
  const { fetchImpl } = fakeFetch(200, { nope: true });
  const result = await discoverModels(ollama, 'http://localhost:11434', { fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.message, /unexpected response/i);
});

test('discoverModels skips non-object entries and entries with non-string names', async () => {
  const { fetchImpl } = fakeFetch(200, {
    models: [null, 5, 'x', { name: { a: 1 } }, { name: 'ok' }],
  });
  const result = await discoverModels(ollama, 'http://localhost:11434', { fetchImpl });
  assert.equal(result.ok, true);
  assert.deepEqual(result.models, [
    { name: 'ok', parameterSize: '', contextLength: null, tools: null },
  ]);
});

test('discoverModels includes err.cause details in the message when present', async () => {
  const fetchImpl = async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    throw Object.assign(new TypeError('fetch failed'), { cause });
  };
  const result = await discoverModels(ollama, 'http://localhost:9', { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.match(result.message, /http:\/\/localhost:9/);
  assert.match(result.message, /fetch failed/);
  assert.match(result.message, /ECONNREFUSED/);
});

test('describeFetchError: plain error has no suffix', () => {
  assert.equal(describeFetchError(new Error('boom')), 'boom');
});

test('describeFetchError: cause code is appended', () => {
  assert.equal(describeFetchError(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })), 'fetch failed (ECONNREFUSED)');
});

test('describeFetchError: cause with only a message uses it', () => {
  assert.equal(describeFetchError(new TypeError('fetch failed', { cause: new Error('socket hang up') })), 'fetch failed (socket hang up)');
});

test('describeFetchError: cause with neither code nor message never prints undefined', () => {
  const out = describeFetchError(new TypeError('fetch failed', { cause: {} }));
  assert.equal(out, 'fetch failed');
  assert.doesNotMatch(out, /undefined/);
});
