import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, validateProvider } from '../src/catalog.js';

const valid = () => ({
  id: 'x', name: 'X', docs: 'https://x', credential: { env: 'ANTHROPIC_AUTH_TOKEN', label: 'API key', help: 'h' },
  env: { ANTHROPIC_BASE_URL: 'https://x/anthropic' },
  profiles: { p: { label: 'P', env: { ANTHROPIC_MODEL: 'm' } } },
  defaultProfile: 'p', test: { method: 'GET', url: 'https://x/models', auth: 'bearer' }, editableBaseUrl: false,
});

test('validateProvider accepts a valid provider', () => {
  assert.doesNotThrow(() => validateProvider(valid()));
});

test('validateProvider accepts credential: null', () => {
  assert.doesNotThrow(() => validateProvider({ ...valid(), credential: null }));
});

test('validateProvider rejects a defaultProfile that is not in profiles', () => {
  assert.throws(() => validateProvider({ ...valid(), defaultProfile: 'nope' }), /defaultProfile/);
});

test('validateProvider rejects missing id, env, profiles, test', () => {
  assert.throws(() => validateProvider({ ...valid(), id: '' }), /id/);
  assert.throws(() => validateProvider({ ...valid(), env: null }), /env/);
  assert.throws(() => validateProvider({ ...valid(), profiles: {} }), /profiles/);
  assert.throws(() => validateProvider({ ...valid(), test: undefined }), /test/);
});

test('validateProvider rejects a credential without env', () => {
  assert.throws(() => validateProvider({ ...valid(), credential: { label: 'k' } }), /credential/);
});

test('loadCatalog loads deepseek with the documented values', async () => {
  const catalog = await loadCatalog();
  const ds = catalog.get('deepseek');
  assert.ok(ds, 'deepseek provider present');
  assert.equal(ds.name, 'DeepSeek');
  assert.equal(ds.credential.env, 'ANTHROPIC_AUTH_TOKEN');
  assert.equal(ds.env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(ds.env.CLAUDE_CODE_EFFORT_LEVEL, 'max');
  assert.equal(ds.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '786432');
  assert.equal(ds.defaultProfile, 'flash-1m');
  assert.deepEqual(ds.profiles['flash-1m'].env, {
    ANTHROPIC_MODEL: 'deepseek-flash[1m]',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-flash[1m]',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-flash[1m]',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-flash',
    CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
  });
  assert.equal(ds.profiles['v4-pro'].env.ANTHROPIC_MODEL, 'deepseek-v4-pro');
  assert.equal(ds.test.url, 'https://api.deepseek.com/models');
  assert.equal(ds.editableBaseUrl, false);
});

test('every catalog entry is valid and keyed by its id', async () => {
  const catalog = await loadCatalog();
  assert.ok(catalog.size >= 1);
  for (const [id, provider] of catalog) {
    assert.equal(id, provider.id);
    assert.doesNotThrow(() => validateProvider(provider));
  }
});

const validModels = () => ({
  id: 'y', name: 'Y', docs: 'https://y', credential: null,
  env: { ANTHROPIC_BASE_URL: 'http://localhost:1', ANTHROPIC_AUTH_TOKEN: 'y' },
  models: { discoverPath: '/api/tags', requireCapability: 'tools', envKeys: ['ANTHROPIC_MODEL'], note: 'n' },
  test: { method: 'GET', path: '/api/tags', auth: 'none' }, editableBaseUrl: true,
});

test('validateProvider accepts a models provider without profiles', () => {
  assert.doesNotThrow(() => validateProvider(validModels()));
});

test('validateProvider rejects a provider with neither profiles nor models', () => {
  const p = validModels();
  delete p.models;
  assert.throws(() => validateProvider(p), /profiles or models/);
});

test('validateProvider rejects a provider with both profiles and models', () => {
  assert.throws(() => validateProvider({ ...valid(), models: validModels().models }), /not both/);
});

test('validateProvider rejects models without discoverPath or envKeys', () => {
  assert.throws(() => validateProvider({ ...validModels(), models: { envKeys: ['A'] } }), /discoverPath/);
  assert.throws(() => validateProvider({ ...validModels(), models: { discoverPath: '/x', envKeys: [] } }), /envKeys/);
});

test('validateProvider accepts test.path instead of test.url and rejects neither', () => {
  assert.doesNotThrow(() => validateProvider({ ...valid(), test: { method: 'GET', path: '/models', auth: 'bearer' } }));
  assert.throws(() => validateProvider({ ...valid(), test: { method: 'GET', auth: 'bearer' } }), /test/);
});

test('loadCatalog loads ollama with the documented values', async () => {
  const catalog = await loadCatalog();
  const ol = catalog.get('ollama');
  assert.ok(ol, 'ollama provider present');
  assert.equal(ol.name, 'Ollama');
  assert.equal(ol.credential, null);
  assert.equal(ol.editableBaseUrl, true);
  assert.equal(ol.env.ANTHROPIC_BASE_URL, 'http://localhost:11434');
  assert.equal(ol.env.ANTHROPIC_AUTH_TOKEN, 'ollama');
  assert.equal(ol.models.discoverPath, '/api/tags');
  assert.equal(ol.models.requireCapability, 'tools');
  assert.deepEqual(ol.models.envKeys, [
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'CLAUDE_CODE_SUBAGENT_MODEL',
  ]);
  assert.equal(ol.test.path, '/api/tags');
  assert.equal(ol.test.auth, 'none');
  assert.equal('profiles' in ol, false);
});
