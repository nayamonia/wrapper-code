// Values from https://www.alibabacloud.com/help/en/model-studio/claude-code (Coding Plan, 2026-10-03).
// The Coding Plan endpoint has no GET /v1/models, so the key is validated with a
// one-token POST /v1/messages (costs one output token per setup).
const MODEL = 'qwen3.7-plus';

export default {
  id: 'qwen',
  name: 'Qwen (Alibaba Model Studio)',
  docs: 'https://www.alibabacloud.com/help/en/model-studio/claude-code',
  credential: {
    env: 'ANTHROPIC_AUTH_TOKEN',
    label: 'Coding Plan API key',
    help: 'Model Studio → Coding Plan → API keys (starts with sk-sp-). A Token Plan sk-sp- key goes in wrapper-code alibaba-token; pay-as-you-go sk- and sk-ws- keys are not supported.',
  },
  env: {
    ANTHROPIC_BASE_URL: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
  },
  profiles: {
    'coding-plan': {
      label: 'Coding Plan (international): qwen3.7-plus for every role',
      env: {
        ANTHROPIC_MODEL: MODEL,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: MODEL,
        ANTHROPIC_DEFAULT_SONNET_MODEL: MODEL,
        ANTHROPIC_DEFAULT_OPUS_MODEL: MODEL,
        CLAUDE_CODE_SUBAGENT_MODEL: MODEL,
      },
    },
  },
  defaultProfile: 'coding-plan',
  test: {
    method: 'POST',
    path: '/v1/messages',
    auth: 'bearer',
    headers: { 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: Object.freeze({ model: MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
  },
  editableBaseUrl: false,
};
