import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadCatalog } from './catalog.js';
import { readProviderEnv, writeProviderEnv, envFilePath, ConfigError } from './config.js';
import { buildEnv, isConfigured } from './env.js';
import { resolveClaude, launchClaude } from './launch.js';
import { openBrowser } from './open.js';
import { startSetupServer } from './setup/server.js';
import { creditLine } from './credits.js';
import { showSplash, shouldSplash } from './splash.js';
import { runUsage } from './usage/report.js';
import { startUsageReceiver, TOKEN_HEADER as USAGE_TOKEN_HEADER } from './usage/receiver.js';
import { appendUsage, usageFilePath } from './usage/store.js';
import { renderSummary } from './usage/summary.js';
import { supportsTruecolor } from './brand.js';

const pkg = createRequire(import.meta.url)('../package.json');

export const HELP = `wrapper-code ${pkg.version}
Run Claude Code with another LLM provider, without touching your Claude Code configuration.

Usage:
  wrapper-code <provider> [claude args...]   Launch Claude Code with <provider> (opens setup first if needed)
  wrapper-code setup <provider>              Open the setup page to change the key or model profile
  wrapper-code list                          List providers and whether they are configured
  wrapper-code usage [--since 24h|7d|30d|all] [--provider <id>] [--by-day] [--json]
                                             Token usage per provider and model
  wrapper-code --help | --version

Config files live in ~/.config/wrapper-code (POSIX) or %APPDATA%\\wrapper-code (Windows).

${creditLine()}
`;

export function displayPath(file, homeDir) {
  if (!homeDir) return file;
  const base = homeDir.length > 1 ? homeDir.replace(/[\\/]+$/, '') : homeDir;
  if (file === base) return '~';
  const sep = file.startsWith(base + '/') ? '/' : file.startsWith(base + path.sep) ? path.sep : null;
  return sep ? `~${file.slice(base.length)}` : file;
}

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

const INJECTED_OTEL_KEYS = [
  'CLAUDE_CODE_ENABLE_TELEMETRY', 'OTEL_LOGS_EXPORTER', 'OTEL_METRICS_EXPORTER', 'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_HEADERS', 'OTEL_LOGS_EXPORT_INTERVAL',
];
// Measured against the real Claude Code: the final batch arrives before the child exits,
// so the linger only covers a straggler.
const DEFAULT_LINGER_MS = 500;

async function finishUsage({ receiver, failedToStart, collected, cfg, home, provider, selection, startedAt, endedAt, stdout, stderr, env }) {
  if (failedToStart) {
    // claude never ran: nothing will arrive, do not linger.
    await receiver.close({ now: true });
  } else {
    // A Ctrl+C or SIGTERM during the post-exit linger ends it early instead of killing us
    // before the usage is written.
    const endLinger = () => { receiver.close({ now: true }); };
    process.on('SIGINT', endLinger);
    process.on('SIGTERM', endLinger);
    try {
      await receiver.close();
    } finally {
      process.off('SIGINT', endLinger);
      process.off('SIGTERM', endLinger);
    }
  }
  const file = usageFilePath(cfg);
  let writeError = null;
  try {
    await appendUsage(collected, cfg);
  } catch (err) {
    writeError = err;
  }
  const colored = shouldSplash({ stdout, env });
  stdout.write(renderSummary({
    providerName: provider.name, selection, events: collected, startedAt, endedAt,
    file: displayPath(file, home || homedir()), saved: !writeError,
    malformed: receiver.stats.malformed, truecolor: colored ? supportsTruecolor(env) : undefined,
  }));
  if (writeError) stderr.write(`usage: could not write ${file}: ${writeError.message}\n`);
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
    sleepImpl,
    startUsageReceiverImpl = startUsageReceiver,
    nowImpl = Date.now,
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

  if (first === 'usage') {
    return runUsage(rest, { cfg, stdout, stderr });
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
    let current;
    try {
      current = await readProviderEnv(provider.id, cfg);
    } catch (err) {
      if (!(err instanceof ConfigError)) throw err;
      stderr.write(`Warning: ${err.message}\nThe existing file will be replaced when you save.\n`);
      current = {};
    }
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
  const selection = provider.models ? values.WRAPPER_CODE_MODEL : (values.WRAPPER_CODE_PROFILE || provider.defaultProfile);

  // Usage telemetry: a local OTLP receiver for this session.
  let receiver = null;
  const sessionId = randomBytes(8).toString('hex');
  const collected = [];
  // Inside a wrapper-code session the shell carries the parent's injected receiver vars.
  // They are ours, not the user's: drop them so this session gets its own receiver.
  const nested = String(env.OTEL_EXPORTER_OTLP_HEADERS || '').includes(`${USAGE_TOKEN_HEADER}=`);
  if (nested) for (const key of INJECTED_OTEL_KEYS) delete childEnv[key];
  const userOtel = (key) => !(nested && INJECTED_OTEL_KEYS.includes(key)) && env[key];
  if (env.WRAPPER_CODE_NO_USAGE === '1') {
    // Opted out: inject nothing, print nothing.
  } else if (userOtel('OTEL_EXPORTER_OTLP_ENDPOINT') || userOtel('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT') || userOtel('CLAUDE_CODE_ENABLE_TELEMETRY')) {
    stdout.write('usage: your OTEL settings are kept; wrapper-code will not record this session\n');
  } else {
    try {
      const lingerMs = Number(env.WRAPPER_CODE_USAGE_LINGER_MS) || DEFAULT_LINGER_MS;
      receiver = await startUsageReceiverImpl({
        lingerMs,
        onEvent: (raw, ts) => {
          collected.push({ ts, sessionId, provider: provider.id, selection, ...raw });
        },
      });
      for (const key of Object.keys(childEnv)) if (/^OTEL_EXPORTER_OTLP_LOGS_/.test(key)) delete childEnv[key];
      Object.assign(childEnv, receiver.env);
    } catch (err) {
      stdout.write(`usage: receiver could not start (${err.message}); session runs without usage tracking\n`);
    }
  }

  let startedAt;
  let code;
  let error;
  try {
    await showSplash({ stdout, env, version: pkg.version, providerName: provider.name, selection, ...(sleepImpl ? { sleep: sleepImpl } : {}) });
    startedAt = nowImpl();
    ({ code, error } = await launchImpl({ claudePath, args: rest, env: childEnv }));
  } catch (err) {
    // A listening receiver would keep the process alive: close it before propagating.
    if (receiver) await Promise.resolve().then(() => receiver.close({ now: true })).catch(() => {});
    throw err;
  }
  if (error) stderr.write(`Failed to start claude: ${error.message}\n`);
  const endedAt = nowImpl();

  if (receiver) {
    // Usage problems are reported, never allowed to change claude's exit code.
    try {
      await finishUsage({ receiver, failedToStart: Boolean(error), collected, cfg, home, provider, selection, startedAt, endedAt, stdout, stderr, env });
    } catch (err) {
      try { stderr.write(`usage: ${err?.message ?? String(err)}\n`); } catch { /* nothing left to report to */ }
    }
  }
  return code;
}
