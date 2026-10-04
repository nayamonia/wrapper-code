import { ConfigError } from './config.js';

export function derivedEnv(provider, profileId) {
  if (!Object.hasOwn(provider.profiles, profileId)) {
    throw new ConfigError(`Unknown profile "${profileId}" for ${provider.id}. Run: wrapper-code setup ${provider.id}`);
  }
  return { ...provider.env, ...provider.profiles[profileId].env };
}

export function modelEnv(provider, model) {
  const env = { ...provider.env };
  for (const key of provider.models.envKeys) env[key] = model;
  return env;
}

export function isConfigured(provider, fileValues) {
  if (provider.credential && !fileValues[provider.credential.env]) return false;
  if (provider.models && !fileValues.WRAPPER_CODE_MODEL) return false;
  return true;
}

function selectionEnv(provider, fileValues) {
  if (provider.models) {
    const model = fileValues.WRAPPER_CODE_MODEL;
    if (!model) throw new ConfigError(`No model selected for ${provider.id}. Run: wrapper-code setup ${provider.id}`);
    return modelEnv(provider, model);
  }
  return derivedEnv(provider, fileValues.WRAPPER_CODE_PROFILE || provider.defaultProfile);
}

// Every WRAPPER_CODE_* key is the wrapper's own setting and never reaches the child.
const isPrivate = (key) => key.startsWith('WRAPPER_CODE_');

export function buildEnv({ provider, fileValues, baseEnv = process.env }) {
  const env = { ...baseEnv, ...selectionEnv(provider, fileValues) };
  for (const [key, value] of Object.entries(fileValues)) {
    if (!isPrivate(key)) env[key] = value;
  }
  delete env.ANTHROPIC_API_KEY;
  // These make Claude Code ignore ANTHROPIC_BASE_URL and talk to another backend.
  delete env.CLAUDE_CODE_USE_BEDROCK;
  delete env.CLAUDE_CODE_USE_VERTEX;
  delete env.CLAUDE_CODE_USE_FOUNDRY;
  for (const key of Object.keys(env)) if (isPrivate(key)) delete env[key];
  return env;
}
