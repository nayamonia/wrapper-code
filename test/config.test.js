import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvFile, serializeEnvFile } from '../src/config.js';

test('parseEnvFile reads KEY=value, skips comments and blank lines, trims whitespace', () => {
  const text = '# header\n\nANTHROPIC_AUTH_TOKEN=sk-abc\n  WRAPPER_CODE_PROFILE = flash-1m \n';
  assert.deepEqual(parseEnvFile(text), {
    ANTHROPIC_AUTH_TOKEN: 'sk-abc',
    WRAPPER_CODE_PROFILE: 'flash-1m',
  });
});

test('parseEnvFile accepts CRLF line endings without leaking \\r into values', () => {
  assert.deepEqual(parseEnvFile('A=1\r\nB=two\r\n'), { A: '1', B: 'two' });
});

test('parseEnvFile splits on the first = only', () => {
  assert.deepEqual(parseEnvFile('K=a=b==\nURL=http://x?y=1'), { K: 'a=b==', URL: 'http://x?y=1' });
});

test('parseEnvFile throws with the line number on a malformed line', () => {
  assert.throws(() => parseEnvFile('OK=1\nnot a pair\n'), /line 2/);
  assert.throws(() => parseEnvFile('=novalue\n'), /line 1/);
  assert.throws(() => parseEnvFile('BAD KEY=1\n'), /line 1/);
});

test('serializeEnvFile writes a header comment and round-trips through parseEnvFile', () => {
  const values = { ANTHROPIC_AUTH_TOKEN: 'sk-abc', WRAPPER_CODE_PROFILE: 'v4-pro' };
  const text = serializeEnvFile(values, { header: 'wrapper-code — deepseek' });
  assert.ok(text.startsWith('# wrapper-code — deepseek\n'));
  assert.ok(text.endsWith('\n'));
  assert.deepEqual(parseEnvFile(text), values);
});
