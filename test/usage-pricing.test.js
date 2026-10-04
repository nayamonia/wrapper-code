import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePrices, estimateCost, normalizeModelId } from '../src/usage/pricing.js';
import { loadCatalog } from '../src/catalog.js';

const EVENT = { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 2_000_000, cacheCreationTokens: 100_000 };

test('normalizeModelId strips a trailing [1m]', () => {
  assert.equal(normalizeModelId('deepseek-flash[1m]'), 'deepseek-flash');
  assert.equal(normalizeModelId('deepseek-flash'), 'deepseek-flash');
  assert.equal(normalizeModelId('x[1m]y'), 'x[1m]y');
});

test('estimateCost applies in/out/cache prices, falling back to the input price for cache tiers', () => {
  assert.equal(estimateCost(EVENT, { in: 2, out: 10 }), 2 + 5 + 4 + 0.2);
  assert.equal(estimateCost(EVENT, { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 }), 2 + 5 + 0.4 + 0.25);
  assert.equal(estimateCost(EVENT, null), null);
  assert.equal(estimateCost({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }, { in: 0.3, out: 1.2 }), 0.0000015);
});

test('resolvePrices: env override wins over the catalog and ignores non-numeric values', async () => {
  const deepseek = (await loadCatalog()).get('deepseek');
  assert.deepEqual(resolvePrices({ provider: deepseek, fileValues: { WRAPPER_CODE_PRICE_IN: '1', WRAPPER_CODE_PRICE_OUT: '2', WRAPPER_CODE_PRICE_CACHE_READ: '0.1' }, model: 'deepseek-flash' }), { in: 1, out: 2, cacheRead: 0.1 });
  assert.deepEqual(resolvePrices({ provider: deepseek, fileValues: { WRAPPER_CODE_PRICE_IN: 'abc', WRAPPER_CODE_PRICE_OUT: '2' }, model: 'deepseek-flash' }), { in: 0.3, out: 1.2, cacheRead: 0.006 }, 'incomplete override falls through to the catalog');
});

test('resolvePrices: catalog table matches with and without the [1m] suffix', async () => {
  const deepseek = (await loadCatalog()).get('deepseek');
  assert.deepEqual(resolvePrices({ provider: deepseek, fileValues: {}, model: 'deepseek-flash[1m]' }), { in: 0.3, out: 1.2, cacheRead: 0.006 });
  assert.deepEqual(resolvePrices({ provider: deepseek, fileValues: {}, model: 'deepseek-v4-pro' }), { in: 1.32, out: 3.96, cacheRead: 0.044 });
});

test('resolvePrices: unknown model is null, free providers are zero', async () => {
  const catalog = await loadCatalog();
  assert.equal(resolvePrices({ provider: catalog.get('qwencloud'), fileValues: {}, model: 'auto' }), null);
  assert.deepEqual(resolvePrices({ provider: catalog.get('qwencloud'), fileValues: {}, model: 'qwen3.8-max' }), { in: 2, out: 6, cacheRead: 0.25 });
  assert.deepEqual(resolvePrices({ provider: catalog.get('ollama'), fileValues: {}, model: 'qwen3-code:14b' }), { in: 0, out: 0 });
  assert.equal(resolvePrices({ provider: catalog.get('alibaba'), fileValues: {}, model: 'qwen3.8-max' }), null, 'Token Plan is prepaid: no per-token price');
});
