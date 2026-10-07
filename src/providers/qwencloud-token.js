// Values from https://docs.qwencloud.com/developer-guides/clients-and-developer-tools/claude-code
// (Token Plan Personal Edition, 2026-10-06). Alibaba Model Studio and Qwen Cloud are one backend:
// on 2026-10-06 the same sk-sp- key answered on this endpoint and on the aliyuncs Token Plan one,
// with the same models. This provider was "alibaba" until then, so that name stays as an alias.
// There is no GET /v1/models, so the key is validated with a
// one-token POST /v1/messages (costs one output token per setup).
const roles = (main, fast) => ({
  ANTHROPIC_MODEL: main,
  ANTHROPIC_DEFAULT_OPUS_MODEL: main,
  ANTHROPIC_DEFAULT_SONNET_MODEL: main,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: fast,
  CLAUDE_CODE_SUBAGENT_MODEL: fast,
});

export default {
  id: 'qwencloud-token',
  name: 'Qwen Cloud Token Plan',
  family: 'qwen',
  billing: 'plan',
  aliases: ['alibaba'],
  docs: 'https://docs.qwencloud.com/developer-guides/clients-and-developer-tools/claude-code',
  credential: {
    env: 'ANTHROPIC_AUTH_TOKEN',
    label: 'Token Plan API key',
    help: 'Token Plan key (Personal or Team Edition, starts with sk-sp-) from the Qwen Cloud or Alibaba Model Studio console. Pay-as-you-go keys go in wrapper-code qwencloud.',
  },
  env: {
    ANTHROPIC_BASE_URL: 'https://token-plan.maas.qwencloudapi.com/apps/anthropic',
  },
  profiles: {
    // auto is the docs' own block and works only on Token Plan endpoints.
    auto: {
      label: 'Automatic routing, Qwen 3.8 Max for Opus, Qwen 3.8 Flash for Sonnet, Qwen 3.6 Flash for Haiku',
      env: {
        ANTHROPIC_MODEL: 'auto',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'qwen3.8-max',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'qwen3.8-flash',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen3.6-flash',
        CLAUDE_CODE_SUBAGENT_MODEL: 'auto',
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: '983616',
      },
    },
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
  defaultProfile: 'auto',
  test: {
    method: 'POST',
    path: '/v1/messages',
    auth: 'bearer',
    headers: { 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: Object.freeze({ model: 'qwen3.7-plus', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
  },
  editableBaseUrl: false,
};
