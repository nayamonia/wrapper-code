import { mkdir, appendFile, readFile, chmod, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { configDir } from '../config.js';

export function usageFilePath(opts) {
  return path.join(configDir(opts), 'usage.jsonl');
}

export async function appendUsage(events, opts) {
  const file = usageFilePath(opts);
  if (!events.length) return file;
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });

  // Check if we need to prepend a newline (recover from truncated files)
  let prefix = '';
  try {
    const st = await stat(file);
    if (st.size > 0) {
      const fd = await open(file, 'r');
      try {
        const buf = Buffer.alloc(1);
        await fd.read(buf, 0, 1, st.size - 1);
        if (buf[0] !== 10) { // 10 is '\n'.charCodeAt(0)
          prefix = '\n';
        }
      } finally {
        await fd.close();
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const payload = `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
  await appendFile(file, prefix + payload, { mode: 0o600 });
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
