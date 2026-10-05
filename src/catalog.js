import { readdir } from 'node:fs/promises';

const PROVIDERS_DIR = new URL('./providers/', import.meta.url);
// Order matters: list sorts a family's providers in this order.
export const BILLINGS = ['plan', 'payg', 'local'];
const FAMILY_RE = /^[a-z0-9-]+$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateProvider(provider) {
  if (!isObject(provider)) throw new Error('provider must be an object');
  if (typeof provider.id !== 'string' || !provider.id) throw new Error('provider.id must be a non-empty string');
  const where = `provider "${provider.id}"`;
  if (typeof provider.name !== 'string' || !provider.name) throw new Error(`${where}: name is required`);
  if (typeof provider.family !== 'string' || !FAMILY_RE.test(provider.family)) {
    throw new Error(`${where}: family must be lowercase letters, digits and dashes`);
  }
  if (!BILLINGS.includes(provider.billing)) {
    throw new Error(`${where}: billing must be one of ${BILLINGS.join(', ')}`);
  }
  if (!isObject(provider.env)) throw new Error(`${where}: env must be an object`);
  const hasProfiles = provider.profiles !== undefined;
  const hasModels = provider.models !== undefined;
  if (hasProfiles && hasModels) throw new Error(`${where}: use profiles or models, not both`);
  if (!hasProfiles && !hasModels) throw new Error(`${where}: needs profiles or models`);
  if (hasProfiles) {
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
  }
  if (hasModels) {
    const m = provider.models;
    if (!isObject(m) || typeof m.discoverPath !== 'string' || !m.discoverPath.startsWith('/')) {
      throw new Error(`${where}: models.discoverPath must be a path starting with /`);
    }
    if (!Array.isArray(m.envKeys) || m.envKeys.length === 0 || !m.envKeys.every((k) => typeof k === 'string')) {
      throw new Error(`${where}: models.envKeys must be a non-empty array of strings`);
    }
    if (m.format !== undefined && !['ollama', 'openrouter'].includes(m.format)) {
      throw new Error(`${where}: models.format must be "ollama" or "openrouter"`);
    }
    if (m.emptyHint !== undefined && typeof m.emptyHint !== 'string') {
      throw new Error(`${where}: models.emptyHint must be a string`);
    }
  }
  if (provider.credential !== null) {
    if (!isObject(provider.credential) || typeof provider.credential.env !== 'string' || typeof provider.credential.label !== 'string') {
      throw new Error(`${where}: credential must be null or { env, label, help }`);
    }
  }
  if (!isObject(provider.test) || (typeof provider.test.url !== 'string' && typeof provider.test.path !== 'string')) {
    throw new Error(`${where}: test must be { method, url | path, auth }`);
  }
  if (provider.test.headers !== undefined && !isObject(provider.test.headers)) {
    throw new Error(`${where}: test.headers must be an object of header name to value`);
  }
  if (provider.test.body !== undefined && !isObject(provider.test.body)) {
    throw new Error(`${where}: test.body must be a plain object (it is sent as JSON)`);
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
