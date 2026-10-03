export function joinUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/+$/, '')}${path}`;
}

export function describeFetchError(err) {
  const base = String(err?.message ?? err);
  const reason = err?.cause?.code || err?.cause?.message;
  return reason ? `${base} (${reason})` : base;
}

function price(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value) * 1e6;
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
}

function normalizeOllama(entry, requireCapability) {
  const details = entry.details || {};
  const caps = Array.isArray(entry.capabilities) ? entry.capabilities : null;
  const context = Number(details.context_length);
  const name = typeof entry.name === 'string' ? entry.name : (typeof entry.model === 'string' ? entry.model : '');
  return {
    name,
    label: '',
    parameterSize: details.parameter_size ? String(details.parameter_size) : '',
    contextLength: Number.isInteger(context) && context > 0 ? context : null,
    tools: caps ? caps.includes(requireCapability) : null,
    priceIn: null,
    priceOut: null,
  };
}

function normalizeOpenRouter(entry, requireCapability) {
  const params = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : null;
  const context = Number(entry.context_length);
  const pricing = entry.pricing || {};
  return {
    name: typeof entry.id === 'string' ? entry.id : '',
    label: typeof entry.name === 'string' ? entry.name : '',
    parameterSize: '',
    contextLength: Number.isInteger(context) && context > 0 ? context : null,
    tools: params ? params.includes(requireCapability) : null,
    priceIn: price(pricing.prompt),
    priceOut: price(pricing.completion),
  };
}

const FORMATS = {
  ollama: { key: 'models', normalize: normalizeOllama, keep: () => true },
  openrouter: { key: 'data', normalize: normalizeOpenRouter, keep: (m) => !m.name.endsWith(':batch') },
};

export async function discoverModels(provider, baseUrl, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const format = FORMATS[provider.models.format || 'ollama'];
  const url = joinUrl(baseUrl, provider.models.discoverPath);
  let res;
  try {
    res = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    return { ok: false, status: 0, message: `Could not reach ${url}: ${describeFetchError(err)}` };
  }
  if (!res.ok) return { ok: false, status: res.status, message: `${url} answered HTTP ${res.status}` };
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, status: res.status, message: `Unexpected response from ${url}: not JSON` };
  }
  if (!body || !Array.isArray(body[format.key])) {
    return { ok: false, status: res.status, message: `Unexpected response from ${url}: no ${format.key} array` };
  }
  const models = body[format.key]
    .filter((e) => e && typeof e === 'object' && !Array.isArray(e))
    .map((entry) => format.normalize(entry, provider.models.requireCapability))
    .filter((m) => m.name && format.keep(m))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, models };
}
