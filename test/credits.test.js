import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREDITS, creditLine, launchBanner } from '../src/credits.js';

test('CREDITS carries the author identity and license', () => {
  assert.equal(CREDITS.name, 'Gabriel Fernandes');
  assert.equal(CREDITS.email, 'gabriel@cd2.com.br');
  assert.equal(CREDITS.github, 'https://github.com/nayamonia');
  assert.equal(CREDITS.site, 'https://cd2.com.br');
  assert.equal(CREDITS.license, 'MIT');
  assert.ok(Object.isFrozen(CREDITS));
});

test('creditLine mentions license, author, email, GitHub and site', () => {
  const line = creditLine();
  assert.match(line, /MIT/);
  assert.match(line, /Gabriel Fernandes/);
  assert.match(line, /gabriel@cd2\.com\.br/);
  assert.match(line, /github\.com\/nayamonia/);
  assert.match(line, /cd2\.com\.br/);
  assert.doesNotMatch(line, /\n/);
});

test('launchBanner is one line with version, provider, profile, license, author and site host', () => {
  const line = launchBanner({ version: '0.1.0', providerName: 'DeepSeek', profileId: 'flash-1m' });
  assert.equal(line, 'wrapper-code 0.1.0 · DeepSeek (flash-1m) · MIT · by Gabriel Fernandes · cd2.com.br');
});

test('launchBanner leaves the parentheses out when there is no profile', () => {
  const line = launchBanner({ version: '0.1.0', providerName: 'Claude Code', profileId: '' });
  assert.equal(line, 'wrapper-code 0.1.0 · Claude Code · MIT · by Gabriel Fernandes · cd2.com.br');
});
