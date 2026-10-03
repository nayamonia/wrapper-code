#!/usr/bin/env node
// Renders the terminal splash as an SVG for the README, from the same pixel
// maps and palette the CLI uses (src/brand.js). Run: npm run brand:svg
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PALETTE, SPRITE, wordmarkRows } from '../src/brand.js';
import { CREDITS } from '../src/credits.js';

const WIDTH = 720;
const HEIGHT = 176;
const MONO = 'ui-monospace, Menlo, Consolas, monospace';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const CODE_FILL = { d: PALETTE.ink, p: PALETTE.magenta, c: PALETTE.cyan, y: PALETTE.yellow, w: PALETTE.white, x: PALETTE.white };

function pixels(rows, x0, y0, size) {
  const out = [];
  rows.forEach((row, y) => {
    [...row].forEach((code, x) => {
      if (code === '.') return;
      out.push(`<rect x="${x0 + x * size}" y="${y0 + y * size}" width="${size}" height="${size}" fill="${CODE_FILL[code]}"/>`);
    });
  });
  return out.join('');
}

function text(x, y, content, fill, size = 15) {
  return `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" fill="${fill}">${content}</text>`;
}

export function renderSplashSvg({ version, providerName, selection }) {
  const what = selection ? `${providerName} · ${selection}` : providerName;
  const who = `${CREDITS.license} · ${CREDITS.name} · ${new URL(CREDITS.site).host}`;
  const bar = Array.from({ length: 12 }, (_, i) => `<rect x="${196 + i * 12}" y="134" width="10" height="16" fill="${PALETTE.cyan}"/>`).join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" shape-rendering="crispEdges" role="img" aria-labelledby="t">`,
    '<title id="t">wrapper-code</title>',
    `<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="${PALETTE.bg}"/>`,
    pixels(SPRITE, 40, 32, 7),
    pixels(wordmarkRows('WRAPPER-CODE'), 196, 40, 5),
    `${text(196, 104, `<tspan fill="${PALETTE.dim}">v${esc(version)}</tspan>  <tspan fill="${PALETTE.yellow}">${esc(what)}</tspan>`, PALETTE.dim)}`,
    text(196, 124, esc(who), PALETTE.dim, 13),
    bar,
    text(350, 147, 'starting claude…', PALETTE.dim, 13),
    '</svg>',
  ].join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const pkg = createRequire(import.meta.url)('../package.json');
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'splash.svg');
  writeFileSync(out, `${renderSplashSvg({ version: pkg.version, providerName: 'DeepSeek', selection: 'flash-1m' })}\n`);
  process.stdout.write(`wrote ${out}\n`);
}
