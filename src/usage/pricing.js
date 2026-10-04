const OVERRIDE = {
  in: 'WRAPPER_CODE_PRICE_IN',
  out: 'WRAPPER_CODE_PRICE_OUT',
  cacheRead: 'WRAPPER_CODE_PRICE_CACHE_READ',
  cacheWrite: 'WRAPPER_CODE_PRICE_CACHE_WRITE',
};

export function normalizeModelId(model) {
  return String(model).replace(/\[1m\]$/, '');
}

function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function resolvePrices({ provider, fileValues = {}, model }) {
  const ovIn = num(fileValues[OVERRIDE.in]);
  const ovOut = num(fileValues[OVERRIDE.out]);
  if (ovIn !== null && ovOut !== null) {
    const prices = { in: ovIn, out: ovOut };
    const cr = num(fileValues[OVERRIDE.cacheRead]);
    const cw = num(fileValues[OVERRIDE.cacheWrite]);
    if (cr !== null) prices.cacheRead = cr;
    if (cw !== null) prices.cacheWrite = cw;
    return prices;
  }
  const table = provider?.pricing?.[normalizeModelId(model)];
  if (table) return { ...table };
  if (provider?.freeOfCharge) return { in: 0, out: 0 };
  return null;
}

export function estimateCost(event, prices) {
  if (!prices) return null;
  const per = (tokens, price) => (Math.max(0, tokens || 0) / 1e6) * price;
  const cost = per(event.inputTokens, prices.in)
    + per(event.outputTokens, prices.out)
    + per(event.cacheReadTokens, prices.cacheRead ?? prices.in)
    + per(event.cacheCreationTokens, prices.cacheWrite ?? prices.in);
  return Math.round(cost * 1e9) / 1e9;
}
