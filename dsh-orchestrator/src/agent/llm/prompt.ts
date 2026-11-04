/**
 * Prompt construction helpers and — more importantly — defensive response parsing.
 *
 * Real models wrap JSON in prose, in ```json fences, or return a bare code block despite
 * being told to answer with JSON. A pipeline that cannot survive that is not usable, so
 * extraction is layered: exact parse → fenced block → first balanced {...}/[...] span.
 */

import { RuleFailure } from '../../types/index.js';

/** Find the index of the bracket that closes the one at `start`, respecting JSON strings. */
function findBalancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function balancedCandidates(text: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;
    const end = findBalancedEnd(text, i);
    if (end > i) found.push(text.slice(i, end + 1));
  }
  // outermost first, then dedupe
  return Array.from(new Set(found)).sort((a, b) => b.length - a.length);
}

/**
 * Parse a JSON payload out of a possibly chatty model response.
 * Throws with a readable message when nothing parses.
 */
export function extractJson<T = any>(text: string): T {
  const raw = (text ?? '').trim();
  if (raw.length === 0) throw new Error('empty LLM response');

  const tryParse = (candidate: string): T | undefined => {
    try {
      const value = JSON.parse(candidate) as unknown;
      // `{}` / `[]` are almost always an accidental brace pair from prose like
      // "reset() {}" — not a usable payload, so keep looking.
      if (value !== null && typeof value === 'object') {
        const empty = Array.isArray(value) ? value.length === 0 : Object.keys(value as object).length === 0;
        if (empty) return undefined;
      }
      return value as T;
    } catch {
      return undefined;
    }
  };

  const direct = tryParse(raw);
  if (direct !== undefined) return direct;

  for (const match of raw.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)) {
    const parsed = tryParse(match[1].trim());
    if (parsed !== undefined) return parsed;
  }

  for (const candidate of balancedCandidates(raw)) {
    const parsed = tryParse(candidate);
    if (parsed !== undefined) return parsed;
  }

  throw new Error(`LLM response contained no parseable JSON (starts with: "${raw.slice(0, 80)}")`);
}

/** Pull the first code block out of a response, preferring JS/TS fences. */
export function extractFencedCode(text: string): string | null {
  const blocks = Array.from((text ?? '').matchAll(/```([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)```/g));
  if (blocks.length === 0) return null;

  for (const lang of ['js', 'javascript', 'ts', 'typescript', 'mjs', '']) {
    const hit = blocks.find(b => (b[1] ?? '').toLowerCase() === lang);
    if (hit && hit[2].trim().length > 0) return hit[2].trim();
  }
  return blocks[0][2].trim();
}

export function truncateText(text: string, max: number): string {
  const value = text ?? '';
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 20))}\n… [truncated ${value.length - max + 20} chars]`;
}

export function bulletList(items: string[]): string {
  if (!items || items.length === 0) return '  (none)';
  return items.map(item => `  - ${item}`).join('\n');
}

export function formatRuleFailures(failures: RuleFailure[]): string {
  if (!failures || failures.length === 0) return '  (none)';
  return failures
    .map(f => {
      const id = f.id ?? f.ruleName;
      return `  - ${id}: ${String(f.message ?? '').replace(/\s+/g, ' ').slice(0, 300)}`;
    })
    .join('\n');
}

/** Extract rule ids (`AREA-123`) mentioned in free text — used to parse model answers. */
export function mentionedRuleIds(text: string, known: string[]): string[] {
  const found = new Set<string>();
  for (const id of known) {
    if (new RegExp(`\\b${id}\\b`).test(text)) found.add(id);
  }
  return Array.from(found);
}

/** Read a field that may be a string, an array of strings, or absent. */
export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(v => (typeof v === 'string' ? v : typeof v === 'object' && v ? String((v as any).text ?? (v as any).name ?? '') : String(v ?? '')))
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) return [value.trim()];
  return [];
}
