import { mkdir, appendFile, readFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { configDir } from '../config.js';

export function usageFilePath(opts) {
  return path.join(configDir(opts), 'usage.jsonl');
}

export async function appendUsage(events, opts) {
  const file = usageFilePath(opts);
  if (!events.length) return file;
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await appendFile(file, `${events.map((e) => JSON.stringify(e)).join('\n')}\n`, { mode: 0o600 });
  if ((opts?.platform ?? process.platform) !== 'win32') await chmod(file, 0o600);
  return file;
}

function isUsageEvent(e) {
  return e && typeof e === 'object' && typeof e.ts === 'string' && typeof e.provider === 'string' && typeof e.inputTokens === 'number';
}

export async function readUsage(opts) {
  let text;
  try {
    text = await readFile(usageFilePath(opts), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { events: [], skipped: 0 };
    throw err;
  }
  const events = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (isUsageEvent(e)) events.push(e);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { events, skipped };
}
