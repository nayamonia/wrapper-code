// Values from https://openrouter.ai/docs/guides/guides/claude-code-integration (2026-10-03).
// OpenRouter exposes the Anthropic Messages API at /api/v1/messages for every model it
// serves. The model list is public (GET /api/v1/models); a model works with Claude Code
// only when it supports tool calling. The key is checked for free against GET /api/v1/key.
export default {
  id: 'openrouter',
  name: 'OpenRouter',
  family: 'gateway',
  billing: 'payg',
  docs: 'https://openrouter.ai/docs/guides/guides/claude-code-integration',
  credential: {
    env: 'ANTHROPIC_AUTH_TOKEN',
    label: 'OpenRouter API key',
    help: 'Create one at https://openrouter.ai/keys. Billing goes through your OpenRouter credits.',
  },
  env: {
    ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
  },
  models: {
    format: 'openrouter',
    discoverPath: '/v1/models',
    requireCapability: 'tools',
    envKeys: [
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_DEFAULT_FABLE_MODEL',
      'CLAUDE_CODE_SUBAGENT_MODEL',
    ],
    note: 'The chosen model is used for every role, subagents included; edit ANTHROPIC_DEFAULT_HAIKU_MODEL and CLAUDE_CODE_SUBAGENT_MODEL in the saved .env for a cheaper subagent model. OpenRouter warns that Claude Code is tuned for Anthropic models and others may behave worse.',
    emptyHint: 'OpenRouter returned no models. Click Refresh list to try again.',
  },
  test: { method: 'GET', url: 'https://openrouter.ai/api/v1/key', auth: 'bearer' },
  editableBaseUrl: false,
};
