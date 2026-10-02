import { readdir } from 'node:fs/promises';

const PROVIDERS_DIR = new URL('./providers/', import.meta.url);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateProvider(provider) {
  if (!isObject(provider)) throw new Error('provider must be an object');
  if (typeof provider.id !== 'string' || !provider.id) throw new Error('provider.id must be a non-empty string');
  const where = `provider "${provider.id}"`;
  if (typeof provider.name !== 'string' || !provider.name) throw new Error(`${where}: name is required`);
  if (!isObject(provider.env)) throw new Error(`${where}: env must be an object`);
  if (!isObject(provider.profiles) || Object.keys(provider.profiles).length === 0) {
    throw new Error(`${where}: profiles must have at least one entry`);
  }
  for (const [pid, profile] of Object.entries(provider.profiles)) {
    if (!isObject(profile) || typeof profile.label !== 'string' || !isObject(profile.env)) {
      throw new Error(`${where}: profiles.${pid} needs label and env`);
    }
  }
  if (!Object.hasOwn(provider.profiles, provider.defaultProfile)) {
    throw new Error(`${where}: defaultProfile "${provider.defaultProfile}" is not in profiles`);
  }
  if (provider.credential !== null) {
    if (!isObject(provider.credential) || typeof provider.credential.env !== 'string' || typeof provider.credential.label !== 'string') {
      throw new Error(`${where}: credential must be null or { env, label, help }`);
    }
  }
  if (!isObject(provider.test) || typeof provider.test.url !== 'string') {
    throw new Error(`${where}: test must be { method, url, auth }`);
  }
}

export async function loadCatalog(dirUrl = PROVIDERS_DIR) {
  const catalog = new Map();
  const files = (await readdir(dirUrl)).filter((f) => f.endsWith('.js')).sort();
  for (const file of files) {
    const mod = await import(new URL(file, dirUrl));
    const provider = mod.default;
    validateProvider(provider);
    catalog.set(provider.id, provider);
  }
  return catalog;
}
