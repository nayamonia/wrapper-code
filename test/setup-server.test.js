import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startSetupServer, testCredential } from '../src/setup/server.js';
import deepseek from '../src/providers/deepseek.js';
import ollama from '../src/providers/ollama.js';

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

test('GET / carries the author credit for the page footer', async () => {
  const { server, stop } = await boot();
  const html = await (await fetch(server.url)).text();
  assert.match(html, /"credits":\{/);
  assert.match(html, /gabriel@cd2\.com\.br/);
  assert.match(html, /github\.com\/nayamonia/);
  assert.match(html, /https:\/\/cd2\.com\.br/);
  assert.match(html, /id="credits"/);
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

const TAGS = {
  models: [
    { name: 'qwen3-code:14b', details: { parameter_size: '14.8B', context_length: 40960 }, capabilities: ['completion', 'tools'] },
    { name: 'gemma3:4b', details: { parameter_size: '4.3B', context_length: 131072 }, capabilities: ['completion'] },
  ],
};

async function fakeOllama({ tags = TAGS, status = 200 } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    if (req.url === '/api/tags') {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? tags : { error: 'down' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => { server.closeAllConnections(); server.close(); } };
}

async function bootOllama({ ollamaOpts, current, timeoutMs, testViaFake = false } = {}) {
  const api = await fakeOllama(ollamaOpts);
  const written = [];
  const server = await startSetupServer({
    provider: ollama,
    current: { ANTHROPIC_BASE_URL: api.url, ...(current || {}) },
    timeoutMs,
    testUrl: testViaFake ? `${api.url}/api/tags` : undefined,
    writeEnv: async (values) => { written.push(values); },
  });
  const post = (route, body) => fetch(`http://127.0.0.1:${server.port}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-setup-token': server.token },
    body: JSON.stringify(body),
  });
  const get = (route) => fetch(`http://127.0.0.1:${server.port}${route}`, { headers: { 'x-setup-token': server.token } });
  const stop = async () => { server.close(); await server.done; api.close(); };
  return { server, api, written, post, get, stop };
}

test('ollama: GET / carries discovery results, models metadata and no profiles', async () => {
  const { server, api, stop } = await bootOllama({ current: { WRAPPER_CODE_MODEL: 'qwen3-code:14b' } });
  const html = await (await fetch(server.url)).text();
  const payload = JSON.parse(html.match(/var setup = (\{.*?\});\n/s)[1].replace(/<\\\//g, '</'));
  assert.equal(payload.provider.id, 'ollama');
  assert.equal('profiles' in payload.provider, false);
  assert.deepEqual(payload.provider.models.envKeys, ollama.models.envKeys);
  assert.equal(payload.provider.models.requireCapability, 'tools');
  assert.equal(payload.discovery.ok, true);
  assert.deepEqual(payload.discovery.models.map((m) => m.name), ['gemma3:4b', 'qwen3-code:14b']);
  assert.equal(payload.discovery.models[1].tools, true);
  assert.equal(payload.current.model, 'qwen3-code:14b');
  assert.equal(payload.current.baseUrl, api.url);
  assert.deepEqual(api.seen, ['/api/tags']);
  await stop();
});

test('ollama: GET / still renders when Ollama is down and reports the error in discovery', async () => {
  const { server, stop } = await bootOllama({ ollamaOpts: { status: 500 } });
  const res = await fetch(server.url);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /"discovery":\{"ok":false/);
  assert.match(html, /HTTP 500/);
  await stop();
});

test('ollama: GET /models without the token is 403 and with it re-discovers from the given base URL', async () => {
  const { server, get, stop } = await bootOllama();
  const other = await fakeOllama({ tags: { models: [{ name: 'llama4:scout', details: { parameter_size: '109B', context_length: 10485760 }, capabilities: ['tools'] }] } });
  assert.equal((await fetch(`http://127.0.0.1:${server.port}/models`)).status, 403);
  const res = await get(`/models?baseUrl=${encodeURIComponent(`${other.url}/`)}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.models.map((m) => m.name), ['llama4:scout']);
  assert.deepEqual(other.seen, ['/api/tags']);
  other.close();
  await stop();
});

test('ollama: GET /models with an empty baseUrl uses the saved one', async () => {
  const { api, get, stop } = await bootOllama();
  const body = await (await get('/models?baseUrl=')).json();
  assert.equal(body.ok, true);
  assert.equal(api.seen.filter((u) => u === '/api/tags').length, 1);
  await stop();
});

test('ollama: POST /save writes model, base URL and context snapshot after testing the connection', async () => {
  const { server, api, post, written } = await bootOllama();
  const res = await post('/save', { model: 'qwen3-code:14b', baseUrl: `${api.url}/`, contextLength: 40960 });
  assert.equal(res.status, 200, await res.text());
  assert.deepEqual(written, [{
    ANTHROPIC_BASE_URL: api.url,
    WRAPPER_CODE_MODEL: 'qwen3-code:14b',
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: '40960',
  }]);
  assert.equal(api.seen.filter((u) => u === '/api/tags').length, 1, 'save tested /api/tags');
  const done = await server.done;
  assert.equal(done.saved, true);
  api.close();
});

test('ollama: POST /save trims the typed model name and accepts a model not in the list', async () => {
  const { api, post, written, stop } = await bootOllama();
  const res = await post('/save', { model: '  gemma4:cloud \n', baseUrl: api.url });
  assert.equal(res.status, 200);
  assert.equal(written[0].WRAPPER_CODE_MODEL, 'gemma4:cloud');
  assert.equal('CLAUDE_CODE_AUTO_COMPACT_WINDOW' in written[0], false);
  await stop();
});

test('ollama: POST /save ignores every non-positive-integer contextLength', async () => {
  for (const bad of ['40960', -5, 1.5, null]) {
    const { api, post, written, stop } = await bootOllama();
    const res = await post('/save', { model: 'qwen3-code:14b', baseUrl: api.url, contextLength: bad });
    assert.equal(res.status, 200, `contextLength ${JSON.stringify(bad)}`);
    assert.equal(written.length, 1);
    assert.equal('CLAUDE_CODE_AUTO_COMPACT_WINDOW' in written[0], false, `contextLength ${JSON.stringify(bad)}`);
    await stop();
  }
});

test('ollama: POST /save without a model is 400 and writes nothing', async () => {
  const { api, post, written, stop } = await bootOllama();
  const res = await post('/save', { model: '   ', baseUrl: api.url });
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /Model is required/);
  assert.equal(written.length, 0);
  await stop();
});

test('ollama: POST /save against a dead base URL is 400 with status 0 and writes nothing', async () => {
  const { post, written, stop } = await bootOllama();
  const res = await post('/save', { model: 'qwen3-code:14b', baseUrl: 'http://127.0.0.1:9' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.status, 0);
  assert.equal(written.length, 0);
  await stop();
});

test('ollama: POST /save with the default base URL (plus a slash) does not store ANTHROPIC_BASE_URL', async () => {
  const { post, written, stop } = await bootOllama({ testViaFake: true, current: { ANTHROPIC_BASE_URL: undefined } });
  const res = await post('/save', { model: 'qwen3-code:14b', baseUrl: 'http://localhost:11434/' });
  assert.equal(res.status, 200, await res.text());
  assert.equal('ANTHROPIC_BASE_URL' in written[0], false);
  assert.equal(written[0].WRAPPER_CODE_MODEL, 'qwen3-code:14b');
  await stop();
});

test('ollama: POST /save with a blank base URL drops a previously saved custom one', async () => {
  const { post, written, stop } = await bootOllama({ testViaFake: true });
  const res = await post('/save', { model: 'qwen3-code:14b', baseUrl: '  ' });
  assert.equal(res.status, 200, await res.text());
  assert.equal('ANTHROPIC_BASE_URL' in written[0], false);
  await stop();
});

test('ollama: POST /save of the default URL removes a previously saved custom base URL', async () => {
  const { post, written, stop } = await bootOllama({ testViaFake: true, current: { ANTHROPIC_BASE_URL: 'http://10.0.0.5:11434' } });
  const res = await post('/save', { model: 'qwen3-code:14b', baseUrl: 'http://localhost:11434' });
  assert.equal(res.status, 200, await res.text());
  assert.equal('ANTHROPIC_BASE_URL' in written[0], false);
  await stop();
});

test('testCredential builds the URL from baseUrl and test.path, tolerating a trailing slash', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, statusText: 'OK', text: async () => '' }; };
  const result = await testCredential(ollama, '', { fetchImpl, baseUrl: 'http://localhost:11434/' });
  assert.deepEqual(result, { ok: true });
  assert.equal(seen[0].url, 'http://localhost:11434/api/tags');
  assert.equal('Authorization' in seen[0].init.headers, false);
});

test('testCredential appends the network error cause code', async () => {
  const fetchImpl = async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); };
  const result = await testCredential(ollama, '', { fetchImpl, baseUrl: 'http://localhost:11434' });
  assert.equal(result.status, 0);
  assert.match(result.message, /fetch failed.*ECONNREFUSED/);
});
