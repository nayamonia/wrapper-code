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

async function boot({ status = 200, current = {}, timeoutMs, credentialTimeoutMs, fetchImpl, writeEnv, provider = deepseek } = {}) {
  const api = await fakeApi(status);
  const written = [];
  const server = await startSetupServer({
    provider,
    current,
    fetchImpl,
    testUrl: api.url,
    timeoutMs,
    credentialTimeoutMs,
    writeEnv: writeEnv || (async (values) => { written.push(values); }),
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

test('POST /save with a failing writeEnv is 500 and the server stays usable', async () => {
  const { server, post, api } = await boot({ writeEnv: async () => { throw new Error('EACCES: denied'); } });
  const res = await post('/save', { credential: 'sk-x', profile: 'flash-1m' });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.message, /EACCES/);
  const cancel = await post('/cancel', {});
  assert.equal(cancel.status, 200);
  assert.deepEqual(await server.done, { saved: false, reason: 'cancelled' });
  api.close();
});

test('two concurrent saves write once and the second gets 409', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const fetchImpl = async () => { await gate; return { ok: true, status: 200, statusText: 'OK', text: async () => '' }; };
  const { server, post, written, api } = await boot({ fetchImpl });
  const first = post('/save', { credential: 'sk-1', profile: 'flash-1m' });
  await new Promise((r) => setTimeout(r, 50));
  const second = await post('/save', { credential: 'sk-2', profile: 'flash-1m' });
  assert.equal(second.status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal(written.length, 1);
  await server.done;
  api.close();
});

test('close() during an in-flight credential test prevents the write', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const fetchImpl = async () => { await gate; return { ok: true, status: 200, statusText: 'OK', text: async () => '' }; };
  const { server, post, written, api } = await boot({ fetchImpl });
  const pending = post('/save', { credential: 'sk-1', profile: 'flash-1m' });
  await new Promise((r) => setTimeout(r, 50));
  server.close();
  assert.deepEqual(await server.done, { saved: false, reason: 'closed' });
  release();
  const res = await pending.catch(() => null);
  if (res) assert.equal(res.status, 409);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(written.length, 0);
  api.close();
});

test('page payload containing $-replacement patterns is spliced literally', async () => {
  const provider = { ...deepseek, editableBaseUrl: true };
  const { server, stop } = await boot({ provider, current: { ANTHROPIC_BASE_URL: "https://x/$'" } });
  const html = await (await fetch(server.url)).text();
  assert.ok(html.includes("https://x/$'"));
  assert.equal(html.split('</html>').length - 1, 1);
  await stop();
});

test('POST /save with a prototype-chain profile name is 400', async () => {
  const { post, stop, written } = await boot();
  const res = await post('/save', { credential: 'sk', profile: 'constructor' });
  assert.equal(res.status, 400);
  assert.equal(written.length, 0);
  await stop();
});

test('a credential test that hangs is aborted by credentialTimeoutMs', async () => {
  const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const keepAlive = setTimeout(() => {}, 2000); // AbortSignal.timeout is unref'd
  const result = await testCredential(deepseek, 'sk', { fetchImpl, timeoutMs: 50 });
  clearTimeout(keepAlive);
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.ok(result.message);
});

test('POST /save returns 400 and frees the save lock when the provider hangs', async () => {
  const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const api = await boot({ fetchImpl, credentialTimeoutMs: 50 });
  const res = await api.post('/save', { credential: 'sk', profile: 'flash-1m' });
  assert.equal(res.status, 400);
  const res2 = await api.post('/save', { credential: 'sk', profile: 'flash-1m' });
  assert.equal(res2.status, 400);
  await api.stop();
});

test('requests with a bad token do not keep the idle timer alive', async () => {
  const { server, stop } = await boot({ timeoutMs: 150 });
  const stopAt = Date.now() + 600;
  const spam = (async () => {
    while (Date.now() < stopAt) {
      await fetch(`http://127.0.0.1:${server.port}/?t=wrong`).catch(() => {});
      await new Promise((r) => setTimeout(r, 20));
    }
  })();
  const result = await Promise.race([server.done, new Promise((r) => setTimeout(() => r('still-alive'), 450))]);
  assert.deepEqual(result, { saved: false, reason: 'timeout' });
  await spam;
  await stop();
});
