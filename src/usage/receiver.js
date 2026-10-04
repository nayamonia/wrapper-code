import http from 'node:http';
import { randomBytes } from 'node:crypto';

const TOKEN_HEADER = 'x-wrapper-usage-token';
const MAX_BODY = 4 * 1024 * 1024;
const COUNTERS = {
  input_tokens: 'inputTokens',
  output_tokens: 'outputTokens',
  cache_read_tokens: 'cacheReadTokens',
  cache_creation_tokens: 'cacheCreationTokens',
  duration_ms: 'durationMs',
};

function attrValue(v) {
  if (!v || typeof v !== 'object') return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('intValue' in v) return v.intValue;
  if ('doubleValue' in v) return v.doubleValue;
  if ('boolValue' in v) return v.boolValue;
  return undefined;
}

function toInt(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function isApiRequest(record, attrs) {
  const body = record.body && typeof record.body.stringValue === 'string' ? record.body.stringValue : '';
  const name = attrs['event.name'];
  return body === 'claude_code.api_request' || name === 'api_request' || name === 'claude_code.api_request';
}

export function parseApiRequests(payload) {
  const events = [];
  let malformed = 0;
  const resourceLogs = Array.isArray(payload?.resourceLogs) ? payload.resourceLogs : [];
  for (const rl of resourceLogs) {
    for (const sl of Array.isArray(rl?.scopeLogs) ? rl.scopeLogs : []) {
      for (const record of Array.isArray(sl?.logRecords) ? sl.logRecords : []) {
        const attrs = {};
        for (const a of Array.isArray(record?.attributes) ? record.attributes : []) {
          if (a && typeof a.key === 'string') attrs[a.key] = attrValue(a.value);
        }
        if (!isApiRequest(record || {}, attrs)) continue;
        const counters = {};
        let present = false;
        for (const [key, field] of Object.entries(COUNTERS)) {
          const n = toInt(attrs[key]);
          if (n !== null && (key === 'input_tokens' || key === 'output_tokens')) present = true;
          counters[field] = n === null ? 0 : Math.max(0, n);
        }
        if (!present) {
          malformed += 1;
          continue;
        }
        events.push({
          model: typeof attrs.model === 'string' ? attrs.model : 'unknown',
          querySource: typeof attrs.query_source === 'string' && attrs.query_source ? attrs.query_source : 'unknown',
          ...counters,
        });
      }
    }
  }
  return { events, malformed };
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

export async function startUsageReceiver({ onEvent, lingerMs = 3000 } = {}) {
  const token = randomBytes(32).toString('hex');
  const stats = { batches: 0, events: 0, malformed: 0, rejected: 0 };

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/logs') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.headers[TOKEN_HEADER] !== token) {
      stats.rejected += 1;
      res.writeHead(403);
      res.end();
      return;
    }
    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || '{}');
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const receivedAt = new Date().toISOString();
    const { events, malformed } = parseApiRequests(payload);
    stats.batches += 1;
    stats.events += events.length;
    stats.malformed += malformed;
    for (const event of events) {
      try {
        onEvent?.(event, receivedAt);
      } catch {
        // a consumer failure must never break the exporter's request
      }
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address();

  let closing = null;
  let finishNow = () => {};
  const close = ({ now = false } = {}) => {
    if (!closing) {
      closing = new Promise((resolve) => {
        let timer = null;
        let done = false;
        finishNow = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          server.closeAllConnections?.();
          server.close(() => resolve());
        };
        timer = setTimeout(finishNow, lingerMs);
        timer.unref?.();
      });
    }
    if (now) finishNow();
    return closing;
  };

  return {
    port,
    token,
    stats,
    env: {
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_METRICS_EXPORTER: 'none',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
      OTEL_EXPORTER_OTLP_HEADERS: `${TOKEN_HEADER}=${token}`,
      OTEL_LOGS_EXPORT_INTERVAL: '2000',
    },
    close,
  };
}
