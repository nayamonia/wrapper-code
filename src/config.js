const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseEnvFile(text) {
  const result = {};
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    const key = eq > 0 ? line.slice(0, eq).trim() : '';
    if (!KEY_RE.test(key)) throw new Error(`Malformed line ${index + 1}: ${raw}`);
    result[key] = line.slice(eq + 1).trim();
  });
  return result;
}

export function serializeEnvFile(values, { header } = {}) {
  const lines = [];
  if (header) lines.push(`# ${header}`);
  for (const [key, value] of Object.entries(values)) lines.push(`${key}=${value}`);
  return `${lines.join('\n')}\n`;
}
