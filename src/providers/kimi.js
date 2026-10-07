// Values from https://platform.kimi.ai/docs/guide/claude-code-kimi and
// https://platform.kimi.ai/docs/models (2026-10-03, re-checked 2026-10-07).
// The Anthropic-compatible base has no model listing, so the key is checked for
// free against the OpenAI-style models route, which accepts the same key.
// "[1m]" is Claude Code's 1M-context marker on the model id, as in the guide.
const K3 = 'kimi-k3[1m]';
const K27 = 'kimi-k2.7-code';

export default {
  id: 'kimi',
  name: 'Kimi (Moonshot API)',
  family: 'kimi',
  billing: 'payg',
  docs: 'https://platform.kimi.ai/docs/guide/claude-code-kimi',
  credential: {
    env: 'ANTHROPIC_AUTH_TOKEN',
    label: 'Moonshot API key',
    help: 'Create one at https://platform.kimi.ai (API keys). Pay per token. A Kimi Code subscription key goes in wrapper-code kimi-code.',
  },
  env: {
    ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic',
    CLAUDE_CODE_EFFORT_LEVEL: 'max',
  },
  profiles: {
    'k3-1m': {
      label: 'Kimi K3 with 1M context (guide default), K2.7 Code for the Haiku tier',
      env: {
        ANTHROPIC_MODEL: K3,
        ANTHROPIC_DEFAULT_OPUS_MODEL: K3,
        ANTHROPIC_DEFAULT_SONNET_MODEL: K3,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: K27,
        ANTHROPIC_DEFAULT_FABLE_MODEL: K3,
        CLAUDE_CODE_SUBAGENT_MODEL: K3,
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
      },
    },
    'k2.7-code': {
      label: 'Kimi K2.7 Code, 256k context, dedicated coding model (needs thinking on: Alt+T / Option+T in Claude Code)',
      env: {
        ANTHROPIC_MODEL: K27,
        ANTHROPIC_DEFAULT_OPUS_MODEL: K27,
        ANTHROPIC_DEFAULT_SONNET_MODEL: K27,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: K27,
        ANTHROPIC_DEFAULT_FABLE_MODEL: K27,
        CLAUDE_CODE_SUBAGENT_MODEL: K27,
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '262144',
      },
    },
  },
  defaultProfile: 'k3-1m',
  test: { method: 'GET', url: 'https://api.moonshot.ai/v1/models', auth: 'bearer' },
  editableBaseUrl: false,
};
