# wrapper-code

Run the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI harness with other LLM providers, without touching your Claude Code configuration.

Website: [nayamonia.github.io/wrapper-code](https://nayamonia.github.io/wrapper-code/) · Package: [npmjs.com/package/wrapper-code](https://www.npmjs.com/package/wrapper-code)

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
wrapper-code ollama                # launch Claude Code with a local Ollama model
wrapper-code ollama --model gemma3 # use another main model for this session only
wrapper-code qwencloud             # launch Claude Code with Qwen Cloud (pay-as-you-go)
wrapper-code alibaba               # launch Claude Code with the Alibaba Token Plan (Qwen, DeepSeek, GLM)
wrapper-code deepseek --resume     # anything after the provider is passed to claude
wrapper-code setup deepseek        # change the API key or model profile
wrapper-code list                  # providers and whether they are configured
```

The first time you launch a provider, a setup page opens in your browser on `127.0.0.1`. Paste your API key, pick a model profile, click **Test and save**. The key is checked against the provider's API before anything is written. Then the session starts right away.

## Providers

| Provider | Setup | Docs |
|---|---|---|
| `deepseek` | API key. Profiles: `flash-1m` (default): DeepSeek Flash with 1M context. `v4-pro`: DeepSeek V4 Pro as main model, Flash for subagents. | [DeepSeek × Claude Code](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/) |
| `ollama` | No key. The setup page lists the models installed in your local Ollama (default `http://localhost:11434`, editable for a remote server) and saves one as the default. Models without tool support are shown but cannot be selected. Runs Qwen Coder, Gemma, Llama, Mistral and any other Ollama model, offline. | [Ollama × Claude Code](https://docs.ollama.com/integrations/claude-code) |
| `qwencloud` | Qwen Cloud API key (pay-as-you-go, starts with `sk-`, created at home.qwencloud.com/api-keys; new accounts get a free quota). One profile, `pay-as-you-go`: automatic routing (`auto`) with Qwen 3.8 Max for Opus, Qwen 3.8 Flash for Sonnet and Qwen 3.6 Flash for Haiku, 983k context. | [Qwen Cloud × Claude Code](https://docs.qwencloud.com/developer-guides/clients-and-developer-tools/claude-code) |
| `alibaba` | Token Plan API key from Alibaba Cloud Model Studio (Personal or Team Edition, starts with `sk-sp-`). Profiles: `qwen-max` (default): Qwen 3.8 Max, Qwen 3.8 Flash for subagents. `qwen-plus`: Qwen 3.7 Plus for every role. `deepseek-pro`: DeepSeek V4 Pro, DeepSeek V4.1 Flash for subagents. `glm`: GLM 5.3 for every role. | [Model Studio × Claude Code](https://www.alibabacloud.com/help/en/model-studio/claude-code) |

Claude Code's system prompt and tools can exceed 32k tokens, and Ollama serves requests at its own runtime context (`OLLAMA_CONTEXT_LENGTH`, often 32k or less by default), not at the model's maximum. A request that does not fit is silently truncated and the model seems to ignore the prompt. Set Ollama's served context to at least 64k on the Ollama side, for example `OLLAMA_CONTEXT_LENGTH=65536 ollama serve`, or the context-length setting in the Ollama app.

The wrapper saves the selected model's maximum context length as `CLAUDE_CODE_AUTO_COMPACT_WINDOW` so Claude Code compacts the conversation before the window overflows. That is the model's maximum, not what your server is configured to serve.

`--model` overrides the main model for that session only; subagents and background tasks keep using the saved model.

The Qwen Cloud and Alibaba setups (`qwencloud` and `alibaba`) validate the key with a one-token request to `/v1/messages`, because those endpoints have no model-listing route. It costs one output token per setup.

The Alibaba Coding Plan was retired, so the former `qwen` provider is gone and `alibaba-token` is now `alibaba`. An old `qwen.env` or `alibaba-token.env` in the config directory is simply ignored.

More online providers (Kimi, GLM, MiniMax) are planned. A provider is a single data file in `src/providers/`; pull requests welcome.

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

## Development

```bash
npm test
```

Tests never call a real provider API.

## Author

Created by **Gabriel Fernandes** ([CD2](https://cd2.com.br)).

- Email: [gabriel@cd2.com.br](mailto:gabriel@cd2.com.br)
- GitHub: [@nayamonia](https://github.com/nayamonia)
- Web: [cd2.com.br](https://cd2.com.br)

## License

[MIT](LICENSE) © 2026 Gabriel Fernandes
