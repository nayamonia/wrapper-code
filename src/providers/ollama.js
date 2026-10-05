// Values from https://docs.ollama.com/integrations/claude-code and
// https://docs.ollama.com/api/anthropic-compatibility (2026-10-02)
export default {
  id: 'ollama',
  name: 'Ollama',
  family: 'local',
  billing: 'local',
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
    note: 'Ollama serves requests at its own context length, not the model maximum: start it with OLLAMA_CONTEXT_LENGTH=65536 or more. --model on the command line overrides the main model for one session only.',
    emptyHint: 'No models installed. Run: ollama pull qwen3-coder',
  },
  test: { method: 'GET', path: '/api/tags', auth: 'none' },
  editableBaseUrl: true,
};
