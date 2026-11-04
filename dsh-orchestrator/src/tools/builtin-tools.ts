/**
 * Built-in tools: sandbox execution, test runner, static analyzer, git patch manager.
 *
 * Fixes vs. the previous version:
 * - `code_sandbox` / `test_runner` no longer use `new Function(...)`. They run inside a
 *   fresh `node:vm` context with a hard `timeout`, which CAN interrupt a synchronous
 *   infinite loop (a Promise.race never could) and leaks no host objects into the sandbox.
 * - `git_patch_manager` emits a real LCS-based unified diff (with `-` lines, context and
 *   correct hunk headers) instead of an all-plus pseudo patch.
 * - the static analyzer also flags vm-escape patterns.
 *
 * SECURITY NOTE (deliberate, stated honestly): `node:vm` is a *fault and time* isolation
 * boundary, not a security boundary. Truly untrusted code needs a separate process /
 * container. For this MVP the goals are: determinism, timeout, and no accidental host
 * access from generated code.
 */
import vm from 'node:vm';
import { ToolDefinition } from '../types/index.js';

const MAX_SOURCE_BYTES = 200_000;

/** Assertion helpers are declared *inside* the sandbox realm, so no host object leaks in. */
const ASSERT_PRELUDE = `
var __passed = 0, __failed = 0, __errors = [];
var console = {
  log: function () {},
  error: function () {},
  warn: function () {},
  info: function () {}
};
function assert(condition, message) {
  if (condition) { __passed++; }
  else { __failed++; __errors.push(String(message || 'assertion failed')); }
}
function assertEqual(actual, expected, message) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { __passed++; }
  else { __failed++; __errors.push(String(message || 'assertion failed') + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')'); }
}
function assertClose(actual, expected, tolerance, message) {
  if (typeof actual === 'number' && Math.abs(actual - expected) <= tolerance) { __passed++; }
  else { __failed++; __errors.push(String(message || 'assertion failed') + ' (expected ~' + expected + ', got ' + actual + ')'); }
}
function assertThrows(fn, ctorName, message) {
  try {
    fn();
    __failed++;
    __errors.push(String(message || 'assertion failed') + ' (expected ' + ctorName + ', nothing was thrown)');
  } catch (e) {
    var name = (e && e.constructor && e.constructor.name) || '';
    if (!ctorName || name === ctorName) { __passed++; }
    else { __failed++; __errors.push(String(message || 'assertion failed') + ' (expected ' + ctorName + ', got ' + name + ': ' + (e && e.message) + ')'); }
  }
}
`;

export interface SandboxRunOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  result: any;
  durationMs: number;
  timedOut: boolean;
  engine: string;
}

function runInSandbox(script: string, timeoutMs: number): SandboxRunOutcome {
  const start = Date.now();
  const logs: string[] = [];
  const stdout: string[] = [];

  // the context object carries no host references whatsoever
  const context = vm.createContext(Object.create(null));

  const wrapped = `
    var __logs = [];
    var __console = {
      log: function () { __logs.push(Array.prototype.map.call(arguments, function (a) { return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' ')); },
      error: function () { __logs.push('[ERROR] ' + Array.prototype.map.call(arguments, String).join(' ')); },
      warn: function () { __logs.push('[WARN] ' + Array.prototype.map.call(arguments, String).join(' ')); },
      info: function () { __logs.push(Array.prototype.map.call(arguments, String).join(' ')); }
    };
    var __out = { ok: true, value: undefined, error: null, logs: __logs };
    try {
      __out.value = (function (console) { ${script}\n })(__console);
    } catch (e) {
      __out.ok = false;
      __out.error = (e && e.message) ? String(e.message) : String(e);
      __out.errorName = (e && e.constructor && e.constructor.name) || 'Error';
    }
    __out;
  `;

  try {
    const outcome = vm.runInContext(wrapped, context, {
      timeout: Math.max(1, timeoutMs),
      displayErrors: true,
      filename: 'sandbox.js'
    }) as any;

    const captured: string[] = Array.isArray(outcome?.logs) ? outcome.logs.map(String) : [];
    stdout.push(...captured);

    if (!outcome?.ok) {
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: String(outcome?.error ?? 'unknown error'),
        result: undefined,
        durationMs: Date.now() - start,
        timedOut: false,
        engine: 'node:vm'
      };
    }

    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: '',
      result: outcome.value,
      durationMs: Date.now() - start,
      timedOut: false,
      engine: 'node:vm'
    };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    const timedOut = err?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' || /timed out|Script execution timed out/i.test(message);
    return {
      exitCode: timedOut ? 124 : 1,
      stdout: stdout.join('\n') + (logs.length ? logs.join('\n') : ''),
      stderr: timedOut ? `sandbox timeout after ${timeoutMs}ms (synchronous loop interrupted)` : message,
      result: undefined,
      durationMs: Date.now() - start,
      timedOut,
      engine: 'node:vm'
    };
  }
}

// ---------------------------------------------------------------------------
// Unified diff (LCS based)
// ---------------------------------------------------------------------------

interface DiffOp {
  t: ' ' | '-' | '+';
  text: string;
}

function lcsOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: ' ', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: '-', text: a[i] });
      i++;
    } else {
      ops.push({ t: '+', text: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ t: '-', text: a[i++] });
  while (j < m) ops.push({ t: '+', text: b[j++] });
  return ops;
}

export function buildUnifiedDiff(filePath: string, original: string, updated: string): string {
  if (original === updated) return '';

  /**
   * Split into logical lines and remember whether the file ends with a newline.
   * A patch without the `\ No newline at end of file` marker cannot be applied by git
   * when either side lacks a trailing newline — which is exactly how the previous
   * all-plus pseudo patch failed.
   */
  const splitLines = (text: string): { lines: string[]; noEol: boolean } => {
    if (text === '') return { lines: [], noEol: false };
    const noEol = !text.endsWith('\n');
    const body = noEol ? text : text.slice(0, -1);
    return { lines: body.split('\n'), noEol };
  };

  const aSide = splitLines(original);
  const bSide = splitLines(updated);
  const a = aSide.lines;
  const b = bSide.lines;
  const NO_EOL = '\\ No newline at end of file\n';

  // guard against pathological O(n*m): fall back to whole-file replacement
  const ops =
    a.length * b.length > 400_000
      ? [...a.map<DiffOp>(text => ({ t: '-', text })), ...b.map<DiffOp>(text => ({ t: '+', text }))]
      : lcsOps(a, b);

  interface Line extends DiffOp {
    oldNo: number;
    newNo: number;
  }

  const lines: Line[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const op of ops) {
    if (op.t === ' ') lines.push({ ...op, oldNo: oldNo++, newNo: newNo++ });
    else if (op.t === '-') lines.push({ ...op, oldNo: oldNo++, newNo: 0 });
    else lines.push({ ...op, oldNo: 0, newNo: newNo++ });
  }

  const changedIdx = lines.map((l, i) => (l.t === ' ' ? -1 : i)).filter(i => i >= 0);
  if (changedIdx.length === 0) return '';

  const CONTEXT = 3;
  const groups: Array<[number, number]> = [];
  for (const idx of changedIdx) {
    const start = Math.max(0, idx - CONTEXT);
    const end = Math.min(lines.length - 1, idx + CONTEXT);
    const last = groups[groups.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else groups.push([start, end]);
  }

  let out = `--- a/${filePath}\n+++ b/${filePath}\n`;

  for (const [start, end] of groups) {
    const slice = lines.slice(start, end + 1);
    const oldLines = slice.filter(l => l.t !== '+');
    const newLines = slice.filter(l => l.t !== '-');

    // a pure insertion has no old line: point at the line *before* the insertion
    const oldStart = oldLines.length > 0 ? oldLines[0].oldNo : Math.max(0, lines[start - 1]?.oldNo ?? 0);
    const newStart = newLines.length > 0 ? newLines[0].newNo : Math.max(0, lines[start - 1]?.newNo ?? 0);

    out += `@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@\n`;
    for (const l of slice) {
      out += l.t + l.text + '\n';
      const endsA = l.t !== '+' && aSide.noEol && l.oldNo === a.length;
      const endsB = l.t !== '-' && bSide.noEol && l.newNo === b.length;
      if (endsA || endsB) out += NO_EOL;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------

export function createBuiltinTools(): ToolDefinition[] {
  return [
    // -------------------------------------------------------------- sandbox
    {
      id: 'code_sandbox',
      name: 'Code Sandbox Execution',
      description: 'Execute a JS snippet inside an isolated node:vm context with a hard timeout',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', description: 'javascript', enum: ['javascript'] },
          code: { type: 'string', description: 'Source code; a top-level return is allowed' },
          timeoutMs: { type: 'number', description: 'Execution timeout in ms' }
        },
        required: ['language', 'code']
      },
      isSandboxed: true,
      timeoutMs: 3000,
      handler: async (params: { language: string; code: string; timeoutMs?: number }, ctx?: { timeoutMs?: number }) => {
        if (params.code.length > MAX_SOURCE_BYTES) {
          throw new Error(`code exceeds ${MAX_SOURCE_BYTES} bytes`);
        }
        if (params.language !== 'javascript') {
          throw new Error(`unsupported language '${params.language}' (only javascript is executed; no simulation)`);
        }
        const timeout = Math.min(params.timeoutMs ?? 2000, ctx?.timeoutMs ?? 2000);
        return runInSandbox(params.code, timeout);
      }
    },

    // ----------------------------------------------------------- test runner
    {
      id: 'test_runner',
      name: 'Automated Test Runner',
      description: 'Run assertion-based tests against a source artifact inside the sandbox',
      parameters: {
        type: 'object',
        properties: {
          testCode: { type: 'string', description: 'Assertions; may tag failures with a rule id' },
          sourceCode: { type: 'string', description: 'Implementation under test' }
        },
        required: ['testCode', 'sourceCode']
      },
      isSandboxed: true,
      timeoutMs: 4000,
      handler: async (params: { testCode: string; sourceCode: string }, ctx?: { timeoutMs?: number }) => {
        if ((params.testCode + params.sourceCode).length > MAX_SOURCE_BYTES) {
          throw new Error('test payload too large');
        }

        const script = `${ASSERT_PRELUDE}
${params.sourceCode}
try {
${params.testCode}
} catch (e) {
  __failed++;
  __errors.push((e && e.constructor && e.constructor.name ? e.constructor.name + ': ' : '') + (e && e.message ? e.message : String(e)));
}
return { passed: __passed, failed: __failed, errors: __errors, total: __passed + __failed };
`;

        const timeout = ctx?.timeoutMs ?? 3000;
        const outcome = runInSandbox(script, timeout);

        if (outcome.exitCode !== 0) {
          return {
            success: false,
            report: {
              passed: 0,
              failed: 1,
              errors: [outcome.timedOut ? `TIMEOUT: ${outcome.stderr}` : outcome.stderr],
              total: 1
            },
            engine: outcome.engine
          };
        }

        const report = outcome.result as { passed: number; failed: number; errors: string[]; total: number };
        return {
          success: report.failed === 0 && report.total > 0,
          report
        };
      }
    },

    // ------------------------------------------------------- static analyzer
    {
      id: 'static_analyzer',
      name: 'Static Code & Security Analyzer',
      description: 'Pattern-based security and quality scan over a source artifact',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Code to scan' },
          rules: { type: 'string', description: 'Preset', enum: ['standard', 'strict', 'security'] }
        },
        required: ['code']
      },
      handler: async (params: { code: string; rules?: string }) => {
        const code = params.code ?? '';
        const issues: Array<{ rule: string; severity: 'critical' | 'warning' | 'info'; line: number; message: string }> = [];

        const lineOf = (re: RegExp): number => {
          const lines = code.split('\n');
          for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
          return 1;
        };

        if (/(^|[^.\w])eval\s*\(/.test(code)) {
          issues.push({ rule: 'SEC-001', severity: 'critical', line: lineOf(/(^|[^.\w])eval\s*\(/), message: 'Direct eval() usage detected' });
        }
        if (/new\s+Function\s*\(/.test(code)) {
          issues.push({ rule: 'SEC-001', severity: 'critical', line: lineOf(/new\s+Function\s*\(/), message: 'Dynamic Function() constructor detected' });
        }
        if (/constructor\s*\.\s*constructor|__proto__\s*\[/.test(code)) {
          issues.push({ rule: 'SEC-004', severity: 'critical', line: lineOf(/constructor\s*\.\s*constructor|__proto__\s*\[/), message: 'Sandbox-escape pattern (constructor.constructor / __proto__) detected' });
        }
        if (/(api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/i.test(code)) {
          issues.push({ rule: 'SEC-002', severity: 'critical', line: lineOf(/(api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/i), message: 'Possible hardcoded credential literal' });
        }
        if (/\bTODO\b|\bFIXME\b|\bXXX\b/.test(code)) {
          issues.push({ rule: 'QUAL-002', severity: 'warning', line: lineOf(/\bTODO\b|\bFIXME\b|\bXXX\b/), message: 'Unresolved TODO/FIXME marker left in artifact' });
        }
        if (/\.then\s*\([^)]*\)\s*;?\s*$/m.test(code) && !/\.catch\s*\(/.test(code)) {
          issues.push({ rule: 'QUAL-001', severity: 'warning', line: 1, message: 'Promise chain without a .catch() handler' });
        }

        // only report rules above 'info' when the strict preset is asked for
        const filtered = params.rules === 'security' ? issues.filter(i => i.rule.startsWith('SEC')) : issues;

        return {
          clean: filtered.length === 0,
          issueCount: filtered.length,
          issues: filtered,
          qualityScore: Math.max(0, 100 - filtered.reduce((s, i) => s + (i.severity === 'critical' ? 40 : i.severity === 'warning' ? 15 : 5), 0))
        };
      }
    },

    // ------------------------------------------------------ git patch manager
    {
      id: 'git_patch_manager',
      name: 'Git Patch & Diff Manager',
      description: 'Produce a real unified diff (LCS based) between two artifacts',
      parameters: {
        type: 'object',
        properties: {
          originalContent: { type: 'string', description: 'Original file content' },
          updatedContent: { type: 'string', description: 'Modified file content' },
          filePath: { type: 'string', description: 'Repository-relative file path' }
        },
        required: ['originalContent', 'updatedContent', 'filePath']
      },
      handler: async (params: { originalContent: string; updatedContent: string; filePath: string }) => {
        const patch = buildUnifiedDiff(params.filePath, params.originalContent, params.updatedContent);
        const originalLines = params.originalContent.split('\n').length;
        const updatedLines = params.updatedContent.split('\n').length;

        return {
          filePath: params.filePath,
          hasChanges: params.originalContent !== params.updatedContent,
          patch,
          stats: {
            originalLines,
            updatedLines,
            added: patch.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length,
            removed: patch.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')).length
          }
        };
      }
    }
  ];
}
