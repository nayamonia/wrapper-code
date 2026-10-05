import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareProviders, selectionOf, formatTable } from '../src/list.js';

test('formatTable sizes each column to its widest cell, two spaces apart, no trailing spaces', () => {
  const text = formatTable([
    ['FAMILY', 'PROVIDER', 'BILLING', 'STATUS', 'SELECTION'],
    ['beta', 'beta-plan', 'plan', 'configured', 'a'],
    ['beta', 'beta', 'payg', 'not configured', '-'],
    ['local', 'loc', 'local', 'configured', 'qwen3-coder:30b'],
    ['zz', 'zeta', 'payg', 'configured', 'b'],
  ]);
  assert.equal(text, [
    'FAMILY  PROVIDER   BILLING  STATUS          SELECTION',
    'beta    beta-plan  plan     configured      a',
    'beta    beta       payg     not configured  -',
    'local   loc        local    configured      qwen3-coder:30b',
    'zz      zeta       payg     configured      b',
  ].join('\n') + '\n');
});

test('formatTable never pads the last column, even when it is the widest', () => {
  const text = formatTable([['A', 'B'], ['x', 'openrouter/some-vendor/a-very-long-model-id:free'], ['y', '-']]);
  assert.doesNotMatch(text, / +$/m);
  assert.match(text, /^y  -$/m);
});

test('compareProviders orders by family, then plan, payg, local, then id', () => {
  const p = (id, family, billing) => ({ id, family, billing });
  const sorted = [
    p('qwencloud', 'qwen', 'payg'),
    p('ollama', 'local', 'local'),
    p('alibaba', 'qwen', 'plan'),
    p('openrouter', 'gateway', 'payg'),
    p('deepseek', 'deepseek', 'payg'),
    p('aaa', 'qwen', 'payg'),
  ].sort(compareProviders).map((x) => x.id);
  assert.deepEqual(sorted, ['deepseek', 'openrouter', 'ollama', 'alibaba', 'aaa', 'qwencloud']);
});

test('selectionOf follows the launch rule: saved model, saved profile, or the default profile', () => {
  const profiled = { profiles: { a: {}, b: {} }, defaultProfile: 'a' };
  const modeled = { models: { envKeys: ['ANTHROPIC_MODEL'] } };
  assert.equal(selectionOf(profiled, {}), 'a');
  assert.equal(selectionOf(profiled, { WRAPPER_CODE_PROFILE: 'b' }), 'b');
  assert.equal(selectionOf(modeled, { WRAPPER_CODE_MODEL: 'qwen3-coder' }), 'qwen3-coder');
  assert.equal(selectionOf(modeled, {}), undefined);
});

test('selectionOf is empty for a passthrough provider', () => {
  assert.equal(selectionOf({ passthrough: true }, { WRAPPER_CODE_PROFILE: 'x' }), '');
});
