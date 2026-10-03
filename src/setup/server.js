import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { derivedEnv } from '../env.js';
import { CREDITS } from '../credits.js';
import { describeFetchError, discoverModels, joinUrl } from './models.js';

const PAGE_URL = new URL('./page.html', import.meta.url);
const MAX_BODY = 64 * 1024;

export async function testCredential(provider, credential, { fetchImpl = globalThis.fetch, testUrl, timeoutMs = 15000, baseUrl } = {}) {
  const url = testUrl || provider.test.url || joinUrl(baseUrl || provider.env.ANTHROPIC_BASE_URL, provider.test.path);
  const headers = {};
  if (provider.test.auth === 'bearer' && credential) headers.Authorization = `Bearer ${credential}`;
  try {
    const res = await fetchImpl(url, { method: provider.test.method || 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return { ok: true };
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.text()).trim();
      if (body) message = body.slice(0, 300);
    } catch {
      // keep statusText
    }
    return { ok: false, status: res.status, message };
  } catch (err) {
    return { ok: false, status: 0, message: `Could not reach ${url}: ${describeFetchError(err)}` };
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function effectiveBaseUrl(provider, current, typed) {
  return String(typed || '').trim() || current.ANTHROPIC_BASE_URL || provider.env.ANTHROPIC_BASE_URL || '';
}

async function pagePayload(provider, current, token, { fetchImpl, discoveryTimeoutMs }) {
  const baseUrl = effectiveBaseUrl(provider, current);
  const payload = {
    token,
    credits: CREDITS,
    provider: {
      id: provider.id,
      name: provider.name,
      docs: provider.docs,
      credential: provider.credential,
      editableBaseUrl: Boolean(provider.editableBaseUrl),
      env: provider.env,
    },
    current: {
      hasCredential: Boolean(provider.credential && current[provider.credential.env]),
      baseUrl,
    },
  };
  if (provider.models) {
    payload.provider.models = {
      envKeys: provider.models.envKeys,
      requireCapability: provider.models.requireCapability,
      note: provider.models.note || '',
    };
    payload.current.model = current.WRAPPER_CODE_MODEL || '';
    payload.discovery = await discoverModels(provider, baseUrl, { fetchImpl, timeoutMs: discoveryTimeoutMs });
  } else {
    const profiles = {};
    for (const [id, profile] of Object.entries(provider.profiles)) {
      profiles[id] = { label: profile.label, env: derivedEnv(provider, id) };
    }
    payload.provider.profiles = profiles;
    payload.current.profile = Object.hasOwn(provider.profiles, current.WRAPPER_CODE_PROFILE) ? current.WRAPPER_CODE_PROFILE : provider.defaultProfile;
  }
  return payload;
}

export async function startSetupServer({
  provider, current = {}, writeEnv, fetchImpl = globalThis.fetch, testUrl,
  timeoutMs = 10 * 60 * 1000, credentialTimeoutMs = 15000, discoveryTimeoutMs = 5000,
}) {
  const token = randomBytes(32).toString('hex');
  const template = await readFile(PAGE_URL, 'utf8');

  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  let finished = false;
  let saving = false;
  let closing = false;
  let timer;

  const finish = (result) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    resolveDone(result);
    server.close();
    setTimeout(() => server.closeAllConnections?.(), 1000).unref();
  };
  // Resolve only after the final response is flushed, so the client always reads it.
  const finishAfter = (res, result) => {
    closing = true;
    let called = false;
    const go = () => {
      if (called) return;
      called = true;
      finish(result);
    };
    // A client that already disconnected will never emit these events.
    if (res.destroyed || res.writableFinished) {
      setImmediate(go);
      return;
    }
    res.once('finish', go);
    res.once('close', go);
  };
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => finish({ saved: false, reason: 'timeout' }), timeoutMs);
    timer.unref?.();
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const sent = req.headers['x-setup-token'] || url.searchParams.get('t');
    if (sent !== token) {
      res.writeHead(403);
      res.end();
      return;
    }
    touch();

    if (req.method === 'GET' && url.pathname === '/') {
      const payload = await pagePayload(provider, current, token, { fetchImpl, discoveryTimeoutMs });
      const json = JSON.stringify(payload).replace(/<\//g, '<\\/');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(template.replace('__SETUP_JSON__', () => json));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/models') {
      if (!provider.models) {
        sendJson(res, 404, { ok: false, status: 0, message: 'This provider has no model discovery' });
        return;
      }
      const baseUrl = effectiveBaseUrl(provider, current, url.searchParams.get('baseUrl'));
      sendJson(res, 200, await discoverModels(provider, baseUrl, { fetchImpl, timeoutMs: discoveryTimeoutMs }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/cancel') {
      sendJson(res, 200, { ok: true }, { connection: 'close' });
      finishAfter(res, { saved: false, reason: 'cancelled' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/save') {
      if (finished || closing) {
        sendJson(res, 409, { ok: false, status: 0, message: 'Setup already finished' });
        return;
      }
      if (saving) {
        sendJson(res, 409, { ok: false, status: 0, message: 'A save is already in progress' });
        return;
      }
      saving = true;
      try {
        let body;
        try {
          body = JSON.parse((await readBody(req)) || '{}');
        } catch {
          sendJson(res, 400, { ok: false, status: 0, message: 'Invalid JSON body' });
          return;
        }
        const values = { ...current };
        if (provider.models) {
          const model = String(body.model || '').trim();
          if (!model) {
            sendJson(res, 400, { ok: false, status: 0, message: 'Model is required' });
            return;
          }
          values.WRAPPER_CODE_MODEL = model;
          delete values.WRAPPER_CODE_PROFILE;
          const context = body.contextLength;
          if (Number.isInteger(context) && context > 0) {
            values.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(context);
          } else {
            delete values.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
          }
        } else {
          const profile = String(body.profile || '');
          if (!Object.hasOwn(provider.profiles, profile)) {
            sendJson(res, 400, { ok: false, status: 0, message: `Unknown profile "${profile}"` });
            return;
          }
          values.WRAPPER_CODE_PROFILE = profile;
        }
        let credential = '';
        if (provider.credential) {
          credential = String(body.credential || '').trim() || current[provider.credential.env] || '';
          if (!credential) {
            sendJson(res, 400, { ok: false, status: 0, message: `${provider.credential.label} is required` });
            return;
          }
          values[provider.credential.env] = credential;
        }
        if (provider.editableBaseUrl) {
          // Only a base URL that differs from the provider default is stored.
          const typed = String(body.baseUrl || '').trim().replace(/\/+$/, '');
          if (typed && typed !== provider.env.ANTHROPIC_BASE_URL) {
            values.ANTHROPIC_BASE_URL = typed;
          } else {
            delete values.ANTHROPIC_BASE_URL;
          }
        }
        const baseUrl = effectiveBaseUrl(provider, values);
        const result = await testCredential(provider, credential, { fetchImpl, testUrl, timeoutMs: credentialTimeoutMs, baseUrl });
        if (finished || closing) {
          sendJson(res, 409, { ok: false, status: 0, message: 'Setup already finished' });
          return;
        }
        if (!result.ok) {
          sendJson(res, 400, result);
          return;
        }
        try {
          await writeEnv(values);
        } catch (err) {
          sendJson(res, 500, { ok: false, status: 0, message: err.message });
          return;
        }
        sendJson(res, 200, { ok: true }, { connection: 'close' });
        finishAfter(res, { saved: true, values });
        return;
      } finally {
        saving = false;
      }
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  touch();
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/?t=${token}`,
    port,
    token,
    done,
    close: () => finish({ saved: false, reason: 'closed' }),
  };
}
