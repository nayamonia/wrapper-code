import { readUsage, clearUsage, usageFilePath } from './store.js';
import { abbreviate } from './summary.js';

export function parseSince(text, now) {
  if (text === 'all') return 0;
  const m = /^(\d+)([hd])$/.exec(String(text || ''));
  if (!m || Number(m[1]) <= 0) return null;
  const n = Number(m[1]);
  return now - n * (m[2] === 'h' ? 3600e3 : 86400e3);
}

function newBucket(key) {
  return { ...key, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

function add(bucket, e) {
  bucket.requests += 1;
  bucket.inputTokens += e.inputTokens || 0;
  bucket.outputTokens += e.outputTokens || 0;
  bucket.cacheReadTokens += e.cacheReadTokens || 0;
  bucket.cacheCreationTokens += e.cacheCreationTokens || 0;
}

const same = (id) => id;

export function aggregate(events, { since = 0, provider, byDay = false, canonical = same } = {}) {
  const target = provider ? canonical(provider) : undefined;
  const groups = new Map();
  const total = newBucket({});
  for (const e of events) {
    const t = Date.parse(e.ts);
    if (!Number.isFinite(t) || t < since) continue;
    const id = canonical(e.provider);
    if (target && id !== target) continue;
    const day = byDay ? e.ts.slice(0, 10) : undefined;
    const key = `${day ?? ''}\u0000${id}\u0000${e.model}`;
    if (!groups.has(key)) groups.set(key, newBucket(byDay ? { day, provider: id, model: e.model } : { provider: id, model: e.model }));
    add(groups.get(key), e);
    add(total, e);
  }
  const list = [...groups.values()].sort((a, b) =>
    (a.day || '').localeCompare(b.day || '') || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
  return { groups: list, total };
}

export function renderReport({ groups, total, skipped = 0, since, byDay = false }) {
  const head = [...(byDay ? ['day'] : []), 'provider', 'model', 'requests', 'in', 'out', 'cache read', 'cache write'];
  const rows = groups.map((g) => [...(byDay ? [g.day] : []), g.provider, g.model, String(g.requests), abbreviate(g.inputTokens), abbreviate(g.outputTokens), abbreviate(g.cacheReadTokens), abbreviate(g.cacheCreationTokens)]);
  rows.push([...(byDay ? [''] : []), 'total', '', String(total.requests), abbreviate(total.inputTokens), abbreviate(total.outputTokens), abbreviate(total.cacheReadTokens), abbreviate(total.cacheCreationTokens)]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  const out = [`usage since ${since} (local file only)`, line(head), ...rows.map(line)];
  if (skipped) out.push(`${skipped} malformed lines skipped`);
  return `${out.join('\n')}\n`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// confirm(question) resolves true or false, or null when there is no terminal to ask on.
async function runClear(args, { cfg, stdout, stderr, confirm, display, canonical }) {
  let provider;
  let yes = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--provider') provider = args[++i];
    else if (a.startsWith('--provider=')) provider = a.slice(11);
    else if (a === '--yes' || a === '-y') yes = true;
    else {
      stderr.write(`usage clear: unknown option ${a}\n`);
      return 1;
    }
  }
  if (provider !== undefined && !provider) {
    stderr.write('usage clear: --provider expects a provider id\n');
    return 1;
  }
  if (provider) provider = canonical(provider);
  const { events, skipped } = await readUsage(cfg);
  const matching = provider ? events.filter((e) => canonical(e.provider) === provider) : events;
  const count = matching.length;
  if (!count && (provider || !skipped)) {
    stdout.write(`${provider ? `no usage recorded for ${provider}` : 'no usage recorded yet'}; nothing to clear\n`);
    return 0;
  }
  const what = provider
    ? `${plural(count, 'request')} (${provider})`
    : `all ${plural(count, 'request')}${skipped ? ` and ${plural(skipped, 'malformed line')}` : ''}`;
  if (!yes) {
    const answer = await confirm(`This removes ${what} from ${display(usageFilePath(cfg))}. Continue? [y/N] `);
    if (answer === null) {
      stderr.write('usage clear: not a terminal; pass --yes to remove without asking\n');
      return 1;
    }
    if (!answer) {
      stdout.write('nothing removed\n');
      return 1;
    }
  }
  const { removed } = await clearUsage({ provider: provider ? [...new Set(matching.map((e) => e.provider))] : undefined }, cfg);
  stdout.write(`removed ${plural(removed, 'request')}${provider ? ` (${provider})` : ''}\n`);
  return 0;
}

export async function runUsage(args, { cfg, stdout, stderr, now = Date.now(), confirm = async () => null, display = (file) => file, canonical = same }) {
  if (args[0] === 'clear') return runClear(args.slice(1), { cfg, stdout, stderr, confirm, display, canonical });
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
  const { groups, total } = aggregate(events, { since: cutoff, provider, byDay, canonical });
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
