import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnvFile, serializeEnvFile, configDir, envFilePath, readProviderEnv, writeProviderEnv, migrateAliasEnv, ConfigError } from '../src/config.js';

test('parseEnvFile reads KEY=value, skips comments and blank lines, trims whitespace', () => {
  const text = '# header\n\nANTHROPIC_AUTH_TOKEN=sk-abc\n  WRAPPER_CODE_PROFILE = flash-1m \n';
  assert.deepEqual(parseEnvFile(text), {
    ANTHROPIC_AUTH_TOKEN: 'sk-abc',
    WRAPPER_CODE_PROFILE: 'flash-1m',
  });
});

test('parseEnvFile accepts CRLF line endings without leaking \\r into values', () => {
  assert.deepEqual(parseEnvFile('A=1\r\nB=two\r\n'), { A: '1', B: 'two' });
});

test('parseEnvFile splits on the first = only', () => {
  assert.deepEqual(parseEnvFile('K=a=b==\nURL=http://x?y=1'), { K: 'a=b==', URL: 'http://x?y=1' });
});

test('parseEnvFile throws with the line number on a malformed line', () => {
  assert.throws(() => parseEnvFile('OK=1\nnot a pair\n'), /line 2/);
  assert.throws(() => parseEnvFile('=novalue\n'), /line 1/);
  assert.throws(() => parseEnvFile('BAD KEY=1\n'), /line 1/);
});

test('parseEnvFile never includes the offending line text in the error', () => {
  assert.throws(() => parseEnvFile('sk-SECRET123\n'), (err) => /Malformed line 1/.test(err.message) && !err.message.includes('SECRET'));
});

test('serializeEnvFile writes a header comment and round-trips through parseEnvFile', () => {
  const values = { ANTHROPIC_AUTH_TOKEN: 'sk-abc', WRAPPER_CODE_PROFILE: 'v4-pro' };
  const text = serializeEnvFile(values, { header: 'wrapper-code — deepseek' });
  assert.ok(text.startsWith('# wrapper-code — deepseek\n'));
  assert.ok(text.endsWith('\n'));
  assert.deepEqual(parseEnvFile(text), values);
});

test('configDir uses XDG_CONFIG_HOME when set on POSIX', () => {
  assert.equal(
    configDir({ platform: 'linux', env: { XDG_CONFIG_HOME: '/xdg' }, home: '/home/u' }),
    path.join('/xdg', 'wrapper-code'),
  );
});

test('configDir falls back to ~/.config on POSIX', () => {
  assert.equal(
    configDir({ platform: 'darwin', env: {}, home: '/Users/u' }),
    path.join('/Users/u', '.config', 'wrapper-code'),
  );
});

test('configDir uses APPDATA on Windows', () => {
  assert.equal(
    configDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, home: 'C:\\Users\\u' }),
    path.join('C:\\Users\\u\\AppData\\Roaming', 'wrapper-code'),
  );
});

test('configDir falls back to home/AppData/Roaming on Windows without APPDATA', () => {
  assert.equal(
    configDir({ platform: 'win32', env: {}, home: 'C:\\Users\\u' }),
    path.join('C:\\Users\\u', 'AppData', 'Roaming', 'wrapper-code'),
  );
});

test('envFilePath is <configDir>/<provider>.env', () => {
  const opts = { platform: 'linux', env: {}, home: '/h' };
  assert.equal(envFilePath('deepseek', opts), path.join('/h', '.config', 'wrapper-code', 'deepseek.env'));
});

test('readProviderEnv returns {} when the file does not exist', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'wc-'));
  assert.deepEqual(await readProviderEnv('deepseek', { platform: 'linux', env: {}, home }), {});
});

test('writeProviderEnv creates the dir, writes 0600 and round-trips', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'wc-'));
  const opts = { platform: process.platform === 'win32' ? 'win32' : 'linux', env: {}, home };
  const file = await writeProviderEnv('deepseek', { ANTHROPIC_AUTH_TOKEN: 'sk-1', WRAPPER_CODE_PROFILE: 'flash-1m' }, opts);
  assert.equal(file, envFilePath('deepseek', opts));
  assert.deepEqual(await readProviderEnv('deepseek', opts), { ANTHROPIC_AUTH_TOKEN: 'sk-1', WRAPPER_CODE_PROFILE: 'flash-1m' });
  if (process.platform !== 'win32') {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
  }
});

test('writeProviderEnv overwrites an existing file and keeps 0600', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'wc-'));
  const opts = { platform: process.platform === 'win32' ? 'win32' : 'linux', env: {}, home };
  await writeProviderEnv('deepseek', { A: '1' }, opts);
  await writeProviderEnv('deepseek', { B: '2' }, opts);
  assert.deepEqual(await readProviderEnv('deepseek', opts), { B: '2' });
});

test('readProviderEnv throws ConfigError naming the file and the setup command on a malformed file', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'wc-'));
  const opts = { platform: 'linux', env: {}, home };
  const file = envFilePath('deepseek', opts);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'garbage line\n');
  await assert.rejects(readProviderEnv('deepseek', opts), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.match(err.message, /deepseek\.env/);
    assert.match(err.message, /wrapper-code setup deepseek/);
    return true;
  });
});

const aliased = { id: 'new-id', aliases: ['old-id', 'older-id'] };

test('migrateAliasEnv renames the first alias file to the provider id and keeps 0600', async () => {
  const opts = { platform: 'linux', env: {}, home: await mkdtemp(path.join(tmpdir(), 'wc-mig-')) };
  await writeProviderEnv('older-id', { ANTHROPIC_AUTH_TOKEN: 'sk-older' }, opts);
  await migrateAliasEnv(aliased, opts);
  assert.deepEqual(await readProviderEnv('new-id', opts), { ANTHROPIC_AUTH_TOKEN: 'sk-older' });
  assert.deepEqual(await readdir(configDir(opts)), ['new-id.env']);
  if (process.platform !== 'win32') assert.equal((await stat(envFilePath('new-id', opts))).mode & 0o777, 0o600);
});

test('migrateAliasEnv leaves every file alone when the provider file already exists', async () => {
  const opts = { platform: 'linux', env: {}, home: await mkdtemp(path.join(tmpdir(), 'wc-mig-')) };
  await writeProviderEnv('new-id', { ANTHROPIC_AUTH_TOKEN: 'sk-new' }, opts);
  await writeProviderEnv('old-id', { ANTHROPIC_AUTH_TOKEN: 'sk-old' }, opts);
  const before = await readFile(envFilePath('old-id', opts), 'utf8');
  await migrateAliasEnv(aliased, opts);
  assert.equal(await readFile(envFilePath('old-id', opts), 'utf8'), before);
  assert.deepEqual(await readProviderEnv('new-id', opts), { ANTHROPIC_AUTH_TOKEN: 'sk-new' });
});

test('migrateAliasEnv does nothing without aliases or without alias files', async () => {
  const opts = { platform: 'linux', env: {}, home: await mkdtemp(path.join(tmpdir(), 'wc-mig-')) };
  await migrateAliasEnv({ id: 'plain' }, opts);
  await migrateAliasEnv(aliased, opts);
  await assert.rejects(readdir(configDir(opts)), { code: 'ENOENT' });
});
