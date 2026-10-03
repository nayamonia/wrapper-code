import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSplash, splashLines, showSplash, SPLASH_WIDTH, BAR_STEPS } from '../src/splash.js';
import { launchBanner } from '../src/credits.js';

function out({ isTTY = true, columns = 120 } = {}) {
  const chunks = [];
  return { isTTY, columns, write: (s) => { chunks.push(String(s)); return true; }, text: () => chunks.join('') };
}
const ARGS = { version: '0.1.0', providerName: 'DeepSeek', selection: 'flash-1m' };
const noSleep = async () => {};

test('shouldSplash is true only for a wide color TTY without opt-outs', () => {
  const env = { COLORTERM: 'truecolor', TERM: 'xterm-256color' };
  assert.equal(shouldSplash({ stdout: out(), env }), true);
  assert.equal(shouldSplash({ stdout: out({ isTTY: false }), env }), false);
  assert.equal(shouldSplash({ stdout: out(), env: { ...env, NO_COLOR: '1' } }), false);
  assert.equal(shouldSplash({ stdout: out(), env: { ...env, WRAPPER_CODE_NO_SPLASH: '1' } }), false);
  assert.equal(shouldSplash({ stdout: out(), env: { ...env, TERM: 'dumb' } }), false);
  assert.equal(shouldSplash({ stdout: out({ columns: 60 }), env }), false);
  assert.equal(shouldSplash({ stdout: out({ columns: SPLASH_WIDTH }), env }), true);
  assert.equal(shouldSplash({ stdout: out({ columns: undefined }), env }), true);
});

test('splashLines is 8 lines wide enough for the sprite plus text, with the bar last', () => {
  const { lines, bar } = splashLines({ ...ARGS, truecolor: true });
  assert.equal(lines.length, 8);
  const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  assert.ok(lines.some((l) => l.includes('▀') || l.includes('▄')), 'sprite rendered');
  assert.ok(lines.some((l) => plain(l).includes('v0.1.0')));
  assert.ok(lines.some((l) => plain(l).includes('DeepSeek · flash-1m')));
  assert.ok(lines.some((l) => plain(l).includes('MIT · Gabriel Fernandes · cd2.com.br')));
  assert.equal(bar(0), lines[7]);
  assert.ok(plain(bar(BAR_STEPS)).includes('█'.repeat(BAR_STEPS)));
  assert.ok(plain(bar(0)).includes('░'.repeat(BAR_STEPS)));
  assert.ok(plain(bar(BAR_STEPS)).includes('starting claude'));
  for (const l of lines) assert.ok(plain(l).length <= SPLASH_WIDTH, `line too wide: ${plain(l).length}`);
  for (const l of lines) if (/\x1b\[/.test(l)) assert.ok(l.endsWith('\x1b[0m'), 'colored line resets');
});

test('splashLines never hides the cursor and omits the selection separator when empty', () => {
  const { lines } = splashLines({ ...ARGS, selection: '', truecolor: false });
  const all = lines.join('\n');
  assert.doesNotMatch(all, /\x1b\[\?25l/);
  assert.doesNotMatch(all, /undefined/);
  assert.match(all.replace(/\x1b\[[0-9;]*m/g, ''), /DeepSeek\s{2,}/);
  assert.doesNotMatch(all, /DeepSeek · /);
});

test('showSplash prints the plain banner when the splash is not allowed', async () => {
  const stdout = out({ isTTY: false });
  const mode = await showSplash({ stdout, env: {}, ...ARGS, sleep: noSleep });
  assert.equal(mode, 'plain');
  assert.equal(stdout.text(), `${launchBanner({ version: '0.1.0', providerName: 'DeepSeek', profileId: 'flash-1m' })}\n`);
});

test('showSplash writes the screen, animates the bar in place and ends with a blank line', async () => {
  const stdout = out();
  const sleeps = [];
  const mode = await showSplash({ stdout, env: { COLORTERM: 'truecolor' }, ...ARGS, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(mode, 'splash');
  const text = stdout.text();
  assert.equal(sleeps.length, BAR_STEPS);
  assert.ok(sleeps.every((ms) => ms === 50));
  assert.equal((text.match(/\r/g) || []).length, BAR_STEPS, 'one carriage return per bar step');
  assert.ok(text.endsWith('\n\n'));
  assert.doesNotMatch(text, /\x1b\[\?25l/);
  assert.ok(text.includes('█'.repeat(BAR_STEPS)));
});
