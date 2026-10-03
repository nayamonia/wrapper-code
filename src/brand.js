export const PALETTE = Object.freeze({
  bg: '#0b0b14',
  ink: '#1b1b3a',
  magenta: '#ff2d95',
  cyan: '#2de2e6',
  yellow: '#ffd23f',
  white: '#f4f4f8',
  muted: '#3a3a66',
});

// Pixel codes used in maps: . none, d ink, p magenta, c cyan, y yellow, w white, x white (wordmark)
const CODE_COLOR = { d: 'ink', p: 'magenta', c: 'cyan', y: 'yellow', w: 'white', x: 'white' };

export const SPRITE = Object.freeze([
  '................',
  '......d..d......',
  '.....dd..dd.....',
  '...dddddddddd...',
  '..dppppppppppd..',
  '..dpccppppccpd..',
  '..dpccppppccpd..',
  '..dppppppppppd..',
  '..dppwwwwwwppd..',
  '..dppwdwdwdppd..',
  '..dppppppppppd..',
  '..dddddddddddd..',
  '....dd....dd....',
  '....dd....dd....',
  '...ddd....ddd...',
  '................',
]);

const GLYPHS = {
  A: ['010', '101', '111', '101', '101'],
  C: ['111', '100', '100', '100', '111'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  O: ['111', '101', '101', '101', '111'],
  P: ['111', '101', '111', '100', '100'],
  R: ['111', '101', '110', '101', '101'],
  W: ['10001', '10001', '10101', '10101', '01010'],
  '-': ['000', '000', '111', '000', '000'],
  ' ': ['0', '0', '0', '0', '0'],
};

export function wordmarkRows(text) {
  const rows = ['', '', '', '', ''];
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (!glyph) throw new Error(`No glyph for "${ch}"`);
    for (let i = 0; i < 5; i += 1) {
      rows[i] += `${glyph[i].replace(/1/g, 'x').replace(/0/g, '.')}.`;
    }
  }
  return rows;
}

function colorOf(code) {
  const name = CODE_COLOR[code];
  if (!name) throw new Error(`Unknown pixel code "${code}"`);
  return name;
}

export function renderSvg(rows, { px, className } = {}) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const attrs = [`viewBox="0 0 ${w} ${h}"`];
  if (px) attrs.push(`width="${w * px}" height="${h * px}"`);
  if (className) attrs.push(`class="${className}"`);
  attrs.push('shape-rendering="crispEdges"', 'xmlns="http://www.w3.org/2000/svg"');
  const rects = [];
  rows.forEach((row, y) => {
    [...row].forEach((code, x) => {
      if (code !== '.') {
        let rect = `<rect x="${x}" y="${y}"`;
        if (px) rect += ' width="1" height="1"';
        rect += ` fill="${PALETTE[colorOf(code)]}"/>`;
        rects.push(rect);
      }
    });
  });
  return `<svg ${attrs.join(' ')}>${rects.join('')}</svg>`;
}

const BASIC_FG = { ink: 34, magenta: 95, cyan: 96, yellow: 93, white: 97, muted: 90 };

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function ansi(name, { truecolor, bg = false }) {
  if (!Object.hasOwn(PALETTE, name) || name === 'bg') throw new Error(`Unknown color "${name}"`);
  if (truecolor) {
    const [r, g, b] = hexToRgb(PALETTE[name]);
    return `\x1b[${bg ? 48 : 38};2;${r};${g};${b}m`;
  }
  return `\x1b[${BASIC_FG[name] + (bg ? 10 : 0)}m`;
}

export const RESET = '\x1b[0m';

export function renderHalfBlocks(rows, { truecolor = true } = {}) {
  const padded = rows.length % 2 ? [...rows, '.'.repeat(rows[0].length)] : [...rows];
  const w = Math.max(...padded.map((r) => r.length));
  const lines = [];
  for (let y = 0; y < padded.length; y += 2) {
    const top = padded[y].padEnd(w, '.');
    const bot = padded[y + 1].padEnd(w, '.');
    let line = '';
    let colored = false;
    for (let x = 0; x < w; x += 1) {
      const t = top[x];
      const b = bot[x];
      if (t === '.' && b === '.') {
        line += ' ';
      } else if (t !== '.' && b !== '.') {
        line += `${ansi(colorOf(t), { truecolor })}${ansi(colorOf(b), { truecolor, bg: true })}▀`;
        colored = true;
      } else if (t !== '.') {
        line += `${ansi(colorOf(t), { truecolor })}▀`;
        colored = true;
      } else {
        line += `${ansi(colorOf(b), { truecolor })}▄`;
        colored = true;
      }
    }
    lines.push(colored ? `${line}${RESET}` : line);
  }
  return lines;
}

export function supportsTruecolor(env) {
  return /truecolor|24bit/i.test(env.COLORTERM || '');
}

export function faviconDataUri() {
  return `data:image/svg+xml;utf8,${encodeURIComponent(renderSvg(SPRITE))}`;
}
