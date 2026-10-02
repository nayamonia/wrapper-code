import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, HELP } from '../src/cli.js';
import { writeProviderEnv } from '../src/config.js';

const BIN = fileURLToPath(new URL('../bin/wrapper-code.js', import.meta.url));
const isWin = process.platform === 'win32';

function sink() {
  const chunks = [];
  return { write: (s) => { chunks.push(String(s)); return true; }, text: () => chunks.join('') };
}

async function tmp() {
  return mkdtemp(path.join(tmpdir(), 'wc-cli-'));
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
  assert.match(before.text(), /deepseek\s+DeepSeek\s+not configured/);
  await writeProviderEnv('deepseek', { ANTHROPIC_AUTH_TOKEN: 'sk' }, opts);
  const after = sink();
  await main(['list'], { stdout: after, stderr: sink(), ...opts });
  assert.match(after.text(), /deepseek\s+DeepSeek\s+configured/);
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
  const opts = { platform: 'linux', env: { PATH: '/x' }, home };
  const launched = [];
  const code = await main(['deepseek', '--resume'], {
    stdout: sink(), stderr: sink(), ...opts,
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
  const opts = { platform: 'linux', env: {}, home };
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
    ...process.env,
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
  const result = await run(['deepseek'], { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), APPDATA: cfg.replace(/wrapper-code$/, '') });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /deepseek\.env/);
  assert.match(result.stderr, /wrapper-code setup deepseek/);
});
