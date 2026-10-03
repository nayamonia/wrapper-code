import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSplashSvg } from '../scripts/render-splash-svg.mjs';

const ARGS = { version: '0.1.0', providerName: 'DeepSeek', selection: 'flash-1m' };

test('renderSplashSvg draws the night panel, the mascot, the wordmark, the text lines and the bar', () => {
  const svg = renderSplashSvg(ARGS);
  assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /viewBox="0 0 720 \d+"/);
  assert.match(svg, /<title[^>]*>wrapper-code<\/title>/);
  assert.match(svg, /<rect x="0" y="0" width="720" height="\d+" fill="#0b0b14"\/>/, 'night panel first');
  assert.ok((svg.match(/fill="#ff2d95"/g) || []).length > 30, 'magenta body pixels');
  assert.ok((svg.match(/fill="#2de2e6"/g) || []).length >= 8 + 12, 'cyan eyes plus 12 bar cells');
  assert.ok((svg.match(/fill="#f4f4f8"/g) || []).length > 60, 'white wordmark pixels');
  assert.match(svg, /v0\.1\.0/);
  assert.match(svg, /DeepSeek · flash-1m/);
  assert.match(svg, /MIT · Gabriel Fernandes · cd2\.com\.br/);
  assert.match(svg, /starting claude…/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.doesNotMatch(svg, /<script|href=|url\(/, 'no scripts or external references');
});

test('renderSplashSvg escapes text that could break the markup', () => {
  const svg = renderSplashSvg({ ...ARGS, providerName: 'A<B>&"C"' });
  assert.match(svg, /A&lt;B&gt;&amp;&quot;C&quot;/);
  assert.doesNotMatch(svg, /A<B>/);
});
