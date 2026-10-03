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
  assert.match(html, /v0\.1\.0/);
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
