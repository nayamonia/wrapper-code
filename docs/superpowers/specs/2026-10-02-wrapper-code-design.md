# wrapper-code — Design Spec

**Date:** 2026-10-02
**Status:** approved design, pending implementation plan

## 1. Purpose

`wrapper-code` runs the Claude Code CLI harness against third-party LLM
providers (online and local) without touching the user's real Claude Code
configuration. The first supported provider is DeepSeek. Qwen Coder, Gemma,
Llama Scout, Mistral Nemo and local runtimes (e.g. Ollama) come later and must
fit the same catalog model without structural changes.

Success looks like: in any project directory, `wrapper-code deepseek` opens a
normal interactive Claude Code session that talks to DeepSeek. Running `claude`
directly afterwards still uses Anthropic, unchanged.

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Audience | Distributable npm package `wrapper-code`, installed with `npm i -g`. README in English. |
| Platforms | macOS, Linux and Windows are all first-class. |
| Isolation | Env vars only. `~/.claude` is **shared**: the provider session sees the user's global CLAUDE.md, skills, plugins, MCPs and history. No `CLAUDE_CONFIG_DIR` override. |
| Setup scope | Browser page asks for the credential and a model profile, tests the key live, and shows derived vars in a collapsed read-only "Advanced" block. |
| Stack | Node ESM JavaScript, **zero runtime dependencies**. `node:http` for setup, `child_process.spawn` for launch, `node:test` for tests. No TypeScript, no build step. `engines.node >= 18`. |

## 3. CLI

```
wrapper-code <provider> [claude args...]   # launch (runs setup first if credential missing)
wrapper-code setup <provider>              # force the setup page (change key or profile)
wrapper-code list                          # catalog providers with configured / not configured status
wrapper-code --help
wrapper-code --version
```

Everything after `<provider>` is passed verbatim to `claude`
(e.g. `wrapper-code deepseek --resume`).

### Launch flow for `wrapper-code deepseek`

1. Load provider `deepseek` from the catalog. Unknown id: print the valid ids, exit 1.
2. Read `<configdir>/deepseek.env`. If the provider declares a required
   credential and it is missing, run the setup flow (section 5). When setup
   saves successfully, **continue to launch in the same invocation**. If setup
   is closed without saving or times out, exit 1 with a message that nothing
   was written.
3. Build the child environment (section 6).
4. Resolve the `claude` binary on `PATH` (section 7). Not found: print the
   Claude Code install command, exit 1.
5. `spawn(claudePath, args, { stdio: 'inherit', env })`. The wrapper waits for
   `exit` and exits with the child's code (or 1 if killed by signal without a
   code). Ctrl+C reaches the child directly because it shares the terminal.

Nothing is ever written under `~/.claude`. No variable leaks to the parent
shell.

## 4. Storage and catalog

### Config directory

- macOS / Linux: `$XDG_CONFIG_HOME/wrapper-code` if `XDG_CONFIG_HOME` is set,
  else `~/.config/wrapper-code`.
- Windows: `%APPDATA%\wrapper-code`.

Created on first write with `mode 0o700` where supported.

### Per-provider env file

One file per provider: `<configdir>/<provider>.env`. Plain `KEY=value` lines,
`#` comments allowed, blank lines ignored, no quoting rules beyond trimming
whitespace. Written with mode `0o600` on POSIX; on Windows the file lives in the
user profile, which is already private, and `chmod` is skipped.

The file stores **only user choices**:

```
# wrapper-code — deepseek
ANTHROPIC_AUTH_TOKEN=sk-...
WRAPPER_CODE_PROFILE=flash-1m
```

Derived variables (`ANTHROPIC_MODEL`, etc.) are **not** stored; they are
recomputed from the catalog on every launch so a package update can fix model
names for everyone without touching their files. Any extra `KEY=value` the user
adds by hand to the file is honored and overrides the catalog (manual
fine-tuning escape hatch).

### Provider catalog

`src/providers/<id>.js`, one default-exported object per provider. Loaded by
`src/catalog.js` by reading the directory. Shape:

```js
export default {
  id: 'deepseek',
  name: 'DeepSeek',
  docs: 'https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/',
  credential: {                      // null for providers that need no key (local runtimes)
    env: 'ANTHROPIC_AUTH_TOKEN',
    label: 'API key',
    help: 'Create one at https://platform.deepseek.com/api_keys',
  },
  env: {                             // fixed vars, always injected
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    CLAUDE_CODE_EFFORT_LEVEL: 'max',
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: '786432',
  },
  profiles: {                        // user picks exactly one; its env is merged over `env`
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
  test: {                            // how setup validates the credential
    method: 'GET',
    url: 'https://api.deepseek.com/models',
    auth: 'bearer',                  // Authorization: Bearer <credential>
  },
  editableBaseUrl: false,            // true for local providers: setup shows a base URL field
};
```

Values above come from the DeepSeek Claude Code integration page as of
2026-10-02. Provider modules are data only; no provider-specific code paths
exist outside the catalog.

## 5. Browser setup

Triggered automatically when a required credential is missing, or explicitly by
`wrapper-code setup <provider>`.

### Server

- `http.createServer` bound to `127.0.0.1`, port `0` (OS picks a free port).
- A random 32-byte hex token is generated per run. Every request must carry it
  (`?t=` on the page URL, `X-Setup-Token` header on `POST`). Requests without a
  valid token get `403` with no body. This prevents other local processes or
  browser tabs from reading or writing the credential.
- Routes:
  - `GET /` serves the page with the provider data and current profile injected.
  - `POST /save` body `{ credential?: string, profile: string, baseUrl?: string }`.
    Runs the catalog `test` request with the candidate credential (or the
    stored one when `credential` is empty on re-setup). On HTTP 2xx: write the
    env file, respond `200 { ok: true }`, then shut down. On failure: respond
    `400 { ok: false, status, message }` without writing anything.
  - `POST /cancel` shuts down without writing.
- Server shuts itself down after a successful save or after 10 minutes idle.
  The wrapper prints the URL to the terminal as well, so the flow works over
  SSH or when no browser can be opened.

### Opening the browser

`src/open.js`: `open <url>` on macOS, `xdg-open <url>` on Linux,
`rundll32 url.dll,FileProtocolHandler <url>` on Windows. Spawned detached,
errors are swallowed; the terminal always prints the URL with "open this in your
browser" so a failed open is not fatal.

### Page

Single `page.html` with inline CSS and JS, no external requests, no framework.
Content:

- Provider name and link to its docs.
- Credential field (`type=password`, "show" toggle, help text from catalog).
  On re-setup: empty with placeholder "already configured, leave blank to keep".
- Base URL field, only when `editableBaseUrl` is true.
- Model profile radio group with labels; current/default profile preselected.
- Collapsed "Advanced" block listing the exact variables that will be injected
  for the selected profile (read-only, updates when the profile changes).
- **Test and save** button; inline success or error message. On success the
  page says "Done, return to the terminal".

## 6. Environment assembly

`src/env.js` builds the child env in this precedence order (later wins):

1. `process.env` of the wrapper.
2. Provider `env`.
3. Selected profile `env` (profile from the env file's `WRAPPER_CODE_PROFILE`,
   else `defaultProfile`).
4. Every `KEY=value` from the env file except `WRAPPER_CODE_PROFILE`
   (credential and manual overrides).

Then `ANTHROPIC_API_KEY` is **deleted** if present in the wrapper's own env,
so Claude Code cannot try Anthropic auth against the provider base URL.
`WRAPPER_CODE_PROFILE` is not passed to the child.

## 7. Resolving the `claude` binary

`src/launch.js` searches each `PATH` entry for `claude`. On Windows it also
tries each extension in `PATHEXT` (so `claude.cmd` and `claude.exe` are found).
The resolved absolute path is passed to `spawn` **without** `shell: true`, so
pass-through args keep their quoting. Exception: Node 18.20+ refuses to spawn a
`.cmd`/`.bat` file without a shell on Windows (CVE-2024-27980 fix), so when the
resolved path ends in `.cmd` or `.bat` the wrapper uses `shell: true` and wraps
each pass-through arg in double quotes (inner quotes escaped). If nothing is
found, exit 1 with:

```
claude not found on PATH. Install Claude Code: npm install -g @anthropic-ai/claude-code
```

## 8. Error handling summary

| Situation | Behavior |
|---|---|
| Unknown provider | List valid ids, exit 1 |
| `claude` not on PATH | Install hint, exit 1 |
| Setup cancelled or timed out | "Nothing was saved", exit 1 |
| Credential test fails | Error shown in page, no write, no launch |
| Env file unreadable / malformed line | Print path, suggest `wrapper-code setup <provider>`, exit 1 |
| Browser cannot be opened | Print URL, keep waiting |
| Child exits non-zero | Wrapper exits with same code |

## 9. Testing

Runner: `node --test` (built-in), no extra dependencies.

- **Unit**
  - env file parse and serialize (comments, blank lines, round trip, malformed line error).
  - env assembly precedence (provider < profile < file override) and removal of `ANTHROPIC_API_KEY` / `WRAPPER_CODE_PROFILE`.
  - config directory resolution by platform, injecting `platform`, `env` and `homedir` as parameters.
  - `claude` resolution with a fake `PATH` directory containing `claude` or `claude.cmd`, using an injected `platform` and `PATHEXT`.
  - catalog loading: every provider module has required fields and `defaultProfile` exists in `profiles`.
- **Integration**
  - Setup server on an ephemeral port: `GET /` without token is 403; `POST /save` with a fake local test endpoint returning 200 writes the file; returning 401 writes nothing and reports the status.
  - Launch with a fake `claude` script that prints its env as JSON and exits with a chosen code; assert the injected vars and the propagated exit code.
- No test calls the real DeepSeek API.

## 10. Project layout

```
wrapper-code/
  package.json            # name, bin, type: module, engines.node >= 18, files, test script
  bin/wrapper-code.js     # argv parsing and dispatch
  src/catalog.js          # loads src/providers/*.js
  src/providers/deepseek.js
  src/config.js           # config dir per platform, read/write env file
  src/env.js              # env assembly
  src/launch.js           # resolve claude, spawn, exit code propagation
  src/setup/server.js     # local HTTP server, token, routes, credential test
  src/setup/page.html     # the setup page
  src/open.js             # open browser per platform
  test/*.test.js
  README.md
  LICENSE
```

## 11. Out of scope for this iteration

- Additional providers (Qwen, Gemma, Llama, Mistral, Ollama). The catalog
  shape already supports `credential: null` and `editableBaseUrl: true` so they
  can be added as data files.
- Per-project env files, profile import from `~/.claude`, a separate
  `CLAUDE_CONFIG_DIR` mode, encrypted credential storage, auto-update of the
  catalog from provider docs.
