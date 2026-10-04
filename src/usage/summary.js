import { ansi, RESET } from '../brand.js';
import { PANEL_WIDTH } from '../splash.js';

export function abbreviate(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

export function summarize(events) {
  const s = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  for (const e of events) {
    s.requests += 1;
    s.inputTokens += e.inputTokens || 0;
    s.outputTokens += e.outputTokens || 0;
    s.cacheReadTokens += e.cacheReadTokens || 0;
    s.cacheCreationTokens += e.cacheCreationTokens || 0;
  }
  return s;
}

function duration(startedAt, endedAt) {
  const min = Math.max(0, Math.round((endedAt - startedAt) / 60000));
  if (min < 1) return 'under a minute';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function summaryLines({ providerName, selection, events, startedAt, endedAt, file, saved = true, malformed = 0, reason, truecolor }) {
  const head = `wrapper-code · ${providerName}${selection ? ` (${selection})` : ''} · ${duration(startedAt, endedAt)}`;
  const lines = [head];
  if (!events.length) {
    let noCapturedMsg = `  no usage captured (${reason || 'no api_request events arrived'})`;
    if (malformed > 0) noCapturedMsg += ` · ${malformed} malformed records ignored`;
    lines.push(noCapturedMsg);
  } else {
    const s = summarize(events);
    lines.push(`  requests ${s.requests} · in ${abbreviate(s.inputTokens)} · out ${abbreviate(s.outputTokens)} · cache read ${abbreviate(s.cacheReadTokens)} · cache write ${abbreviate(s.cacheCreationTokens)}`);
    let last = `  ${saved ? `saved to ${file}` : 'not saved'}`;
    if (malformed > 0) last += ` · ${malformed} malformed records ignored`;
    lines.push(last);
  }
  if (truecolor === undefined) return lines;
  const night = ansi('bg', { truecolor, bg: true });
  const colors = [ansi('yellow', { truecolor }), ansi('white', { truecolor }), ansi('dim', { truecolor })];
  return lines.map((l, i) => {
    const pad = Math.max(0, PANEL_WIDTH - l.length);
    return `${night}${colors[Math.min(i, 2)]}${l}${' '.repeat(pad)}${RESET}`;
  });
}

export function renderSummary(opts) {
  return `${summaryLines(opts).join('\n')}\n`;
}
