// Everything that outranks a /login in Claude Code's auth precedence: with any of these set,
// the account's login would be silently ignored.
export const AUTH_VARS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
];

export function accountEnv(baseEnv, dir) {
  const env = Object.fromEntries(Object.entries(baseEnv).filter(([key]) => !key.startsWith('WRAPPER_CODE_')));
  const removed = AUTH_VARS.filter((key) => env[key]);
  for (const key of AUTH_VARS) delete env[key];
  const replacedConfigDir = Boolean(env.CLAUDE_CONFIG_DIR) && env.CLAUDE_CONFIG_DIR !== dir;
  env.CLAUDE_CONFIG_DIR = dir;
  return { env, removed, replacedConfigDir };
}
