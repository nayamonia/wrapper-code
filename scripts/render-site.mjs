#!/usr/bin/env node
// Renders the landing page (docs/index.html) for GitHub Pages from the same
// sources the CLI uses: the brand module, the provider catalog and the credits.
// Run: npm run site
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PALETTE, SPRITE, wordmarkRows, renderSvg, faviconDataUri } from '../src/brand.js';
import { CREDITS } from '../src/credits.js';
import { loadCatalog } from '../src/catalog.js';

const REPO = 'https://github.com/nayamonia/wrapper-code';
const NPM = 'https://www.npmjs.com/package/wrapper-code';
const CCR = 'https://github.com/musistudio/claude-code-router';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const host = (url) => new URL(url).host;

function providerRow(p) {
  const setup = p.credential ? esc(p.credential.label) : 'No key';
  const choices = p.profiles
    ? Object.entries(p.profiles).map(([id, prof]) => `<li><code>${esc(id)}</code> ${esc(prof.label)}</li>`).join('')
    : p.credential
      ? '<li>Any model with tool calling, picked from the live catalog at setup time</li>'
      : '<li>Models discovered from your server at setup time</li>';
  return `<tr>
  <td><code>wrapper-code ${esc(p.id)}</code></td>
  <td><strong>${esc(p.name)}</strong><div class="muted">${setup}</div></td>
  <td><ul class="plain">${choices}</ul></td>
  <td><a href="${esc(p.docs)}" rel="noopener">docs</a></td>
</tr>`;
}

export function renderSite({ catalog, version }) {
  const providers = [...catalog.values()];
  const chips = providers.map((p) => `<span class="chip">${esc(p.name)}</span>`).join('');
  const rows = providers.map(providerRow).join('\n');
  const exampleId = catalog.has('deepseek') ? 'deepseek' : (providers[0]?.id ?? 'deepseek');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>wrapper-code</title>
<meta name="description" content="Run the Claude Code CLI harness with other LLM providers without touching your Claude Code configuration.">
<link rel="icon" href="${faviconDataUri()}">
<style>
  :root { --bg: ${PALETTE.bg}; --card: #15152a; --fg: ${PALETTE.white}; --muted: ${PALETTE.dim}; --line: #2b2b4a; --ink: ${PALETTE.ink}; --magenta: ${PALETTE.magenta}; --cyan: ${PALETTE.cyan}; --yellow: ${PALETTE.yellow}; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  a { color: var(--cyan); }
  code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .95em; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 0 20px; }
  nav { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 0; flex-wrap: wrap; }
  nav .wordmark svg { width: 180px; height: 18px; display: block; }
  nav .wordmark svg rect { fill: var(--fg); }
  nav .links { display: flex; gap: 18px; font: 600 12px/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .18em; text-transform: uppercase; }
  nav .links a { color: var(--muted); text-decoration: none; }
  nav .links a:hover { color: var(--cyan); }
  .hero { text-align: center; padding: 48px 0 28px; }
  .hero .sprite svg { width: 128px; height: 128px; }
  h1 { font-size: clamp(30px, 5vw, 44px); margin: 18px 0 8px; letter-spacing: -.01em; }
  .lead { color: #c9c9d6; font-size: 18px; max-width: 620px; margin: 0 auto 22px; }
  .install { display: inline-block; text-align: left; background: var(--card); border: 2px solid var(--ink); box-shadow: 4px 4px 0 var(--magenta); padding: 14px 18px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 15px; line-height: 1.7; }
  .install .p { color: var(--muted); }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin: 22px 0 0; }
  .chip { border: 1px solid var(--cyan); color: var(--cyan); padding: 3px 10px; font: 600 12px/1.6 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .08em; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 40px 0; }
  .box { background: var(--card); border: 1px solid var(--line); padding: 16px; }
  .box h3 { margin: 0 0 6px; color: var(--yellow); font-size: 15px; }
  .box p { margin: 0; color: #c9c9d6; font-size: 14px; }
  h2 { font: 700 13px/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .25em; text-transform: uppercase; color: var(--cyan); margin: 36px 0 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; vertical-align: top; padding: 10px 8px; border-top: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 600; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; border-top: 0; }
  td code { color: var(--fg); }
  .muted { color: var(--muted); font-size: 13px; }
  ul.plain { list-style: none; margin: 0; padding: 0; }
  ul.plain li { margin: 0 0 4px; }
  ul.plain code { color: var(--yellow); }
  .compare p { color: #c9c9d6; font-size: 15px; margin: 0 0 14px; }
  .compare table { margin: 18px 0; }
  .compare td:first-child { color: var(--muted); }
  .compare h3 { margin: 26px 0 10px; color: var(--yellow); font-size: 15px; }
  .compare ul { margin: 0 0 18px; padding-left: 20px; color: #c9c9d6; font-size: 15px; }
  .compare li { margin-bottom: 8px; }
  .compare li strong { color: var(--fg); }
  .compare th:nth-child(2), .compare td:nth-child(2) { border-left: 2px solid var(--magenta); }
  .how ol { padding-left: 20px; color: #c9c9d6; }
  .how li { margin-bottom: 6px; }
  footer { margin: 48px 0 32px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; text-align: center; }
  footer a { color: inherit; }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } table, thead, tbody, tr, td, th { display: block; } thead { display: none; } td { border-top: 0; padding: 4px 0; } tr { border-top: 1px solid var(--line); padding: 10px 0; } .compare td:first-child { color: var(--yellow); font-weight: 600; } .compare td:nth-child(2) { border-left: 0; } .compare td:nth-child(2)::before { content: "wrapper-code: "; color: var(--muted); } .compare td:nth-child(3)::before { content: "claude-code-router: "; color: var(--muted); } }
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <a class="wordmark" href="#top" aria-label="wrapper-code">${renderSvg(wordmarkRows('WRAPPER-CODE'))}</a>
    <div class="links"><a href="#install">Install</a><a href="#providers">Providers</a><a href="#compare">vs CCR</a><a href="${REPO}" rel="noopener">GitHub</a><a href="${NPM}" rel="noopener">npm</a></div>
  </nav>

  <section class="hero" id="top">
    <div class="sprite" aria-hidden="true">${renderSvg(SPRITE)}</div>
    <h1>Run Claude Code with any LLM</h1>
    <p class="lead">One command, your provider, zero changes to your Claude Code configuration. The provider's settings live only inside that session.</p>
    <div class="install" id="install"><span class="p">$</span> npm install -g wrapper-code<br><span class="p">$</span> wrapper-code ${esc(exampleId)}</div>
    <div class="chips">${chips}</div>
  </section>

  <section class="grid">
    <div class="box"><h3>Isolated</h3><p>Only environment variables change, and only for that process. <code>claude</code> on its own keeps using Anthropic.</p></div>
    <div class="box"><h3>Side by side</h3><p>Run several Claude Code sessions at the same time on one computer, each with a different LLM: <code>wrapper-code deepseek</code> in one terminal, <code>wrapper-code qwencloud</code> in another, plain <code>claude</code> in a third.</p></div>
    <div class="box"><h3>Setup in the browser</h3><p>The first launch opens a local page: paste the key, pick a model profile, and the key is tested before anything is saved.</p></div>
    <div class="box"><h3>Token usage</h3><p>Every session records its requests and tokens locally and prints a short summary when Claude Code exits. <code>wrapper-code usage</code> adds them up by provider, model and day. Nothing leaves your machine.</p></div>
  </section>

  <section id="providers">
    <h2>Providers</h2>
    <table>
      <thead><tr><th>Command</th><th>Provider</th><th>Profiles</th><th></th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </section>

  <section class="compare" id="compare">
    <h2>wrapper-code vs claude-code-router</h2>
    <p><a href="${CCR}" rel="noopener">claude-code-router</a> (CCR) is the best-known way to run Claude Code on other models, and for many setups it is the better tool. The two projects solve problems of different sizes. This comparison reflects CCR 3.1 and its documentation (September 2026); check its repository for the current state.</p>
    <p>CCR is a local gateway: a background service listens on <code>127.0.0.1:3456</code>, Claude Code (and Codex, Kimi CLI, OpenCode and other agents) is pointed at it, and the service decides per request which provider and model to call. That is where its features come from: routing rules, request rewrites, retries and ordered fallbacks, credential pools with key rotation, custom router scripts, translation to OpenAI- and Gemini-style APIs, vision or web search added to models that lack them, request logs with cost estimates, a management UI, a desktop app and Docker images.</p>
    <p>wrapper-code is not a gateway. It builds an environment with the provider's <code>ANTHROPIC_BASE_URL</code>, key and model variables and starts <code>claude</code> with it. No process sits between Claude Code and the provider, so the provider has to speak the Anthropic Messages API itself. There is no routing, no fallback, no retry and no mixing of providers inside one session.</p>
    <table>
      <thead><tr><th></th><th>wrapper-code</th><th>claude-code-router</th></tr></thead>
      <tbody>
        <tr><td>What it is</td><td>A launcher: sets environment variables for one <code>claude</code> process</td><td>A local gateway and management UI between agents and providers</td></tr>
        <tr><td>In the request path</td><td>Nothing; Claude Code calls the provider directly</td><td>CCR's gateway on <code>127.0.0.1:3456</code></td></tr>
        <tr><td>Your prompts and the model's answers</td><td>Travel only between Claude Code and the provider; wrapper-code never sees them</td><td>Pass through the gateway; its request logs can keep request and response bodies</td></tr>
        <tr><td>Must be running</td><td>Nothing; when <code>claude</code> exits, nothing is left</td><td>The CCR service or desktop app, or Claude Code launched from it cannot reach a model</td></tr>
        <tr><td>Providers</td><td>${providers.length} built in, all through their Anthropic-compatible endpoint</td><td>Many presets, plus any OpenAI-, Anthropic- or Gemini-compatible endpoint, translated by the gateway</td></tr>
        <tr><td>Routing, fallbacks, retries, key rotation</td><td>No</td><td>Yes: rules, rewrites, ordered fallbacks, credential pools, custom scripts</td></tr>
        <tr><td>Several providers in one session</td><td>No; one provider per session, different models per role</td><td>Yes</td></tr>
        <tr><td>Vision, web search or MCP tools added to a model</td><td>No</td><td>Yes (Fusion, ToolHub)</td></tr>
        <tr><td>Other agents (Codex, Kimi CLI, OpenCode...)</td><td>No, Claude Code only</td><td>Yes</td></tr>
        <tr><td>Effect on plain <code>claude</code></td><td>None, and there is no mode that could change it; <code>~/.claude</code> is untouched</td><td>None with the "only opened from CCR" scope; the "system default" scope changes the Claude Code you open directly</td></tr>
        <tr><td>Open ports</td><td>One loopback listener, random token, only while a session runs</td><td>Gateway on <code>3456</code> and management UI on <code>3458</code> while the service runs</td></tr>
        <tr><td>Configuration</td><td>One <code>KEY=value</code> file per provider, readable and editable by hand</td><td>SQLite database, edited through the UI</td></tr>
        <tr><td>Usage</td><td>Requests and tokens per session, provider and model, local, no prices</td><td>Request logs with latency, tokens and cost estimates</td></tr>
        <tr><td>Install</td><td>One npm package, no dependencies, about 100 kB; Node.js 18+ and Claude Code</td><td>npm CLI on Node.js 22+, or the desktop app or Docker</td></tr>
        <tr><td>License</td><td>MIT</td><td>MIT</td></tr>
      </tbody>
    </table>
    <h3>Where wrapper-code is the better fit</h3>
    <ul>
      <li><strong>Nothing between Claude Code and the model.</strong> Requests go straight to the provider's endpoint. There is no local process to parse, rewrite and re-stream every request and response, and none that can be down. CCR's documentation lists its running service as a prerequisite for a Claude Code launched from it.</li>
      <li><strong>Your prompts stay between Claude Code and the provider.</strong> wrapper-code never sees them; the only thing it receives is Claude Code's own token counts, over a loopback port with a random per-session token. CCR's gateway sees every request, and its request logs store request and response bodies (configurable: all, errors only or none; kept for the current day).</li>
      <li><strong>Nothing runs when you are not working.</strong> No daemon, no desktop app, no database, no port left open. When <code>claude</code> exits, wrapper-code prints the usage block and exits too.</li>
      <li><strong>Small.</strong> One npm package with no runtime dependencies: 25 files, about 100 kB unpacked, Node.js 18+. Updating or removing it touches nothing else on the machine.</li>
      <li><strong>Plain <code>claude</code> cannot be hijacked.</strong> wrapper-code has no "system default" mode, so there is no setting that could make your normal Claude Code talk to another backend. CCR's own guide recommends starting with the "only opened from CCR" scope for the same reason.</li>
      <li><strong>The provider's integration, unchanged.</strong> Each provider definition follows the provider's published Claude Code setup (linked in the table above), and what reaches Claude Code is what the provider's endpoint sends: streaming, tool calls, caching and thinking as the provider implements them, with no translation layer in between.</li>
      <li><strong>Readable and reproducible.</strong> The whole configuration is one environment file you can <code>cat</code>. Export the same variables by hand and you get the same session, with or without wrapper-code.</li>
    </ul>
    <p>Choose CCR if you want to route per request, need fallbacks across providers or keys, want a provider that only speaks the OpenAI or Gemini API, or run other agents through the same gateway. Choose wrapper-code if you want one command that starts Claude Code on one provider, with no service to keep running and nothing changed for your normal Claude Code, and the provider's own Anthropic-compatible endpoint is enough.</p>
    <p class="muted">Both can be installed at once. If a CCR profile is set as "system default", check that it did not add <code>ANTHROPIC_BASE_URL</code> to the <code>env</code> block of <code>~/.claude/settings.json</code>: settings there win over the variables wrapper-code sets.</p>
  </section>

  <section class="how">
    <h2>How it works</h2>
    <ol>
      <li>Reads the provider definition: base URL, model variables, how to test a key.</li>
      <li>Reads your saved choices; runs the setup page if the key is missing.</li>
      <li>Builds an environment from your shell, the provider and your profile. <code>ANTHROPIC_API_KEY</code> is removed so Claude Code cannot fall back to Anthropic.</li>
      <li>Finds <code>claude</code> on your PATH and runs it with that environment, forwarding your arguments and its exit code.</li>
    </ol>
    <p class="muted">Requires Node.js 18+ and Claude Code. Works on macOS, Linux and Windows. Version v${esc(version)}.</p>
  </section>

  <footer>
    ${esc(CREDITS.license)} License · Created by ${esc(CREDITS.name)} · <a href="mailto:${esc(CREDITS.email)}">${esc(CREDITS.email)}</a> · <a href="${esc(CREDITS.github)}" rel="noopener">GitHub</a> · <a href="${esc(CREDITS.site)}" rel="noopener">${esc(host(CREDITS.site))}</a>
  </footer>
</div>
</body>
</html>
`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = createRequire(import.meta.url)('../package.json');
  const catalog = await loadCatalog();
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'index.html'), renderSite({ catalog, version: pkg.version }));
  writeFileSync(path.join(root, 'docs', '.nojekyll'), '');
  process.stdout.write('wrote docs/index.html and docs/.nojekyll\n');
}
