import { createRequire } from 'node:module';
import { loadCatalog } from './catalog.js';
import { readProviderEnv, writeProviderEnv, envFilePath, ConfigError } from './config.js';
import { buildEnv, isConfigured } from './env.js';
import { resolveClaude, launchClaude } from './launch.js';
import { openBrowser } from './open.js';
import { startSetupServer } from './setup/server.js';

const pkg = createRequire(import.meta.url)('../package.json');

export const HELP = `wrapper-code ${pkg.version}
Run Claude Code with another LLM provider, without touching your Claude Code configuration.

Usage:
  wrapper-code <provider> [claude args...]   Launch Claude Code with <provider> (opens setup first if needed)
  wrapper-code setup <provider>              Open the setup page to change the key or model profile
  wrapper-code list                          List providers and whether they are configured
  wrapper-code --help | --version

Config files live in ~/.config/wrapper-code (POSIX) or %APPDATA%\\wrapper-code (Windows).
`;

const INSTALL_HINT = 'claude not found on PATH. Install Claude Code: npm install -g @anthropic-ai/claude-code\n';

async function runSetup(provider, current, { cfg, stdout, stderr, openBrowserImpl, startSetupServerImpl }) {
  const server = await startSetupServerImpl({
    provider,
    current,
    writeEnv: (values) => writeProviderEnv(provider.id, values, cfg),
  });
  stdout.write(`Setup page: ${server.url}\nIf your browser did not open, open this URL manually. Waiting (10 min timeout)...\n`);
  openBrowserImpl(server.url, { platform: cfg.platform });
  const result = await server.done;
  if (result.saved) {
    stdout.write(`Saved to ${envFilePath(provider.id, cfg)}\n`);
  } else {
    stderr.write(`Setup ${result.reason === 'timeout' ? 'timed out' : 'was cancelled'}. Nothing was saved.\n`);
  }
  return result;
}

export function reportFatal(err, stderr = process.stderr) {
  if (err instanceof ConfigError) {
    stderr.write(`wrapper-code: ${err.message}\n`);
  } else {
    stderr.write(`wrapper-code: unexpected error\n${err?.stack ?? String(err)}\n`);
  }
}

export async function main(argv, deps = {}) {
  const {
    stdout = process.stdout,
    stderr = process.stderr,
    env = process.env,
    platform = process.platform,
    home,
    openBrowserImpl = openBrowser,
    launchImpl = launchClaude,
    resolveClaudeImpl = resolveClaude,
    startSetupServerImpl = startSetupServer,
    catalogImpl = loadCatalog,
  } = deps;
  const cfg = { platform, env, ...(home ? { home } : {}) };
  const setupDeps = { cfg, stdout, stderr, openBrowserImpl, startSetupServerImpl };

  const [first, ...rest] = argv;
  if (!first || first === '--help' || first === '-h') {
    stdout.write(HELP);
    return first ? 0 : 1;
  }
  if (first === '--version' || first === '-v') {
    stdout.write(`${pkg.version}\n`);
    return 0;
  }

  const catalog = await catalogImpl();
  const ids = [...catalog.keys()];
  const unknown = (id) => {
    stderr.write(`Unknown provider "${id}". Available: ${ids.join(', ')}\n`);
    return 1;
  };

  if (first === 'list') {
    let failed = false;
    for (const provider of catalog.values()) {
      let status;
      try {
        const values = await readProviderEnv(provider.id, cfg);
        status = isConfigured(provider, values) ? 'configured' : 'not configured';
      } catch (err) {
        failed = true;
        status = `error: ${err.message}`;
      }
      stdout.write(`${provider.id.padEnd(12)} ${provider.name.padEnd(12)} ${status}\n`);
    }
    return failed ? 1 : 0;
  }

  if (first === 'setup') {
    const id = (rest[0] || '').toLowerCase();
    const provider = catalog.get(id);
    if (!provider) return unknown(rest[0] || '(missing)');
    const current = await readProviderEnv(provider.id, cfg);
    const result = await runSetup(provider, current, setupDeps);
    return result.saved ? 0 : 1;
  }

  const provider = catalog.get(first.toLowerCase());
  if (!provider) return unknown(first);

  let values = await readProviderEnv(provider.id, cfg);
  if (!isConfigured(provider, values)) {
    stdout.write(`${provider.name} is not configured yet. Opening setup...\n`);
    const result = await runSetup(provider, values, setupDeps);
    if (!result.saved) return 1;
    values = await readProviderEnv(provider.id, cfg);
  }

  const childEnv = buildEnv({ provider, fileValues: values, baseEnv: env });
  const claudePath = resolveClaudeImpl({ platform, env });
  if (!claudePath) {
    stderr.write(INSTALL_HINT);
    return 1;
  }
  const { code, error } = await launchImpl({ claudePath, args: rest, env: childEnv });
  if (error) stderr.write(`Failed to start claude: ${error.message}\n`);
  return code;
}
