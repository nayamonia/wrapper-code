import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { loadCatalog, resolveProvider } from './catalog.js';
import { readProviderEnv, writeProviderEnv, envFilePath, migrateAliasEnv, ConfigError } from './config.js';
import { buildEnv, isConfigured } from './env.js';
import { resolveClaude, launchClaude } from './launch.js';
import { openBrowser } from './open.js';
import { startSetupServer } from './setup/server.js';
import { creditLine } from './credits.js';
import { runAccountsCommand, parseAccountFlags, prepareAccountSession } from './accounts/commands.js';
import { runAuth } from './accounts/auth.js';
import { pidAlive } from './accounts/temp.js';
import { showSplash, shouldSplash } from './splash.js';
import { runUsage } from './usage/report.js';
import { startUsageReceiver, TOKEN_HEADER as USAGE_TOKEN_HEADER } from './usage/receiver.js';
import { appendUsage, usageFilePath } from './usage/store.js';
import { renderSummary } from './usage/summary.js';
import { supportsTruecolor } from './brand.js';
import { compareProviders, selectionOf, formatTable } from './list.js';

const pkg = createRequire(import.meta.url)('../package.json');

export const HELP = `wrapper-code ${pkg.version}
Run Claude Code with another LLM provider, without touching your Claude Code configuration.

Usage:
  wrapper-code <provider> [claude args...]   Launch Claude Code with <provider> (opens setup first if needed)
  wrapper-code claude [claude args...]       Launch your own Claude Code unchanged, only recording token usage
  wrapper-code claude --account <name> [claude args...]
                                             Launch your Claude Code logged in to a saved Claude account
  wrapper-code claude --temp [claude args...]
                                             Launch it with a one-off login, removed when the session ends
  wrapper-code accounts [add <name> | remove <name> [--yes]]
                                             List, add or remove saved Claude accounts (macOS, Linux)
  wrapper-code setup <provider>              Open the setup page to change the key or model profile
  wrapper-code list                          List providers and whether they are configured
  wrapper-code usage [--since 24h|7d|30d|all] [--provider <id>] [--by-day] [--json]
                                             Token usage per provider and model
  wrapper-code usage clear [--provider <id>] [--yes]
                                             Delete the recorded usage, all of it or one provider's
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

// Resolves true or false, or null when there is no terminal to ask on.
async function confirmOnTerminal(question) {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

export const INSTALL_HINT = 'claude not found on PATH. Install Claude Code: npm install -g @anthropic-ai/claude-code\n';

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
    confirmImpl = confirmOnTerminal,
    authImpl = runAuth,
    tmpRoot = tmpdir(),
    pidAliveImpl = pidAlive,
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

  if (first === 'usage') {
    // Records keep the id they were written with; an alias reads as its current id.
    const canonical = (id) => resolveProvider(catalog, id)?.id ?? id;
    return runUsage(rest, { cfg, stdout, stderr, confirm: confirmImpl, display: (file) => displayPath(file, home || homedir()), canonical });
  }

  const accountCtx = {
    cfg, home: home || homedir(), env, platform, stdout, stderr, confirm: confirmImpl,
    authImpl, resolveClaudeImpl, tmpRoot, pidAliveImpl, installHint: INSTALL_HINT,
  };
  if (first === 'accounts') return runAccountsCommand(rest, accountCtx);

  const ids = [...catalog.keys()];
  const unknown = (id) => {
    stderr.write(`Unknown provider "${id}". Available: ${ids.join(', ')}\n`);
    return 1;
  };

  if (first === 'list') {
    const rows = [['FAMILY', 'PROVIDER', 'BILLING', 'STATUS', 'SELECTION']];
    const errors = [];
    for (const provider of [...catalog.values()].sort(compareProviders)) {
      let status = 'not configured';
      let selection = '-';
      try {
        if (!provider.passthrough) await migrateAliasEnv(provider, cfg);
        const values = provider.passthrough ? {} : await readProviderEnv(provider.id, cfg);
        if (isConfigured(provider, values)) {
          status = 'configured';
          selection = selectionOf(provider, values) || '-';
        }
      } catch (err) {
        status = 'error';
        errors.push(err.message);
      }
      rows.push([provider.family, provider.id, provider.billing, status, selection]);
    }
    stdout.write(formatTable(rows));
    // Full messages after the table, so an error never breaks the column alignment.
    for (const message of errors) stderr.write(`wrapper-code: ${message}\n`);
    return errors.length ? 1 : 0;
  }

  if (first === 'setup') {
    const provider = resolveProvider(catalog, rest[0]);
    if (!provider) return unknown(rest[0] || '(missing)');
    if (provider.passthrough) {
      stdout.write(`${provider.name} needs no setup: wrapper-code ${provider.id} runs it with your own configuration and only records token usage.\n`);
      return 0;
    }
    let current;
    try {
      await migrateAliasEnv(provider, cfg);
      current = await readProviderEnv(provider.id, cfg);
    } catch (err) {
      if (!(err instanceof ConfigError)) throw err;
      stderr.write(`Warning: ${err.message}\nThe existing file will be replaced when you save.\n`);
      current = {};
    }
    const result = await runSetup(provider, current, setupDeps);
    return result.saved ? 0 : 1;
  }

  const provider = resolveProvider(catalog, first);
  if (!provider) return unknown(first);

  // wrapper-code claude --account <name> | --temp: wrapper-code's flags, read before claude's.
  let args = rest;
  let accountFlags = null;
  if (provider.passthrough) {
    const parsed = parseAccountFlags(rest);
    if (parsed.error) {
      stderr.write(`${parsed.error}\n`);
      return 1;
    }
    args = parsed.rest;
    if (parsed.account !== null || parsed.temp) accountFlags = parsed;
  }

  if (!provider.passthrough) await migrateAliasEnv(provider, cfg);
  let values = provider.passthrough ? {} : await readProviderEnv(provider.id, cfg);
  if (!isConfigured(provider, values)) {
    stdout.write(`${provider.name} is not configured yet. Opening setup...\n`);
    const result = await runSetup(provider, values, setupDeps);
    if (!result.saved) return 1;
    values = await readProviderEnv(provider.id, cfg);
  }

  let childEnv = buildEnv({ provider, fileValues: values, baseEnv: env });
  const claudePath = resolveClaudeImpl({ platform, env });
  if (!claudePath) {
    stderr.write(INSTALL_HINT);
    return 1;
  }
  let selection = selectionOf(provider, values);
  let teardown = null;
  if (accountFlags) {
    const session = await prepareAccountSession(accountFlags, childEnv, claudePath, accountCtx);
    if (session.code !== undefined) return session.code;
    ({ env: childEnv, selection, teardown } = session);
  }

  try {
    return await runSession({ provider, selection, childEnv, claudePath, args });
  } finally {
    if (teardown) await teardown();
  }

  async function runSession({ provider, selection, childEnv, claudePath, args }) {
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
      ({ code, error } = await launchImpl({ claudePath, args, env: childEnv }));
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
}
