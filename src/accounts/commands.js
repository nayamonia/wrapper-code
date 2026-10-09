import { stat } from 'node:fs/promises';
import { validateName, accountDir, createAccountDir, listAccounts, removeAccountDir, accountEmail } from './store.js';
import { linkShared, syncMcpServers } from './share.js';
import { sweepTemp, createTempAccount, teardownTemp } from './temp.js';
import { accountEnv } from './env.js';
import { readUsage } from '../usage/store.js';
import { formatTable } from '../list.js';
import { ConfigError } from '../config.js';

export const UNSUPPORTED = 'Claude accounts are supported on macOS and Linux only.\n';
const USAGE = 'Usage: wrapper-code accounts [add <name> | remove <name> [--yes]]\n';

export async function prepareShared(dir, { home, stderr }) {
  try {
    await linkShared(dir, { home });
    await syncMcpServers(dir, { home, warn: (m) => stderr.write(`wrapper-code: ${m}\n`) });
  } catch (err) {
    throw new ConfigError(`could not prepare the account folder ${dir}: ${err.message}`);
  }
}

const logoutWith = ({ authImpl, claudePath, env }) => (dir) =>
  authImpl('logout', { claudePath, configDir: dir, env: accountEnv(env, dir).env, timeoutMs: 15000 });

export async function cleanupTemps({ tmpRoot, authImpl, env, pidAliveImpl, stdout }, claudePath) {
  if (!claudePath) return;
  const n = await sweepTemp({ tmpRoot, isAlive: pidAliveImpl, logout: logoutWith({ authImpl, claudePath, env }) });
  if (n) stdout.write(`Cleaned ${n} leftover temporary session(s).\n`);
}

export function unknownAccount(name, accounts, stderr) {
  const names = accounts.map((a) => a.name);
  stderr.write(`Unknown account "${name}". Accounts: ${names.length ? names.join(', ') : 'none'}. Add one with: wrapper-code accounts add <name>\n`);
  return 1;
}

async function exists(dir) {
  try {
    await stat(dir);
    return true;
  } catch {
    return false;
  }
}

async function list(ctx) {
  const { cfg, stdout } = ctx;
  await cleanupTemps(ctx, ctx.resolveClaudeImpl({ platform: ctx.platform, env: ctx.env }));
  const accounts = await listAccounts(cfg);
  if (!accounts.length) {
    stdout.write('No accounts yet. Add one with: wrapper-code accounts add <name>\n');
    return 0;
  }
  const { events } = await readUsage(cfg);
  const rows = [['ACCOUNT', 'EMAIL', 'LAST USED']];
  for (const { name, dir } of accounts) {
    const last = events.filter((e) => e.provider === 'claude' && e.selection === name).map((e) => e.ts).sort().pop();
    rows.push([name, (await accountEmail(dir)) || '-', last ? last.slice(0, 10) : 'never']);
  }
  stdout.write(formatTable(rows));
  return 0;
}

async function add(name, ctx) {
  const { cfg, home, env, stdout, stderr, authImpl } = ctx;
  const error = validateName(name);
  if (error) {
    stderr.write(`${error}\n`);
    return 1;
  }
  const dir = accountDir(name, cfg);
  if (await exists(dir)) {
    stderr.write(`Account "${name}" already exists. Start it with: wrapper-code claude --account ${name}\n`);
    return 1;
  }
  const claudePath = ctx.resolveClaudeImpl({ platform: ctx.platform, env });
  if (!claudePath) {
    stderr.write(ctx.installHint);
    return 1;
  }
  await createAccountDir(dir, { name, createdAt: new Date().toISOString(), temp: false });
  try {
    await prepareShared(dir, { home, stderr });
  } catch (err) {
    await removeAccountDir(dir);
    throw err;
  }
  stdout.write(`Logging in account "${name}". Your usual claude login is not touched.\n`);
  // Ctrl-C reaches the child (it shares the terminal); keep the wrapper alive so the cleanup below runs.
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const ignore = () => {};
  signals.forEach((s) => process.on(s, ignore));
  let code;
  try {
    ({ code } = await authImpl('login', { claudePath, configDir: dir, env: accountEnv(env, dir).env, inherit: true }));
  } finally {
    signals.forEach((s) => process.off(s, ignore));
  }
  if (code !== 0) {
    await removeAccountDir(dir);
    stderr.write(`Login did not finish; account "${name}" was not saved.\n`);
    return code;
  }
  const email = await accountEmail(dir);
  stdout.write(`Account "${name}" saved${email ? ` (${email})` : ''}. Start it with: wrapper-code claude --account ${name}\n`);
  return 0;
}

async function remove(args, ctx) {
  const { cfg, env, stdout, stderr, authImpl, confirm } = ctx;
  const yes = args.includes('--yes');
  const name = args.find((a) => a !== '--yes');
  const accounts = await listAccounts(cfg);
  const account = accounts.find((a) => a.name === name);
  if (!account) return unknownAccount(name ?? '', accounts, stderr);
  const claudePath = ctx.resolveClaudeImpl({ platform: ctx.platform, env });
  if (!claudePath) {
    stderr.write(ctx.installHint);
    return 1;
  }
  const email = (await accountEmail(account.dir)) || '-';
  if (!yes) {
    const answer = await confirm(`Remove account ${name} (${email})? It will be logged out and its sessions deleted. [y/N] `);
    if (answer === null) {
      stderr.write('accounts remove: not a terminal; pass --yes to remove without asking\n');
      return 1;
    }
    if (!answer) {
      stdout.write('nothing removed\n');
      return 0;
    }
  }
  const result = await logoutWith({ authImpl, claudePath, env })(account.dir);
  await removeAccountDir(account.dir);
  if (result.code !== 0) {
    stderr.write(`wrapper-code: logout of "${name}" failed; its login may remain in the Keychain. Next time, run CLAUDE_CONFIG_DIR=<folder> claude auth logout before removing.\n`);
  }
  stdout.write(`Account "${name}" removed.\n`);
  return 0;
}

export async function runAccountsCommand(args, ctx) {
  if (ctx.platform === 'win32') {
    ctx.stderr.write(UNSUPPORTED);
    return 1;
  }
  const [sub, ...rest] = args;
  if (sub === undefined || sub === 'list') return list(ctx);
  if (sub === 'add') return add(rest[0], ctx);
  if (sub === 'remove') return remove(rest, ctx);
  ctx.stderr.write(USAGE);
  return 1;
}

// The flags are wrapper-code's only when they come right after `claude`; anything after the
// first other argument belongs to claude.
export function parseAccountFlags(args) {
  let account = null;
  let temp = false;
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '--temp') {
      temp = true;
      i += 1;
    } else if (a === '--account') {
      if (i + 1 >= args.length) return { error: '--account needs a name: wrapper-code claude --account <name>' };
      account = args[i + 1];
      i += 2;
    } else if (a.startsWith('--account=')) {
      account = a.slice('--account='.length);
      i += 1;
    } else {
      break;
    }
  }
  if (account !== null && temp) return { error: 'Use either --account <name> or --temp, not both.' };
  return { account, temp, rest: args.slice(i) };
}

function reportEnv({ removed, replacedConfigDir }, stderr) {
  if (removed.length) stderr.write(`wrapper-code: removed ${removed.join(', ')} from this session so the account's login is used\n`);
  if (replacedConfigDir) stderr.write('wrapper-code: your CLAUDE_CONFIG_DIR is replaced by the account folder for this session only\n');
}

export async function prepareAccountSession(flags, childEnv, claudePath, ctx) {
  const { cfg, home, stdout, stderr, platform } = ctx;
  if (platform === 'win32') {
    stderr.write(UNSUPPORTED);
    return { code: 1 };
  }
  if (flags.account !== null) {
    const accounts = await listAccounts(cfg);
    const account = accounts.find((a) => a.name === flags.account);
    if (!account) return unknownAccount(flags.account, accounts, stderr) && { code: 1 };
    await prepareShared(account.dir, { home, stderr });
    const built = accountEnv(childEnv, account.dir);
    reportEnv(built, stderr);
    return { env: built.env, selection: account.name, teardown: async () => {} };
  }
  await cleanupTemps(ctx, claudePath);
  const dir = await createTempAccount({ tmpRoot: ctx.tmpRoot, pid: process.pid });
  const teardown = async () => {
    let removed;
    try {
      ({ removed } = await teardownTemp(dir, { logout: logoutWith({ authImpl: ctx.authImpl, claudePath, env: ctx.env }) }));
    } catch (err) {
      stderr.write(`wrapper-code: the temporary login was logged out but its folder could not be deleted (${err.message}): ${dir}\n`);
      return;
    }
    if (removed) stdout.write('Temporary login removed.\n');
    else stderr.write(`wrapper-code: the temporary login could not be logged out; its folder is kept at ${dir}. Clear it with: CLAUDE_CONFIG_DIR=${dir} claude auth logout\n`);
  };
  try {
    await prepareShared(dir, { home, stderr });
  } catch (err) {
    await teardown();
    throw err;
  }
  const built = accountEnv(childEnv, dir);
  reportEnv(built, stderr);
  return { env: built.env, selection: 'temp', teardown };
}
