import { ConfigError } from './config.js';

export function derivedEnv(provider, profileId) {
  if (!Object.hasOwn(provider.profiles, profileId)) throw new ConfigError(`Unknown profile "${profileId}" for ${provider.id}. Run: wrapper-code setup ${provider.id}`);
  return { ...provider.env, ...provider.profiles[profileId].env };
}

export function isConfigured(provider, fileValues) {
  if (!provider.credential) return true;
  return Boolean(fileValues[provider.credential.env]);
}

export function buildEnv({ provider, fileValues, baseEnv = process.env }) {
  const profileId = fileValues.WRAPPER_CODE_PROFILE || provider.defaultProfile;
  const env = { ...baseEnv, ...derivedEnv(provider, profileId) };
  for (const [key, value] of Object.entries(fileValues)) {
    if (key !== 'WRAPPER_CODE_PROFILE') env[key] = value;
  }
  delete env.ANTHROPIC_API_KEY;
  // These make Claude Code ignore ANTHROPIC_BASE_URL and talk to another backend.
  delete env.CLAUDE_CODE_USE_BEDROCK;
  delete env.CLAUDE_CODE_USE_VERTEX;
  delete env.CLAUDE_CODE_USE_FOUNDRY;
  delete env.WRAPPER_CODE_PROFILE;
  return env;
}
