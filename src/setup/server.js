import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { derivedEnv } from '../env.js';

const PAGE_URL = new URL('./page.html', import.meta.url);
const MAX_BODY = 64 * 1024;

export async function testCredential(provider, credential, { fetchImpl = globalThis.fetch, testUrl, timeoutMs = 15000 } = {}) {
  const url = testUrl || provider.test.url;
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
    return { ok: false, status: 0, message: err.message };
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

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function pagePayload(provider, current, token) {
  const profiles = {};
  for (const [id, profile] of Object.entries(provider.profiles)) {
    profiles[id] = { label: profile.label, env: derivedEnv(provider, id) };
  }
  return {
    token,
    provider: {
      id: provider.id,
      name: provider.name,
      docs: provider.docs,
      credential: provider.credential,
      editableBaseUrl: Boolean(provider.editableBaseUrl),
      profiles,
    },
    current: {
      profile: Object.hasOwn(provider.profiles, current.WRAPPER_CODE_PROFILE) ? current.WRAPPER_CODE_PROFILE : provider.defaultProfile,
      hasCredential: Boolean(provider.credential && current[provider.credential.env]),
      baseUrl: current.ANTHROPIC_BASE_URL || provider.env.ANTHROPIC_BASE_URL || '',
    },
  };
}

export async function startSetupServer({
  provider, current = {}, writeEnv, fetchImpl = globalThis.fetch, testUrl, timeoutMs = 10 * 60 * 1000, credentialTimeoutMs = 15000,
}) {
  const token = randomBytes(32).toString('hex');
  const template = await readFile(PAGE_URL, 'utf8');

  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  let finished = false;
  let saving = false;
  let timer;

  const finish = (result) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    resolveDone(result);
    setImmediate(() => {
      server.closeAllConnections?.();
      server.close();
    });
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
      const json = JSON.stringify(pagePayload(provider, current, token)).replace(/<\//g, '<\\/');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(template.replace('__SETUP_JSON__', () => json));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/cancel') {
      sendJson(res, 200, { ok: true });
      finish({ saved: false, reason: 'cancelled' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/save') {
      if (finished) {
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
        const profile = String(body.profile || '');
        if (!Object.hasOwn(provider.profiles, profile)) {
          sendJson(res, 400, { ok: false, status: 0, message: `Unknown profile "${profile}"` });
          return;
        }
        const values = { ...current, WRAPPER_CODE_PROFILE: profile };
        let credential = '';
        if (provider.credential) {
          credential = String(body.credential || '').trim() || current[provider.credential.env] || '';
          if (!credential) {
            sendJson(res, 400, { ok: false, status: 0, message: `${provider.credential.label} is required` });
            return;
          }
          values[provider.credential.env] = credential;
        }
        if (provider.editableBaseUrl && String(body.baseUrl || '').trim()) {
          values.ANTHROPIC_BASE_URL = String(body.baseUrl).trim();
        }
        const result = await testCredential(provider, credential, { fetchImpl, testUrl, timeoutMs: credentialTimeoutMs });
        if (finished) {
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
        sendJson(res, 200, { ok: true });
        finish({ saved: true, values });
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
