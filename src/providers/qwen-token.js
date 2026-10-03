// Values from https://www.alibabacloud.com/help/en/model-studio/claude-code (Token Plan, 2026-10-03).
// Token Plan keys start with sk-sp- like Coding Plan keys, but only work on this endpoint.
// Like the Coding Plan, there is no GET /v1/models, so the key is validated with a
// one-token POST /v1/messages (costs one output token per setup).
const MODEL = 'qwen3.7-plus';

export default {
  id: 'qwen-token',
  name: 'Qwen (Alibaba Token Plan)',
  docs: 'https://www.alibabacloud.com/help/en/model-studio/claude-code',
  credential: {
    env: 'ANTHROPIC_AUTH_TOKEN',
    label: 'Token Plan API key',
    help: 'Model Studio → Token Plan → API keys (starts with sk-sp-). A Coding Plan key goes in wrapper-code qwen instead.',
  },
  env: {
    ANTHROPIC_BASE_URL: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic',
  },
  profiles: {
    'token-plan': {
      label: 'Token Plan: qwen3.7-plus for every role',
      env: {
        ANTHROPIC_MODEL: MODEL,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: MODEL,
        ANTHROPIC_DEFAULT_SONNET_MODEL: MODEL,
        ANTHROPIC_DEFAULT_OPUS_MODEL: MODEL,
        CLAUDE_CODE_SUBAGENT_MODEL: MODEL,
      },
    },
  },
  defaultProfile: 'token-plan',
  test: {
    method: 'POST',
    path: '/v1/messages',
    auth: 'bearer',
    headers: { 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: Object.freeze({ model: MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
  },
  editableBaseUrl: false,
};
