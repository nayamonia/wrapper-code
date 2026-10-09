import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_VARS, accountEnv } from '../src/accounts/env.js';

test('accountEnv sets CLAUDE_CONFIG_DIR and removes every variable that outranks the login', () => {
  const base = {
    PATH: '/bin', ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_OAUTH_TOKEN: 'o',
    CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '', WRAPPER_CODE_X: 'y',
  };
  const { env, removed, replacedConfigDir } = accountEnv(base, '/acct');
  assert.equal(env.CLAUDE_CONFIG_DIR, '/acct');
  assert.equal(env.PATH, '/bin');
  for (const key of [...AUTH_VARS, 'WRAPPER_CODE_X']) assert.equal(key in env, false, key);
  assert.deepEqual(removed, ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK']);
  assert.equal(replacedConfigDir, false);
  assert.equal(base.ANTHROPIC_API_KEY, 'k', 'the input is not mutated');
});

test('accountEnv reports a shell CLAUDE_CONFIG_DIR it replaced', () => {
  assert.equal(accountEnv({ CLAUDE_CONFIG_DIR: '/mine' }, '/acct').replacedConfigDir, true);
  assert.equal(accountEnv({ CLAUDE_CONFIG_DIR: '/acct' }, '/acct').replacedConfigDir, false);
});
