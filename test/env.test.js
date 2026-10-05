import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError } from '../src/config.js';
import { buildEnv, derivedEnv, isConfigured, modelEnv } from '../src/env.js';
import deepseek from '../src/providers/deepseek.js';
import ollama from '../src/providers/ollama.js';
import claude from '../src/providers/claude.js';

test('buildEnv layers process env < provider env < profile env < file values', () => {
  const env = buildEnv({
    provider: deepseek,
    fileValues: { ANTHROPIC_AUTH_TOKEN: 'sk-file', WRAPPER_CODE_PROFILE: 'v4-pro', CLAUDE_CODE_EFFORT_LEVEL: 'high' },
    baseEnv: { PATH: '/bin', ANTHROPIC_BASE_URL: 'https://shell-value', HOME: '/h' },
  });
  assert.equal(env.PATH, '/bin');
  assert.equal(env.HOME, '/h');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(env.ANTHROPIC_MODEL, 'deepseek-v4-pro');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'sk-file');
  assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, 'high');
});

test('buildEnv uses defaultProfile when the file has no WRAPPER_CODE_PROFILE', () => {
  const env = buildEnv({ provider: deepseek, fileValues: { ANTHROPIC_AUTH_TOKEN: 'sk' }, baseEnv: {} });
  assert.equal(env.ANTHROPIC_MODEL, 'deepseek-flash[1m]');
});

test('buildEnv removes ANTHROPIC_API_KEY and WRAPPER_CODE_PROFILE from the child env', () => {
  const env = buildEnv({
    provider: deepseek,
    fileValues: { ANTHROPIC_AUTH_TOKEN: 'sk', WRAPPER_CODE_PROFILE: 'flash-1m' },
    baseEnv: { ANTHROPIC_API_KEY: 'real-anthropic-key' },
  });
  assert.equal('ANTHROPIC_API_KEY' in env, false);
  assert.equal('WRAPPER_CODE_PROFILE' in env, false);
});

test('buildEnv does not mutate baseEnv', () => {
  const baseEnv = { ANTHROPIC_API_KEY: 'k' };
  buildEnv({ provider: deepseek, fileValues: {}, baseEnv });
  assert.equal(baseEnv.ANTHROPIC_API_KEY, 'k');
});

test('buildEnv throws a setup hint on an unknown profile', () => {
  assert.throws(
    () => buildEnv({ provider: deepseek, fileValues: { WRAPPER_CODE_PROFILE: 'ghost' }, baseEnv: {} }),
    /wrapper-code setup deepseek/,
  );
});

test('derivedEnv merges provider env and profile env', () => {
  const env = derivedEnv(deepseek, 'flash-1m');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(env.ANTHROPIC_MODEL, 'deepseek-flash[1m]');
  assert.equal('ANTHROPIC_AUTH_TOKEN' in env, false);
});

test('isConfigured is true only when the credential env is present and non-empty', () => {
  assert.equal(isConfigured(deepseek, {}), false);
  assert.equal(isConfigured(deepseek, { ANTHROPIC_AUTH_TOKEN: '' }), false);
  assert.equal(isConfigured(deepseek, { ANTHROPIC_AUTH_TOKEN: 'sk' }), true);
  assert.equal(isConfigured({ ...deepseek, credential: null }, {}), true);
});

test('buildEnv removes shell vars that reroute Claude Code to another backend', () => {
  const env = buildEnv({
    provider: deepseek,
    fileValues: { ANTHROPIC_AUTH_TOKEN: 'sk' },
    baseEnv: { CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '1', PATH: '/bin' },
  });
  for (const key of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
    assert.equal(key in env, false, key);
  }
  assert.equal(env.PATH, '/bin');
});

test('unknown profile (including prototype names) is a ConfigError with the setup hint', () => {
  for (const id of ['ghost', 'constructor']) {
    assert.throws(
      () => buildEnv({ provider: deepseek, fileValues: { WRAPPER_CODE_PROFILE: id }, baseEnv: {} }),
      (err) => err instanceof ConfigError && /wrapper-code setup deepseek/.test(err.message),
    );
  }
});

test('modelEnv sets every envKeys entry to the model name on top of provider env', () => {
  const env = modelEnv(ollama, 'qwen3-code:14b');
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://localhost:11434');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'ollama');
  for (const key of ollama.models.envKeys) assert.equal(env[key], 'qwen3-code:14b');
});

test('buildEnv expands WRAPPER_CODE_MODEL for a models provider and keeps file overrides', () => {
  const env = buildEnv({
    provider: ollama,
    fileValues: { WRAPPER_CODE_MODEL: 'gemma3', ANTHROPIC_BASE_URL: 'http://10.0.0.5:11434', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '40960' },
    baseEnv: { PATH: '/bin' },
  });
  assert.equal(env.PATH, '/bin');
  assert.equal(env.ANTHROPIC_MODEL, 'gemma3');
  assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL, 'gemma3');
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://10.0.0.5:11434');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'ollama');
  assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '40960');
  assert.equal('WRAPPER_CODE_MODEL' in env, false);
});

test('buildEnv throws a ConfigError with the setup hint when a models provider has no model', () => {
  assert.throws(
    () => buildEnv({ provider: ollama, fileValues: { ANTHROPIC_BASE_URL: 'http://localhost:11434' }, baseEnv: {} }),
    (err) => err instanceof ConfigError && /wrapper-code setup ollama/.test(err.message),
  );
});

test('isConfigured requires WRAPPER_CODE_MODEL for a models provider', () => {
  assert.equal(isConfigured(ollama, {}), false);
  assert.equal(isConfigured(ollama, { ANTHROPIC_BASE_URL: 'http://localhost:11434' }), false);
  assert.equal(isConfigured(ollama, { WRAPPER_CODE_MODEL: '' }), false);
  assert.equal(isConfigured(ollama, { WRAPPER_CODE_MODEL: 'qwen3-code:14b' }), true);
});

test('buildEnv never passes any WRAPPER_CODE_* key to the child, from the file or the shell', () => {
  const env = buildEnv({
    provider: deepseek,
    fileValues: { ANTHROPIC_AUTH_TOKEN: 'sk', WRAPPER_CODE_PRICE_IN: '1', WRAPPER_CODE_PRICE_CACHE_READ: '0.1', WRAPPER_CODE_SOMETHING_NEW: 'x' },
    baseEnv: { WRAPPER_CODE_NO_SPLASH: '1', WRAPPER_CODE_USAGE_LINGER_MS: '200', PATH: '/bin' },
  });
  for (const key of Object.keys(env)) assert.doesNotMatch(key, /^WRAPPER_CODE_/);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'sk');
  assert.equal(env.PATH, '/bin');
});

test('a passthrough provider is always configured and its env is the shell env, untouched', () => {
  assert.equal(isConfigured(claude, {}), true);
  const baseEnv = {
    PATH: '/bin', ANTHROPIC_API_KEY: 'sk-ant', ANTHROPIC_BASE_URL: 'https://corp-proxy', ANTHROPIC_MODEL: 'opus',
    CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '1', WRAPPER_CODE_NO_SPLASH: '1',
  };
  const env = buildEnv({ provider: claude, fileValues: { ANTHROPIC_AUTH_TOKEN: 'stray', WRAPPER_CODE_PROFILE: 'x' }, baseEnv });
  const { WRAPPER_CODE_NO_SPLASH, ...expected } = baseEnv;
  assert.deepEqual(env, expected);
  assert.notEqual(env, baseEnv);
});
