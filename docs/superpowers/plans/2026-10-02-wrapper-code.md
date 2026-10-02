# wrapper-code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `wrapper-code` npm CLI that launches Claude Code against DeepSeek (first provider) using per-session env vars, with a browser-based setup page that validates and stores the API key.

**Architecture:** A zero-dependency Node ESM package. A data-only provider catalog (`src/providers/*.js`) describes env vars, model profiles and how to test a credential. The CLI reads `<configdir>/<provider>.env`, runs a local `node:http` setup page when the credential is missing, assembles the child environment from catalog + profile + file, and `spawn`s the user's `claude` binary with `stdio: 'inherit'`.

**Tech Stack:** Node.js >= 18 (ESM, `node:http`, `node:child_process`, `node:test`, global `fetch`). No runtime dependencies. No build step.

**Spec:** `docs/superpowers/specs/2026-10-02-wrapper-code-design.md`

## Global Constraints

- `engines.node >= 18`; `"type": "module"`; **zero runtime dependencies**; no TypeScript, no build step.
- Must work on macOS, Linux and Windows. Platform-specific behavior is always parameterized (`platform`, `env`, `home` injectable) so it is testable on any OS.
- Config dir: `$XDG_CONFIG_HOME/wrapper-code` or `~/.config/wrapper-code` (POSIX); `%APPDATA%\wrapper-code` (Windows). Dir mode `0o700`, file mode `0o600` on POSIX; `chmod` skipped on Windows.
- Env file stores only user choices (`<credential env>`, `WRAPPER_CODE_PROFILE`, optional `ANTHROPIC_BASE_URL`, manual extras). Derived model vars are never written.
- Child env precedence: `process.env` < provider `env` < profile `env` < file values. Then delete `ANTHROPIC_API_KEY` and `WRAPPER_CODE_PROFILE`.
- Never write under `~/.claude`. Never set `CLAUDE_CONFIG_DIR`.
- Setup server binds `127.0.0.1`, port `0`, requires a per-run random token on every request (`?t=` or `X-Setup-Token`), 403 otherwise. Idle timeout 10 minutes. No external requests from the page.
- `claude` resolved on `PATH` honoring `PATHEXT` on Windows; `shell: true` **only** when the resolved file ends in `.cmd`/`.bat`, with each arg double-quoted.
- Exit code of `claude` is propagated; killed by signal without a code → exit 1.
- Install hint text, verbatim: `claude not found on PATH. Install Claude Code: npm install -g @anthropic-ai/claude-code`
- Tests use `node --test`; no test touches the real DeepSeek API.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **Pasted key with surrounding whitespace or a trailing newline** — the key must be trimmed before testing and saving, otherwise every later launch fails with 401. (Test added in Task 7.)
2. **Env file edited on Windows with CRLF line endings** — values must not carry a trailing `\r`. (Test added in Task 1.)
3. **Credential or override value containing `=`** (base64 padding, URLs with query strings) — only the first `=` separates key from value. (Test added in Task 1.)
4. **A directory named `claude` on `PATH`** (e.g. a project folder) — resolution must skip non-files and keep searching. (Test added in Task 5.)
5. **Setup `POST /save` with a profile id that is not in the catalog** (stale page, hand-crafted request) — must be rejected with 400 and write nothing. (Test added in Task 7.)

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | name, bin, ESM, engines, files, test script |
| `bin/wrapper-code.js` | executable shim: calls `main()` and maps result/exception to exit code |
| `src/cli.js` | argv dispatch (`list`, `setup`, `<provider>`, `--help`, `--version`), launch and setup orchestration |
| `src/catalog.js` | loads and validates `src/providers/*.js` into a `Map<id, provider>` |
| `src/providers/deepseek.js` | DeepSeek provider data |
| `src/config.js` | config dir per platform; parse/serialize/read/write the per-provider env file |
| `src/env.js` | child env assembly, derived env for display, `isConfigured` |
| `src/launch.js` | resolve `claude` on PATH, spawn, propagate exit code |
| `src/open.js` | open a URL in the default browser per platform |
| `src/setup/server.js` | local HTTP server: token check, page, `/save`, `/cancel`, credential test |
| `src/setup/page.html` | the setup page (inline CSS/JS) |
| `test/*.test.js` | one test file per module plus `cli.test.js` end-to-end |
| `README.md`, `LICENSE` | user docs, MIT |

---

### Task 1: Package scaffold and env file parse/serialize

**Files:**
- Create: `package.json`, `.gitignore`, `LICENSE`, `src/config.js`, `test/config.test.js`

**Interfaces:**
- Produces: `parseEnvFile(text: string): Record<string,string>` (throws `Error` with `line N` on malformed lines); `serializeEnvFile(values: Record<string,string>, { header?: string }): string`.

- [ ] **Step 1: Create package.json, .gitignore and LICENSE**

`package.json`:
```json
{
  "name": "wrapper-code",
  "version": "0.1.0",
  "description": "Run the Claude Code CLI harness with other LLM providers (DeepSeek first) without touching your Claude Code configuration.",
  "type": "module",
  "bin": { "wrapper-code": "./bin/wrapper-code.js" },
  "files": ["bin", "src", "README.md", "LICENSE"],
  "engines": { "node": ">=18" },
  "scripts": { "test": "node --test test/*.test.js" },
  "keywords": ["claude-code", "deepseek", "llm", "cli", "wrapper"],
  "license": "MIT"
}
```

`.gitignore`:
```
node_modules/
*.tgz
.DS_Store
```

`LICENSE`: standard MIT text with `Copyright (c) 2026 Gabriel Fernandes`.

- [ ] **Step 2: Write the failing tests**

`test/config.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvFile, serializeEnvFile } from '../src/config.js';

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

test('serializeEnvFile writes a header comment and round-trips through parseEnvFile', () => {
  const values = { ANTHROPIC_AUTH_TOKEN: 'sk-abc', WRAPPER_CODE_PROFILE: 'v4-pro' };
  const text = serializeEnvFile(values, { header: 'wrapper-code — deepseek' });
  assert.ok(text.startsWith('# wrapper-code — deepseek\n'));
  assert.ok(text.endsWith('\n'));
  assert.deepEqual(parseEnvFile(text), values);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/config.test.js`
Expected: FAIL, `Cannot find module '../src/config.js'`.

- [ ] **Step 4: Implement parse/serialize**

`src/config.js`:
```js
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseEnvFile(text) {
  const result = {};
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    const key = eq > 0 ? line.slice(0, eq).trim() : '';
    if (!KEY_RE.test(key)) throw new Error(`Malformed line ${index + 1}: ${raw}`);
    result[key] = line.slice(eq + 1).trim();
  });
  return result;
}

export function serializeEnvFile(values, { header } = {}) {
  const lines = [];
  if (header) lines.push(`# ${header}`);
  for (const [key, value] of Object.entries(values)) lines.push(`${key}=${value}`);
  return `${lines.join('\n')}\n`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/config.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore LICENSE src/config.js test/config.test.js
git commit -m "feat: package scaffold and env file parse/serialize

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Config directory and env file read/write

**Files:**
- Modify: `src/config.js`
- Modify: `test/config.test.js`

**Interfaces:**
- Consumes: `parseEnvFile`, `serializeEnvFile` (Task 1).
- Produces:
  - `configDir({ platform?, env?, home? }): string`
  - `envFilePath(providerId, opts?): string`
  - `readProviderEnv(providerId, opts?): Promise<Record<string,string>>` — `{}` when the file does not exist; throws `ConfigError` (message contains the path and `wrapper-code setup <id>`) when unreadable or malformed.
  - `writeProviderEnv(providerId, values, opts?): Promise<string>` — returns the written path.
  - `class ConfigError extends Error`
  - `opts` is always `{ platform = process.platform, env = process.env, home = os.homedir() }`.

- [ ] **Step 1: Append failing tests**

Append to `test/config.test.js`:
```js
import { mkdtemp, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configDir, envFilePath, readProviderEnv, writeProviderEnv, ConfigError } from '../src/config.js';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/config.test.js`
Expected: FAIL, `does not provide an export named 'configDir'`.

- [ ] **Step 3: Implement**

Append to `src/config.js` (add the imports at the top of the file):
```js
import { homedir } from 'node:os';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';

export class ConfigError extends Error {}

function normalize(opts = {}) {
  return {
    platform: opts.platform ?? process.platform,
    env: opts.env ?? process.env,
    home: opts.home ?? homedir(),
  };
}

export function configDir(opts) {
  const { platform, env, home } = normalize(opts);
  if (platform === 'win32') {
    const base = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(base, 'wrapper-code');
  }
  const base = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'wrapper-code');
}

export function envFilePath(providerId, opts) {
  return path.join(configDir(opts), `${providerId}.env`);
}

export async function readProviderEnv(providerId, opts) {
  const file = envFilePath(providerId, opts);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new ConfigError(`Cannot read ${file}: ${err.message}. Run: wrapper-code setup ${providerId}`);
  }
  try {
    return parseEnvFile(text);
  } catch (err) {
    throw new ConfigError(`${file}: ${err.message}. Run: wrapper-code setup ${providerId}`);
  }
}

export async function writeProviderEnv(providerId, values, opts) {
  const { platform } = normalize(opts);
  const file = envFilePath(providerId, opts);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, serializeEnvFile(values, { header: `wrapper-code — ${providerId}` }), { mode: 0o600 });
  if (platform !== 'win32') await chmod(file, 0o600);
  return file;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/config.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "feat: config directory per platform and provider env file read/write

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Provider catalog and DeepSeek provider

**Files:**
- Create: `src/catalog.js`, `src/providers/deepseek.js`, `test/catalog.test.js`

**Interfaces:**
- Produces:
  - `validateProvider(provider): void` — throws `Error` naming the missing/invalid field.
  - `loadCatalog(dirUrl?: URL): Promise<Map<string, Provider>>` — keyed by `provider.id`.
  - `Provider` shape: `{ id, name, docs, credential: null | { env, label, help }, env: Record<string,string>, profiles: Record<string, { label, env }>, defaultProfile, test: { method, url, auth: 'bearer' | 'none' }, editableBaseUrl: boolean }`.

- [ ] **Step 1: Write the failing tests**

`test/catalog.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, validateProvider } from '../src/catalog.js';

const valid = () => ({
  id: 'x', name: 'X', docs: 'https://x', credential: { env: 'ANTHROPIC_AUTH_TOKEN', label: 'API key', help: 'h' },
  env: { ANTHROPIC_BASE_URL: 'https://x/anthropic' },
  profiles: { p: { label: 'P', env: { ANTHROPIC_MODEL: 'm' } } },
  defaultProfile: 'p', test: { method: 'GET', url: 'https://x/models', auth: 'bearer' }, editableBaseUrl: false,
});

test('validateProvider accepts a valid provider', () => {
  assert.doesNotThrow(() => validateProvider(valid()));
});

test('validateProvider accepts credential: null', () => {
  assert.doesNotThrow(() => validateProvider({ ...valid(), credential: null }));
});

test('validateProvider rejects a defaultProfile that is not in profiles', () => {
  assert.throws(() => validateProvider({ ...valid(), defaultProfile: 'nope' }), /defaultProfile/);
});

test('validateProvider rejects missing id, env, profiles, test', () => {
  assert.throws(() => validateProvider({ ...valid(), id: '' }), /id/);
  assert.throws(() => validateProvider({ ...valid(), env: null }), /env/);
  assert.throws(() => validateProvider({ ...valid(), profiles: {} }), /profiles/);
  assert.throws(() => validateProvider({ ...valid(), test: undefined }), /test/);
});

test('validateProvider rejects a credential without env', () => {
  assert.throws(() => validateProvider({ ...valid(), credential: { label: 'k' } }), /credential/);
});

test('loadCatalog loads deepseek with the documented values', async () => {
  const catalog = await loadCatalog();
  const ds = catalog.get('deepseek');
  assert.ok(ds, 'deepseek provider present');
  assert.equal(ds.name, 'DeepSeek');
  assert.equal(ds.credential.env, 'ANTHROPIC_AUTH_TOKEN');
  assert.equal(ds.env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(ds.env.CLAUDE_CODE_EFFORT_LEVEL, 'max');
  assert.equal(ds.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '786432');
  assert.equal(ds.defaultProfile, 'flash-1m');
  assert.deepEqual(ds.profiles['flash-1m'].env, {
    ANTHROPIC_MODEL: 'deepseek-flash[1m]',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-flash[1m]',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-flash[1m]',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-flash',
    CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
  });
  assert.equal(ds.profiles['v4-pro'].env.ANTHROPIC_MODEL, 'deepseek-v4-pro');
  assert.equal(ds.test.url, 'https://api.deepseek.com/models');
  assert.equal(ds.editableBaseUrl, false);
});

test('every catalog entry is valid and keyed by its id', async () => {
  const catalog = await loadCatalog();
  assert.ok(catalog.size >= 1);
  for (const [id, provider] of catalog) {
    assert.equal(id, provider.id);
    assert.doesNotThrow(() => validateProvider(provider));
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/catalog.test.js`
Expected: FAIL, `Cannot find module '../src/catalog.js'`.

- [ ] **Step 3: Implement the provider and the catalog**

`src/providers/deepseek.js`:
```js
// Values from https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/ (2026-10-02)
export default {
  id: 'deepseek',
  name: 'DeepSeek',
  docs: 'https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/',
  credential: {
    env: 'ANTHROPIC_AUTH_TOKEN',
    label: 'API key',
    help: 'Create one at https://platform.deepseek.com/api_keys',
  },
  env: {
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    CLAUDE_CODE_EFFORT_LEVEL: 'max',
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: '786432',
  },
  profiles: {
    'flash-1m': {
      label: 'DeepSeek Flash, 1M context (documentation default)',
      env: {
        ANTHROPIC_MODEL: 'deepseek-flash[1m]',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-flash[1m]',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-flash[1m]',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-flash',
        CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
      },
    },
    'v4-pro': {
      label: 'DeepSeek V4 Pro as main model, Flash for subagents',
      env: {
        ANTHROPIC_MODEL: 'deepseek-v4-pro',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-flash[1m]',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-flash',
        CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
      },
    },
  },
  defaultProfile: 'flash-1m',
  test: { method: 'GET', url: 'https://api.deepseek.com/models', auth: 'bearer' },
  editableBaseUrl: false,
};
```

`src/catalog.js`:
```js
import { readdir } from 'node:fs/promises';

const PROVIDERS_DIR = new URL('./providers/', import.meta.url);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateProvider(provider) {
  if (!isObject(provider)) throw new Error('provider must be an object');
  if (typeof provider.id !== 'string' || !provider.id) throw new Error('provider.id must be a non-empty string');
  const where = `provider "${provider.id}"`;
  if (typeof provider.name !== 'string' || !provider.name) throw new Error(`${where}: name is required`);
  if (!isObject(provider.env)) throw new Error(`${where}: env must be an object`);
  if (!isObject(provider.profiles) || Object.keys(provider.profiles).length === 0) {
    throw new Error(`${where}: profiles must have at least one entry`);
  }
  for (const [pid, profile] of Object.entries(provider.profiles)) {
    if (!isObject(profile) || typeof profile.label !== 'string' || !isObject(profile.env)) {
      throw new Error(`${where}: profiles.${pid} needs label and env`);
    }
  }
  if (!provider.profiles[provider.defaultProfile]) {
    throw new Error(`${where}: defaultProfile "${provider.defaultProfile}" is not in profiles`);
  }
  if (provider.credential !== null) {
    if (!isObject(provider.credential) || typeof provider.credential.env !== 'string' || typeof provider.credential.label !== 'string') {
      throw new Error(`${where}: credential must be null or { env, label, help }`);
    }
  }
  if (!isObject(provider.test) || typeof provider.test.url !== 'string') {
    throw new Error(`${where}: test must be { method, url, auth }`);
  }
}

export async function loadCatalog(dirUrl = PROVIDERS_DIR) {
  const catalog = new Map();
  const files = (await readdir(dirUrl)).filter((f) => f.endsWith('.js')).sort();
  for (const file of files) {
    const mod = await import(new URL(file, dirUrl));
    const provider = mod.default;
    validateProvider(provider);
    catalog.set(provider.id, provider);
  }
  return catalog;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/catalog.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/catalog.js src/providers/deepseek.js test/catalog.test.js
git commit -m "feat: provider catalog with DeepSeek definition

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Environment assembly

**Files:**
- Create: `src/env.js`, `test/env.test.js`

**Interfaces:**
- Consumes: `Provider` shape (Task 3).
- Produces:
  - `buildEnv({ provider, fileValues, baseEnv }): Record<string,string>` — throws `Error` mentioning `wrapper-code setup <id>` when `WRAPPER_CODE_PROFILE` names an unknown profile.
  - `derivedEnv(provider, profileId): Record<string,string>` — `provider.env` merged with the profile env (for the setup page's Advanced block).
  - `isConfigured(provider, fileValues): boolean`.

- [ ] **Step 1: Write the failing tests**

`test/env.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnv, derivedEnv, isConfigured } from '../src/env.js';
import deepseek from '../src/providers/deepseek.js';

test('buildEnv layers process env < provider env < profile env < file values', () => {
  const env = buildEnv({
    provider: deepseek,
    fileValues: { ANTHROPIC_AUTH_TOKEN: 'sk-file', WRAPPER_CODE_PROFILE: 'v4-pro', CLAUDE_CODE_EFFORT_LEVEL: 'high' },
    baseEnv: { PATH: '/bin', ANTHROPIC_BASE_URL: 'https://shell-value', HOME: '/h' },
  });
  assert.equal(env.PATH, '/bin');
  assert.equal(env.HOME, '/h');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(env.ANTHROPIC_MODEL, 'deepseek-v4-pro');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'sk-file');
  assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, 'high');
});

test('buildEnv uses defaultProfile when the file has no WRAPPER_CODE_PROFILE', () => {
  const env = buildEnv({ provider: deepseek, fileValues: { ANTHROPIC_AUTH_TOKEN: 'sk' }, baseEnv: {} });
  assert.equal(env.ANTHROPIC_MODEL, 'deepseek-flash[1m]');
});

test('buildEnv removes ANTHROPIC_API_KEY and WRAPPER_CODE_PROFILE from the child env', () => {
  const env = buildEnv({
    provider: deepseek,
    fileValues: { ANTHROPIC_AUTH_TOKEN: 'sk', WRAPPER_CODE_PROFILE: 'flash-1m' },
    baseEnv: { ANTHROPIC_API_KEY: 'real-anthropic-key' },
  });
  assert.equal('ANTHROPIC_API_KEY' in env, false);
  assert.equal('WRAPPER_CODE_PROFILE' in env, false);
});

test('buildEnv does not mutate baseEnv', () => {
  const baseEnv = { ANTHROPIC_API_KEY: 'k' };
  buildEnv({ provider: deepseek, fileValues: {}, baseEnv });
  assert.equal(baseEnv.ANTHROPIC_API_KEY, 'k');
});

test('buildEnv throws a setup hint on an unknown profile', () => {
  assert.throws(
    () => buildEnv({ provider: deepseek, fileValues: { WRAPPER_CODE_PROFILE: 'ghost' }, baseEnv: {} }),
    /wrapper-code setup deepseek/,
  );
});

test('derivedEnv merges provider env and profile env', () => {
  const env = derivedEnv(deepseek, 'flash-1m');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(env.ANTHROPIC_MODEL, 'deepseek-flash[1m]');
  assert.equal('ANTHROPIC_AUTH_TOKEN' in env, false);
});

test('isConfigured is true only when the credential env is present and non-empty', () => {
  assert.equal(isConfigured(deepseek, {}), false);
  assert.equal(isConfigured(deepseek, { ANTHROPIC_AUTH_TOKEN: '' }), false);
  assert.equal(isConfigured(deepseek, { ANTHROPIC_AUTH_TOKEN: 'sk' }), true);
  assert.equal(isConfigured({ ...deepseek, credential: null }, {}), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/env.test.js`
Expected: FAIL, `Cannot find module '../src/env.js'`.

- [ ] **Step 3: Implement**

`src/env.js`:
```js
export function derivedEnv(provider, profileId) {
  const profile = provider.profiles[profileId];
  if (!profile) throw new Error(`Unknown profile "${profileId}" for ${provider.id}. Run: wrapper-code setup ${provider.id}`);
  return { ...provider.env, ...profile.env };
}

export function isConfigured(provider, fileValues) {
  if (!provider.credential) return true;
  return Boolean(fileValues[provider.credential.env]);
}

export function buildEnv({ provider, fileValues, baseEnv = process.env }) {
  const profileId = fileValues.WRAPPER_CODE_PROFILE || provider.defaultProfile;
  const env = { ...baseEnv, ...derivedEnv(provider, profileId) };
  for (const [key, value] of Object.entries(fileValues)) {
    if (key !== 'WRAPPER_CODE_PROFILE') env[key] = value;
  }
  delete env.ANTHROPIC_API_KEY;
  delete env.WRAPPER_CODE_PROFILE;
  return env;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/env.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/env.js test/env.test.js
git commit -m "feat: child environment assembly from catalog, profile and env file

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Resolve and launch `claude`

**Files:**
- Create: `src/launch.js`, `test/launch.test.js`

**Interfaces:**
- Produces:
  - `resolveClaude({ platform?, env? }): string | null` — absolute path of the first `claude` executable on `PATH` (with `PATHEXT` on win32), or `null`.
  - `quoteForCmd(arg: string): string`.
  - `launchClaude({ claudePath, args, env, spawnImpl? }): Promise<{ code: number, signal?: string, error?: Error }>`.

- [ ] **Step 1: Write the failing tests**

`test/launch.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveClaude, launchClaude, quoteForCmd } from '../src/launch.js';

const isWin = process.platform === 'win32';

async function tmp() {
  return mkdtemp(path.join(tmpdir(), 'wc-launch-'));
}

test('resolveClaude finds an executable named claude on PATH (POSIX)', { skip: isWin }, async () => {
  const dir = await tmp();
  const file = path.join(dir, 'claude');
  await writeFile(file, '#!/bin/sh\n');
  await chmod(file, 0o755);
  assert.equal(resolveClaude({ platform: 'linux', env: { PATH: `/nonexistent${path.delimiter}${dir}` } }), file);
});

test('resolveClaude skips a non-executable file on POSIX', { skip: isWin }, async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'claude'), '');
  await chmod(path.join(dir, 'claude'), 0o644);
  assert.equal(resolveClaude({ platform: 'linux', env: { PATH: dir } }), null);
});

test('resolveClaude skips a directory named claude and keeps searching', async () => {
  const dirA = await tmp();
  const dirB = await tmp();
  await mkdir(path.join(dirA, 'claude'));
  const file = path.join(dirB, isWin ? 'claude.cmd' : 'claude');
  await writeFile(file, '');
  if (!isWin) await chmod(file, 0o755);
  const found = resolveClaude({
    platform: process.platform,
    env: { PATH: `${dirA}${path.delimiter}${dirB}`, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
  });
  assert.equal(found, file);
});

test('resolveClaude honors PATHEXT on win32 and finds claude.cmd', async () => {
  const dir = await tmp();
  const file = path.join(dir, 'claude.cmd');
  await writeFile(file, '@echo off\r\n');
  assert.equal(
    resolveClaude({ platform: 'win32', env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' } }),
    file,
  );
});

test('resolveClaude returns null on an empty PATH', () => {
  assert.equal(resolveClaude({ platform: 'linux', env: {} }), null);
});

test('quoteForCmd leaves simple args alone and double-quotes the rest', () => {
  assert.equal(quoteForCmd('--resume'), '--resume');
  assert.equal(quoteForCmd('a b'), '"a b"');
  assert.equal(quoteForCmd('say "hi"'), '"say \\"hi\\""');
  assert.equal(quoteForCmd(''), '""');
});

test('launchClaude passes env and args to the child and propagates its exit code', async () => {
  const dir = await tmp();
  const script = path.join(dir, 'fake-claude.js');
  const out = path.join(dir, 'out.json');
  await writeFile(script, `
    import { writeFileSync } from 'node:fs';
    writeFileSync(process.env.FAKE_OUT, JSON.stringify({ argv: process.argv.slice(2), model: process.env.ANTHROPIC_MODEL }));
    process.exit(Number(process.env.FAKE_EXIT));
  `);
  const result = await launchClaude({
    claudePath: process.execPath,
    args: [script, '--resume', 'a b'],
    env: { ...process.env, FAKE_OUT: out, FAKE_EXIT: '7', ANTHROPIC_MODEL: 'deepseek-flash[1m]' },
  });
  assert.equal(result.code, 7);
  assert.deepEqual(JSON.parse(await readFile(out, 'utf8')), { argv: ['--resume', 'a b'], model: 'deepseek-flash[1m]' });
});

test('launchClaude resolves code 1 with the error when spawn fails', async () => {
  const result = await launchClaude({ claudePath: path.join(await tmp(), 'missing'), args: [], env: process.env });
  assert.equal(result.code, 1);
  assert.ok(result.error);
});

test('launchClaude uses a shell with quoted args only for .cmd/.bat paths', async () => {
  const calls = [];
  const fakeSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { on: (event, cb) => { if (event === 'exit') setImmediate(() => cb(0, null)); } };
  };
  await launchClaude({ claudePath: 'C:\\x\\claude.cmd', args: ['a b'], env: {}, spawnImpl: fakeSpawn });
  await launchClaude({ claudePath: '/usr/bin/claude', args: ['a b'], env: {}, spawnImpl: fakeSpawn });
  assert.equal(calls[0].opts.shell, true);
  assert.deepEqual(calls[0].args, ['"a b"']);
  assert.equal(calls[0].cmd, '"C:\\x\\claude.cmd"');
  assert.equal(calls[1].opts.shell, false);
  assert.deepEqual(calls[1].args, ['a b']);
  assert.equal(calls[1].opts.stdio, 'inherit');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/launch.test.js`
Expected: FAIL, `Cannot find module '../src/launch.js'`.

- [ ] **Step 3: Implement**

`src/launch.js`:
```js
import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

export function resolveClaude({ platform = process.platform, env = process.env } = {}) {
  const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = platform === 'win32'
    ? ['', ...(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase())]
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `claude${ext}`);
      try {
        if (!statSync(candidate).isFile()) continue;
        if (platform !== 'win32') accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // not there or not executable: keep looking
      }
    }
  }
  return null;
}

export function quoteForCmd(arg) {
  if (/^[\w\-=.:\\/]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

export function launchClaude({ claudePath, args, env, spawnImpl = spawn }) {
  const useShell = /\.(cmd|bat)$/i.test(claudePath);
  const command = useShell ? `"${claudePath}"` : claudePath;
  const childArgs = useShell ? args.map(quoteForCmd) : args;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(command, childArgs, { stdio: 'inherit', env, shell: useShell });
    } catch (error) {
      resolve({ code: 1, error });
      return;
    }
    child.on('error', (error) => resolve({ code: 1, error }));
    child.on('exit', (code, signal) => resolve({ code: code ?? 1, signal: signal ?? undefined }));
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/launch.test.js`
Expected: PASS, 9 tests (2 skipped on Windows).

- [ ] **Step 5: Commit**

```bash
git add src/launch.js test/launch.test.js
git commit -m "feat: resolve claude on PATH and launch it with the assembled env

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Open the browser per platform

**Files:**
- Create: `src/open.js`, `test/open.test.js`

**Interfaces:**
- Produces: `openBrowser(url, { platform?, spawnImpl? }): boolean` — `true` when a launcher process was started, `false` otherwise. Never throws.

- [ ] **Step 1: Write the failing tests**

`test/open.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../src/open.js';

function recorder() {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { on() {}, unref() {} };
  };
  return { calls, spawnImpl };
}

test('openBrowser uses open on macOS', () => {
  const { calls, spawnImpl } = recorder();
  assert.equal(openBrowser('http://127.0.0.1:1/?t=x', { platform: 'darwin', spawnImpl }), true);
  assert.deepEqual(calls[0].cmd, 'open');
  assert.deepEqual(calls[0].args, ['http://127.0.0.1:1/?t=x']);
  assert.equal(calls[0].opts.detached, true);
  assert.equal(calls[0].opts.stdio, 'ignore');
});

test('openBrowser uses xdg-open on Linux', () => {
  const { calls, spawnImpl } = recorder();
  openBrowser('http://u', { platform: 'linux', spawnImpl });
  assert.equal(calls[0].cmd, 'xdg-open');
  assert.deepEqual(calls[0].args, ['http://u']);
});

test('openBrowser uses rundll32 on Windows', () => {
  const { calls, spawnImpl } = recorder();
  openBrowser('http://u', { platform: 'win32', spawnImpl });
  assert.equal(calls[0].cmd, 'rundll32');
  assert.deepEqual(calls[0].args, ['url.dll,FileProtocolHandler', 'http://u']);
});

test('openBrowser returns false and does not throw when spawn throws', () => {
  const spawnImpl = () => { throw new Error('ENOENT'); };
  assert.equal(openBrowser('http://u', { platform: 'linux', spawnImpl }), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/open.test.js`
Expected: FAIL, `Cannot find module '../src/open.js'`.

- [ ] **Step 3: Implement**

`src/open.js`:
```js
import { spawn } from 'node:child_process';

function launcher(platform, url) {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  return ['xdg-open', [url]];
}

export function openBrowser(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  const [cmd, args] = launcher(platform, url);
  try {
    const child = spawnImpl(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/open.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/open.js test/open.test.js
git commit -m "feat: open the setup URL in the default browser per platform

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Setup server and page

**Files:**
- Create: `src/setup/server.js`, `src/setup/page.html`, `test/setup-server.test.js`

**Interfaces:**
- Consumes: `derivedEnv(provider, profileId)` (Task 4); `Provider` shape (Task 3).
- Produces:
  - `testCredential(provider, credential, { fetchImpl?, testUrl? }): Promise<{ ok: true } | { ok: false, status: number, message: string }>` — `status: 0` for network errors.
  - `startSetupServer({ provider, current?, writeEnv, fetchImpl?, testUrl?, timeoutMs? }): Promise<{ url, port, token, done: Promise<{ saved: boolean, values?, reason?: 'timeout' | 'cancelled' | 'closed' }>, close(): void }>`.
  - `writeEnv(values)` is called exactly once, only after a successful credential test.

- [ ] **Step 1: Write the failing tests**

`test/setup-server.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startSetupServer, testCredential } from '../src/setup/server.js';
import deepseek from '../src/providers/deepseek.js';

async function fakeApi(status) {
  const server = http.createServer((req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(status === 200 ? '{"data":[]}' : '{"error":{"message":"invalid api key"}}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/models`, close: () => server.close() };
}

async function boot({ status = 200, current = {}, timeoutMs } = {}) {
  const api = await fakeApi(status);
  const written = [];
  const server = await startSetupServer({
    provider: deepseek,
    current,
    testUrl: api.url,
    timeoutMs,
    writeEnv: async (values) => { written.push(values); },
  });
  const post = (route, body, token = server.token) => fetch(`http://127.0.0.1:${server.port}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-setup-token': token },
    body: JSON.stringify(body),
  });
  const stop = async () => { server.close(); await server.done; api.close(); };
  return { server, written, post, stop };
}

test('GET / without the token is 403', async () => {
  const { server, stop } = await boot();
  const res = await fetch(`http://127.0.0.1:${server.port}/`);
  assert.equal(res.status, 403);
  await stop();
});

test('GET / with the token serves the page with the provider payload', async () => {
  const { server, stop } = await boot({ current: { WRAPPER_CODE_PROFILE: 'v4-pro', ANTHROPIC_AUTH_TOKEN: 'sk-old' } });
  const res = await fetch(server.url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /DeepSeek/);
  assert.match(html, new RegExp(server.token));
  assert.match(html, /"profile":"v4-pro"/);
  assert.match(html, /"hasCredential":true/);
  assert.match(html, /deepseek-flash\[1m\]/);
  assert.doesNotMatch(html, /sk-old/);
  await stop();
});

test('POST /save without the token header is 403', async () => {
  const { post, written, stop } = await boot();
  const res = await post('/save', { credential: 'sk-x', profile: 'flash-1m' }, 'wrong');
  assert.equal(res.status, 403);
  assert.equal(written.length, 0);
  await stop();
});

test('POST /save with a valid key writes the file and resolves done', async () => {
  const { server, post, written } = await boot();
  const res = await post('/save', { credential: 'sk-test', profile: 'v4-pro' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(written, [{ ANTHROPIC_AUTH_TOKEN: 'sk-test', WRAPPER_CODE_PROFILE: 'v4-pro' }]);
  const done = await server.done;
  assert.equal(done.saved, true);
  assert.deepEqual(done.values, written[0]);
});

test('POST /save trims whitespace and newlines around the credential', async () => {
  const { post, written, stop } = await boot();
  await post('/save', { credential: '  sk-trim \n', profile: 'flash-1m' });
  assert.equal(written[0].ANTHROPIC_AUTH_TOKEN, 'sk-trim');
  await stop();
});

test('POST /save with a rejected key is 400 with the API status and writes nothing', async () => {
  const { post, written, stop } = await boot({ status: 401 });
  const res = await post('/save', { credential: 'sk-bad', profile: 'flash-1m' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.status, 401);
  assert.match(body.message, /invalid api key/);
  assert.equal(written.length, 0);
  await stop();
});

test('POST /save with an unknown profile is 400 and writes nothing', async () => {
  const { post, written, stop } = await boot();
  const res = await post('/save', { credential: 'sk-x', profile: 'ghost' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /ghost/);
  assert.equal(written.length, 0);
  await stop();
});

test('POST /save with an empty credential keeps the stored one and preserves manual extras', async () => {
  const { post, written, stop } = await boot({
    current: { ANTHROPIC_AUTH_TOKEN: 'sk-old', WRAPPER_CODE_PROFILE: 'flash-1m', CLAUDE_CODE_EFFORT_LEVEL: 'high' },
  });
  const res = await post('/save', { credential: '', profile: 'v4-pro' });
  assert.equal(res.status, 200);
  assert.deepEqual(written[0], { ANTHROPIC_AUTH_TOKEN: 'sk-old', WRAPPER_CODE_PROFILE: 'v4-pro', CLAUDE_CODE_EFFORT_LEVEL: 'high' });
  await stop();
});

test('POST /save with no credential at all is 400', async () => {
  const { post, written, stop } = await boot();
  const res = await post('/save', { credential: '', profile: 'flash-1m' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /API key/);
  assert.equal(written.length, 0);
  await stop();
});

test('POST /save with invalid JSON is 400', async () => {
  const { server, stop } = await boot();
  const res = await fetch(`http://127.0.0.1:${server.port}/save`, {
    method: 'POST', headers: { 'x-setup-token': server.token }, body: '{nope',
  });
  assert.equal(res.status, 400);
  await stop();
});

test('POST /cancel resolves done with saved:false', async () => {
  const { server, post } = await boot();
  const res = await post('/cancel', {});
  assert.equal(res.status, 200);
  const done = await server.done;
  assert.deepEqual(done, { saved: false, reason: 'cancelled' });
});

test('idle timeout resolves done with reason timeout', async () => {
  const { server } = await boot({ timeoutMs: 50 });
  const done = await server.done;
  assert.deepEqual(done, { saved: false, reason: 'timeout' });
});

test('testCredential sends a bearer header and reports ok on 2xx', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, statusText: 'OK', text: async () => '' }; };
  assert.deepEqual(await testCredential(deepseek, 'sk-1', { fetchImpl }), { ok: true });
  assert.equal(seen[0].url, 'https://api.deepseek.com/models');
  assert.equal(seen[0].init.method, 'GET');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer sk-1');
});

test('testCredential reports a network error as status 0', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const result = await testCredential(deepseek, 'sk-1', { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.match(result.message, /ECONNREFUSED/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/setup-server.test.js`
Expected: FAIL, `Cannot find module '../src/setup/server.js'`.

- [ ] **Step 3: Write the page**

`src/setup/page.html` (the server replaces `__SETUP_JSON__` with the payload):
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>wrapper-code setup</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f9; --card: #fff; --fg: #1b1f24; --muted: #6a737d; --line: #d9dde2; --accent: #2563eb; --ok: #15803d; --err: #b91c1c; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f1115; --card: #171a21; --fg: #e6e8eb; --muted: #9aa3ad; --line: #2b313b; --accent: #60a5fa; --ok: #4ade80; --err: #f87171; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  main { max-width: 640px; margin: 40px auto; padding: 0 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 20px; }
  label { display: block; font-weight: 600; margin: 16px 0 6px; }
  .help { color: var(--muted); font-size: 13px; margin: 4px 0 0; }
  input[type=text], input[type=password] { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--fg); font-size: 15px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row input { flex: 1; }
  button { padding: 10px 16px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; font-size: 14px; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  button:disabled { opacity: .6; cursor: default; }
  .profile { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; margin-bottom: 8px; cursor: pointer; }
  .profile input { margin-top: 4px; }
  .profile code { color: var(--muted); font-size: 12px; }
  details { margin-top: 16px; }
  summary { cursor: pointer; color: var(--muted); }
  pre { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px; overflow: auto; font-size: 12px; }
  .actions { display: flex; gap: 8px; margin-top: 20px; }
  .msg { margin-top: 16px; padding: 10px 12px; border-radius: 8px; display: none; }
  .msg.ok { display: block; background: color-mix(in srgb, var(--ok) 12%, transparent); color: var(--ok); }
  .msg.err { display: block; background: color-mix(in srgb, var(--err) 12%, transparent); color: var(--err); }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1 id="title"></h1>
    <p class="sub">wrapper-code · <a id="docs" target="_blank" rel="noopener">provider documentation</a></p>
    <form id="form">
      <div id="credential-block">
        <label for="credential" id="credential-label"></label>
        <div class="row">
          <input id="credential" type="password" autocomplete="off" spellcheck="false">
          <button type="button" id="toggle">Show</button>
        </div>
        <p class="help" id="credential-help"></p>
      </div>
      <div id="baseurl-block" hidden>
        <label for="baseUrl">Base URL</label>
        <input id="baseUrl" type="text" autocomplete="off" spellcheck="false">
      </div>
      <label>Model profile</label>
      <div id="profiles"></div>
      <details>
        <summary>Advanced: variables that will be injected</summary>
        <pre id="advanced"></pre>
      </details>
      <div class="actions">
        <button type="submit" class="primary" id="save">Test and save</button>
        <button type="button" id="cancel">Cancel</button>
      </div>
      <div class="msg" id="msg"></div>
    </form>
  </div>
</main>
<script>
(function () {
  var setup = __SETUP_JSON__;
  var provider = setup.provider, current = setup.current, token = setup.token;
  var $ = function (id) { return document.getElementById(id); };

  $('title').textContent = provider.name + ' setup';
  $('docs').href = provider.docs;

  if (provider.credential) {
    $('credential-label').textContent = provider.credential.label;
    $('credential-help').textContent = provider.credential.help || '';
    if (current.hasCredential) $('credential').placeholder = 'already configured, leave blank to keep';
  } else {
    $('credential-block').hidden = true;
  }
  if (provider.editableBaseUrl) {
    $('baseurl-block').hidden = false;
    $('baseUrl').value = current.baseUrl || '';
  }

  var profilesEl = $('profiles');
  Object.keys(provider.profiles).forEach(function (id) {
    var p = provider.profiles[id];
    var label = document.createElement('label');
    label.className = 'profile';
    var radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'profile'; radio.value = id; radio.checked = id === current.profile;
    radio.addEventListener('change', renderAdvanced);
    var text = document.createElement('div');
    var strong = document.createElement('div'); strong.textContent = p.label;
    var code = document.createElement('code'); code.textContent = id;
    text.appendChild(strong); text.appendChild(code);
    label.appendChild(radio); label.appendChild(text);
    profilesEl.appendChild(label);
  });

  function selectedProfile() {
    var el = document.querySelector('input[name=profile]:checked');
    return el ? el.value : current.profile;
  }
  function renderAdvanced() {
    var env = provider.profiles[selectedProfile()].env;
    $('advanced').textContent = Object.keys(env).map(function (k) { return k + '=' + env[k]; }).join('\n');
  }
  renderAdvanced();

  $('toggle').addEventListener('click', function () {
    var input = $('credential');
    input.type = input.type === 'password' ? 'text' : 'password';
    this.textContent = input.type === 'password' ? 'Show' : 'Hide';
  });

  function show(kind, text) { var m = $('msg'); m.className = 'msg ' + kind; m.textContent = text; }
  function post(route, body) {
    return fetch(route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-setup-token': token }, body: JSON.stringify(body) });
  }

  $('form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    $('save').disabled = true;
    show('', '');
    post('/save', { credential: $('credential').value, profile: selectedProfile(), baseUrl: $('baseUrl').value })
      .then(function (res) { return res.json().then(function (body) { return { res: res, body: body }; }); })
      .then(function (r) {
        if (r.body.ok) {
          show('ok', 'Done. You can return to the terminal.');
          $('cancel').disabled = true;
        } else {
          show('err', (r.body.status ? 'HTTP ' + r.body.status + ': ' : '') + r.body.message);
          $('save').disabled = false;
        }
      })
      .catch(function (err) { show('err', err.message); $('save').disabled = false; });
  });

  $('cancel').addEventListener('click', function () {
    post('/cancel', {}).then(function () { show('ok', 'Cancelled. Nothing was saved. You can close this tab.'); $('save').disabled = true; $('cancel').disabled = true; });
  });
})();
</script>
</body>
</html>
```

- [ ] **Step 4: Implement the server**

`src/setup/server.js`:
```js
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { derivedEnv } from '../env.js';

const PAGE_URL = new URL('./page.html', import.meta.url);
const MAX_BODY = 64 * 1024;

export async function testCredential(provider, credential, { fetchImpl = globalThis.fetch, testUrl } = {}) {
  const url = testUrl || provider.test.url;
  const headers = {};
  if (provider.test.auth === 'bearer' && credential) headers.Authorization = `Bearer ${credential}`;
  try {
    const res = await fetchImpl(url, { method: provider.test.method || 'GET', headers });
    if (res.ok) return { ok: true };
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.text()).trim();
      if (body) message = body.slice(0, 300);
    } catch {
      // keep statusText
    }
    return { ok: false, status: res.status, message };
  } catch (err) {
    return { ok: false, status: 0, message: err.message };
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function pagePayload(provider, current, token) {
  const profiles = {};
  for (const [id, profile] of Object.entries(provider.profiles)) {
    profiles[id] = { label: profile.label, env: derivedEnv(provider, id) };
  }
  return {
    token,
    provider: {
      id: provider.id,
      name: provider.name,
      docs: provider.docs,
      credential: provider.credential,
      editableBaseUrl: Boolean(provider.editableBaseUrl),
      profiles,
    },
    current: {
      profile: provider.profiles[current.WRAPPER_CODE_PROFILE] ? current.WRAPPER_CODE_PROFILE : provider.defaultProfile,
      hasCredential: Boolean(provider.credential && current[provider.credential.env]),
      baseUrl: current.ANTHROPIC_BASE_URL || provider.env.ANTHROPIC_BASE_URL || '',
    },
  };
}

export async function startSetupServer({
  provider, current = {}, writeEnv, fetchImpl = globalThis.fetch, testUrl, timeoutMs = 10 * 60 * 1000,
}) {
  const token = randomBytes(32).toString('hex');
  const template = await readFile(PAGE_URL, 'utf8');

  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  let finished = false;
  let timer;

  const finish = (result) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    resolveDone(result);
    setImmediate(() => {
      server.closeAllConnections?.();
      server.close();
    });
  };
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => finish({ saved: false, reason: 'timeout' }), timeoutMs);
    timer.unref?.();
  };

  const server = http.createServer(async (req, res) => {
    touch();
    const url = new URL(req.url, 'http://127.0.0.1');
    const sent = req.headers['x-setup-token'] || url.searchParams.get('t');
    if (sent !== token) {
      res.writeHead(403);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      const json = JSON.stringify(pagePayload(provider, current, token)).replace(/<\//g, '<\\/');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(template.replace('__SETUP_JSON__', json));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/cancel') {
      sendJson(res, 200, { ok: true });
      finish({ saved: false, reason: 'cancelled' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/save') {
      let body;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        sendJson(res, 400, { ok: false, status: 0, message: 'Invalid JSON body' });
        return;
      }
      const profile = String(body.profile || '');
      if (!provider.profiles[profile]) {
        sendJson(res, 400, { ok: false, status: 0, message: `Unknown profile "${profile}"` });
        return;
      }
      const values = { ...current, WRAPPER_CODE_PROFILE: profile };
      let credential = '';
      if (provider.credential) {
        credential = String(body.credential || '').trim() || current[provider.credential.env] || '';
        if (!credential) {
          sendJson(res, 400, { ok: false, status: 0, message: `${provider.credential.label} is required` });
          return;
        }
        values[provider.credential.env] = credential;
      }
      if (provider.editableBaseUrl && String(body.baseUrl || '').trim()) {
        values.ANTHROPIC_BASE_URL = String(body.baseUrl).trim();
      }
      const result = await testCredential(provider, credential, { fetchImpl, testUrl });
      if (!result.ok) {
        sendJson(res, 400, result);
        return;
      }
      await writeEnv(values);
      sendJson(res, 200, { ok: true });
      finish({ saved: true, values });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  touch();
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/?t=${token}`,
    port,
    token,
    done,
    close: () => finish({ saved: false, reason: 'closed' }),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/setup-server.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 6: Open the page in a real browser once**

Run a throwaway script from the scratchpad (not committed):
```js
import { startSetupServer } from '/Users/nayabing/Workspaces/Superdevs/wrapper-code/src/setup/server.js';
import deepseek from '/Users/nayabing/Workspaces/Superdevs/wrapper-code/src/providers/deepseek.js';
const s = await startSetupServer({ provider: deepseek, writeEnv: async (v) => console.log('would write', v), testUrl: 'https://example.com/' });
console.log(s.url);
console.log(await s.done);
```
Open the printed URL in the built-in browser, check: title "DeepSeek setup", key field with Show toggle, two profiles with `flash-1m` preselected, Advanced block showing the five model vars plus base URL, effort and compact window; switch profile and confirm the block updates; click Cancel and confirm the message. Fix any layout or script error before committing.

- [ ] **Step 7: Commit**

```bash
git add src/setup/server.js src/setup/page.html test/setup-server.test.js
git commit -m "feat: local setup server and page with credential test

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: CLI dispatch and executable

**Files:**
- Create: `src/cli.js`, `bin/wrapper-code.js`, `test/cli.test.js`

**Interfaces:**
- Consumes: `loadCatalog` (Task 3); `readProviderEnv`, `writeProviderEnv`, `envFilePath`, `ConfigError` (Task 2); `buildEnv`, `isConfigured` (Task 4); `resolveClaude`, `launchClaude` (Task 5); `openBrowser` (Task 6); `startSetupServer` (Task 7).
- Produces: `main(argv: string[], deps?): Promise<number>` where `deps` may override `stdout`, `stderr`, `env`, `platform`, `home`, `openBrowserImpl`, `launchImpl`, `resolveClaudeImpl`, `startSetupServerImpl`, `catalogImpl`. `HELP: string`.

- [ ] **Step 1: Write the failing tests**

`test/cli.test.js`:
```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/cli.test.js`
Expected: FAIL, `Cannot find module '../src/cli.js'`.

- [ ] **Step 3: Implement the CLI**

`src/cli.js`:
```js
import { createRequire } from 'node:module';
import { loadCatalog } from './catalog.js';
import { readProviderEnv, writeProviderEnv, envFilePath } from './config.js';
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
    for (const provider of catalog.values()) {
      const values = await readProviderEnv(provider.id, cfg);
      const status = isConfigured(provider, values) ? 'configured' : 'not configured';
      stdout.write(`${provider.id.padEnd(12)} ${provider.name.padEnd(12)} ${status}\n`);
    }
    return 0;
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
```

`bin/wrapper-code.js`:
```js
#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err) => {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  },
);
```

Then make it executable:
```bash
chmod +x bin/wrapper-code.js
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/cli.test.js`
Expected: PASS, 11 tests (1 skipped on Windows).

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all test files pass, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/cli.js bin/wrapper-code.js test/cli.test.js
git commit -m "feat: wrapper-code CLI with list, setup and launch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: README, package check and manual end-to-end

**Files:**
- Create: `README.md`
- Modify: `package.json` (only if `npm pack --dry-run` shows missing/extra files)

**Interfaces:** none (documentation and verification).

- [ ] **Step 1: Write README.md**

```markdown
# wrapper-code

Run the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI harness with other LLM providers, without touching your Claude Code configuration.

`wrapper-code deepseek` opens a normal interactive Claude Code session that talks to DeepSeek. Running `claude` directly still uses Anthropic, exactly as before. Nothing is written under `~/.claude`, and no variable leaks into your shell: the provider settings exist only inside that one session.

## Install

Requires Node.js 18+ and Claude Code (`npm install -g @anthropic-ai/claude-code`).

```bash
npm install -g wrapper-code
```

Works on macOS, Linux and Windows.

## Usage

```bash
wrapper-code deepseek              # launch Claude Code with DeepSeek
wrapper-code deepseek --resume     # anything after the provider is passed to claude
wrapper-code setup deepseek        # change the API key or model profile
wrapper-code list                  # providers and whether they are configured
```

The first time you launch a provider, a setup page opens in your browser on `127.0.0.1`. Paste your API key, pick a model profile, click **Test and save**. The key is checked against the provider's API before anything is written. Then the session starts right away.

## Providers

| Provider | Profiles | Docs |
|---|---|---|
| `deepseek` | `flash-1m` (default): DeepSeek Flash with 1M context. `v4-pro`: DeepSeek V4 Pro as main model, Flash for subagents. | [DeepSeek × Claude Code](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/) |

More providers (Qwen Coder, Gemma, Llama, Mistral, local runtimes such as Ollama) are planned. A provider is a single data file in `src/providers/`; pull requests welcome.

## Where things are stored

One file per provider, containing only your choices (key and profile):

- macOS / Linux: `~/.config/wrapper-code/<provider>.env` (or `$XDG_CONFIG_HOME/wrapper-code/`), mode `600`
- Windows: `%APPDATA%\wrapper-code\<provider>.env`

Model names and the other variables come from the built-in catalog on every launch, so updating `wrapper-code` picks up provider changes without touching your file. Any extra `KEY=value` you add to the file by hand is passed through and overrides the catalog.

## How it works

1. Reads the provider definition (base URL, model variables, how to test a key).
2. Reads your `<provider>.env`; runs the setup page if the key is missing.
3. Builds an environment: your shell env + provider vars + profile vars + your file. `ANTHROPIC_API_KEY` is removed so Claude Code cannot fall back to Anthropic auth.
4. Finds `claude` on your `PATH` and runs it with that environment, forwarding your arguments and its exit code.

Your global `~/.claude` (CLAUDE.md, skills, plugins, MCP servers, history) is shared with the provider session, since only environment variables change.

## Development

```bash
npm test
```

Tests never call a real provider API.

## License

MIT
```

- [ ] **Step 2: Check the package contents**

Run: `npm pack --dry-run`
Expected: the tarball lists `bin/wrapper-code.js`, `src/**` (including `src/setup/page.html` and `src/providers/deepseek.js`), `README.md`, `LICENSE`, `package.json`, and nothing from `test/` or `docs/`. If `page.html` is missing, the `files` field is wrong; fix it.

- [ ] **Step 3: Link and run the real flow on this machine**

```bash
npm link
XDG_CONFIG_HOME=/private/tmp/claude-501/-Users-nayabing-Workspaces-Superdevs-wrapper-code/90162883-fdf6-413c-9c71-eac1bd643812/scratchpad/cfg wrapper-code list
```
Expected: `deepseek     DeepSeek     not configured`.

Then, pointing at the scratchpad config so nothing real is written:
```bash
XDG_CONFIG_HOME=/private/tmp/claude-501/-Users-nayabing-Workspaces-Superdevs-wrapper-code/90162883-fdf6-413c-9c71-eac1bd643812/scratchpad/cfg wrapper-code deepseek
```
Expected: the terminal prints the setup URL and the browser opens the page. Entering a bogus key must show an HTTP 401 error from DeepSeek in the page and write nothing. Click Cancel: the terminal prints "Setup was cancelled. Nothing was saved." and exits 1. Do **not** enter a real key during implementation; the user does that themselves.

Clean up: `npm unlink -g wrapper-code`.

- [ ] **Step 4: Commit**

```bash
git add README.md package.json
git commit -m "docs: README with install, usage and storage details

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** §3 CLI → Task 8. §4 storage and catalog → Tasks 1, 2, 3. §5 setup server, browser opening, page → Tasks 6, 7. §6 env assembly → Task 4. §7 claude resolution incl. `.cmd` shell exception → Task 5. §8 error table → Tasks 2 (malformed file), 5 (spawn error), 7 (key test failure, timeout, cancel), 8 (unknown provider, missing claude, cancelled setup, exit code). §9 testing → every task. §10 layout → File Structure. §11 out of scope → nothing planned for it.
- **Type consistency:** `opts = { platform, env, home }` is the same object shape across `config.js` and `cli.js`; `startSetupServer` returns `{ url, port, token, done, close }` and Task 8 fakes return the same keys; `launchClaude` returns `{ code, signal?, error? }` and Task 8 reads `code` and `error`.
- **Review Focus:** items 1 and 5 tested in Task 7, items 2 and 3 in Task 1, item 4 in Task 5.
