import { BILLINGS } from './catalog.js';

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function compareProviders(a, b) {
  return byText(a.family, b.family)
    || BILLINGS.indexOf(a.billing) - BILLINGS.indexOf(b.billing)
    || byText(a.id, b.id);
}

// The same rule the launch uses to pick the env for the child.
export function selectionOf(provider, values) {
  if (provider.passthrough) return '';
  return provider.models ? values.WRAPPER_CODE_MODEL : (values.WRAPPER_CODE_PROFILE || provider.defaultProfile);
}

// Rows of strings, header first. The last column is never padded, so no line ends in spaces.
export function formatTable(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  const lines = rows.map((row) => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]))).join('  '));
  return `${lines.join('\n')}\n`;
}
