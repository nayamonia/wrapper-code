import { homedir } from 'node:os';
import { mkdir, readFile, writeFile, chmod, rename, access } from 'node:fs/promises';
import path from 'node:path';

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseEnvFile(text) {
  const result = {};
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    const key = eq > 0 ? line.slice(0, eq).trim() : '';
    if (!KEY_RE.test(key)) throw new Error(`Malformed line ${index + 1}`);
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

export class ConfigError extends Error {}

function normalize(opts = {}) {
  return {
    platform: opts.platform ?? process.platform,
    env: opts.env ?? process.env,
    home: opts.home ?? homedir(),
  };
}

export function configDir(opts) {
  const { platform, env, home } = normalize(opts);
  if (platform === 'win32') {
    const base = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(base, 'wrapper-code');
  }
  const base = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'wrapper-code');
}

export function envFilePath(providerId, opts) {
  return path.join(configDir(opts), `${providerId}.env`);
}

export async function readProviderEnv(providerId, opts) {
  const file = envFilePath(providerId, opts);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new ConfigError(`Cannot read ${file}: ${err.message}. Run: wrapper-code setup ${providerId}`);
  }
  try {
    return parseEnvFile(text);
  } catch (err) {
    throw new ConfigError(`${file}: ${err.message}. Run: wrapper-code setup ${providerId}`);
  }
}

export async function writeProviderEnv(providerId, values, opts) {
  const { platform } = normalize(opts);
  const file = envFilePath(providerId, opts);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, serializeEnvFile(values, { header: `wrapper-code — ${providerId}` }), { mode: 0o600 });
  if (platform !== 'win32') await chmod(file, 0o600);
  return file;
}

// A provider that was renamed keeps the user's saved file: the first <alias>.env found
// becomes <id>.env. An existing <id>.env always wins and the alias files are left alone.
export async function migrateAliasEnv(provider, opts) {
  if (!provider.aliases?.length) return;
  const target = envFilePath(provider.id, opts);
  try {
    await access(target);
    return;
  } catch { /* no file under the current id yet */ }
  for (const alias of provider.aliases) {
    const from = envFilePath(alias, opts);
    try {
      await rename(from, target);
      return;
    } catch (err) {
      if (err.code !== 'ENOENT') throw new ConfigError(`Cannot rename ${from} to ${target}: ${err.message}`);
    }
  }
}
