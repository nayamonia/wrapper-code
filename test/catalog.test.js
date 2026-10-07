import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadCatalog, validateProvider, resolveProvider, BILLINGS } from '../src/catalog.js';

const valid = () => ({
  id: 'x', name: 'X', family: 'x', billing: 'payg', docs: 'https://x', credential: { env: 'ANTHROPIC_AUTH_TOKEN', label: 'API key', help: 'h' },
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
  id: 'y', name: 'Y', family: 'y', billing: 'local', docs: 'https://y', credential: null,
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

test('validateProvider accepts test.headers and test.body objects and rejects non-objects', () => {
  const withBody = { ...valid(), test: { method: 'POST', path: '/v1/messages', auth: 'bearer', headers: { 'anthropic-version': '2023-06-01' }, body: { max_tokens: 1 } } };
  assert.doesNotThrow(() => validateProvider(withBody));
  assert.throws(() => validateProvider({ ...withBody, test: { ...withBody.test, headers: 'nope' } }), /test\.headers/);
  assert.throws(() => validateProvider({ ...withBody, test: { ...withBody.test, body: ['x'] } }), /test\.body/);
  assert.throws(() => validateProvider({ ...withBody, test: { ...withBody.test, body: 'raw' } }), /test\.body/);
});

test('loadCatalog loads qwencloud with the Qwen Cloud pay-as-you-go values', async () => {
  const catalog = await loadCatalog();
  assert.equal(catalog.has('qwen'), false, 'the Coding Plan provider is gone');
  const qc = catalog.get('qwencloud');
  assert.ok(qc, 'qwencloud provider present');
  assert.equal(qc.name, 'Qwen Cloud');
  assert.equal(qc.docs, 'https://docs.qwencloud.com/developer-guides/clients-and-developer-tools/claude-code');
  assert.equal(qc.credential.env, 'ANTHROPIC_AUTH_TOKEN');
  assert.equal(qc.credential.label, 'Qwen Cloud API key');
  assert.match(qc.credential.help, /home\.qwencloud\.com\/api-keys/);
  assert.doesNotMatch(qc.credential.help, /Coding Plan/);
  assert.deepEqual(qc.env, { ANTHROPIC_BASE_URL: 'https://maas.qwencloudapi.com/apps/anthropic' });
  assert.deepEqual(Object.keys(qc.profiles), ['pay-as-you-go']);
  assert.equal(qc.defaultProfile, 'pay-as-you-go');
  assert.deepEqual(qc.profiles['pay-as-you-go'].env, {
    ANTHROPIC_MODEL: 'qwen3.8-max',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'qwen3.8-max',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'qwen3.8-flash',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen3.6-flash',
    CLAUDE_CODE_SUBAGENT_MODEL: 'qwen3.8-flash',
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: '983616',
  });
  // auto exists only on the Token Plan endpoints; pay-as-you-go answers 400 Model not exist.
  assert.equal(Object.values(qc.profiles['pay-as-you-go'].env).includes('auto'), false);
  assert.doesNotMatch(qc.profiles['pay-as-you-go'].label, /automatic routing|auto\b/);
  assert.equal(qc.test.method, 'POST');
  assert.equal(qc.test.path, '/v1/messages');
  assert.equal(qc.test.auth, 'bearer');
  assert.equal(qc.test.headers['anthropic-version'], '2023-06-01');
  assert.equal(qc.test.headers['content-type'], 'application/json');
  assert.deepEqual(qc.test.body, { model: 'qwen3.6-flash', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
  assert.equal(Object.isFrozen(qc.test.body), true, 'shared body object must not be mutable');
  assert.equal(qc.editableBaseUrl, false);
});

const roles = (main, fast) => ({
  ANTHROPIC_MODEL: main,
  ANTHROPIC_DEFAULT_OPUS_MODEL: main,
  ANTHROPIC_DEFAULT_SONNET_MODEL: main,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: fast,
  CLAUDE_CODE_SUBAGENT_MODEL: fast,
});

test('loadCatalog loads qwencloud-token with the Qwen Cloud Token Plan values, five profiles and the alibaba alias', async () => {
  const catalog = await loadCatalog();
  for (const gone of ['alibaba', 'alibaba-token', 'qwen-token']) assert.equal(catalog.has(gone), false, `${gone} is not an id`);
  const qt = catalog.get('qwencloud-token');
  assert.ok(qt, 'qwencloud-token provider present');
  assert.equal(qt.name, 'Qwen Cloud Token Plan');
  assert.equal(qt.family, 'qwen');
  assert.equal(qt.billing, 'plan');
  assert.deepEqual(qt.aliases, ['alibaba']);
  assert.equal(qt.docs, 'https://docs.qwencloud.com/developer-guides/clients-and-developer-tools/claude-code');
  assert.equal(qt.credential.env, 'ANTHROPIC_AUTH_TOKEN');
  assert.match(qt.credential.label, /Token Plan/);
  assert.match(qt.credential.help, /sk-sp-/);
  assert.match(qt.credential.help, /wrapper-code qwencloud\b/);
  assert.deepEqual(qt.env, { ANTHROPIC_BASE_URL: 'https://token-plan.maas.qwencloudapi.com/apps/anthropic' });
  assert.deepEqual(Object.keys(qt.profiles), ['auto', 'qwen-max', 'qwen-plus', 'deepseek-pro', 'glm']);
  assert.equal(qt.defaultProfile, 'auto');
  assert.deepEqual(qt.profiles.auto.env, {
    ANTHROPIC_MODEL: 'auto',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'qwen3.8-max',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'qwen3.8-flash',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen3.6-flash',
    CLAUDE_CODE_SUBAGENT_MODEL: 'auto',
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: '983616',
  });
  assert.deepEqual(qt.profiles['qwen-max'].env, roles('qwen3.8-max', 'qwen3.8-flash'));
  assert.deepEqual(qt.profiles['qwen-plus'].env, roles('qwen3.7-plus', 'qwen3.7-plus'));
  assert.deepEqual(qt.profiles['deepseek-pro'].env, roles('deepseek-v4-pro', 'deepseek-v4.1-flash'));
  assert.deepEqual(qt.profiles.glm.env, roles('glm-5.3', 'glm-5.3'));
  assert.equal(qt.test.method, 'POST');
  assert.equal(qt.test.path, '/v1/messages');
  assert.equal(qt.test.auth, 'bearer');
  assert.equal(qt.test.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(qt.test.body, { model: 'qwen3.7-plus', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
  assert.equal(Object.isFrozen(qt.test.body), true);
  assert.equal(qt.editableBaseUrl, false);
});

test('help texts no longer mention the Coding Plan or the old ids', async () => {
  const catalog = await loadCatalog();
  const token = catalog.get('qwencloud-token').credential.help;
  assert.match(token, /sk-sp-/);
  assert.doesNotMatch(token, /Coding Plan|wrapper-code qwen\b|alibaba-token/);
  const qwencloud = catalog.get('qwencloud').credential.help;
  assert.doesNotMatch(qwencloud, /Coding Plan|alibaba-token/);
  assert.deepEqual([...catalog.keys()].sort(), ['claude', 'deepseek', 'kimi', 'kimi-code', 'ollama', 'openrouter', 'qwencloud', 'qwencloud-token']);
});

test('validateProvider accepts models.format ollama/openrouter and models.emptyHint, rejects other formats', () => {
  const base = validModels();
  assert.doesNotThrow(() => validateProvider({ ...base, models: { ...base.models, format: 'ollama' } }));
  assert.doesNotThrow(() => validateProvider({ ...base, models: { ...base.models, format: 'openrouter', emptyHint: 'none' } }));
  assert.throws(() => validateProvider({ ...base, models: { ...base.models, format: 'openai' } }), /models\.format/);
  assert.throws(() => validateProvider({ ...base, models: { ...base.models, emptyHint: 7 } }), /models\.emptyHint/);
});

test('loadCatalog loads openrouter: key, gateway discovery flag, openrouter-format model discovery, free key test', async () => {
  const catalog = await loadCatalog();
  const or = catalog.get('openrouter');
  assert.ok(or, 'openrouter provider present');
  assert.equal(or.name, 'OpenRouter');
  assert.equal(or.docs, 'https://openrouter.ai/docs/guides/guides/claude-code-integration');
  assert.equal(or.credential.env, 'ANTHROPIC_AUTH_TOKEN');
  assert.equal(or.credential.label, 'OpenRouter API key');
  assert.match(or.credential.help, /openrouter\.ai\/keys/);
  assert.deepEqual(or.env, { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api', CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1' });
  assert.equal(or.models.format, 'openrouter');
  assert.equal(or.models.discoverPath, '/v1/models');
  assert.equal(or.models.requireCapability, 'tools');
  assert.deepEqual(or.models.envKeys, [
    'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL',
  ]);
  assert.match(or.models.note, /Anthropic models/);
  assert.equal(typeof or.models.emptyHint, 'string');
  assert.deepEqual(or.test, { method: 'GET', url: 'https://openrouter.ai/api/v1/key', auth: 'bearer' });
  assert.equal(or.editableBaseUrl, false);
  assert.equal('profiles' in or, false);
});

test('ollama carries its empty-list hint in the catalog', async () => {
  const catalog = await loadCatalog();
  assert.match(catalog.get('ollama').models.emptyHint, /ollama pull/);
});

test('validateProvider requires family as lowercase letters, digits and dashes', () => {
  assert.throws(() => validateProvider({ ...valid(), family: undefined }), /family/);
  assert.throws(() => validateProvider({ ...valid(), family: '' }), /family/);
  assert.throws(() => validateProvider({ ...valid(), family: 'Qwen' }), /family/);
  assert.throws(() => validateProvider({ ...valid(), family: 'qwen cloud' }), /family/);
  assert.doesNotThrow(() => validateProvider({ ...valid(), family: 'kimi-2' }));
});

test('validateProvider accepts only plan, payg and local as billing', () => {
  assert.deepEqual(BILLINGS, ['plan', 'payg', 'local']);
  for (const billing of BILLINGS) assert.doesNotThrow(() => validateProvider({ ...valid(), billing }));
  for (const billing of [undefined, '', 'gateway', 'cloud', 'PAYG']) {
    assert.throws(() => validateProvider({ ...valid(), billing }), /billing/);
  }
});

test('catalog family and billing per provider', async () => {
  const catalog = await loadCatalog();
  const actual = Object.fromEntries([...catalog.values()].map((p) => [p.id, `${p.family}/${p.billing}`]));
  assert.deepEqual(actual, {
    'qwencloud-token': 'qwen/plan',
    claude: 'anthropic/plan',
    deepseek: 'deepseek/payg',
    kimi: 'kimi/payg',
    'kimi-code': 'kimi/plan',
    ollama: 'local/local',
    openrouter: 'gateway/payg',
    qwencloud: 'qwen/payg',
  });
});

test('a passthrough provider needs no env, profiles, models or test, and cannot carry them', () => {
  const base = { id: 'native', name: 'Native', family: 'anthropic', billing: 'plan', docs: 'https://example.com', passthrough: true, credential: null };
  assert.doesNotThrow(() => validateProvider(base));
  for (const extra of [{ env: { A: '1' } }, { profiles: {} }, { models: {} }, { test: { url: 'https://x' } }, { credential: { env: 'K', label: 'Key' } }]) {
    assert.throws(() => validateProvider({ ...base, ...extra }), /passthrough/);
  }
  assert.throws(() => validateProvider({ ...base, passthrough: 'yes' }), /passthrough must be true/);
});

test('the claude provider is the passthrough one', async () => {
  const claude = (await loadCatalog()).get('claude');
  assert.equal(claude.passthrough, true);
  assert.equal(claude.name, 'Claude Code');
});

test('validateProvider accepts optional aliases and rejects malformed ones', () => {
  assert.doesNotThrow(() => validateProvider({ ...valid(), aliases: ['old-x', 'x2'] }));
  for (const aliases of [[], 'old', ['Old'], ['a b'], [''], [7], ['dup', 'dup']]) {
    assert.throws(() => validateProvider({ ...valid(), aliases }), /aliases/);
  }
});

async function catalogDir(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'wc-catalog-'));
  for (const [name, provider] of Object.entries(files)) {
    await writeFile(path.join(dir, name), `export default ${JSON.stringify(provider)};\n`);
  }
  return pathToFileURL(`${dir}/`);
}

test('loadCatalog rejects an alias that is another provider id or claimed twice', async () => {
  const a = { ...valid(), id: 'a', aliases: ['b'] };
  const b = { ...valid(), id: 'b' };
  await assert.rejects(loadCatalog(await catalogDir({ 'a.js': a, 'b.js': b })), /alias "b" is already a provider id/);
  const c = { ...valid(), id: 'c', aliases: ['old'] };
  const d = { ...valid(), id: 'd', aliases: ['old'] };
  await assert.rejects(loadCatalog(await catalogDir({ 'c.js': c, 'd.js': d })), /alias "old" is also claimed by "c"/);
});

test('resolveProvider finds by id or alias, case-insensitively, else undefined', () => {
  const p = { ...valid(), id: 'new-id', aliases: ['old-id'] };
  const catalog = new Map([['new-id', p], ['x', valid()]]);
  assert.equal(resolveProvider(catalog, 'new-id'), p);
  assert.equal(resolveProvider(catalog, 'old-id'), p);
  assert.equal(resolveProvider(catalog, 'OLD-ID'), p);
  assert.equal(resolveProvider(catalog, 'X'), catalog.get('x'));
  assert.equal(resolveProvider(catalog, 'nope'), undefined);
  assert.equal(resolveProvider(catalog, ''), undefined);
  assert.equal(resolveProvider(catalog, undefined), undefined);
});

test('loadCatalog loads kimi with the Moonshot guide values', async () => {
  const catalog = await loadCatalog();
  const km = catalog.get('kimi');
  assert.ok(km, 'kimi provider present');
  assert.equal(km.name, 'Kimi (Moonshot API)');
  assert.equal(km.family, 'kimi');
  assert.equal(km.billing, 'payg');
  assert.equal(km.docs, 'https://platform.kimi.ai/docs/guide/claude-code-kimi');
  assert.equal(km.credential.env, 'ANTHROPIC_AUTH_TOKEN');
  assert.match(km.credential.label, /Moonshot API key/);
  assert.match(km.credential.help, /wrapper-code kimi-code/);
  assert.deepEqual(km.env, {
    ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic',
    CLAUDE_CODE_EFFORT_LEVEL: 'max',
  });
  assert.deepEqual(Object.keys(km.profiles), ['k3-1m', 'k2.7-code']);
  assert.equal(km.defaultProfile, 'k3-1m');
  assert.deepEqual(km.profiles['k3-1m'].env, {
    ANTHROPIC_MODEL: 'kimi-k3[1m]',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k3[1m]',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k3[1m]',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-k2.7-code',
    ANTHROPIC_DEFAULT_FABLE_MODEL: 'kimi-k3[1m]',
    CLAUDE_CODE_SUBAGENT_MODEL: 'kimi-k3[1m]',
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
  });
  assert.deepEqual(km.profiles['k2.7-code'].env, {
    ANTHROPIC_MODEL: 'kimi-k2.7-code',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k2.7-code',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k2.7-code',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-k2.7-code',
    ANTHROPIC_DEFAULT_FABLE_MODEL: 'kimi-k2.7-code',
    CLAUDE_CODE_SUBAGENT_MODEL: 'kimi-k2.7-code',
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: '262144',
  });
  assert.match(km.profiles['k2.7-code'].label, /thinking/i, 'label warns that K2.7 Code needs thinking on');
  assert.deepEqual(km.test, { method: 'GET', url: 'https://api.moonshot.ai/v1/models', auth: 'bearer' });
  assert.equal(km.editableBaseUrl, false);
});

const sameModel = (model, window) => ({
  ANTHROPIC_MODEL: model,
  ANTHROPIC_DEFAULT_OPUS_MODEL: model,
  ANTHROPIC_DEFAULT_SONNET_MODEL: model,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
  ANTHROPIC_DEFAULT_FABLE_MODEL: model,
  CLAUDE_CODE_SUBAGENT_MODEL: model,
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: window,
  CLAUDE_CODE_MAX_CONTEXT_TOKENS: window,
});

test('loadCatalog loads kimi-code with the Kimi Code guide values', async () => {
  const catalog = await loadCatalog();
  const kc = catalog.get('kimi-code');
  assert.ok(kc, 'kimi-code provider present');
  assert.equal(kc.name, 'Kimi Code');
  assert.equal(kc.family, 'kimi');
  assert.equal(kc.billing, 'plan');
  assert.equal(kc.docs, 'https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html');
  assert.equal(kc.credential.env, 'ANTHROPIC_AUTH_TOKEN');
  assert.match(kc.credential.label, /Kimi Code API key/);
  assert.match(kc.credential.help, /wrapper-code kimi\b/);
  assert.deepEqual(kc.env, {
    ANTHROPIC_BASE_URL: 'https://api.kimi.com/coding',
    CLAUDE_CODE_EFFORT_LEVEL: 'high',
  });
  assert.deepEqual(Object.keys(kc.profiles), ['k3-1m', 'k3-256k']);
  assert.equal(kc.defaultProfile, 'k3-1m');
  assert.deepEqual(kc.profiles['k3-1m'].env, sameModel('k3[1m]', '1048576'));
  assert.deepEqual(kc.profiles['k3-256k'].env, sameModel('k3-256k', '262144'));
  assert.deepEqual(kc.test, { method: 'GET', path: '/v1/models', auth: 'bearer' });
  assert.equal(kc.editableBaseUrl, false);
});
