// Values from https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/ (2026-10-02)
export default {
  id: 'deepseek',
  name: 'DeepSeek',
  docs: 'https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/',
  credential: {
    env: 'ANTHROPIC_AUTH_TOKEN',
    label: 'API key',
    help: 'Create one at https://platform.deepseek.com/api_keys',
  },
  env: {
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    CLAUDE_CODE_EFFORT_LEVEL: 'max',
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: '786432',
  },
  profiles: {
    'flash-1m': {
      label: 'DeepSeek Flash, 1M context (documentation default)',
      env: {
        ANTHROPIC_MODEL: 'deepseek-flash[1m]',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-flash[1m]',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-flash[1m]',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-flash',
        CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
      },
    },
    'v4-pro': {
      label: 'DeepSeek V4 Pro as main model, Flash for subagents',
      env: {
        ANTHROPIC_MODEL: 'deepseek-v4-pro',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-flash[1m]',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-flash',
        CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
      },
    },
  },
  defaultProfile: 'flash-1m',
  test: { method: 'GET', url: 'https://api.deepseek.com/models', auth: 'bearer' },
  editableBaseUrl: false,
};
