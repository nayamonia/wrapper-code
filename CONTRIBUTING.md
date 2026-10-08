# Contributing to wrapper-code

Thanks for helping. Most contributions are a new provider, a fix to a provider's values, or documentation. This guide covers all three.

## Ground rules

- **No runtime dependencies.** wrapper-code is plain Node.js 18+ (ESM). If you need a package, open an issue first.
- **Only environment variables.** wrapper-code sets the environment of one `claude` process and gets out of the way. No proxy, no protocol translation, nothing written under `~/.claude`. A provider must serve the Anthropic Messages API (`/v1/messages`) natively; one that only speaks the OpenAI API is reachable through `openrouter`, not as a direct provider.
- **Tests never call a real provider API.** Network calls go through an injected `fetchImpl`; see `test/setup-server.test.js`.
- **Never commit a key**, not in a test, a fixture or a comment.

## Development

```bash
git clone https://github.com/nayamonia/wrapper-code.git
cd wrapper-code
npm test            # node --test, no install step needed
npm run site        # regenerates docs/index.html from the catalog
node bin/wrapper-code.js list
```

To try your branch as the real command: `npm link`, then `wrapper-code <provider>`. Your config files live in `~/.config/wrapper-code/` (or `%APPDATA%\wrapper-code\`), so a local test uses your real keys; they stay on your machine.

## Adding a provider

A provider is one data file in `src/providers/<id>.js` that exports a plain object. `src/catalog.js` loads every file in that folder and validates it with `validateProvider`; that function is the authoritative reference for the fields below.

### One provider or one profile?

Decide this first:

> **Same key and same endpoint → profiles of one provider. Different key or different endpoint → separate providers.**

One provider has one config file, so one saved key, one base URL and one key check. A subscription plan and the pay-as-you-go side of the same vendor usually differ in key, endpoint or both, so they are two providers in the same family: see `kimi` / `kimi-code` and `qwencloud` / `qwencloud-token`. Profiles are for choosing models within one contract (`deepseek` has `flash-1m` and `v4-pro`).

### Start from an existing file

Copy the closest one:

| You are adding | Copy |
|---|---|
| A hosted API with a fixed set of models | `src/providers/kimi.js` |
| A hosted API with no model-listing route | `src/providers/qwencloud.js` (key checked with a one-token request) |
| A local server whose models are discovered at setup | `src/providers/ollama.js` |
| A gateway with a large live catalog | `src/providers/openrouter.js` |

Start the file with a comment that says where every value comes from and when you checked it, for example:

```js
// Values from https://example.com/docs/claude-code (2026-10-08).
// The Anthropic-compatible base has no model listing, so the key is checked for
// free against the OpenAI-style models route, which accepts the same key.
```

### Fields

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Lowercase letters, digits and dashes. It is the command (`wrapper-code <id>`) and the config file name (`<id>.env`), so **renaming it later breaks users**; see Aliases. |
| `name` | yes | Shown by `wrapper-code list`, the setup page and the site. Use the vendor's product name: `Kimi (Moonshot API)`, `Z.ai GLM Coding Plan`. |
| `family` | yes | Groups providers in `list`, lowercase. Use the model family or vendor (`kimi`, `qwen`, `glm`); `local` for servers on your machine, `gateway` for multi-vendor routers. |
| `billing` | yes | `plan` (subscription with a quota), `payg` (pay per token) or `local`. |
| `docs` | yes | The provider's own Claude Code guide. Linked from the setup page and the site. |
| `credential` | yes | `{ env, label, help }`, or `null` when no key is needed. `env` is almost always `ANTHROPIC_AUTH_TOKEN`. `help` tells the user where to create the key and, if the vendor has a sibling provider, which key goes where. |
| `env` | yes | Variables set for every profile, at least `ANTHROPIC_BASE_URL`. Settings such as `API_TIMEOUT_MS` or `CLAUDE_CODE_EFFORT_LEVEL` go here when the provider's guide sets them. |
| `profiles` + `defaultProfile` | one of these | `{ <profileId>: { label, env } }`. The profile's `env` is merged over the provider's. `defaultProfile` must be a key of `profiles`. |
| `models` | one of these | Discovery at setup time instead of fixed profiles: `{ discoverPath, envKeys, requireCapability, format, note, emptyHint }`. `format` is `ollama` or `openrouter`; a new listing format needs code in `src/setup/models.js`. The chosen model is written to every key in `envKeys`. |
| `test` | yes | How the setup page checks the key: `{ method, url \| path, auth, headers?, body? }`. `url` is absolute; `path` is joined to the base URL. `auth: 'bearer'` sends `Authorization: Bearer <key>`; `'none'` sends nothing. Any 2xx counts as valid. |
| `editableBaseUrl` | no | `true` lets the user change the base URL on the setup page (local servers). |
| `aliases` | no | Old ids that still work. See below. |

`passthrough: true` is reserved for the `claude` provider, which runs the user's own Claude Code unchanged.

### Model variables

A profile normally sets every model role Claude Code uses:

```js
ANTHROPIC_MODEL                // main model
ANTHROPIC_DEFAULT_OPUS_MODEL
ANTHROPIC_DEFAULT_SONNET_MODEL
ANTHROPIC_DEFAULT_HAIKU_MODEL  // background work: a cheaper model saves tokens
ANTHROPIC_DEFAULT_FABLE_MODEL
CLAUDE_CODE_SUBAGENT_MODEL     // subagents
CLAUDE_CODE_AUTO_COMPACT_WINDOW // the model's context size, so Claude Code compacts in time
```

A small helper keeps profiles readable; see `roles()` in `src/providers/zai-coding.js`. Use the model ids exactly as the provider's guide writes them, including Claude Code's `[1m]` 1M-context suffix when the guide uses it.

### The key check

Prefer a check that costs nothing: a models route that answers 401 to a wrong key. Watch out for routes that answer 200 without any key; `zai-coding` hit one and checks another route instead (see the comment in that file). Only when no free route exists, send a one-token `POST /v1/messages` with the cheapest model, as `qwencloud` does, and say in the README that setup costs one output token.

### Aliases (renaming a provider)

If a provider must be renamed, put the old id in `aliases`. `wrapper-code <old-id>` keeps working, the old `<old-id>.env` is renamed to the new name on first use, and its usage history is reported under the new id. An alias may not be another provider's id or belong to two providers; `loadCatalog` rejects both.

### Checklist for a provider pull request

- [ ] `src/providers/<id>.js`, with the source comment and date at the top.
- [ ] Tests in `test/catalog.test.js`: add the id to the list of catalog ids, add `<family>/<billing>` to the "family and billing per provider" test, and add a test that pins the documented values (base URL, profiles, key check), like the one for `deepseek`.
- [ ] A row in the README's Providers table, and any caveat (context limits, how the provider counts cached tokens, a one-token setup check).
- [ ] `npm run site` and commit the regenerated `docs/index.html`; `test/site.test.js` fails if it is stale.
- [ ] `npm test` passes.
- [ ] In the pull request description, say how you verified it: which account type, which profiles you ran in a real Claude Code session, and whether tool calls, subagents and long sessions worked. Do not paste keys or full request logs.

## Fixing a provider's values

Providers change model ids, endpoints and plans often. A fix is welcome even without a new feature: update the values, update the date in the source comment, and adjust the pinned test. Link the provider page that shows the change.

## Documentation and translations

- The English `README.md` is the source of truth. Translations live next to it (`README.pt-BR.md`, `README.es.md`), start with a note that they may lag behind, and keep commands, variable names, paths and provider ids untranslated.
- The site (`docs/index.html`) is generated: change `scripts/render-site.mjs`, never the HTML by hand.

## Commits and pull requests

- One topic per pull request. Small is easier to review.
- Commit messages follow the existing history: `feat: ...`, `fix: ...`, `docs: ...`, in the imperative mood, about what changes for the user. For example: `feat: Kimi provider via the Moonshot API with K3 and K2.7 Code profiles`.
- Reference the issue you are closing (`Closes #19`).

## Issues

Issues labeled [good first issue](https://github.com/nayamonia/wrapper-code/labels/good%20first%20issue) are a good start. Comment on an issue before you begin so two people do not work on the same thing. For bigger changes (a new command, anything touching `src/env.js` or `src/launch.js`), open an issue with a proposal first.

When you report a bug, include `wrapper-code --version`, `claude --version`, your OS, the provider and profile, and what you expected. Never include your key or the contents of your `.env` file.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
