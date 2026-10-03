// Values from https://docs.ollama.com/integrations/claude-code and
// https://docs.ollama.com/api/anthropic-compatibility (2026-10-02)
export default {
  id: 'ollama',
  name: 'Ollama',
  docs: 'https://docs.ollama.com/integrations/claude-code',
  credential: null,
  env: {
    ANTHROPIC_BASE_URL: 'http://localhost:11434',
    ANTHROPIC_AUTH_TOKEN: 'ollama',
  },
  models: {
    discoverPath: '/api/tags',
    requireCapability: 'tools',
    envKeys: [
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'CLAUDE_CODE_SUBAGENT_MODEL',
    ],
    note: 'Ollama recommends a context window of 64k tokens or more for larger repositories. Use --model on the command line to override the default for one session.',
  },
  test: { method: 'GET', path: '/api/tags', auth: 'none' },
  editableBaseUrl: true,
};
