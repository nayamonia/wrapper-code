import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startSetupServer, testCredential } from '../src/setup/server.js';
import deepseek from '../src/providers/deepseek.js';

async function fakeApi(status) {
  const server = http.createServer((req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(status === 200 ? '{"data":[]}' : '{"error":{"message":"invalid api key"}}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/models`, close: () => { server.closeAllConnections(); server.close(); } };
}

async function boot({ status = 200, current = {}, timeoutMs } = {}) {
  const api = await fakeApi(status);
  const written = [];
  const server = await startSetupServer({
    provider: deepseek,
    current,
    testUrl: api.url,
    timeoutMs,
    writeEnv: async (values) => { written.push(values); },
  });
  const post = (route, body, token = server.token) => fetch(`http://127.0.0.1:${server.port}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-setup-token': token },
    body: JSON.stringify(body),
  });
  const stop = async () => { server.close(); await server.done; api.close(); };
  return { server, written, post, stop, api };
}

test('GET / without the token is 403', async () => {
  const { server, stop } = await boot();
  const res = await fetch(`http://127.0.0.1:${server.port}/`);
  assert.equal(res.status, 403);
  await stop();
});

test('GET / with the token serves the page with the provider payload', async () => {
  const { server, stop } = await boot({ current: { WRAPPER_CODE_PROFILE: 'v4-pro', ANTHROPIC_AUTH_TOKEN: 'sk-old' } });
  const res = await fetch(server.url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /DeepSeek/);
  assert.match(html, new RegExp(server.token));
  assert.match(html, /"profile":"v4-pro"/);
  assert.match(html, /"hasCredential":true/);
  assert.match(html, /deepseek-flash\[1m\]/);
  assert.doesNotMatch(html, /sk-old/);
  await stop();
});

test('POST /save without the token header is 403', async () => {
  const { post, written, stop } = await boot();
  const res = await post('/save', { credential: 'sk-x', profile: 'flash-1m' }, 'wrong');
  assert.equal(res.status, 403);
  assert.equal(written.length, 0);
  await stop();
});

test('POST /save with a valid key writes the file and resolves done', async () => {
  const { server, post, written, api } = await boot();
  const res = await post('/save', { credential: 'sk-test', profile: 'v4-pro' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(written, [{ ANTHROPIC_AUTH_TOKEN: 'sk-test', WRAPPER_CODE_PROFILE: 'v4-pro' }]);
  const done = await server.done;
  assert.equal(done.saved, true);
  assert.deepEqual(done.values, written[0]);
  api.close();
});

test('POST /save trims whitespace and newlines around the credential', async () => {
  const { post, written, stop } = await boot();
  await post('/save', { credential: '  sk-trim \n', profile: 'flash-1m' });
  assert.equal(written[0].ANTHROPIC_AUTH_TOKEN, 'sk-trim');
  await stop();
});

test('POST /save with a rejected key is 400 with the API status and writes nothing', async () => {
  const { post, written, stop } = await boot({ status: 401 });
  const res = await post('/save', { credential: 'sk-bad', profile: 'flash-1m' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.status, 401);
  assert.match(body.message, /invalid api key/);
  assert.equal(written.length, 0);
  await stop();
});

test('POST /save with an unknown profile is 400 and writes nothing', async () => {
  const { post, written, stop } = await boot();
  const res = await post('/save', { credential: 'sk-x', profile: 'ghost' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /ghost/);
  assert.equal(written.length, 0);
  await stop();
});

test('POST /save with an empty credential keeps the stored one and preserves manual extras', async () => {
  const { post, written, stop } = await boot({
    current: { ANTHROPIC_AUTH_TOKEN: 'sk-old', WRAPPER_CODE_PROFILE: 'flash-1m', CLAUDE_CODE_EFFORT_LEVEL: 'high' },
  });
  const res = await post('/save', { credential: '', profile: 'v4-pro' });
  assert.equal(res.status, 200);
  assert.deepEqual(written[0], { ANTHROPIC_AUTH_TOKEN: 'sk-old', WRAPPER_CODE_PROFILE: 'v4-pro', CLAUDE_CODE_EFFORT_LEVEL: 'high' });
  await stop();
});

test('POST /save with no credential at all is 400', async () => {
  const { post, written, stop } = await boot();
  const res = await post('/save', { credential: '', profile: 'flash-1m' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /API key/);
  assert.equal(written.length, 0);
  await stop();
});

test('POST /save with invalid JSON is 400', async () => {
  const { server, stop } = await boot();
  const res = await fetch(`http://127.0.0.1:${server.port}/save`, {
    method: 'POST', headers: { 'x-setup-token': server.token }, body: '{nope',
  });
  assert.equal(res.status, 400);
  await stop();
});

test('POST /cancel resolves done with saved:false', async () => {
  const { server, post, api } = await boot();
  const res = await post('/cancel', {});
  assert.equal(res.status, 200);
  const done = await server.done;
  assert.deepEqual(done, { saved: false, reason: 'cancelled' });
  api.close();
});

test('idle timeout resolves done with reason timeout', async () => {
  const { server, api } = await boot({ timeoutMs: 50 });
  const done = await server.done;
  assert.deepEqual(done, { saved: false, reason: 'timeout' });
  api.close();
});

test('testCredential sends a bearer header and reports ok on 2xx', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, statusText: 'OK', text: async () => '' }; };
  assert.deepEqual(await testCredential(deepseek, 'sk-1', { fetchImpl }), { ok: true });
  assert.equal(seen[0].url, 'https://api.deepseek.com/models');
  assert.equal(seen[0].init.method, 'GET');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer sk-1');
});

test('testCredential reports a network error as status 0', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const result = await testCredential(deepseek, 'sk-1', { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.match(result.message, /ECONNREFUSED/);
});
