import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../src/open.js';

function recorder() {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { on() {}, unref() {} };
  };
  return { calls, spawnImpl };
}

test('openBrowser uses open on macOS', () => {
  const { calls, spawnImpl } = recorder();
  assert.equal(openBrowser('http://127.0.0.1:1/?t=x', { platform: 'darwin', spawnImpl }), true);
  assert.deepEqual(calls[0].cmd, 'open');
  assert.deepEqual(calls[0].args, ['http://127.0.0.1:1/?t=x']);
  assert.equal(calls[0].opts.detached, true);
  assert.equal(calls[0].opts.stdio, 'ignore');
});

test('openBrowser uses xdg-open on Linux', () => {
  const { calls, spawnImpl } = recorder();
  openBrowser('http://u', { platform: 'linux', spawnImpl });
  assert.equal(calls[0].cmd, 'xdg-open');
  assert.deepEqual(calls[0].args, ['http://u']);
});

test('openBrowser uses rundll32 on Windows', () => {
  const { calls, spawnImpl } = recorder();
  openBrowser('http://u', { platform: 'win32', spawnImpl });
  assert.equal(calls[0].cmd, 'rundll32');
  assert.deepEqual(calls[0].args, ['url.dll,FileProtocolHandler', 'http://u']);
});

test('openBrowser returns false and does not throw when spawn throws', () => {
  const spawnImpl = () => { throw new Error('ENOENT'); };
  assert.equal(openBrowser('http://u', { platform: 'linux', spawnImpl }), false);
});
