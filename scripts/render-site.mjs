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
  const setup = p.passthrough ? 'Your own Claude Code login' : p.credential ? esc(p.credential.label) : 'No key';
  const choices = p.passthrough
    ? '<li>Your normal models and settings; only token usage is recorded</li>'
    : p.profiles
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
<meta name="description" content="Run the Claude Code CLI harness with other LLM providers, or with several Claude accounts at once, without touching your Claude Code configuration.">
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
  .demo { margin: 36px 0 0; text-align: center; }
  .demo img { display: block; width: 100%; height: auto; border: 2px solid var(--ink); box-shadow: 4px 4px 0 var(--cyan); }
  .demo p { color: var(--muted); font-size: 14px; margin: 14px auto 0; max-width: 720px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 40px 0; }
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
  .compare ul { margin: 0 0 18px; padding-left: 20px; color: #c9c9d6; font-size: 15px; }
  .compare li { margin-bottom: 8px; }
  .compare li strong { color: var(--fg); }
  .compare .summary { color: var(--fg); }
  .compare details { margin: 0 0 8px; }
  .compare summary { cursor: pointer; list-style: none; display: inline-block; font: 600 12px/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .18em; text-transform: uppercase; color: var(--cyan); padding: 8px 0 18px; }
  .compare summary::-webkit-details-marker { display: none; }
  .compare summary::before { content: "▸  "; }
  .compare details[open] summary::before { content: "▾  "; }
  .how ol { padding-left: 20px; color: #c9c9d6; }
  .how li { margin-bottom: 6px; }
  footer { margin: 48px 0 32px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; text-align: center; }
  footer a { color: inherit; }
  @media (max-width: 960px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } table, thead, tbody, tr, td, th { display: block; } thead { display: none; } td { border-top: 0; padding: 4px 0; } tr { border-top: 1px solid var(--line); padding: 10px 0; } }
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
    <p class="lead">One command, your provider, zero changes to your Claude Code configuration. The provider's settings live only inside that session. Several Claude accounts, personal and Team, work side by side the same way.</p>
    <div class="install" id="install"><span class="p">$</span> npm install -g wrapper-code<br><span class="p">$</span> wrapper-code ${esc(exampleId)}</div>
    <div class="chips">${chips}</div>
  </section>

  <section class="demo" id="demo">
    <img src="demo.gif" width="1600" height="900" alt="Two terminals side by side run the same prompt: wrapper-code claude on the left, wrapper-code deepseek on the right. Then wrapper-code usage lists the requests and tokens of both." loading="lazy">
    <p>The same prompt in two terminals: <code>wrapper-code claude</code> on the left, <code>wrapper-code deepseek</code> on the right. When both finish, <code>wrapper-code usage</code> shows the requests and tokens of each one, by model.</p>
  </section>

  <section class="grid">
    <div class="box"><h3>Isolated</h3><p>Only environment variables change, and only for that process. Plain <code>claude</code> keeps using Anthropic, and nothing is written under <code>~/.claude</code>.</p></div>
    <div class="box"><h3>Side by side</h3><p>Run several Claude Code sessions at the same time, each with its own LLM: <code>wrapper-code deepseek</code> in one terminal, <code>wrapper-code qwencloud</code> in another, plain <code>claude</code> in a third.</p></div>
    <div class="box"><h3>Claude accounts</h3><p>Several Claude logins at once, a personal plan and a Team on the same e-mail included. <code>wrapper-code claude --account work</code> opens one, <code>--temp</code> logs in for a single session. Plain <code>claude</code> keeps its own.</p></div>
    <div class="box"><h3>Plan or pay per token</h3><p>Use a subscription you already pay for, such as Kimi Code, the Qwen Token Plan or the GLM Coding Plan, or pay per token. <code>wrapper-code list</code> shows how each provider bills.</p></div>
    <div class="box"><h3>Setup in the browser</h3><p>The first launch opens a local page: paste the key, pick a model profile, and the key is tested before anything is saved.</p></div>
    <div class="box"><h3>Token usage</h3><p>Each session records its requests and tokens locally. <code>wrapper-code usage</code> adds them up by provider, model and day, <code>wrapper-code usage clear</code> deletes them, and <code>wrapper-code claude</code> counts your Anthropic usage too. Nothing leaves your machine.</p></div>
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
    <p class="summary"><a href="${CCR}" rel="noopener">claude-code-router</a> (CCR) is a local gateway that routes, rewrites and retries every request, for Claude Code and other agents. wrapper-code only sets up the environment of one session and gets out of the way: nothing between Claude Code and the provider, nothing running when you are not working, plain <code>claude</code> untouched. If you need routing, fallbacks or other agents, use CCR.</p>
    <details>
      <summary>Read the full comparison</summary>
    <p><a href="${CCR}" rel="noopener">claude-code-router</a> (CCR) is the best-known way to run Claude Code on other models. It is a local gateway: a background service on <code>127.0.0.1:3456</code> receives every request from Claude Code (and from Codex, Kimi CLI, OpenCode and other agents), decides per request which provider and model to call, and can rewrite, retry, fall back to another model or key, translate to OpenAI- and Gemini-style APIs, and add vision, web search or MCP tools to a model that lacks them. It has a management UI, request logs with cost estimates, a desktop app and Docker images. If you need any of that, use CCR.</p>
    <p>wrapper-code wants to solve a smaller problem: start one Claude Code session on one other provider, with nothing changed for your normal Claude Code and nothing extra running. It sets the provider's <code>ANTHROPIC_BASE_URL</code>, key and model variables in the environment of one <code>claude</code> process and gets out of the way. That is the whole design, and it is where its advantages come from:</p>
    <ul>
      <li><strong>Nothing between Claude Code and the model.</strong> Requests go straight to the provider's endpoint. There is no local process to parse, rewrite and re-stream every request and response, and none that can be down. CCR's documentation lists its running service as a prerequisite for a Claude Code launched from it.</li>
      <li><strong>Your prompts stay between Claude Code and the provider.</strong> wrapper-code never sees them; the only thing it receives is Claude Code's own token counts, over a loopback port with a random per-session token. CCR's gateway sees every request, and its request logs store request and response bodies (configurable: all, errors only or none; kept for the current day).</li>
      <li><strong>Nothing runs when you are not working.</strong> No daemon, no desktop app, no database, no port left open. When <code>claude</code> exits, wrapper-code prints the usage block and exits too.</li>
      <li><strong>Plain <code>claude</code> cannot be hijacked.</strong> Nothing is written under <code>~/.claude</code>, and there is no "system default" mode, so no setting could make your normal Claude Code talk to another backend. CCR has such a scope; its own guide recommends starting with "only opened from CCR" for the same reason.</li>
      <li><strong>Side by side.</strong> Each session carries its own environment, so <code>wrapper-code deepseek</code>, <code>wrapper-code ollama</code> and plain <code>claude</code> can run at the same time in three terminals.</li>
      <li><strong>The provider's integration, unchanged.</strong> Each provider definition follows the provider's published Claude Code setup (linked in the table above), and what reaches Claude Code is what the provider's endpoint sends: streaming, tool calls, caching and thinking as the provider implements them, with no translation layer in between.</li>
      <li><strong>Small and readable.</strong> One npm package with no runtime dependencies (27 files, about 100 kB, Node.js 18+). The whole configuration is one environment file per provider that you can <code>cat</code>; export the same variables by hand and you get the same session, with or without wrapper-code.</li>
    </ul>
    <p>What wrapper-code does not do, by design: per-request routing, fallbacks, retries, key rotation, several providers in one session, protocol translation (the provider must speak the Anthropic Messages API), other agents than Claude Code. This reflects CCR 3.1 and its documentation (September 2026); check its repository for the current state.</p>
    <p class="muted">Both can be installed at once. If a CCR profile is set as "system default", check that it did not add <code>ANTHROPIC_BASE_URL</code> to the <code>env</code> block of <code>~/.claude/settings.json</code>: settings there win over the variables wrapper-code sets.</p>
      </details>
  </section>

  <section class="how">
    <h2>How it works</h2>
    <ol>
      <li>Reads the provider definition: base URL, model variables, how to test a key.</li>
      <li>Reads your saved choices; runs the setup page if the key is missing.</li>
      <li>Builds an environment from your shell, the provider and your profile. <code>ANTHROPIC_API_KEY</code> is removed so Claude Code cannot fall back to Anthropic.</li>
      <li>Starts a small receiver on <code>127.0.0.1</code> for Claude Code's own token counts, which become the usage report.</li>
      <li>Finds <code>claude</code> on your PATH and runs it with that environment, forwarding your arguments and its exit code.</li>
    </ol>
    <p><code>wrapper-code claude</code> is the exception: it skips the first three steps and runs your own Claude Code with your environment as it is, only adding the receiver.</p>
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
