English · Português · [Español](README.es.md)
# wrapper-code

Run the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI harness with other LLM providers, or with several Claude accounts at once, without touching your Claude Code configuration.

Website: [nayamonia.github.io/wrapper-code](https://nayamonia.github.io/wrapper-code/) · Package: [npmjs.com/package/wrapper-code](https://www.npmjs.com/package/wrapper-code)

`wrapper-code deepseek` opens a normal interactive Claude Code session that talks to DeepSeek. Running `claude` directly still uses Anthropic, exactly as before. Nothing is written under `~/.claude`, and no variable leaks into your shell: the provider settings exist only inside that one session.

Every session records its token usage on your machine, and `wrapper-code usage` adds it up by provider and model. `wrapper-code claude` starts your own Claude Code unchanged, so your Anthropic usage is counted in the same report.

It also manages several Claude accounts at the same time, such as a personal Max plan and a company Team on the same e-mail. `wrapper-code claude --account work` opens a session logged in to one of them, with your usual settings, plugins and MCP servers, while plain `claude` stays on its own login. Sessions of different accounts run side by side in separate terminals. `wrapper-code claude --temp` logs in for one session only and removes the login on exit. See [Claude accounts](#claude-accounts) (macOS and Linux).

![The same prompt in two terminals: wrapper-code claude on the left, wrapper-code deepseek on the right; then wrapper-code usage lists the requests and tokens of both](https://nayamonia.github.io/wrapper-code/demo.gif)

*The same prompt in two terminals: `wrapper-code claude` on the left, `wrapper-code deepseek` on the right. When both finish, `wrapper-code usage` shows the requests and tokens of each one.*

## Install

Requires Node.js 18+ and Claude Code (`npm install -g @anthropic-ai/claude-code`).

```bash
npm install -g wrapper-code
```

Works on macOS, Linux and Windows.

## Usage

```bash
wrapper-code deepseek              # launch Claude Code with DeepSeek
wrapper-code ollama                # launch Claude Code with a local Ollama model
wrapper-code ollama --model gemma3 # use another main model for this session only
wrapper-code qwencloud             # launch Claude Code with Qwen Cloud (pay-as-you-go)
wrapper-code qwencloud-token       # launch Claude Code with the Qwen Cloud Token Plan (Qwen, DeepSeek, GLM)
wrapper-code openrouter            # launch Claude Code with any OpenRouter model (OpenAI, Google, Meta, Mistral, xAI...)
wrapper-code kimi                  # launch Claude Code with Kimi through the Moonshot API (pay per token)
wrapper-code kimi-code             # launch Claude Code with your Kimi Code subscription
wrapper-code zai-coding            # launch Claude Code with your Z.ai GLM Coding Plan
wrapper-code deepseek --resume     # anything after the provider is passed to claude
wrapper-code claude                # your own Claude Code, unchanged, with its token usage recorded
wrapper-code accounts add work     # log in another Claude account, kept apart from your usual login
wrapper-code claude --account work # your Claude Code with that account
wrapper-code claude --temp         # log in for this session only; logged out and deleted on exit
wrapper-code accounts              # saved accounts with their e-mail and last use
wrapper-code setup deepseek        # change the API key or model profile
wrapper-code list                  # providers by family: billing, status and the selected profile or model
```

`wrapper-code list` groups providers of the same family and shows how each one bills (`plan`, `payg` or `local`):

```
FAMILY     PROVIDER         BILLING  STATUS          SELECTION
anthropic  claude           plan     configured      -
deepseek   deepseek         payg     configured      flash-1m
gateway    openrouter       payg     not configured  -
glm        zai-coding       plan     not configured  -
kimi       kimi-code        plan     configured      k3-1m
kimi       kimi             payg     not configured  -
local      ollama           local    configured      qwen3-coder
qwen       qwencloud-token  plan     configured      auto
qwen       qwencloud        payg     not configured  -
```

The first time you launch a provider, a setup page opens in your browser on `127.0.0.1`. Paste your API key, pick a model profile, click **Test and save**. The key is checked against the provider's API before anything is written. Then the session starts right away.

## Providers

| Provider | Setup | Docs |
|---|---|---|
| `deepseek` | API key. Profiles: `flash-1m` (default): DeepSeek Flash with 1M context. `v4-pro`: DeepSeek V4 Pro as main model, Flash for subagents. | [DeepSeek × Claude Code](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/) |
| `ollama` | No key. The setup page lists the models installed in your local Ollama (default `http://localhost:11434`, editable for a remote server) and saves one as the default. Models without tool support are shown but cannot be selected. Runs Qwen Coder, Gemma, Llama, Mistral and any other Ollama model, offline. | [Ollama × Claude Code](https://docs.ollama.com/integrations/claude-code) |
| `qwencloud` | Qwen Cloud API key (pay-as-you-go, starts with `sk-`, created at home.qwencloud.com/api-keys; new accounts get a free quota). One profile, `pay-as-you-go`: Qwen 3.8 Max as main model, Qwen 3.8 Flash for Sonnet and subagents, Qwen 3.6 Flash for Haiku, 983k context. | [Qwen Cloud × Claude Code](https://docs.qwencloud.com/developer-guides/clients-and-developer-tools/claude-code) |
| `qwencloud-token` | Token Plan API key (Personal or Team Edition, starts with `sk-sp-`) from the Qwen Cloud or Alibaba Model Studio console. Profiles: `auto` (default): automatic routing, as in the Qwen Cloud docs. `qwen-max`: Qwen 3.8 Max, Qwen 3.8 Flash for subagents. `qwen-plus`: Qwen 3.7 Plus for every role. `deepseek-pro`: DeepSeek V4 Pro, DeepSeek V4.1 Flash for subagents. `glm`: GLM 5.3 for every role. | [Qwen Cloud × Claude Code](https://docs.qwencloud.com/developer-guides/clients-and-developer-tools/claude-code) |
| `openrouter` | OpenRouter API key (openrouter.ai/keys), checked for free. The setup page lists every model OpenRouter serves, with a search box; models without tool calling are shown but cannot be selected. The chosen model is used for every role, subagents included. Billing through your OpenRouter credits. | [OpenRouter × Claude Code](https://openrouter.ai/docs/guides/guides/claude-code-integration) |
| `kimi` | Moonshot API key from platform.kimi.ai, pay per token, checked for free against the models route. Profiles: `k3-1m` (default): Kimi K3 with 1M context, K2.7 Code for the Haiku tier. `k2.7-code`: Kimi K2.7 Code for every role, 256k context; turn thinking on in Claude Code (Alt+T / Option+T). | [Kimi × Claude Code](https://platform.kimi.ai/docs/guide/claude-code-kimi) |
| `kimi-code` | Kimi Code API key (Kimi membership with Kimi Code, created in the Kimi Code Console), checked for free against the models route. Profiles: `k3-1m` (default): Kimi K3 with 1M context for every role. `k3-256k`: Kimi K3 with 256k context. | [Kimi Code × Claude Code](https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html) |
| `zai-coding` | Z.ai API key (GLM Coding Plan subscription, created under API Keys at z.ai), checked for free against the models route. With the plan active, every call counts against the plan quota, never the account balance or usage bundles. Profiles: `glm-5.3` (default): GLM 5.3, GLM 5.3 Flash for the Haiku tier. `glm-5.3-1m`: the same with 1M context. `flash`: GLM 5.3 Flash for every role, to save quota. | [Z.ai × Claude Code](https://docs.z.ai/devpack/tool/claude) |
| `claude` | Nothing to set up. Runs your own Claude Code exactly as plain `claude` does (your login, your models, your settings; no variable is added or removed) with the usage receiver on, so your Anthropic usage shows up in `wrapper-code usage` next to the other providers. | [Claude Code monitoring](https://code.claude.com/docs/en/monitoring-usage) |

Claude Code's system prompt and tools can exceed 32k tokens, and Ollama serves requests at its own runtime context (`OLLAMA_CONTEXT_LENGTH`, often 32k or less by default), not at the model's maximum. A request that does not fit is silently truncated and the model seems to ignore the prompt. Set Ollama's served context to at least 64k on the Ollama side, for example `OLLAMA_CONTEXT_LENGTH=65536 ollama serve`, or the context-length setting in the Ollama app.

The wrapper saves the selected model's maximum context length as `CLAUDE_CODE_AUTO_COMPACT_WINDOW` so Claude Code compacts the conversation before the window overflows. That is the model's maximum, not what your server is configured to serve.

`--model` overrides the main model for that session only; subagents and background tasks keep using the saved model.

The Qwen Cloud setups (`qwencloud` and `qwencloud-token`) validate the key with a one-token request to `/v1/messages`, because those endpoints have no model-listing route. It costs one output token per setup.

Alibaba Model Studio and Qwen Cloud are one backend: a Token Plan key from either console works with `qwencloud-token`. The former `alibaba` provider is now an alias of `qwencloud-token`: `wrapper-code alibaba` still works, and `alibaba.env` is renamed to `qwencloud-token.env` the first time you use either name. Its usage history shows up under `qwencloud-token`. The Alibaba Coding Plan was retired, so the former `qwen` provider is gone, and an old `qwen.env` or `alibaba-token.env` in the config directory is simply ignored.

With OpenRouter you can pick OpenAI, Google, Meta, Mistral, xAI and other models through one key. To use a cheaper model for subagents and background work, edit `ANTHROPIC_DEFAULT_HAIKU_MODEL` and `CLAUDE_CODE_SUBAGENT_MODEL` in `~/.config/wrapper-code/openrouter.env`; the wrapper keeps hand-written keys. OpenRouter itself warns that Claude Code is tuned for Anthropic models, so other models may behave worse in long agentic sessions.

MiniMax is reachable through OpenRouter today; a dedicated provider is planned. Z.ai pay-as-you-go is not offered: on an account with a GLM Coding Plan, Claude Code calls always count against the plan. A provider is a single data file in `src/providers/`; pull requests welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains the fields and the checklist.

## Claude accounts

Several Claude logins (Pro, Max, Team or Enterprise) can live side by side, without touching the login of plain `claude`. macOS and Linux only.

- `wrapper-code accounts add <name>` creates an account and runs `claude auth login` for it.
- `wrapper-code claude --account <name> [claude args...]` starts your Claude Code with that account.
- `wrapper-code claude --temp [claude args...]` logs in for one session. When it ends, the login is logged out and its folder deleted. If the logout fails, the folder is kept and its path printed; the next `--temp` or `accounts` tries again.
- `wrapper-code accounts` lists the accounts with their e-mail, organization and last use, and `wrapper-code accounts remove <name> [--yes]` logs one out and deletes it (`--yes` skips the question, and is required without a terminal).
- One e-mail can belong to several organizations, a personal plan and a Team for example. Add one account per organization (`accounts add pessoal`, `accounts add time`) and pick the organization in the login page's selector; the `ORG` column tells them apart.

**How the accounts are kept:**
- Each account is its own `CLAUDE_CONFIG_DIR` under `~/.config/wrapper-code/accounts/`. Claude Code keeps its login there, and on macOS in a Keychain entry of its own.
- **Shared with your usual Claude Code, by symlink:** everything in `~/.claude`, which covers settings, CLAUDE.md and the files it imports, plugins, skills, agents, commands and hooks. Your user MCP servers are copied from `~/.claude.json` before each session, and so is your completed onboarding, so a new account opens straight on the prompt. Folder trust is still asked once per account.
- **Kept per account:** the login, the session history and Claude Code's runtime state.

**Variables that would override the account:** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and the Bedrock, Vertex and Foundry switches are removed from these sessions, and wrapper-code says which ones it removed.

Console sign-ins made without an API key are stored outside the config folder, in `~/.config/anthropic`, and are shared by every account, so they are not supported here.

## Where things are stored

One file per provider, containing only your choices: the key and profile for DeepSeek; for Ollama the model, the context snapshot, and the base URL only if it differs from the default `http://localhost:11434`:

- macOS / Linux: `~/.config/wrapper-code/<provider>.env` (or `$XDG_CONFIG_HOME/wrapper-code/`), mode `600`
- Windows: `%APPDATA%\wrapper-code\<provider>.env`

Model names and the other variables come from the built-in catalog on every launch, so updating `wrapper-code` picks up provider changes without touching your file. Any extra `KEY=value` you add to the file by hand is passed through and overrides the catalog.

## How it works

1. Reads the provider definition (base URL, model variables, how to test a key).
2. Reads your `<provider>.env`; runs the setup page if the key or model is missing.
3. Builds an environment: your shell env + provider vars + profile vars (for Ollama, your saved model in the model variables) + your file. `ANTHROPIC_API_KEY` is removed so Claude Code cannot fall back to Anthropic auth.
4. Finds `claude` on your `PATH` and runs it with that environment, forwarding your arguments and its exit code.

Your global `~/.claude` (CLAUDE.md, skills, plugins, MCP servers, history) is shared with the provider session, since only environment variables change.

## Notes

- `~/.claude` is shared, so `env` entries in `~/.claude/settings.json` (and any `apiKeyHelper`) still apply inside the provider session and can override the provider variables. If a session talks to the wrong backend, check there first.
- Ctrl+C is passed through to `claude`; the wrapper itself keeps running until `claude` exits.
- If a provider file is broken (for example a pasted bare key), `wrapper-code setup <provider>` replaces it with a fresh one.
- Before `claude` starts, wrapper-code shows a sub-second 8-bit splash. It only appears on a color terminal at least 72 columns wide. Set `WRAPPER_CODE_NO_SPLASH=1` (or the standard `NO_COLOR`) to skip it.

## Token usage

Every session records its token usage locally. When Claude Code exits, wrapper-code prints a short block with the number of requests, the tokens (input, output, cache read, cache write) and how long the session ran. There is no cost estimate: prices change often and differ by plan, so check your provider's dashboard for what you actually paid.

```bash
wrapper-code usage                 # last 30 days by provider and model
wrapper-code usage --since 7d --provider deepseek --by-day
wrapper-code usage --since all --json
wrapper-code usage clear           # delete everything recorded (asks first)
wrapper-code usage clear --provider deepseek --yes
```

`usage clear` deletes the recorded usage: all of it, or only one provider's with `--provider`. It shows what will be removed and asks before deleting; `--yes` skips the question, and without a terminal it refuses unless `--yes` is given. There is no undo.

To count your regular Claude Code usage too, start it with `wrapper-code claude` instead of `claude`. Nothing about the session changes; it is only recorded.

Providers do not all count input the same way. Most follow Anthropic's convention, where input excludes the tokens read from cache. Kimi Code (`kimi-code`) appears to include them: a session that reads 37.8k tokens from cache reports about 37k input as well, where the Moonshot API (`kimi`) reports a few hundred. The Z.ai GLM Coding Plan (`zai-coding`) looks the same: a one-line session reports 17.2k input with 16.5k read from cache. wrapper-code shows the numbers as each provider reports them, so for `kimi-code` and `zai-coding` the input column overstates the new tokens; the cache read column is the reliable one.

How it works: the wrapper starts a tiny OpenTelemetry receiver on `127.0.0.1` for the session and points Claude Code's own telemetry export at it. The token counts are the ones Claude Code reports for each API request. Nothing leaves your machine; the data lives in `~/.config/wrapper-code/usage.jsonl` (model, tokens and duration per request; no prompts or responses). Set `WRAPPER_CODE_NO_USAGE=1` to turn it off. If your shell already defines `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` or `CLAUDE_CODE_ENABLE_TELEMETRY`, wrapper-code keeps your settings and records nothing for that session. While it records, any `OTEL_EXPORTER_OTLP_LOGS_*` variable in the session's environment is dropped so it cannot redirect the export. OTEL variables set in Claude Code's own settings file (the `env` block of `~/.claude/settings.json`) are not detected; if you export telemetry from there, set `WRAPPER_CODE_NO_USAGE=1`.

## Development

```bash
npm test
```

Tests never call a real provider API. See [CONTRIBUTING.md](CONTRIBUTING.md) for adding a provider and the pull request checklist.

## wrapper-code vs claude-code-router

[claude-code-router](https://github.com/musistudio/claude-code-router) (CCR) is a local gateway that routes, rewrites and retries every request, for Claude Code and other agents. wrapper-code only sets up the environment of one session and gets out of the way: nothing between Claude Code and the provider, nothing running when you are not working, plain `claude` untouched. If you need routing, fallbacks or other agents, use CCR.

<details>
<summary><b>Read the full comparison</b></summary>

[claude-code-router](https://github.com/musistudio/claude-code-router) (CCR) is the best-known way to run Claude Code on other models. It is a local gateway: a background service on `127.0.0.1:3456` receives every request from Claude Code (and from Codex, Kimi CLI, OpenCode and other agents), decides per request which provider and model to call, and can rewrite, retry, fall back to another model or key, translate to OpenAI- and Gemini-style APIs, and add vision, web search or MCP tools to a model that lacks them. It has a management UI, request logs with cost estimates, a desktop app and Docker images. If you need any of that, use CCR.

wrapper-code wants to solve a smaller problem: start one Claude Code session on one other provider, with nothing changed for your normal Claude Code and nothing extra running. It sets the provider's `ANTHROPIC_BASE_URL`, key and model variables in the environment of one `claude` process and gets out of the way. That is the whole design, and it is where its advantages come from:

- **Nothing between Claude Code and the model.** Requests go straight to the provider's endpoint. There is no local process to parse, rewrite and re-stream every request and response, and none that can be down. CCR's documentation lists its running service as a prerequisite for a Claude Code launched from it.
- **Your prompts stay between Claude Code and the provider.** wrapper-code never sees them; the only thing it receives is Claude Code's own token counts, over a loopback port with a random per-session token. CCR's gateway sees every request, and its request logs store request and response bodies (configurable: all, errors only or none; kept for the current day).
- **Nothing runs when you are not working.** No daemon, no desktop app, no database, no port left open. When `claude` exits, wrapper-code prints the usage block and exits too.
- **Plain `claude` cannot be hijacked.** Nothing is written under `~/.claude`, and there is no "system default" mode, so no setting could make your normal Claude Code talk to another backend. CCR has such a scope; its own guide recommends starting with "only opened from CCR" for the same reason.
- **Side by side.** Each session carries its own environment, so `wrapper-code deepseek`, `wrapper-code ollama` and plain `claude` can run at the same time in three terminals.
- **The provider's integration, unchanged.** Each provider definition follows the provider's published Claude Code setup (linked in the Providers table), and what reaches Claude Code is what the provider's endpoint sends: streaming, tool calls, caching and thinking as the provider implements them, with no translation layer in between.
- **Small and readable.** One npm package with no runtime dependencies (27 files, about 100 kB, Node.js 18+). The whole configuration is one environment file per provider that you can `cat`; export the same variables by hand and you get the same session, with or without wrapper-code.

What wrapper-code does not do, by design: per-request routing, fallbacks, retries, key rotation, several providers in one session, protocol translation (the provider must speak the Anthropic Messages API), other agents than Claude Code. This reflects CCR 3.1 and its documentation (September 2026); check its repository for the current state.

Both can be installed at once. wrapper-code does not know about CCR; if a CCR profile is set as "system default", check that it did not add `ANTHROPIC_BASE_URL` to the `env` block of `~/.claude/settings.json`, because settings there win over the variables wrapper-code sets (see Notes).

</details>

## Author

Created by **Gabriel Fernandes** ([CD2](https://cd2.com.br)).

- Email: [gabriel@cd2.com.br](mailto:gabriel@cd2.com.br)
- GitHub: [@nayamonia](https://github.com/nayamonia)
- Web: [cd2.com.br](https://cd2.com.br)

## License

[MIT](LICENSE) © 2026 Gabriel Fernandes
