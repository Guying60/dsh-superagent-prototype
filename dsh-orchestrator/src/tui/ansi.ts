/**
 * Zero-dependency ANSI toolkit for the terminal UI.
 *
 * Everything here is width-aware: CJK glyphs occupy two columns, so a naive `length`
 * would shear every box that contains Chinese text.
 */

const ESC = '\u001b[';

export const style = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  inverse: `${ESC}7m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  gray: `${ESC}90m`,
  white: `${ESC}37m`,
  bgCyan: `${ESC}46m`,
  bgGreen: `${ESC}42m`,
  bgRed: `${ESC}41m`,
  bgYellow: `${ESC}43m`
} as const;

export function paint(text: string, ...styles: string[]): string {
  return `${styles.join('')}${text}${style.reset}`;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[a-zA-Z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

function charWidth(code: number): number {
  if (code < 0x1100) return 1;
  // CJK, Hangul, full-width forms, emoji-ish blocks
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff)
  ) {
    return 2;
  }
  return 1;
}

export function visibleWidth(text: string): number {
  const plain = stripAnsi(text);
  let width = 0;
  for (const ch of plain) width += charWidth(ch.codePointAt(0) ?? 32);
  return width;
}

/** Truncate + pad to an exact visible width (ANSI sequences are preserved). */
export function fit(text: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string {
  if (width <= 0) return '';
  const visible = visibleWidth(text);

  if (visible > width) {
    let out = '';
    let used = 0;
    const plain = stripAnsi(text);
    for (const ch of plain) {
      const w = charWidth(ch.codePointAt(0) ?? 32);
      if (used + w > width - 1) break;
      out += ch;
      used += w;
    }
    return out + '…' + ' '.repeat(Math.max(0, width - used - 1));
  }

  const pad = width - visible;
  if (align === 'right') return ' '.repeat(pad) + text;
  if (align === 'center') {
    const left = Math.floor(pad / 2);
    return ' '.repeat(left) + text + ' '.repeat(pad - left);
  }
  return text + ' '.repeat(pad);
}

// ---------------------------------------------------------------------------
// Box drawing
// ---------------------------------------------------------------------------

export interface BoxOptions {
  title?: string;
  titleColor?: string;
  borderColor?: string;
  /** suffix rendered right-aligned in the top border */
  badge?: string;
  badgeColor?: string;
}

/** Frame a set of already-styled content lines into a bordered box. */
export function box(lines: string[], width: number, options: BoxOptions = {}): string[] {
  const border = options.borderColor ?? style.gray;
  const inner = Math.max(1, width - 2);
  const out: string[] = [];

  const titleText = options.title ? ` ${options.title} ` : '';
  const badgeText = options.badge ? ` ${options.badge} ` : '';
  const titleW = visibleWidth(titleText);
  const badgeW = visibleWidth(badgeText);

  if (titleText || badgeText) {
    const fill = Math.max(0, inner - 2 - titleW - badgeW);
    const titleStyled = titleText ? paint(titleText, options.titleColor ?? style.cyan, style.bold) : '';
    const badgeStyled = badgeText ? paint(badgeText, options.badgeColor ?? style.gray) : '';
    out.push(
      `${border}┌─${style.reset}${titleStyled}${border}${'─'.repeat(fill)}${style.reset}${badgeStyled}${border}─┐${style.reset}`
    );
  } else {
    out.push(`${border}┌${'─'.repeat(inner)}┐${style.reset}`);
  }

  for (const line of lines) {
    out.push(`${border}│${style.reset}${fit(line, inner)}${border}│${style.reset}`);
  }

  out.push(`${border}└${'─'.repeat(inner)}┘${style.reset}`);
  return out;
}

/** Compose two column stacks of equal height. */
export function sideBySide(left: string[], right: string[], leftWidth: number, gap = 1): string[] {
  const height = Math.max(left.length, right.length);
  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    const l = left[i] ?? '';
    const r = right[i] ?? '';
    out.push(`${fit(l, leftWidth)}${' '.repeat(gap)}${r}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small widgets
// ---------------------------------------------------------------------------

export function bar(value: number, max: number, width: number, colour: string): string {
  const ratio = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const filled = Math.round(ratio * width);
  return paint('█'.repeat(filled), colour) + paint('░'.repeat(Math.max(0, width - filled)), style.gray);
}

export function statusGlyph(status: string): string {
  switch (status) {
    case 'running':
      return paint('◐', style.yellow, style.bold);
    case 'completed':
      return paint('✔', style.green);
    case 'failed':
      return paint('✘', style.red);
    case 'needs_human':
      return paint('!', style.bgYellow, style.bold);
    case 'skipped':
      return paint('-', style.gray);
    case 'pending':
    default:
      return paint('·', style.gray);
  }
}

export function statusBadge(status: string): { text: string; colour: string } {
  switch (status) {
    case 'running':
      return { text: ' RUNNING ', colour: style.bgCyan };
    case 'completed':
      return { text: ' DONE ', colour: style.bgGreen };
    case 'failed':
      return { text: ' FAILED ', colour: style.bgRed };
    case 'needs_human':
      return { text: ' NEEDS HUMAN ', colour: style.bgYellow };
    default:
      return { text: ` ${status.toUpperCase()} `, colour: style.dim };
  }
}

export function rule(width: number, label = ''): string {
  const visible = visibleWidth(label);
  const pad = Math.max(0, width - visible - 2);
  return paint('─'.repeat(pad), style.gray) + (label ? ` ${label} ` : '');
}

export function elapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

export function truncate(text: string, width: number): string {
  const plain = stripAnsi(text).replace(/\s+/g, ' ').trim();
  if (visibleWidth(plain) <= width) return plain;
  let out = '';
  let used = 0;
  for (const ch of plain) {
    const w = charWidth(ch.codePointAt(0) ?? 32);
    if (used + w > width - 1) break;
    out += ch;
    used += w;
  }
  return out + '…';
}
