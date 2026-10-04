import { readUsage } from './store.js';
import { abbreviate } from './summary.js';

export function parseSince(text, now) {
  if (text === 'all') return 0;
  const m = /^(\d+)([hd])$/.exec(String(text || ''));
  if (!m || Number(m[1]) <= 0) return null;
  const n = Number(m[1]);
  return now - n * (m[2] === 'h' ? 3600e3 : 86400e3);
}

function newBucket(key) {
  return { ...key, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: null, unpriced: 0 };
}

function add(bucket, e) {
  bucket.requests += 1;
  bucket.inputTokens += e.inputTokens || 0;
  bucket.outputTokens += e.outputTokens || 0;
  bucket.cacheReadTokens += e.cacheReadTokens || 0;
  bucket.cacheCreationTokens += e.cacheCreationTokens || 0;
  if (typeof e.costUsd === 'number') bucket.costUsd = (bucket.costUsd ?? 0) + e.costUsd;
  else bucket.unpriced += 1;
}

function round(bucket) {
  if (bucket.costUsd !== null) bucket.costUsd = Math.round(bucket.costUsd * 1e6) / 1e6;
  return bucket;
}

export function aggregate(events, { since = 0, provider, byDay = false } = {}) {
  const groups = new Map();
  const total = newBucket({});
  for (const e of events) {
    const t = Date.parse(e.ts);
    if (!Number.isFinite(t) || t < since) continue;
    if (provider && e.provider !== provider) continue;
    const day = byDay ? e.ts.slice(0, 10) : undefined;
    const key = `${day ?? ''}\u0000${e.provider}\u0000${e.model}`;
    if (!groups.has(key)) groups.set(key, newBucket(byDay ? { day, provider: e.provider, model: e.model } : { provider: e.provider, model: e.model }));
    add(groups.get(key), e);
    add(total, e);
  }
  const list = [...groups.values()].map(round).sort((a, b) =>
    (a.day || '').localeCompare(b.day || '') || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
  return { groups: list, total: round(total) };
}

function cost(bucket) {
  if (bucket.costUsd === null) return bucket.unpriced ? `unknown (${bucket.unpriced} unpriced)` : 'unknown';
  const d = `$${bucket.costUsd.toFixed(2)}`;
  return bucket.unpriced ? `≥ ${d} (${bucket.unpriced} unpriced)` : d;
}

export function renderReport({ groups, total, skipped = 0, since, byDay = false }) {
  const head = [...(byDay ? ['day'] : []), 'provider', 'model', 'requests', 'in', 'out', 'cache read', 'cache write', 'est. cost'];
  const rows = groups.map((g) => [...(byDay ? [g.day] : []), g.provider, g.model, String(g.requests), abbreviate(g.inputTokens), abbreviate(g.outputTokens), abbreviate(g.cacheReadTokens), abbreviate(g.cacheCreationTokens), cost(g)]);
  rows.push([...(byDay ? [''] : []), 'total', '', String(total.requests), abbreviate(total.inputTokens), abbreviate(total.outputTokens), abbreviate(total.cacheReadTokens), abbreviate(total.cacheCreationTokens), cost(total)]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  const out = [`usage since ${since} (estimates; local file only)`, line(head), ...rows.map(line)];
  if (skipped) out.push(`${skipped} malformed lines skipped`);
  return `${out.join('\n')}\n`;
}

export async function runUsage(args, { cfg, stdout, stderr, now = Date.now() }) {
  let since = '30d';
  let provider;
  let byDay = false;
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--since') since = args[++i];
    else if (a.startsWith('--since=')) since = a.slice(8);
    else if (a === '--provider') provider = args[++i];
    else if (a.startsWith('--provider=')) provider = a.slice(11);
    else if (a === '--by-day') byDay = true;
    else if (a === '--json') json = true;
    else {
      stderr.write(`usage: unknown option ${a}\n`);
      return 1;
    }
  }
  const cutoff = parseSince(since, now);
  if (cutoff === null) {
    stderr.write('usage: --since expects 24h, 7d, 30d or all\n');
    return 1;
  }
  const { events, skipped } = await readUsage(cfg);
  const { groups, total } = aggregate(events, { since: cutoff, provider, byDay });
  if (json) {
    stdout.write(`${JSON.stringify({ since, provider: provider ?? null, byDay, groups, total, skipped })}\n`);
    return 0;
  }
  if (!groups.length) {
    stdout.write(`no usage recorded yet${skipped ? ` (${skipped} malformed lines skipped)` : ''}\n`);
    return 0;
  }
  stdout.write(renderReport({ groups, total, skipped, since, byDay }));
  return 0;
}
