import { SPRITE, wordmarkRows, renderHalfBlocks, supportsTruecolor, ansi, RESET } from './brand.js';
import { CREDITS, launchBanner } from './credits.js';

export const SPLASH_WIDTH = 72;
export const PANEL_WIDTH = 71; // one short of the minimum width so the cursor never wraps
export const BAR_STEPS = 12;
export const STEP_MS = 50;

export function shouldSplash({ stdout, env }) {
  if (!stdout.isTTY) return false;
  if (env.NO_COLOR !== undefined) return false;
  if (env.WRAPPER_CODE_NO_SPLASH === '1') return false;
  if (env.TERM === 'dumb') return false;
  if (typeof stdout.columns === 'number' && stdout.columns < SPLASH_WIDTH) return false;
  return true;
}

const host = (url) => new URL(url).host;

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

export function splashLines({ version, providerName, selection, truecolor }) {
  const night = ansi('bg', { truecolor, bg: true });
  // Every line sits on the brand's night panel, so the splash looks the same on
  // light and dark terminals. Colored runs end with RESET, which also drops the
  // background, so the panel color is re-applied right after each reset.
  const c = (name, text) => `${ansi(name, { truecolor })}${text}${RESET}${night}`;
  const onPanel = (line) => {
    const body = line.split(RESET).join(`${RESET}${night}`);
    const pad = Math.max(0, PANEL_WIDTH - stripAnsi(body).length);
    return `${night}${body}${' '.repeat(pad)}${RESET}`;
  };
  const sprite = renderHalfBlocks(SPRITE, { truecolor, panel: true });          // 8 lines
  const wordmark = renderHalfBlocks(wordmarkRows('WRAPPER-CODE'), { truecolor, panel: true }); // 3 lines
  const who = `${CREDITS.license} · ${CREDITS.name} · ${host(CREDITS.site)}`;

  // Build provider · selection string, handling undefined/empty values
  const provName = providerName || '';
  const what = selection ? `${provName} · ${selection}` : provName;

  // Compute available width for the version line (line 4: index 4 of right array)
  // Structure: "  " (2) + sprite (16) + "   " (3) + text = 21 + text
  const spriteColWidth = 21;
  const availableWidth = SPLASH_WIDTH - spriteColWidth;

  // Build version prefix: "v{version}  " (with 2 spaces)
  const versionText = version ? `v${version}` : '';
  const versionPrefix = versionText ? `${versionText}  ` : '';
  const versionPrefixLen = stripAnsi(versionPrefix).length;

  // Truncate what if needed
  let displayWhat = what;
  const availableForWhat = availableWidth - versionPrefixLen;
  if (stripAnsi(what).length > availableForWhat && availableForWhat > 1) {
    displayWhat = stripAnsi(what).slice(0, availableForWhat - 1) + '…';
  }

  // Build the bar function
  const bar = (step) => {
    const filled = '█'.repeat(step);
    const empty = '░'.repeat(BAR_STEPS - step);
    return onPanel(`  ${sprite[7]}   ${c('cyan', filled)}${c('muted', empty)}${c('dim', '  starting claude…')}`);
  };

  const right = [
    '',
    wordmark[0],
    wordmark[1],
    wordmark[2],
    versionText ? `${c('dim', versionText)}  ${c('yellow', displayWhat)}` : `${c('yellow', displayWhat)}`,
    c('dim', who),
    '',
  ];
  const lines = right.map((r, i) => onPanel(r ? `  ${sprite[i]}   ${r}` : `  ${sprite[i]}`));
  lines.push(bar(0));
  return { lines, bar };
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function showSplash({ stdout, env, version, providerName, selection, sleep = defaultSleep }) {
  if (!shouldSplash({ stdout, env })) {
    stdout.write(`${launchBanner({ version, providerName, profileId: selection })}\n`);
    return 'plain';
  }
  const { lines, bar } = splashLines({ version, providerName, selection, truecolor: supportsTruecolor(env) });
  stdout.write(`${lines.slice(0, -1).join('\n')}\n`);
  stdout.write(bar(0));
  for (let step = 1; step <= BAR_STEPS; step += 1) {
    await sleep(STEP_MS);
    stdout.write(`\r${bar(step)}`);
  }
  stdout.write('\n\n');
  return 'splash';
}
