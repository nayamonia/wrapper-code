import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, HELP, reportFatal, displayPath } from '../src/cli.js';
import { writeProviderEnv, ConfigError } from '../src/config.js';
import { readUsage } from '../src/usage/store.js';

const BIN = fileURLToPath(new URL('../bin/wrapper-code.js', import.meta.url));
const isWin = process.platform === 'win32';

function sink() {
  const chunks = [];
  return { write: (s) => { chunks.push(String(s)); return true; }, text: () => chunks.join('') };
}

async function tmp() {
  return mkdtemp(path.join(tmpdir(), 'wc-cli-'));
}

// The developer's shell, minus anything that would make the wrapper under test skip
// capture or send a fake event to the session the tests run in (e.g. inside wrapper-code).
function shellEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('OTEL_') || key === 'CLAUDE_CODE_ENABLE_TELEMETRY' || key === 'WRAPPER_CODE_NO_USAGE') delete env[key];
  }
  return env;
}

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

test('no arguments prints help and exits 1', async () => {
  const stdout = sink();
  assert.equal(await main([], { stdout, stderr: sink() }), 1);
  assert.equal(stdout.text(), HELP);
});

test('--help exits 0 and --version prints the package version', async () => {
  const out = sink();
  assert.equal(await main(['--help'], { stdout: out, stderr: sink() }), 0);
  const ver = sink();
  assert.equal(await main(['--version'], { stdout: ver, stderr: sink() }), 0);
  assert.match(ver.text(), /^\d+\.\d+\.\d+\n$/);
});

test('--help ends with the author credit', async () => {
  const out = sink();
  await main(['--help'], { stdout: out, stderr: sink() });
  assert.match(out.text(), /MIT/);
  assert.match(out.text(), /Gabriel Fernandes/);
  assert.match(out.text(), /gabriel@cd2\.com\.br/);
  assert.match(out.text(), /github\.com\/nayamonia/);
  assert.match(out.text(), /cd2\.com\.br/);
});

test('unknown provider lists the available ones and exits 1', async () => {
  const stderr = sink();
  assert.equal(await main(['nope'], { stdout: sink(), stderr, home: await tmp(), env: {}, platform: 'linux' }), 1);
  assert.match(stderr.text(), /Unknown provider "nope"/);
  assert.match(stderr.text(), /deepseek/);
});

test('list shows configured status per provider', async () => {
  const home = await tmp();
  const opts = { platform: 'linux', env: {}, home };
  const before = sink();
  await main(['list'], { stdout: before, stderr: sink(), ...opts });
  assert.match(before.text(), /deepseek\s+deepseek\s+payg\s+not configured\s+-/);
  await writeProviderEnv('deepseek', { ANTHROPIC_AUTH_TOKEN: 'sk' }, opts);
  const after = sink();
  await main(['list'], { stdout: after, stderr: sink(), ...opts });
  assert.match(after.text(), /deepseek\s+deepseek\s+payg\s+configured\s+flash-1m/);
});

test('launch without a credential runs setup; cancelled setup exits 1 without launching', async () => {
  const launched = [];
  const stderr = sink();
  const stdout = sink();
  const code = await main(['deepseek'], {
    stdout, stderr, home: await tmp(), env: {}, platform: 'linux',
    openBrowserImpl: () => true,
    startSetupServerImpl: async () => ({ url: 'http://127.0.0.1:1/?t=x', done: Promise.resolve({ saved: false, reason: 'cancelled' }), close() {} }),
    launchImpl: async (opts) => { launched.push(opts); return { code: 0 }; },
  });
  assert.equal(code, 1);
  assert.equal(launched.length, 0);
  assert.match(stdout.text(), /http:\/\/127\.0\.0\.1:1\/\?t=x/);
  assert.match(stderr.text(), /Nothing was saved/);
});

test('launch without a credential runs setup, then launches in the same invocation when saved', async () => {
  const home = await tmp();
  const opts = { platform: 'linux', env: { PATH: '/x', WRAPPER_CODE_NO_USAGE: '1' }, home };
  const launched = [];
  const stdout = sink();
  const code = await main(['deepseek', '--resume'], {
    stdout, stderr: sink(), ...opts,
    openBrowserImpl: () => true,
    startSetupServerImpl: async ({ writeEnv }) => {
      const values = { ANTHROPIC_AUTH_TOKEN: 'sk-new', WRAPPER_CODE_PROFILE: 'v4-pro' };
      await writeEnv(values);
      return { url: 'http://127.0.0.1:1/?t=x', done: Promise.resolve({ saved: true, values }), close() {} };
    },
    resolveClaudeImpl: () => '/fake/claude',
    launchImpl: async (o) => { launched.push(o); return { code: 3 }; },
  });
  assert.equal(code, 3);
  assert.equal(launched[0].claudePath, '/fake/claude');
  assert.deepEqual(launched[0].args, ['--resume']);
  assert.equal(launched[0].env.ANTHROPIC_AUTH_TOKEN, 'sk-new');
  assert.equal(launched[0].env.ANTHROPIC_MODEL, 'deepseek-v4-pro');
  assert.equal(launched[0].env.PATH, '/x');
  const lines = stdout.text().trimEnd().split('\n');
  assert.match(lines[lines.length - 1], /^wrapper-code \d+\.\d+\.\d+ · DeepSeek \(v4-pro\) · MIT · by Gabriel Fernandes · cd2\.com\.br$/);
});

test('launch with claude missing from PATH prints the install hint and exits 1', async () => {
  const home = await tmp();
  const opts = { platform: 'linux', env: {}, home };
  await writeProviderEnv('deepseek', { ANTHROPIC_AUTH_TOKEN: 'sk' }, opts);
  const stderr = sink();
  const code = await main(['deepseek'], { stdout: sink(), stderr, ...opts, resolveClaudeImpl: () => null });
  assert.equal(code, 1);
  assert.equal(stderr.text(), 'claude not found on PATH. Install Claude Code: npm install -g @anthropic-ai/claude-code\n');
});

test('setup <provider> exits 0 when saved and 1 when cancelled', async () => {
  const base = { stdout: sink(), stderr: sink(), home: await tmp(), env: {}, platform: 'linux', openBrowserImpl: () => true };
  const saved = await main(['setup', 'deepseek'], {
    ...base,
    startSetupServerImpl: async () => ({ url: 'u', done: Promise.resolve({ saved: true, values: {} }), close() {} }),
  });
  assert.equal(saved, 0);
  const cancelled = await main(['setup', 'deepseek'], {
    ...base,
    startSetupServerImpl: async () => ({ url: 'u', done: Promise.resolve({ saved: false, reason: 'timeout' }), close() {} }),
  });
  assert.equal(cancelled, 1);
});

test('provider ids are matched case-insensitively', async () => {
  const home = await tmp();
  const opts = { platform: 'linux', env: { WRAPPER_CODE_NO_USAGE: '1' }, home };
  await writeProviderEnv('deepseek', { ANTHROPIC_AUTH_TOKEN: 'sk' }, opts);
  const code = await main(['DeepSeek'], { stdout: sink(), stderr: sink(), ...opts, resolveClaudeImpl: () => '/c', launchImpl: async () => ({ code: 0 }) });
  assert.equal(code, 0);
});

test('end-to-end: the bin launches a fake claude with the injected env and propagates its exit code', { skip: isWin }, async () => {
  const home = await tmp();
  const binDir = path.join(home, 'fakebin');
  await mkdir(binDir);
  const out = path.join(home, 'out.json');
  const fake = path.join(binDir, 'claude');
  await writeFile(fake, `#!/usr/bin/env node
require('fs').writeFileSync(process.env.FAKE_OUT, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));
process.exit(7);
`);
  await chmod(fake, 0o755);
  await writeProviderEnv('deepseek', { ANTHROPIC_AUTH_TOKEN: 'sk-e2e', WRAPPER_CODE_PROFILE: 'flash-1m' }, { platform: 'linux', env: {}, home });
  const env = {
    ...shellEnv(),
    WRAPPER_CODE_NO_USAGE: '1',
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    FAKE_OUT: out,
    ANTHROPIC_API_KEY: 'must-be-removed',
  };
  const result = await run(['deepseek', '--resume', 'x y'], env);
  assert.equal(result.code, 7, result.stderr);
  const seen = JSON.parse(await readFile(out, 'utf8'));
  assert.deepEqual(seen.argv, ['--resume', 'x y']);
  assert.equal(seen.env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(seen.env.ANTHROPIC_AUTH_TOKEN, 'sk-e2e');
  assert.equal(seen.env.ANTHROPIC_MODEL, 'deepseek-flash[1m]');
  assert.equal(seen.env.CLAUDE_CODE_SUBAGENT_MODEL, 'deepseek-flash');
  assert.equal('ANTHROPIC_API_KEY' in seen.env, false);
  assert.equal('WRAPPER_CODE_PROFILE' in seen.env, false);
  assert.equal('CLAUDE_CONFIG_DIR' in seen.env, false);
});

test('end-to-end: a malformed env file prints the path and the setup hint and exits 1', async () => {
  const home = await tmp();
  const cfg = path.join(home, '.config', 'wrapper-code');
  await mkdir(cfg, { recursive: true });
  await writeFile(path.join(cfg, 'deepseek.env'), 'broken\n');
  const result = await run(['deepseek'], { ...shellEnv(), HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), APPDATA: cfg.replace(/wrapper-code$/, '') });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /deepseek\.env/);
  assert.match(result.stderr, /wrapper-code setup deepseek/);
});

async function malformedHome() {
  const home = await tmp();
  const cfg = path.join(home, '.config', 'wrapper-code');
  await mkdir(cfg, { recursive: true });
  await writeFile(path.join(cfg, 'deepseek.env'), 'broken\n');
  return home;
}

test('list reports a malformed env file as an error row, the message on stderr, and exits 1', async () => {
  const home = await malformedHome();
  const stdout = sink();
  const stderr = sink();
  const code = await main(['list'], { stdout, stderr, home, env: {}, platform: 'linux' });
  assert.equal(code, 1);
  assert.match(stdout.text(), /^deepseek\s+deepseek\s+payg\s+error\s+-$/m);
  assert.match(stdout.text(), /^qwen\s+qwencloud\s+payg\s+not configured\s+-$/m, 'other providers still listed');
  assert.match(stderr.text(), /^wrapper-code: .*deepseek\.env: Malformed line 1\. Run: wrapper-code setup deepseek$/m);
});

test('setup with a malformed env file warns, starts the server with empty current and never prints the raw line', async () => {
  const home = await malformedHome();
  let seen;
  const stderr = sink();
  const code = await main(['setup', 'deepseek'], {
    stdout: sink(), stderr, home, env: {}, platform: 'linux',
    openBrowserImpl: () => {},
    startSetupServerImpl: async (opts) => {
      seen = opts;
      return { url: 'http://x', done: Promise.resolve({ saved: false, reason: 'cancelled' }) };
    },
  });
  assert.equal(code, 1);
  assert.deepEqual(seen.current, {});
  assert.match(stderr.text(), /Warning: .*deepseek\.env/);
  assert.match(stderr.text(), /replaced/);
});

test('a pasted bare key in the env file is never echoed by list', async () => {
  const home = await tmp();
  const cfg = path.join(home, '.config', 'wrapper-code');
  await mkdir(cfg, { recursive: true });
  await writeFile(path.join(cfg, 'deepseek.env'), 'sk-SECRET123\n');
  const stdout = sink();
  const stderr = sink();
  const code = await main(['list'], { stdout, stderr, home, env: {}, platform: 'linux' });
  assert.equal(code, 1);
  assert.doesNotMatch(stdout.text() + stderr.text(), /SECRET/);
  assert.match(stderr.text(), /Malformed line 1/);
});

test('reportFatal prints ConfigError plainly and other errors with a stack', () => {
  const a = sink();
  reportFatal(new ConfigError('bad file'), a);
  assert.equal(a.text(), 'wrapper-code: bad file\n');
  const b = sink();
  reportFatal(new TypeError('boom'), b);
  assert.match(b.text(), /^wrapper-code: unexpected error\nTypeError: boom\n\s+at /);
  const c = sink();
  reportFatal('just a string', c);
  assert.equal(c.text(), 'wrapper-code: unexpected error\njust a string\n');
});

test('ollama: launch with a base URL but no model opens setup instead of crashing', async () => {
  const home = await tmp();
  const opts = { platform: 'linux', env: {}, home };
  await writeProviderEnv('ollama', { ANTHROPIC_BASE_URL: 'http://localhost:11434' }, opts);
  const setups = [];
  const code = await main(['ollama'], {
    stdout: sink(), stderr: sink(), ...opts,
    openBrowserImpl: () => true,
    startSetupServerImpl: async (o) => { setups.push(o); return { url: 'u', done: Promise.resolve({ saved: false, reason: 'cancelled' }), close() {} }; },
    launchImpl: async () => { throw new Error('must not launch'); },
  });
  assert.equal(code, 1);
  assert.equal(setups[0].provider.id, 'ollama');
  assert.deepEqual(setups[0].current, { ANTHROPIC_BASE_URL: 'http://localhost:11434' });
});

test('ollama: the launch banner names the model', async () => {
  const home = await tmp();
  const opts = { platform: 'linux', env: { WRAPPER_CODE_NO_USAGE: '1' }, home };
  await writeProviderEnv('ollama', { WRAPPER_CODE_MODEL: 'qwen3-code:14b' }, opts);
  const stdout = sink();
  await main(['ollama'], { stdout, stderr: sink(), ...opts, resolveClaudeImpl: () => '/c', launchImpl: async () => ({ code: 0 }) });
  assert.match(stdout.text(), /wrapper-code \d+\.\d+\.\d+ · Ollama \(qwen3-code:14b\) · MIT/);
});

test('end-to-end: ollama launches a fake claude with the five model vars, the auth token and no profile leak', { skip: isWin }, async () => {
  const home = await tmp();
  const binDir = path.join(home, 'fakebin');
  await mkdir(binDir);
  const out = path.join(home, 'out.json');
  const fake = path.join(binDir, 'claude');
  await writeFile(fake, `#!/usr/bin/env node
require('fs').writeFileSync(process.env.FAKE_OUT, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));
process.exit(0);
`);
  await chmod(fake, 0o755);
  await writeProviderEnv('ollama', { WRAPPER_CODE_MODEL: 'gemma3', ANTHROPIC_BASE_URL: 'http://10.0.0.5:11434', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '131072' }, { platform: 'linux', env: {}, home });
  const env = {
    ...shellEnv(),
    WRAPPER_CODE_NO_USAGE: '1',
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    FAKE_OUT: out,
    ANTHROPIC_API_KEY: 'must-be-removed',
  };
  const result = await run(['ollama', '--model', 'qwen3:14b'], env);
  assert.equal(result.code, 0, result.stderr);
  const seen = JSON.parse(await readFile(out, 'utf8'));
  assert.deepEqual(seen.argv, ['--model', 'qwen3:14b']);
  assert.equal(seen.env.ANTHROPIC_BASE_URL, 'http://10.0.0.5:11434');
  assert.equal(seen.env.ANTHROPIC_AUTH_TOKEN, 'ollama');
  for (const key of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) {
    assert.equal(seen.env[key], 'gemma3', key);
  }
  assert.equal(seen.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '131072');
  assert.equal('ANTHROPIC_API_KEY' in seen.env, false);
  assert.equal('WRAPPER_CODE_MODEL' in seen.env, false);
  assert.equal('WRAPPER_CODE_PROFILE' in seen.env, false);
});

test('list shows ollama alongside deepseek', async () => {
  const out = sink();
  await main(['list'], { stdout: out, stderr: sink(), platform: 'linux', env: {}, home: await tmp() });
  assert.match(out.text(), /local\s+ollama\s+local\s+not configured/);
});

test('launch on a color TTY shows the 8-bit splash instead of the one-line banner', async () => {
  const home = await tmp();
  const opts = { platform: 'linux', env: { COLORTERM: 'truecolor', TERM: 'xterm-256color', WRAPPER_CODE_NO_USAGE: '1' }, home };
  await writeProviderEnv('deepseek', { ANTHROPIC_AUTH_TOKEN: 'sk', WRAPPER_CODE_PROFILE: 'v4-pro' }, opts);
  const chunks = [];
  const stdout = { isTTY: true, columns: 120, write: (s) => { chunks.push(String(s)); return true; } };
  const code = await main(['deepseek'], {
    stdout, stderr: sink(), ...opts,
    resolveClaudeImpl: () => '/c',
    launchImpl: async () => ({ code: 0 }),
    sleepImpl: async () => {},
  });
  assert.equal(code, 0);
  const text = chunks.join('');
  assert.ok(text.includes('▀'), 'sprite half-blocks present');
  const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(plain, /DeepSeek · v4-pro/);
  assert.match(plain, /starting claude/);
  assert.doesNotMatch(plain, /wrapper-code \d+\.\d+\.\d+ · DeepSeek \(v4-pro\)/, 'plain banner not printed');
});

test('list shows qwencloud as not configured before setup', async () => {
  const out = sink();
  await main(['list'], { stdout: out, stderr: sink(), platform: 'linux', env: {}, home: await tmp() });
  assert.match(out.text(), /qwen\s+qwencloud\s+payg\s+not configured/);
  assert.doesNotMatch(out.text(), /^\S+\s+qwen\s/m, 'no provider with the retired id qwen');
});

test('qwencloud: launch before setup opens the setup page for the qwencloud provider', async () => {
  const setups = [];
  const code = await main(['qwencloud'], {
    stdout: sink(), stderr: sink(), platform: 'linux', env: {}, home: await tmp(),
    openBrowserImpl: () => true,
    startSetupServerImpl: async (o) => { setups.push(o); return { url: 'u', done: Promise.resolve({ saved: false, reason: 'cancelled' }), close() {} }; },
    launchImpl: async () => { throw new Error('must not launch'); },
  });
  assert.equal(code, 1);
  assert.equal(setups[0].provider.id, 'qwencloud');
});

test('end-to-end: qwencloud launches a fake claude with the pay-as-you-go env', { skip: isWin }, async () => {
  const home = await tmp();
  const binDir = path.join(home, 'fakebin');
  await mkdir(binDir);
  const out = path.join(home, 'out.json');
  const fake = path.join(binDir, 'claude');
  await writeFile(fake, `#!/usr/bin/env node
require('fs').writeFileSync(process.env.FAKE_OUT, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));
process.exit(0);
`);
  await chmod(fake, 0o755);
  await writeProviderEnv('qwencloud', { ANTHROPIC_AUTH_TOKEN: 'sk-qc-e2e', WRAPPER_CODE_PROFILE: 'pay-as-you-go' }, { platform: 'linux', env: {}, home });
  const env = {
    ...shellEnv(),
    WRAPPER_CODE_NO_USAGE: '1',
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    FAKE_OUT: out,
    ANTHROPIC_API_KEY: 'must-be-removed',
  };
  const result = await run(['qwencloud', '--resume'], env);
  assert.equal(result.code, 0, result.stderr);
  const seen = JSON.parse(await readFile(out, 'utf8'));
  assert.deepEqual(seen.argv, ['--resume']);
  assert.equal(seen.env.ANTHROPIC_BASE_URL, 'https://maas.qwencloudapi.com/apps/anthropic');
  assert.equal(seen.env.ANTHROPIC_AUTH_TOKEN, 'sk-qc-e2e');
  assert.equal(seen.env.ANTHROPIC_MODEL, 'auto');
  assert.equal(seen.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'qwen3.6-flash');
  assert.equal(seen.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'qwen3.8-flash');
  assert.equal(seen.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'qwen3.8-max');
  assert.equal(seen.env.CLAUDE_CODE_SUBAGENT_MODEL, 'auto');
  assert.equal(seen.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '983616');
  assert.equal('ANTHROPIC_API_KEY' in seen.env, false);
  assert.equal('WRAPPER_CODE_PROFILE' in seen.env, false);
});

test('end-to-end: alibaba launches a fake claude with the Token Plan env', { skip: isWin }, async () => {
  const home = await tmp();
  const binDir = path.join(home, 'fakebin');
  await mkdir(binDir);
  const out = path.join(home, 'out.json');
  const fake = path.join(binDir, 'claude');
  await writeFile(fake, `#!/usr/bin/env node
require('fs').writeFileSync(process.env.FAKE_OUT, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));
process.exit(0);
`);
  await chmod(fake, 0o755);
  await writeProviderEnv('alibaba', { ANTHROPIC_AUTH_TOKEN: 'tp-e2e', WRAPPER_CODE_PROFILE: 'deepseek-pro' }, { platform: 'linux', env: {}, home });
  const env = {
    ...shellEnv(),
    WRAPPER_CODE_NO_USAGE: '1',
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    FAKE_OUT: out,
  };
  const result = await run(['alibaba'], env);
  assert.equal(result.code, 0, result.stderr);
  const seen = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(seen.env.ANTHROPIC_BASE_URL, 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic');
  assert.equal(seen.env.ANTHROPIC_AUTH_TOKEN, 'tp-e2e');
  assert.equal(seen.env.ANTHROPIC_MODEL, 'deepseek-v4-pro');
  assert.equal(seen.env.CLAUDE_CODE_SUBAGENT_MODEL, 'deepseek-v4.1-flash');
});

test('the retired ids qwen and alibaba-token are unknown and the message lists the current providers', async () => {
  for (const old of ['qwen', 'alibaba-token']) {
    const stderr = sink();
    const code = await main([old], { stdout: sink(), stderr, platform: 'linux', env: {}, home: await tmp() });
    assert.equal(code, 1);
    assert.match(stderr.text(), new RegExp(`Unknown provider "${old}"\\. Available: alibaba, claude, deepseek, ollama, openrouter, qwencloud`));
  }
});

test('stale qwen.env and alibaba-token.env files are ignored by list and by other launches', async () => {
  const home = await tmp();
  const opts = { platform: 'linux', env: { WRAPPER_CODE_NO_USAGE: '1' }, home };
  await writeProviderEnv('qwen', { ANTHROPIC_AUTH_TOKEN: 'old-cp' }, opts);
  await writeProviderEnv('alibaba-token', { ANTHROPIC_AUTH_TOKEN: 'old-tp' }, opts);
  await writeProviderEnv('deepseek', { ANTHROPIC_AUTH_TOKEN: 'sk' }, opts);
  const out = sink();
  assert.equal(await main(['list'], { stdout: out, stderr: sink(), ...opts }), 0);
  assert.match(out.text(), /deepseek\s+deepseek\s+payg\s+configured\s+flash-1m/);
  assert.match(out.text(), /qwen\s+qwencloud\s+payg\s+not configured/);
  assert.match(out.text(), /qwen\s+alibaba\s+plan\s+not configured/);
  assert.doesNotMatch(out.text(), /old-cp|old-tp/);
  const launched = [];
  assert.equal(await main(['deepseek'], { stdout: sink(), stderr: sink(), ...opts, resolveClaudeImpl: () => '/c', launchImpl: async (o) => { launched.push(o); return { code: 0 }; } }), 0);
  assert.equal(launched[0].env.ANTHROPIC_AUTH_TOKEN, 'sk');
});

test('list shows openrouter as not configured before setup', async () => {
  const out = sink();
  await main(['list'], { stdout: out, stderr: sink(), platform: 'linux', env: {}, home: await tmp() });
  assert.match(out.text(), /gateway\s+openrouter\s+payg\s+not configured/);
});

test('openrouter: a key without a model is not configured and opens setup', async () => {
  const home = await tmp();
  const opts = { platform: 'linux', env: {}, home };
  await writeProviderEnv('openrouter', { ANTHROPIC_AUTH_TOKEN: 'sk-or' }, opts);
  const setups = [];
  const code = await main(['openrouter'], {
    stdout: sink(), stderr: sink(), ...opts,
    openBrowserImpl: () => true,
    startSetupServerImpl: async (o) => { setups.push(o); return { url: 'u', done: Promise.resolve({ saved: false, reason: 'cancelled' }), close() {} }; },
    launchImpl: async () => { throw new Error('must not launch'); },
  });
  assert.equal(code, 1);
  assert.equal(setups[0].provider.id, 'openrouter');
});

test('end-to-end: openrouter launches a fake claude with the six model keys, the key, the gateway flag and the context window', { skip: isWin }, async () => {
  const home = await tmp();
  const binDir = path.join(home, 'fakebin');
  await mkdir(binDir);
  const out = path.join(home, 'out.json');
  const fake = path.join(binDir, 'claude');
  await writeFile(fake, `#!/usr/bin/env node
require('fs').writeFileSync(process.env.FAKE_OUT, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));
process.exit(0);
`);
  await chmod(fake, 0o755);
  await writeProviderEnv('openrouter', { ANTHROPIC_AUTH_TOKEN: 'sk-or-e2e', WRAPPER_CODE_MODEL: 'openai/gpt-6.1-sol', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1050000' }, { platform: 'linux', env: {}, home });
  const env = {
    ...shellEnv(),
    WRAPPER_CODE_NO_USAGE: '1',
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    FAKE_OUT: out,
    ANTHROPIC_API_KEY: 'must-be-removed',
  };
  const result = await run(['openrouter'], env);
  assert.equal(result.code, 0, result.stderr);
  const seen = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(seen.env.ANTHROPIC_BASE_URL, 'https://openrouter.ai/api');
  assert.equal(seen.env.ANTHROPIC_AUTH_TOKEN, 'sk-or-e2e');
  assert.equal(seen.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1');
  for (const key of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) {
    assert.equal(seen.env[key], 'openai/gpt-6.1-sol', key);
  }
  assert.equal(seen.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '1050000');
  assert.equal('ANTHROPIC_API_KEY' in seen.env, false);
  assert.equal('WRAPPER_CODE_MODEL' in seen.env, false);
});

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/otlp-api-request.json', import.meta.url));

async function configuredDeepseek() {
  const home = await tmp();
  const opts = { platform: 'linux', env: {}, home };
  await writeProviderEnv('deepseek', { ANTHROPIC_AUTH_TOKEN: 'sk', WRAPPER_CODE_PROFILE: 'flash-1m' }, opts);
  return opts;
}

test('launch injects the seven OTEL variables of the usage receiver into the child env', async () => {
  const opts = await configuredDeepseek();
  opts.env = { WRAPPER_CODE_USAGE_LINGER_MS: '1' };
  const launched = [];
  const stdout = sink();
  const code = await main(['deepseek'], {
    stdout, stderr: sink(), ...opts,
    resolveClaudeImpl: () => '/c',
    launchImpl: async (o) => { launched.push(o); return { code: 0 }; },
  });
  assert.equal(code, 0);
  const env = launched[0].env;
  assert.equal(env.CLAUDE_CODE_ENABLE_TELEMETRY, '1');
  assert.equal(env.OTEL_LOGS_EXPORTER, 'otlp');
  assert.equal(env.OTEL_METRICS_EXPORTER, 'none');
  assert.equal(env.OTEL_EXPORTER_OTLP_PROTOCOL, 'http/json');
  assert.match(env.OTEL_EXPORTER_OTLP_ENDPOINT, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(env.OTEL_EXPORTER_OTLP_HEADERS, /^x-wrapper-usage-token=[0-9a-f]{64}$/);
  assert.equal(env.OTEL_LOGS_EXPORT_INTERVAL, '2000');
  assert.match(stdout.text(), /no usage captured \(no api_request events arrived\)/);
});

test('WRAPPER_CODE_NO_USAGE=1 injects nothing and prints no summary', async () => {
  const opts = await configuredDeepseek();
  opts.env = { WRAPPER_CODE_NO_USAGE: '1' };
  const launched = [];
  const stdout = sink();
  await main(['deepseek'], { stdout, stderr: sink(), ...opts, resolveClaudeImpl: () => '/c', launchImpl: async (o) => { launched.push(o); return { code: 0 }; } });
  assert.equal('CLAUDE_CODE_ENABLE_TELEMETRY' in launched[0].env, false);
  assert.equal('OTEL_EXPORTER_OTLP_ENDPOINT' in launched[0].env, false);
  assert.doesNotMatch(stdout.text(), /usage/);
});

test("the user's own OTEL endpoint is kept, with a one-line notice and no capture", async () => {
  const opts = await configuredDeepseek();
  opts.env = { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318', CLAUDE_CODE_ENABLE_TELEMETRY: '1' };
  const launched = [];
  const stdout = sink();
  await main(['deepseek'], { stdout, stderr: sink(), ...opts, resolveClaudeImpl: () => '/c', launchImpl: async (o) => { launched.push(o); return { code: 0 }; } });
  assert.equal(launched[0].env.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://collector:4318');
  assert.equal('OTEL_EXPORTER_OTLP_HEADERS' in launched[0].env, false);
  assert.match(stdout.text(), /usage: your OTEL settings are kept; wrapper-code will not record this session/);
  assert.doesNotMatch(stdout.text(), /no usage captured/);
});

test('a receiver that fails to start is reported once and the session still launches', async () => {
  const opts = await configuredDeepseek();
  const launched = [];
  const stdout = sink();
  const code = await main(['deepseek'], {
    stdout, stderr: sink(), ...opts,
    startUsageReceiverImpl: async () => { throw new Error('EADDRINUSE'); },
    resolveClaudeImpl: () => '/c',
    launchImpl: async (o) => { launched.push(o); return { code: 4 }; },
  });
  assert.equal(code, 4);
  assert.equal('OTEL_EXPORTER_OTLP_ENDPOINT' in launched[0].env, false);
  assert.match(stdout.text(), /usage: receiver could not start \(EADDRINUSE\); session runs without usage tracking/);
});

test('end-to-end: a fake claude posts the fixture to the receiver; the summary is printed, the line stored, the exit code kept', { skip: isWin }, async () => {
  const home = await tmp();
  const binDir = path.join(home, 'fakebin');
  await mkdir(binDir);
  const fake = path.join(binDir, 'claude');
  await writeFile(fake, `#!/usr/bin/env node
const fs = require('fs');
const body = fs.readFileSync(process.env.FIXTURE_PATH, 'utf8');
const [name, token] = process.env.OTEL_EXPORTER_OTLP_HEADERS.split('=');
fetch(process.env.OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/logs', { method: 'POST', headers: { 'content-type': 'application/json', [name]: token }, body })
  .then((r) => { if (r.status !== 200) throw new Error('receiver answered ' + r.status); process.exit(5); })
  .catch((e) => { console.error(e.message); process.exit(99); });
`);
  await chmod(fake, 0o755);
  const cfg = { platform: 'linux', env: {}, home };
  await writeProviderEnv('deepseek', { ANTHROPIC_AUTH_TOKEN: 'sk-e2e', WRAPPER_CODE_PROFILE: 'flash-1m' }, cfg);
  const env = { ...shellEnv(), HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), PATH: `${binDir}${path.delimiter}${process.env.PATH}`, FIXTURE_PATH, WRAPPER_CODE_USAGE_LINGER_MS: '200' };
  const result = await run(['deepseek'], env);
  assert.equal(result.code, 5, result.stderr);
  assert.match(result.stdout, /requests 1 · in /);
  assert.doesNotMatch(result.stdout, /cost|\$/, 'the summary shows no price');
  assert.match(result.stdout, /saved to .*usage\.jsonl/);
  const { events } = await readUsage(cfg);
  assert.equal(events.length, 1);
  assert.equal(events[0].provider, 'deepseek');
  assert.equal('costUsd' in events[0], false, 'stored events carry no cost');
  assert.equal(events[0].selection, 'flash-1m');
  assert.ok(events[0].outputTokens > 0);
  assert.match(events[0].sessionId, /^[0-9a-f]{16}$/);
});

test('displayPath shortens only on a path boundary', () => {
  assert.equal(displayPath('/home/al/.config/wrapper-code/usage.jsonl', '/home/al'), '~/.config/wrapper-code/usage.jsonl');
  assert.equal(displayPath('/home/alice/.config/x/usage.jsonl', '/home/al'), '/home/alice/.config/x/usage.jsonl');
  assert.equal(displayPath('/home/al/.config/usage.jsonl', '/home/al/'), '~/.config/usage.jsonl');
});

test('a SIGINT during the post-exit linger ends it early; usage is still summarized and the exit code kept', async () => {
  const opts = await configuredDeepseek();
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  let release;
  const fake = async ({ onEvent }) => ({
    env: { CLAUDE_CODE_ENABLE_TELEMETRY: '1' },
    stats: { malformed: 0 },
    close: ({ now } = {}) => {
      fake.calls.push(!!now);
      if (now) release();
      fake.pending ||= new Promise((r) => { release = r; });
      return fake.pending;
    },
    onEvent,
  });
  fake.calls = [];
  const stdout = sink();
  const p = main(['deepseek'], {
    stdout, stderr: sink(), ...opts,
    startUsageReceiverImpl: fake,
    resolveClaudeImpl: () => '/c',
    launchImpl: async () => ({ code: 7 }),
  });
  const timer = setTimeout(() => { process.emit('SIGINT'); }, 100);
  const guard = setTimeout(() => { release?.(); }, 3000);
  try {
    assert.equal(await p, 7);
  } finally {
    clearTimeout(timer);
    clearTimeout(guard);
  }
  assert.deepEqual(fake.calls, [false, true]);
  assert.match(stdout.text(), /no usage captured/);
  assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
});

test('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT in the shell env counts as the user\'s own OTEL setup', async () => {
  const opts = await configuredDeepseek();
  opts.env = { OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://collector:4318/v1/logs' };
  const launched = [];
  const stdout = sink();
  await main(['deepseek'], { stdout, stderr: sink(), ...opts, resolveClaudeImpl: () => '/c', launchImpl: async (o) => { launched.push(o); return { code: 0 }; } });
  assert.equal(launched[0].env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, 'http://collector:4318/v1/logs');
  assert.equal('OTEL_EXPORTER_OTLP_ENDPOINT' in launched[0].env, false);
  assert.match(stdout.text(), /your OTEL settings are kept/);
});

test('provider .env OTEL_EXPORTER_OTLP_LOGS_* keys are removed from the child env when the receiver is injected', async () => {
  const home = await tmp();
  const opts = { platform: 'linux', env: { WRAPPER_CODE_USAGE_LINGER_MS: '1' }, home };
  await writeProviderEnv('deepseek', {
    ANTHROPIC_AUTH_TOKEN: 'sk', WRAPPER_CODE_PROFILE: 'flash-1m',
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://elsewhere:4318', OTEL_EXPORTER_OTLP_LOGS_HEADERS: 'a=b',
  }, opts);
  const launched = [];
  await main(['deepseek'], { stdout: sink(), stderr: sink(), ...opts, resolveClaudeImpl: () => '/c', launchImpl: async (o) => { launched.push(o); return { code: 0 }; } });
  const env = launched[0].env;
  assert.equal(Object.keys(env).some((k) => k.startsWith('OTEL_EXPORTER_OTLP_LOGS_')), false);
  assert.match(env.OTEL_EXPORTER_OTLP_ENDPOINT, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(env.CLAUDE_CODE_ENABLE_TELEMETRY, '1');
});

test('wrapper-code usage is dispatched and documented in --help', async () => {
  const out = sink();
  assert.equal(await main(['usage'], { stdout: out, stderr: sink(), platform: 'linux', env: {}, home: await tmp() }), 0);
  assert.match(out.text(), /no usage recorded yet/);
  const help = sink();
  await main(['--help'], { stdout: help, stderr: sink() });
  assert.match(help.text(), /wrapper-code usage \[--since 24h\|7d\|30d\|all\] \[--provider <id>\] \[--by-day\] \[--json\]/);
});

function fakeReceiver() {
  const r = { calls: [], onEvent: null };
  r.impl = async ({ onEvent }) => {
    r.onEvent = onEvent;
    return {
      env: { CLAUDE_CODE_ENABLE_TELEMETRY: '1' },
      stats: { malformed: 0 },
      close: async ({ now = false } = {}) => { r.calls.push(now); },
    };
  };
  return r;
}

const RAW = { model: 'deepseek-flash', querySource: 'main', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 100 };

test('when claude fails to start, the receiver is closed at once instead of lingering', async () => {
  const opts = await configuredDeepseek();
  const r = fakeReceiver();
  const stderr = sink();
  const code = await main(['deepseek'], {
    stdout: sink(), stderr, ...opts,
    startUsageReceiverImpl: r.impl,
    resolveClaudeImpl: () => '/c',
    launchImpl: async () => ({ code: 1, error: new Error('spawn EACCES') }),
  });
  assert.equal(code, 1);
  assert.deepEqual(r.calls, [true]);
  assert.match(stderr.text(), /Failed to start claude: spawn EACCES/);
});

test('a launch that throws closes the receiver and rejects instead of hanging', async () => {
  const opts = await configuredDeepseek();
  const r = fakeReceiver();
  await assert.rejects(main(['deepseek'], {
    stdout: sink(), stderr: sink(), ...opts,
    startUsageReceiverImpl: r.impl,
    resolveClaudeImpl: () => '/c',
    launchImpl: async () => { throw new Error('boom'); },
  }), /boom/);
  assert.deepEqual(r.calls, [true]);
});

test('a launch that throws with the real receiver does not keep the process alive', async () => {
  const opts = await configuredDeepseek();
  let port;
  await assert.rejects(main(['deepseek'], {
    stdout: sink(), stderr: sink(), ...opts,
    resolveClaudeImpl: () => '/c',
    launchImpl: async ({ env }) => { port = new URL(env.OTEL_EXPORTER_OTLP_ENDPOINT).port; throw new Error('boom'); },
  }), /boom/);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/v1/logs`, { method: 'POST' }), 'receiver is closed');
});

test('a failure while printing the summary never changes the exit code', async () => {
  const opts = await configuredDeepseek();
  const r = fakeReceiver();
  const stderr = sink();
  const stdout = { write: (s) => { if (/no usage captured/.test(s)) throw new Error('EPIPE'); return true; } };
  const code = await main(['deepseek'], {
    stdout, stderr, ...opts,
    startUsageReceiverImpl: r.impl,
    resolveClaudeImpl: () => '/c',
    launchImpl: async () => ({ code: 6 }),
  });
  assert.equal(code, 6);
  assert.match(stderr.text(), /usage: .*EPIPE/);
});

test('a failed usage write prints the summary with "not saved", then one warning', async () => {
  const opts = await configuredDeepseek();
  await mkdir(path.join(opts.home, '.config', 'wrapper-code', 'usage.jsonl'));
  const r = fakeReceiver();
  const log = [];
  const tagged = (tag) => ({ write: (s) => { log.push([tag, String(s)]); return true; } });
  const code = await main(['deepseek'], {
    stdout: tagged('out'), stderr: tagged('err'), ...opts,
    startUsageReceiverImpl: r.impl,
    resolveClaudeImpl: () => '/c',
    launchImpl: async () => { r.onEvent(RAW, '2026-10-03T10:00:00.000Z'); return { code: 3 }; },
  });
  assert.equal(code, 3);
  const all = log.map(([, s]) => s).join('');
  assert.match(all, /requests 1 · /);
  assert.match(all, /^  not saved$/m);
  assert.doesNotMatch(all, /saved to/);
  const summaryAt = log.findIndex(([t, s]) => t === 'out' && /not saved/.test(s));
  const warnings = log.filter(([t, s]) => t === 'err' && /usage: could not write/.test(s));
  assert.equal(warnings.length, 1);
  assert.ok(summaryAt >= 0 && log.indexOf(warnings[0]) > summaryAt, 'the warning comes after the summary');
});

const PARENT_OTEL = {
  CLAUDE_CODE_ENABLE_TELEMETRY: '1',
  OTEL_LOGS_EXPORTER: 'otlp',
  OTEL_METRICS_EXPORTER: 'none',
  OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
  OTEL_EXPORTER_OTLP_HEADERS: 'x-wrapper-usage-token=parent',
  OTEL_LOGS_EXPORT_INTERVAL: '2000',
};

test('a nested launch ignores the parent session\'s injected OTEL vars and starts its own receiver', async () => {
  const opts = await configuredDeepseek();
  opts.env = { ...PARENT_OTEL, WRAPPER_CODE_USAGE_LINGER_MS: '1' };
  const launched = [];
  const stdout = sink();
  await main(['deepseek'], { stdout, stderr: sink(), ...opts, resolveClaudeImpl: () => '/c', launchImpl: async (o) => { launched.push(o); return { code: 0 }; } });
  const env = launched[0].env;
  assert.doesNotMatch(stdout.text(), /your OTEL settings are kept/);
  assert.match(env.OTEL_EXPORTER_OTLP_ENDPOINT, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.notEqual(env.OTEL_EXPORTER_OTLP_ENDPOINT, PARENT_OTEL.OTEL_EXPORTER_OTLP_ENDPOINT);
  assert.match(env.OTEL_EXPORTER_OTLP_HEADERS, /^x-wrapper-usage-token=[0-9a-f]{64}$/);
  assert.match(stdout.text(), /no usage captured/);
});

test('a nested launch with WRAPPER_CODE_NO_USAGE=1 does not forward the parent\'s OTEL vars', async () => {
  const opts = await configuredDeepseek();
  opts.env = { ...PARENT_OTEL, WRAPPER_CODE_NO_USAGE: '1' };
  const launched = [];
  await main(['deepseek'], { stdout: sink(), stderr: sink(), ...opts, resolveClaudeImpl: () => '/c', launchImpl: async (o) => { launched.push(o); return { code: 0 }; } });
  for (const key of Object.keys(PARENT_OTEL)) assert.equal(key in launched[0].env, false, key);
});

test('the receiver lingers 500 ms after claude exits by default', async () => {
  const opts = await configuredDeepseek();
  const seen = [];
  const r = fakeReceiver();
  await main(['deepseek'], {
    stdout: sink(), stderr: sink(), ...opts,
    startUsageReceiverImpl: async (o) => { seen.push(o.lingerMs); return r.impl(o); },
    resolveClaudeImpl: () => '/c',
    launchImpl: async () => ({ code: 0 }),
  });
  assert.deepEqual(seen, [500]);
});

test('list prints FAMILY PROVIDER BILLING STATUS SELECTION, grouped by family, with the selection', async () => {
  const home = await tmp();
  const opts = { platform: 'linux', env: {}, home };
  const keyed = (over) => ({ env: {}, credential: { env: 'ANTHROPIC_AUTH_TOKEN', label: 'k' }, profiles: { a: {}, b: {} }, defaultProfile: 'a', test: {}, ...over });
  const catalog = new Map([
    ['zeta', keyed({ id: 'zeta', name: 'Zeta', family: 'zz', billing: 'payg' })],
    ['beta', keyed({ id: 'beta', name: 'Beta', family: 'beta', billing: 'payg' })],
    ['beta-plan', keyed({ id: 'beta-plan', name: 'Beta Plan', family: 'beta', billing: 'plan' })],
    ['loc', { id: 'loc', name: 'Loc', family: 'local', billing: 'local', env: {}, credential: null, models: { envKeys: ['ANTHROPIC_MODEL'] }, test: {} }],
  ]);
  await writeProviderEnv('zeta', { ANTHROPIC_AUTH_TOKEN: 'sk-z', WRAPPER_CODE_PROFILE: 'b' }, opts);
  await writeProviderEnv('beta-plan', { ANTHROPIC_AUTH_TOKEN: 'sk-b' }, opts);
  await writeProviderEnv('loc', { WRAPPER_CODE_MODEL: 'qwen3-coder:30b' }, opts);
  const out = sink();
  const err = sink();
  const code = await main(['list'], { stdout: out, stderr: err, ...opts, catalogImpl: async () => catalog });
  assert.equal(code, 0);
  assert.equal(err.text(), '');
  assert.equal(out.text(), [
    'FAMILY  PROVIDER   BILLING  STATUS          SELECTION',
    'beta    beta-plan  plan     configured      a',
    'beta    beta       payg     not configured  -',
    'local   loc        local    configured      qwen3-coder:30b',
    'zz      zeta       payg     configured      b',
  ].join('\n') + '\n');
  assert.doesNotMatch(out.text(), /sk-z|sk-b/);
});

test('list groups the real catalog by family, plan before payg', async () => {
  const out = sink();
  await main(['list'], { stdout: out, stderr: sink(), platform: 'linux', env: {}, home: await tmp() });
  const rows = out.text().trimEnd().split('\n').slice(1).map((line) => line.split(/ {2,}/).slice(0, 3).join(' '));
  assert.deepEqual(rows, [
    'anthropic claude plan',
    'deepseek deepseek payg',
    'gateway openrouter payg',
    'local ollama local',
    'qwen alibaba plan',
    'qwen qwencloud payg',
  ]);
});

test('wrapper-code claude launches with the shell env untouched plus the usage receiver, without setup', async () => {
  const home = await tmp();
  const env = { ANTHROPIC_API_KEY: 'sk-ant', CLAUDE_CODE_USE_BEDROCK: '1', WRAPPER_CODE_USAGE_LINGER_MS: '1' };
  const launched = [];
  const stdout = sink();
  const code = await main(['claude', '-p', 'hi'], {
    stdout, stderr: sink(), platform: 'linux', env, home,
    resolveClaudeImpl: () => '/c',
    launchImpl: async (o) => { launched.push(o); return { code: 3 }; },
    startSetupServerImpl: async () => { throw new Error('setup must not open'); },
    openBrowserImpl: async () => { throw new Error('browser must not open'); },
  });
  assert.equal(code, 3);
  assert.deepEqual(launched[0].args, ['-p', 'hi']);
  const child = launched[0].env;
  assert.equal(child.ANTHROPIC_API_KEY, 'sk-ant');
  assert.equal(child.CLAUDE_CODE_USE_BEDROCK, '1');
  for (const key of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL', 'WRAPPER_CODE_USAGE_LINGER_MS']) assert.equal(key in child, false, key);
  assert.equal(child.CLAUDE_CODE_ENABLE_TELEMETRY, '1');
  assert.match(child.OTEL_EXPORTER_OTLP_ENDPOINT, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(stdout.text(), /wrapper-code · Claude Code · /, 'summary head has no empty selection');
  assert.doesNotMatch(stdout.text(), /not configured|setup/i);
});

test('list shows claude as configured with no selection; setup claude has nothing to do', async () => {
  const home = await tmp();
  const out = sink();
  await main(['list'], { stdout: out, stderr: sink(), platform: 'linux', env: {}, home });
  assert.match(out.text(), /^anthropic +claude +plan +configured +-$/m);
  const setup = sink();
  const code = await main(['setup', 'claude'], {
    stdout: setup, stderr: sink(), platform: 'linux', env: {}, home,
    startSetupServerImpl: async () => { throw new Error('setup must not open'); },
  });
  assert.equal(code, 0);
  assert.match(setup.text(), /Claude Code needs no setup: wrapper-code claude runs it with your own configuration and only records token usage\./);
});

test('end to end: a claude session is recorded under provider claude with the model Claude Code reports', { skip: isWin }, async () => {
  const home = await tmp();
  const binDir = path.join(home, 'bin');
  await mkdir(binDir);
  const fake = path.join(binDir, 'claude');
  await writeFile(fake, `#!/usr/bin/env node
const fs = require('fs');
const body = fs.readFileSync(process.env.FIXTURE_PATH, 'utf8');
const [name, token] = process.env.OTEL_EXPORTER_OTLP_HEADERS.split('=');
if (process.env.ANTHROPIC_API_KEY !== 'sk-ant-e2e' || process.env.ANTHROPIC_BASE_URL) { console.error('env was changed'); process.exit(98); }
fetch(process.env.OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/logs', { method: 'POST', headers: { 'content-type': 'application/json', [name]: token }, body })
  .then((r) => { if (r.status !== 200) throw new Error('receiver answered ' + r.status); process.exit(0); })
  .catch((e) => { console.error(e.message); process.exit(99); });
`);
  await chmod(fake, 0o755);
  const cfg = { platform: 'linux', env: {}, home };
  const env = { ...shellEnv(), HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), PATH: `${binDir}${path.delimiter}${process.env.PATH}`, FIXTURE_PATH, WRAPPER_CODE_USAGE_LINGER_MS: '200', ANTHROPIC_API_KEY: 'sk-ant-e2e' };
  for (const key of Object.keys(env)) if (/^ANTHROPIC_(BASE_URL|AUTH_TOKEN|MODEL)/.test(key)) delete env[key];
  const result = await run(['claude'], env);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /requests 1 · in /);
  const { events } = await readUsage(cfg);
  assert.equal(events.length, 1);
  assert.equal(events[0].provider, 'claude');
  assert.equal(events[0].selection, '');
  assert.ok(events[0].model);
  const report = await run(['usage', '--since', 'all'], env);
  assert.match(report.stdout, /^claude +\S+ +1 /m);
  const cleared = await run(['usage', 'clear'], env);
  assert.equal(cleared.code, 1, 'no terminal, no --yes: refuses');
  assert.match(cleared.stderr, /pass --yes/);
  const forced = await run(['usage', 'clear', '--yes'], env);
  assert.equal(forced.code, 0);
  assert.match(forced.stdout, /removed 1 request\n/);
  assert.equal((await readUsage(cfg)).events.length, 0);
});

test('usage clear goes through the injected confirmation and shows the path with ~', async () => {
  const opts = await configuredDeepseek();
  const { appendUsage } = await import('../src/usage/store.js');
  await appendUsage([{ ts: '2026-10-03T11:00:00Z', sessionId: 's', provider: 'deepseek', selection: 'x', model: 'm', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }], opts);
  const asked = [];
  const out = sink();
  const code = await main(['usage', 'clear'], { stdout: out, stderr: sink(), ...opts, confirmImpl: async (q) => { asked.push(q); return true; } });
  assert.equal(code, 0);
  assert.equal(asked[0], 'This removes all 1 request from ~/.config/wrapper-code/usage.jsonl. Continue? [y/N] ');
  assert.equal((await readUsage(opts)).events.length, 0);
});

test('--help documents usage clear and the claude passthrough', async () => {
  const help = sink();
  await main(['--help'], { stdout: help, stderr: sink() });
  assert.match(help.text(), /wrapper-code usage clear \[--provider <id>\] \[--yes\]/);
  assert.match(help.text(), /wrapper-code claude \[claude args\.\.\.\]/);
});
