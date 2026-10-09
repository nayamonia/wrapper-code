import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSite } from '../scripts/render-site.mjs';
import { loadCatalog } from '../src/catalog.js';
import { CREDITS } from '../src/credits.js';

const ALLOWED_HOSTS = new Set(['github.com', 'www.npmjs.com', 'cd2.com.br']);

test('renderSite builds a self-contained landing page from the brand, the catalog and the credits', async () => {
  const catalog = await loadCatalog();
  const html = renderSite({ catalog, version: '0.1.0' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>wrapper-code<\/title>/);
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml/);
  assert.match(html, /viewBox="0 0 16 16"/, 'mascot sprite inline');
  assert.match(html, /viewBox="0 0 50 5"/, 'wordmark inline');
  assert.match(html, /Run Claude Code with any LLM/);
  assert.match(html, /npm install -g wrapper-code/);
  assert.match(html, /<div class="install" id="install">[^\n]*<span class="p">\$<\/span> wrapper-code deepseek<\/div>/, 'hero example uses deepseek');
  assert.doesNotMatch(html, /<h3>8-bit<\/h3>/, 'no 8-bit card');
  const row = (id) => html.slice(html.indexOf(`<code>wrapper-code ${id}</code>`), html.indexOf('</tr>', html.indexOf(`<code>wrapper-code ${id}</code>`)));
  assert.match(row('ollama'), /Models discovered from your server at setup time/);
  assert.doesNotMatch(row('openrouter'), /your server/, 'a hosted catalog is not "your server"');
  assert.match(row('openrouter'), /Any model with tool calling, picked from the live catalog at setup time/);
  assert.deepEqual([...html.matchAll(/<div class="box"><h3>([^<]+)<\/h3>/g)].map((m) => m[1]), ['Isolated', 'Side by side', 'Claude accounts', 'Plan or pay per token', 'Setup in the browser', 'Token usage'], 'card order');
  assert.match(html, /<h3>Token usage<\/h3><p>[^<]*requests and tokens[^]*?<code>wrapper-code usage<\/code>[^]*?your machine/, 'usage card text');
  assert.match(html, /\.grid \{ display: grid; grid-template-columns: repeat\(3, 1fr\);/, 'six cards in two rows of three');
  assert.match(html, /<h3>Side by side<\/h3><p>[^<]*several Claude Code sessions at the same time/, 'card about parallel sessions with different LLMs');
  assert.match(html, /v0\.1\.0/);
  const compare = html.slice(html.indexOf('<section class="compare" id="compare">'), html.indexOf('<section class="how">'));
  assert.ok(compare.length > 0, 'comparison section before "How it works"');
  assert.match(compare, /<h2>wrapper-code vs claude-code-router<\/h2>/);
  assert.match(compare, /href="https:\/\/github\.com\/musistudio\/claude-code-router"/, 'links to the CCR repository');
  assert.match(compare, /If you need any of that, use CCR\./, 'states when CCR is the right choice');
  assert.match(compare, /wants to solve a smaller problem/, 'states the problem wrapper-code solves');
  assert.match(compare, /What wrapper-code does not do, by design/, 'states what wrapper-code does not do');
  assert.match(compare, /wrapper-code never sees them/, 'prompts never pass through wrapper-code');
  assert.match(compare, /no runtime dependencies/, 'footprint claim');
  assert.doesNotMatch(compare, /<table/, 'no comparison table');
  const details = compare.indexOf('<details>');
  assert.ok(details > 0 && compare.indexOf('</details>') > details, 'full comparison inside a details element');
  const summary = compare.slice(0, details);
  assert.match(summary, /<p class="summary">[^]*?use CCR\.<\/p>/, 'short summary before the details');
  assert.ok(summary.length < 900, 'summary is short');
  assert.match(compare.slice(details), /<summary>Read the full comparison<\/summary>/);
  for (const text of ['If you need any of that, use CCR.', 'wants to solve a smaller problem', 'What wrapper-code does not do, by design', 'Both can be installed at once']) {
    assert.ok(compare.indexOf(text) > details, `"${text}" is inside the details`);
  }
  assert.match(html, /<a href="#compare">vs CCR<\/a>/, 'nav link to the comparison');
  for (const provider of catalog.values()) {
    assert.match(html, new RegExp(`<code>wrapper-code ${provider.id}</code>`), `install line for ${provider.id}`);
    assert.ok(html.includes(provider.name), `name of ${provider.id}`);
    assert.ok(html.includes(`href="${provider.docs}"`), `docs link of ${provider.id}`);
  }
  assert.match(html, /https:\/\/github\.com\/nayamonia\/wrapper-code/);
  assert.match(html, /https:\/\/www\.npmjs\.com\/package\/wrapper-code/);
  assert.ok(html.includes(CREDITS.email) && html.includes(CREDITS.github) && html.includes(CREDITS.site));
  assert.match(html, /MIT/);
});

test('renderSite makes no external requests: no remote scripts, styles, fonts or images', async () => {
  const catalog = await loadCatalog();
  const html = renderSite({ catalog, version: '0.1.0' });
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /<link[^>]+href="https?:/);
  assert.doesNotMatch(html, /url\(\s*['"]?https?:/);
  assert.doesNotMatch(html, /<img[^>]+src="https?:/);
  const hrefs = [...html.matchAll(/href="(https?:\/\/[^"/]+)/g)].map((m) => new URL(`${m[1]}/`).host);
  const docsHosts = [...catalog.values()].map((p) => new URL(p.docs).host);
  for (const host of hrefs) {
    assert.ok(ALLOWED_HOSTS.has(host) || docsHosts.includes(host), `unexpected external link host: ${host}`);
  }
});

test('renderSite escapes provider text', async () => {
  const catalog = new Map([['x', {
    id: 'x', name: 'A<b>&"c"', docs: 'https://example.com/docs', credential: null,
    env: {}, profiles: { p: { label: '<i>label</i>', env: {} } }, defaultProfile: 'p',
    test: { method: 'GET', url: 'https://example.com/m', auth: 'none' }, editableBaseUrl: false,
  }]]);
  const html = renderSite({ catalog, version: '0.1.0' });
  assert.match(html, /A&lt;b&gt;&amp;&quot;c&quot;/);
  assert.match(html, /&lt;i&gt;label&lt;\/i&gt;/);
  assert.doesNotMatch(html, /<i>label<\/i>/);
});

test('the committed docs/index.html is up to date with the catalog (run: npm run site)', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createRequire } = await import('node:module');
  const pkg = createRequire(import.meta.url)('../package.json');
  const committed = await readFile(new URL('../docs/index.html', import.meta.url), 'utf8');
  const catalog = await loadCatalog();
  assert.ok(committed === renderSite({ catalog, version: pkg.version }), 'docs/index.html is stale: run `npm run site` and commit the result');
});

test('renderSite describes the passthrough provider without a key or a model list', async () => {
  const html = renderSite({ catalog: await loadCatalog(), version: '0.1.0' });
  const row = html.slice(html.indexOf('<td><code>wrapper-code claude</code>'));
  const cell = row.slice(0, row.indexOf('</tr>'));
  assert.match(cell, /Your own Claude Code login/);
  assert.match(cell, /only token usage is recorded/);
  assert.doesNotMatch(cell, /No key|discovered/);
});

test('renderSite mentions usage clear and the claude passthrough in the usage card and in how it works', async () => {
  const html = renderSite({ catalog: await loadCatalog(), version: '0.1.0' });
  const card = html.slice(html.indexOf('<h3>Token usage</h3>'));
  const text = card.slice(0, card.indexOf('</div>'));
  assert.match(text, /<code>wrapper-code usage clear<\/code>/);
  assert.match(text, /<code>wrapper-code claude<\/code>/);
  const how = html.slice(html.indexOf('<h2>How it works</h2>'));
  assert.match(how, /<code>wrapper-code claude<\/code> is the exception/);
});

test('renderSite shows the demo GIF between the hero and the cards, served from the docs folder', async () => {
  const html = renderSite({ catalog: await loadCatalog(), version: '0.1.0' });
  const demo = html.indexOf('<section class="demo" id="demo">');
  assert.ok(demo > html.indexOf('<section class="hero"') && demo < html.indexOf('<section class="grid">'), 'position');
  assert.match(html, /<img src="demo\.gif" width="1600" height="900" alt="[^"]*wrapper-code claude[^"]*wrapper-code deepseek[^"]*" loading="lazy">/);
  assert.match(html, /<section class="demo"[^]*?<code>wrapper-code usage<\/code>/);
});
