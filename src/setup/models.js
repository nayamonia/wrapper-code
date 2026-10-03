export function joinUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/+$/, '')}${path}`;
}

export function describeFetchError(err) {
  const reason = err?.cause?.code || err?.cause?.message;
  return reason ? `${err.message} (${reason})` : String(err?.message);
}

function normalize(entry, requireCapability) {
  const details = entry.details || {};
  const caps = Array.isArray(entry.capabilities) ? entry.capabilities : null;
  const context = Number(details.context_length);
  const name = typeof entry.name === 'string' ? entry.name : (typeof entry.model === 'string' ? entry.model : '');
  return {
    name,
    parameterSize: details.parameter_size ? String(details.parameter_size) : '',
    contextLength: Number.isInteger(context) && context > 0 ? context : null,
    tools: caps ? caps.includes(requireCapability) : null,
  };
}

export async function discoverModels(provider, baseUrl, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
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
  if (!body || !Array.isArray(body.models)) {
    return { ok: false, status: res.status, message: `Unexpected response from ${url}: no models array` };
  }
  const models = body.models
    .filter((e) => e && typeof e === 'object' && !Array.isArray(e))
    .map((entry) => normalize(entry, provider.models.requireCapability))
    .filter((m) => m.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, models };
}
