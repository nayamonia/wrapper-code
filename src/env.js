export function derivedEnv(provider, profileId) {
  const profile = provider.profiles[profileId];
  if (!profile) throw new Error(`Unknown profile "${profileId}" for ${provider.id}. Run: wrapper-code setup ${provider.id}`);
  return { ...provider.env, ...profile.env };
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
  delete env.WRAPPER_CODE_PROFILE;
  return env;
}
