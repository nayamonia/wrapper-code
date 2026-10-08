// Values from https://docs.z.ai/devpack/tool/claude (2026-10-07).
// Only the GLM Coding Plan is offered. On 2026-10-08, with a plan active, every call to the
// Anthropic endpoint counted against the plan, and a usage bundle and the cash balance were left
// untouched, so Claude Code cannot reach Z.ai's pay-as-you-go side from a plan account.
// GET /api/anthropic/v1/models answers 200 even without a key, so the setup check uses the
// paas models route, which answers 401 to a wrong key and costs nothing.
const roles = (main, haiku) => ({
  ANTHROPIC_MODEL: main,
  ANTHROPIC_DEFAULT_OPUS_MODEL: main,
  ANTHROPIC_DEFAULT_SONNET_MODEL: main,
  ANTHROPIC_DEFAULT_FABLE_MODEL: main,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: haiku,
  CLAUDE_CODE_SUBAGENT_MODEL: main,
});

export default {
  id: 'zai-coding',
  name: 'Z.ai GLM Coding Plan',
  family: 'glm',
  billing: 'plan',
  docs: 'https://docs.z.ai/devpack/tool/claude',
  credential: {
    env: 'ANTHROPIC_AUTH_TOKEN',
    label: 'Z.ai API key',
    help: 'GLM Coding Plan subscription: z.ai → API Keys → Create API Key. With the plan active, Claude Code calls count against the plan quota (refreshed every 5 hours), never the account balance or usage bundles.',
  },
  env: {
    ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
    API_TIMEOUT_MS: '3000000',
  },
  profiles: {
    'glm-5.3': {
      label: 'GLM 5.3, GLM 5.3 Flash for the Haiku tier',
      env: roles('glm-5.3', 'glm-5.3-flash'),
    },
    'glm-5.3-1m': {
      label: 'GLM 5.3 with 1M context, GLM 5.3 Flash for the Haiku tier',
      env: { ...roles('glm-5.3[1m]', 'glm-5.3-flash'), CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000' },
    },
    flash: {
      label: 'GLM 5.3 Flash for every role, to save plan quota',
      env: roles('glm-5.3-flash', 'glm-5.3-flash'),
    },
  },
  defaultProfile: 'glm-5.3',
  test: { method: 'GET', url: 'https://api.z.ai/api/paas/v4/models', auth: 'bearer' },
  editableBaseUrl: false,
};
