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
    { name: 'ancient:1b', label: '', parameterSize: '1B', contextLength: null, tools: null, priceIn: null, priceOut: null, cacheReadPrice: null, cacheWritePrice: null },
    { name: 'gemma3:4b', label: '', parameterSize: '4.3B', contextLength: 131072, tools: false, priceIn: null, priceOut: null, cacheReadPrice: null, cacheWritePrice: null },
    { name: 'qwen3-code:14b', label: '', parameterSize: '14.8B', contextLength: 40960, tools: true, priceIn: null, priceOut: null, cacheReadPrice: null, cacheWritePrice: null },
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
    { name: 'ok', label: '', parameterSize: '', contextLength: null, tools: null, priceIn: null, priceOut: null, cacheReadPrice: null, cacheWritePrice: null },
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

test('describeFetchError: a thrown non-Error never prints undefined', () => {
  assert.equal(describeFetchError('plain string'), 'plain string');
});

const OPENROUTER = {
  data: [
    { id: 'openai/gpt-6.1-sol', name: 'OpenAI: GPT-6.1 Sol', context_length: 1050000, pricing: { prompt: '0.000002', completion: '0.00001', input_cache_read: '0.0000002', input_cache_write: '0.0000025' }, supported_parameters: ['tools', 'temperature'] },
    { id: 'openai/gpt-6.1-sol:batch', name: 'OpenAI: GPT-6.1 Sol (batch)', context_length: 1050000, pricing: { prompt: '0.000001', completion: '0.000005' }, supported_parameters: ['tools'] },
    { id: 'google/gemma-4-it', name: 'Google: Gemma 4', context_length: 131072, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['temperature'] },
    { id: 'meta-llama/llama-5-scout', name: 'Meta: Llama 5 Scout', context_length: 1048576 },
  ],
};
const openrouterProvider = {
  ...ollama,
  id: 'openrouter',
  env: { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api' },
  models: { ...ollama.models, discoverPath: '/v1/models', format: 'openrouter' },
};

test('discoverModels in openrouter format reads data[], maps id/name/context/price/tools and drops :batch variants', async () => {
  const { calls, fetchImpl } = fakeFetch(200, OPENROUTER);
  const result = await discoverModels(openrouterProvider, 'https://openrouter.ai/api', { fetchImpl });
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/models');
  assert.equal(result.ok, true);
  assert.deepEqual(result.models, [
    { name: 'google/gemma-4-it', label: 'Google: Gemma 4', parameterSize: '', contextLength: 131072, tools: false, priceIn: 0, priceOut: 0, cacheReadPrice: null, cacheWritePrice: null },
    { name: 'meta-llama/llama-5-scout', label: 'Meta: Llama 5 Scout', parameterSize: '', contextLength: 1048576, tools: null, priceIn: null, priceOut: null, cacheReadPrice: null, cacheWritePrice: null },
    { name: 'openai/gpt-6.1-sol', label: 'OpenAI: GPT-6.1 Sol', parameterSize: '', contextLength: 1050000, tools: true, priceIn: 2, priceOut: 10, cacheReadPrice: 0.2, cacheWritePrice: 2.5 },
  ]);
});

test('discoverModels in openrouter format rejects a response without a data array', async () => {
  const { fetchImpl } = fakeFetch(200, { models: [] });
  const result = await discoverModels(openrouterProvider, 'https://openrouter.ai/api', { fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.message, /no data array/);
});

test('discoverModels in ollama format still returns the extended shape with empty label and null prices', async () => {
  const { fetchImpl } = fakeFetch(200, TAGS);
  const result = await discoverModels(ollama, 'http://localhost:11434', { fetchImpl });
  assert.equal(result.ok, true);
  assert.deepEqual(result.models[2], { name: 'qwen3-code:14b', label: '', parameterSize: '14.8B', contextLength: 40960, tools: true, priceIn: null, priceOut: null, cacheReadPrice: null, cacheWritePrice: null });
});

test('discoverModels in openrouter format treats negative sentinel prices (dynamic routers) as unknown', async () => {
  const { fetchImpl } = fakeFetch(200, { data: [{ id: 'openrouter/auto-beta', name: 'Auto Router', context_length: 2000000, pricing: { prompt: '-1', completion: '-1' }, supported_parameters: ['tools'] }] });
  const result = await discoverModels(openrouterProvider, 'https://openrouter.ai/api', { fetchImpl });
  assert.equal(result.models[0].priceIn, null);
  assert.equal(result.models[0].priceOut, null);
});

test('discoverModels in openrouter format treats negative or non-numeric cache prices as unknown', async () => {
  const { fetchImpl } = fakeFetch(200, { data: [{ id: 'x/y', name: 'X', pricing: { prompt: '0.000001', completion: '0.000002', input_cache_read: '-1', input_cache_write: 'abc' } }] });
  const result = await discoverModels(openrouterProvider, 'https://openrouter.ai/api', { fetchImpl });
  assert.equal(result.models[0].cacheReadPrice, null);
  assert.equal(result.models[0].cacheWritePrice, null);
});
