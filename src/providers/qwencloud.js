// Values from https://docs.qwencloud.com/developer-guides/clients-and-developer-tools/claude-code
// (pay-as-you-go, 2026-10-03). The model "auto" exists only on Token Plan endpoints: here it
// answered 400 "Model not exist" on 2026-10-06, so every role names a model. qwen3.8-max and
// qwen3.8-flash answered 200 on this endpoint the same day. The endpoint has no GET /v1/models,
// so the key is validated with a one-token POST /v1/messages against the cheapest model
// (costs one output token per setup).
export default {
  id: 'qwencloud',
  name: 'Qwen Cloud',
  family: 'qwen',
  billing: 'payg',
  docs: 'https://docs.qwencloud.com/developer-guides/clients-and-developer-tools/claude-code',
  credential: {
    env: 'ANTHROPIC_AUTH_TOKEN',
    label: 'Qwen Cloud API key',
    help: 'Create one at https://home.qwencloud.com/api-keys (pay-as-you-go, starts with sk-). New accounts get a free quota.',
  },
  env: {
    ANTHROPIC_BASE_URL: 'https://maas.qwencloudapi.com/apps/anthropic',
  },
  profiles: {
    'pay-as-you-go': {
      label: 'Pay-as-you-go: Qwen 3.8 Max as main model, Qwen 3.8 Flash for Sonnet and subagents, Qwen 3.6 Flash for Haiku',
      env: {
        ANTHROPIC_MODEL: 'qwen3.8-max',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'qwen3.8-max',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'qwen3.8-flash',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen3.6-flash',
        CLAUDE_CODE_SUBAGENT_MODEL: 'qwen3.8-flash',
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: '983616',
      },
    },
  },
  defaultProfile: 'pay-as-you-go',
  test: {
    method: 'POST',
    path: '/v1/messages',
    auth: 'bearer',
    headers: { 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: Object.freeze({ model: 'qwen3.6-flash', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
  },
  editableBaseUrl: false,
};
