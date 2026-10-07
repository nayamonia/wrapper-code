// Values from https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html (2026-10-07).
// The guide sets the key as ANTHROPIC_API_KEY, but on 2026-10-07 the endpoint answered 200 to
// Bearer auth as well, so the key goes in ANTHROPIC_AUTH_TOKEN like every other provider here.
// GET /v1/models answers with the key and costs nothing, so it is the setup check.
// The context variables must match the model's window, as the guide asks.
const sameModel = (model, window) => ({
  ANTHROPIC_MODEL: model,
  ANTHROPIC_DEFAULT_OPUS_MODEL: model,
  ANTHROPIC_DEFAULT_SONNET_MODEL: model,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
  ANTHROPIC_DEFAULT_FABLE_MODEL: model,
  CLAUDE_CODE_SUBAGENT_MODEL: model,
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: window,
  CLAUDE_CODE_MAX_CONTEXT_TOKENS: window,
});

export default {
  id: 'kimi-code',
  name: 'Kimi Code',
  family: 'kimi',
  billing: 'plan',
  docs: 'https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html',
  credential: {
    env: 'ANTHROPIC_AUTH_TOKEN',
    label: 'Kimi Code API key',
    help: 'Kimi membership with Kimi Code: Kimi Code Console → Create API Key. A pay-per-token Moonshot key goes in wrapper-code kimi.',
  },
  env: {
    ANTHROPIC_BASE_URL: 'https://api.kimi.com/coding',
    CLAUDE_CODE_EFFORT_LEVEL: 'high',
  },
  profiles: {
    'k3-1m': {
      label: 'Kimi K3 with 1M context for every role',
      env: sameModel('k3[1m]', '1048576'),
    },
    'k3-256k': {
      label: 'Kimi K3 with 256k context for every role',
      env: sameModel('k3-256k', '262144'),
    },
  },
  defaultProfile: 'k3-1m',
  test: { method: 'GET', path: '/v1/models', auth: 'bearer' },
  editableBaseUrl: false,
};
