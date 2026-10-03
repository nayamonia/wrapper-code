import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE, SPRITE, wordmarkRows, renderSvg, renderHalfBlocks, supportsTruecolor, faviconDataUri, ansi,
} from '../src/brand.js';

test('PALETTE is the Arcade neon set and is frozen', () => {
  assert.deepEqual(PALETTE, {
    bg: '#0b0b14', ink: '#1b1b3a', magenta: '#ff2d95', cyan: '#2de2e6', yellow: '#ffd23f', white: '#f4f4f8', muted: '#3a3a66', dim: '#8a8aa3',
  });
  assert.ok(Object.isFrozen(PALETTE));
});

test('SPRITE is a 16x16 grid using only known pixel codes', () => {
  assert.equal(SPRITE.length, 16);
  for (const row of SPRITE) {
    assert.equal(row.length, 16);
    assert.match(row, /^[.dpcwy]+$/);
  }
  assert.ok(SPRITE.some((r) => r.includes('c')), 'has cyan eyes');
});

test('wordmarkRows renders WRAPPER-CODE as 5 rows with a gap after each glyph', () => {
  const rows = wordmarkRows('WRAPPER-CODE');
  assert.equal(rows.length, 5);
  const width = rows[0].length;
  for (const row of rows) {
    assert.equal(row.length, width);
    assert.match(row, /^[.x]+$/);
  }
  assert.ok(rows.some((r) => r.includes('x')));
  // W is 5 wide, the other 11 glyphs are 3 wide, each followed by a 1-px gap
  assert.equal(width, (5 + 1) + 11 * (3 + 1));
});

test('wordmarkRows throws a clear error for a character without a glyph', () => {
  assert.throws(() => wordmarkRows('WRAPPER_CODE'), /No glyph for "_"/);
});

test('renderSvg emits one rect per lit pixel with crisp edges and optional size', () => {
  const svg = renderSvg(['p.', '.c'], { px: 10, className: 'pix' });
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 2 2"/);
  assert.match(svg, /width="20" height="20"/);
  assert.match(svg, /class="pix"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.equal((svg.match(/<rect /g) || []).length, 2);
  assert.match(svg, /fill="#ff2d95"/);
  assert.match(svg, /fill="#2de2e6"/);
  // Without px, the SVG opening tag should not have width/height attributes
  const tagMatch = renderSvg(['p']).match(/^<svg [^>]*>/);
  assert.doesNotMatch(tagMatch[0], /width=|height=/);
});

test('renderSvg: all rects always have width="1" height="1" (regression)', () => {
  const svg1 = renderSvg(['p.', '.c']);
  const svg2 = renderSvg(['p.', '.c'], { px: 10 });
  const rects1 = svg1.match(/<rect [^>]*>/g) || [];
  const rects2 = svg2.match(/<rect [^>]*>/g) || [];
  const withWidth1 = rects1.filter((r) => /width="1" height="1"/.test(r)).length;
  const withWidth2 = rects2.filter((r) => /width="1" height="1"/.test(r)).length;
  assert.equal(withWidth1, rects1.length, 'all rects have width/height without px');
  assert.equal(withWidth2, rects2.length, 'all rects have width/height with px');
});

test('faviconDataUri: decoded SVG has all rects with width/height (regression)', () => {
  const uri = faviconDataUri();
  const svg = decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length));
  const rects = svg.match(/<rect [^>]*>/g) || [];
  const withWidth = rects.filter((r) => /width="1" height="1"/.test(r)).length;
  assert.ok(rects.length > 50, 'sprite has many rects');
  assert.equal(withWidth, rects.length, 'every sprite rect has width="1" height="1"');
});

test('renderHalfBlocks pairs rows into ▀▄ cells and resets at the end of colored lines', () => {
  const lines = renderHalfBlocks(['p.c', '.pc', 'd..'], { truecolor: true });
  assert.equal(lines.length, 2); // 3 rows → padded to 4 → 2 lines
  assert.match(lines[0], /\x1b\[38;2;255;45;149m▀/);           // top only → ▀ in magenta
  assert.match(lines[0], /\x1b\[38;2;255;45;149m▄/);           // bottom only → ▄ in magenta
  assert.match(lines[0], /\x1b\[38;2;45;226;230m\x1b\[48;2;45;226;230m▀/); // both → fg top + bg bottom
  assert.ok(lines[0].endsWith('\x1b[0m'));
  assert.ok(lines[1].endsWith('\x1b[0m'));
  assert.equal(renderHalfBlocks(['..', '..'])[0], '  ');
});

test('renderHalfBlocks falls back to 16-color codes without truecolor', () => {
  const [line] = renderHalfBlocks(['pc', 'wd'], { truecolor: false });
  assert.match(line, /\x1b\[95m\x1b\[107m▀/); // magenta over white
  assert.match(line, /\x1b\[96m\x1b\[44m▀/);  // cyan over ink
  assert.doesNotMatch(line, /38;2/);
});

test('ansi maps names to escapes in both modes', () => {
  assert.equal(ansi('cyan', { truecolor: true }), '\x1b[38;2;45;226;230m');
  assert.equal(ansi('cyan', { truecolor: true, bg: true }), '\x1b[48;2;45;226;230m');
  assert.equal(ansi('muted', { truecolor: false }), '\x1b[90m');
  assert.throws(() => ansi('nope', { truecolor: true }), /Unknown color/);
});

test('supportsTruecolor reads COLORTERM', () => {
  assert.equal(supportsTruecolor({ COLORTERM: 'truecolor' }), true);
  assert.equal(supportsTruecolor({ COLORTERM: '24bit' }), true);
  assert.equal(supportsTruecolor({ COLORTERM: '' }), false);
  assert.equal(supportsTruecolor({}), false);
});

test('faviconDataUri is an SVG data URI of the sprite', () => {
  const uri = faviconDataUri();
  assert.ok(uri.startsWith('data:image/svg+xml;utf8,'));
  const svg = decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length));
  assert.match(svg, /viewBox="0 0 16 16"/);
  assert.ok((svg.match(/<rect /g) || []).length > 50);
});

// --- background leak and panel mode ---------------------------------------
function scanCells(line) {
  // Walks the ANSI stream and returns every drawn cell with the fg/bg active at that moment.
  const cells = [];
  let fg = null;
  let bg = null;
  const re = /\x1b\[([0-9;]*)m|([^\x1b])/g;
  let m;
  while ((m = re.exec(line))) {
    if (m[1] !== undefined) {
      const p = m[1].split(';').map(Number);
      if (p[0] === 0) { fg = null; bg = null; }
      else if (p[0] === 38) fg = p.slice(2).join(',');
      else if (p[0] === 48) bg = p.slice(2).join(',');
      else if (p[0] === 49) bg = null;
    } else {
      cells.push({ ch: m[2], fg, bg });
    }
  }
  return cells;
}

test('renderHalfBlocks clears the background after a two-pixel cell', () => {
  const [line] = renderHalfBlocks(['ww.', 'w..'], { truecolor: true });
  const cells = scanCells(line);
  assert.equal(cells[0].fg, '244,244,248');
  assert.equal(cells[0].bg, '244,244,248'); // solid white cell is fine
  assert.equal(cells[1].ch, '▀');
  assert.equal(cells[1].bg, null, 'single-pixel cell must not inherit the previous background');
  assert.equal(cells[2].ch, ' ');
  assert.equal(cells[2].bg, null, 'empty cell must not inherit the previous background');
});

test('renderHalfBlocks never draws a pixel in the same color as its background (sprite and wordmark)', () => {
  for (const rows of [SPRITE, wordmarkRows('WRAPPER-CODE')]) {
    const padded = rows.length % 2 ? [...rows, '.'.repeat(rows[0].length)] : rows;
    renderHalfBlocks(rows, { truecolor: true }).forEach((line, i) => {
      scanCells(line).forEach((cell, x) => {
        const top = padded[i * 2][x] ?? '.';
        const bot = padded[i * 2 + 1][x] ?? '.';
        if (cell.ch === ' ') assert.equal(cell.bg, null, `line ${i} col ${x}: empty cell has a background`);
        else if (top === '.' || bot === '.') assert.equal(cell.bg, null, `line ${i} col ${x}: half cell has a background`);
        else if (top !== bot) assert.notEqual(cell.fg, cell.bg, `line ${i} col ${x}: invisible pixel`);
      });
    });
  }
});

test('renderHalfBlocks panel mode paints the night background on every cell', () => {
  const night = '11,11,20';
  const [line] = renderHalfBlocks(['w.c', 'w.'], { truecolor: true, panel: true });
  const cells = scanCells(line);
  assert.equal(cells.length, 3);
  assert.equal(cells[0].bg, '244,244,248'); // solid cell keeps its own bottom color
  assert.equal(cells[1].ch, ' ');
  assert.equal(cells[1].bg, night);
  assert.equal(cells[2].ch, '▀');
  assert.equal(cells[2].fg, '45,226,230');
  assert.equal(cells[2].bg, night);
  assert.ok(line.endsWith('\x1b[0m'));
  const [plain] = renderHalfBlocks(['..', '..'], { truecolor: true, panel: true });
  assert.equal(scanCells(plain).every((c) => c.bg === night), true);
});

test('ansi exposes the night background and a readable dim text color in both modes', () => {
  assert.equal(ansi('bg', { truecolor: true, bg: true }), '\x1b[48;2;11;11;20m');
  assert.equal(ansi('bg', { truecolor: false, bg: true }), '\x1b[40m');
  assert.equal(PALETTE.dim, '#8a8aa3');
  assert.equal(ansi('dim', { truecolor: true }), '\x1b[38;2;138;138;163m');
  assert.equal(ansi('dim', { truecolor: false }), '\x1b[37m');
});
