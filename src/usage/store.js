import { mkdir, appendFile, readFile, writeFile, rename, rm, chmod, stat, open } from 'node:fs/promises';
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
  return e && typeof e === 'object' && typeof e.ts === 'string' && typeof e.provider === 'string' && typeof e.model === 'string' && Number.isFinite(Date.parse(e.ts)) && typeof e.inputTokens === 'number';
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

// Without a provider the whole file goes. With one, only the lines that parse and name that
// provider go; anything else, malformed lines included, stays where it is.
export async function clearUsage({ provider } = {}, opts) {
  const file = usageFilePath(opts);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { removed: 0 };
    throw err;
  }
  const wanted = provider === undefined ? null : [].concat(provider);
  const kept = [];
  let removed = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e = null;
    try { e = JSON.parse(line); } catch { /* malformed */ }
    if (wanted ? wanted.includes(e?.provider) : isUsageEvent(e)) removed += 1;
    else if (wanted) kept.push(line);
  }
  if (wanted && !removed) return { removed };
  if (!kept.length) {
    await rm(file, { force: true });
    return { removed };
  }
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, `${kept.join('\n')}\n`, { mode: 0o600 });
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  return { removed };
}
