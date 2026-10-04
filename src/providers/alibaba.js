// Values from https://www.alibabacloud.com/help/en/model-studio/claude-code (Token Plan, 2026-10-03).
// Token Plan keys start with sk-sp- and only work on this endpoint.
// Every model below answered HTTP 200 on this endpoint's /v1/messages on 2026-10-03.
// There is no GET /v1/models, so the key is validated with a
// one-token POST /v1/messages (costs one output token per setup).
const roles = (main, fast) => ({
  ANTHROPIC_MODEL: main,
  ANTHROPIC_DEFAULT_OPUS_MODEL: main,
  ANTHROPIC_DEFAULT_SONNET_MODEL: main,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: fast,
  CLAUDE_CODE_SUBAGENT_MODEL: fast,
});

// Token Plan is prepaid; no per-token price, so usage shows tokens only.
export default {
  id: 'alibaba',
  name: 'Alibaba Token Plan',
  docs: 'https://www.alibabacloud.com/help/en/model-studio/claude-code',
  credential: {
    env: 'ANTHROPIC_AUTH_TOKEN',
    label: 'Token Plan API key',
    help: 'Model Studio → Token Plan → API keys (starts with sk-sp-). Pay-as-you-go keys from Qwen Cloud go in wrapper-code qwencloud.',
  },
  env: {
    ANTHROPIC_BASE_URL: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic',
  },
  profiles: {
    'qwen-max': {
      label: 'Qwen 3.8 Max as main model, Qwen 3.8 Flash for subagents',
      env: roles('qwen3.8-max', 'qwen3.8-flash'),
    },
    'qwen-plus': {
      label: 'Qwen 3.7 Plus for every role',
      env: roles('qwen3.7-plus', 'qwen3.7-plus'),
    },
    'deepseek-pro': {
      label: 'DeepSeek V4 Pro as main model, DeepSeek V4.1 Flash for subagents',
      env: roles('deepseek-v4-pro', 'deepseek-v4.1-flash'),
    },
    glm: {
      label: 'GLM 5.3 for every role',
      env: roles('glm-5.3', 'glm-5.3'),
    },
  },
  defaultProfile: 'qwen-max',
  test: {
    method: 'POST',
    path: '/v1/messages',
    auth: 'bearer',
    headers: { 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: Object.freeze({ model: 'qwen3.7-plus', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
  },
  editableBaseUrl: false,
};
