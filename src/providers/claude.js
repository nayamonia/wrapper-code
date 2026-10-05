// Claude Code itself, with the user's own login, models and settings. Nothing is changed for
// the session; it exists so Anthropic usage is recorded next to the other providers.
export default {
  id: 'claude',
  name: 'Claude Code',
  family: 'anthropic',
  billing: 'plan',
  docs: 'https://code.claude.com/docs/en/monitoring-usage',
  passthrough: true,
  credential: null,
};
