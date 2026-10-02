import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnv, derivedEnv, isConfigured } from '../src/env.js';
import deepseek from '../src/providers/deepseek.js';

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
