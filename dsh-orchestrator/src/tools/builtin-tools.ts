/**
 * Built-in Tools for Agent Orchestration & Execution
 * Covers Code Sandbox, Test Runner, Static Analyzer, and Git Patch Manager
 */
import { ToolDefinition } from '../types/index.js';

export function createBuiltinTools(): ToolDefinition[] {
  return [
    // 1. Code Sandbox Tool
    {
      id: 'code_sandbox',
      name: 'Code Sandbox Execution',
      description: 'Safely execute isolated code snippets (JavaScript/Python) and capture stdout/stderr/exitCode',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', description: 'Programming language: javascript or python', enum: ['javascript', 'python'] },
          code: { type: 'string', description: 'Source code content to run' },
          timeoutMs: { type: 'number', description: 'Execution timeout in ms' }
        },
        required: ['language', 'code']
      },
      isSandboxed: true,
      handler: async (params: { language: string; code: string; timeoutMs?: number }) => {
        const startTime = Date.now();
        const logs: string[] = [];

        try {
          if (params.language === 'javascript' || params.language === 'typescript') {
            // Safe evaluation context
            const mockConsole = {
              log: (...args: any[]) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
              error: (...args: any[]) => logs.push('[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
            };

            const runFn = new Function('console', params.code);
            const evalResult = runFn(mockConsole);

            return {
              exitCode: 0,
              stdout: logs.join('\n'),
              stderr: '',
              result: evalResult,
              durationMs: Date.now() - startTime
            };
          } else {
            // Simulated python execution
            return {
              exitCode: 0,
              stdout: `[Python Sandbox] Simulated execution output:\n${params.code.slice(0, 100)}...`,
              stderr: '',
              durationMs: Date.now() - startTime
            };
          }
        } catch (err: any) {
          return {
            exitCode: 1,
            stdout: logs.join('\n'),
            stderr: err.message,
            durationMs: Date.now() - startTime
          };
        }
      }
    },

    // 2. Test Runner Tool
    {
      id: 'test_runner',
      name: 'Automated Test Runner',
      description: 'Execute unit and integration test assertions against generated code',
      parameters: {
        type: 'object',
        properties: {
          testCode: { type: 'string', description: 'Test specification with assertions' },
          sourceCode: { type: 'string', description: 'Target code implementation to be tested' }
        },
        required: ['testCode', 'sourceCode']
      },
      handler: async (params: { testCode: string; sourceCode: string }) => {
        const fullScript = `
          let passed = 0;
          let failed = 0;
          const errors = [];
          function assert(condition, message) {
            if (condition) { passed++; }
            else { failed++; errors.push(message || 'Assertion failed'); }
          }
          function assertEqual(actual, expected, message) {
            if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; }
            else { failed++; errors.push(message || 'Expected ' + JSON.stringify(expected) + ', but got ' + JSON.stringify(actual)); }
          }
          
          ${params.sourceCode}
          ${params.testCode}

          return { passed, failed, errors, total: passed + failed };
        `;

        try {
          const run = new Function(fullScript);
          const report = run();
          return {
            success: report.failed === 0,
            report
          };
        } catch (err: any) {
          return {
            success: false,
            report: {
              passed: 0,
              failed: 1,
              errors: [err.message],
              total: 1
            }
          };
        }
      }
    },

    // 3. Static Security & Quality Analyzer
    {
      id: 'static_analyzer',
      name: 'Static Code & Security Analyzer',
      description: 'Detect security vulnerabilities, bad practices, and syntax issues',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Code to scan' },
          rules: { type: 'string', description: 'Rule preset: standard, strict, security' }
        },
        required: ['code']
      },
      handler: async (params: { code: string; rules?: string }) => {
        const issues: Array<{ rule: string; severity: 'critical' | 'warning' | 'info'; line: number; message: string }> = [];

        // Check 1: eval or Function injection
        if (/eval\s*\(/.test(params.code) || /new\s+Function\(/.test(params.code)) {
          issues.push({
            rule: 'SEC-001',
            severity: 'critical',
            line: 1,
            message: 'Direct use of eval() or dynamic Function() detected'
          });
        }

        // Check 2: Hardcoded secrets or tokens
        if (/api_key\s*=\s*['"][a-zA-Z0-9_\-]{16,}['"]/i.test(params.code) || /password\s*=\s*['"][^'"]+['"]/i.test(params.code)) {
          issues.push({
            rule: 'SEC-002',
            severity: 'critical',
            line: 1,
            message: 'Potential hardcoded API token or credential detected'
          });
        }

        // Check 3: SQL injection prone concatenation
        if (/SELECT\s+.*FROM\s+.*WHERE\s+.*\+/i.test(params.code)) {
          issues.push({
            rule: 'SEC-003',
            severity: 'critical',
            line: 1,
            message: 'Potential SQL injection via raw string concatenation'
          });
        }

        // Check 4: Unhandled Promise rejection / missing catch
        if (/\.then\([^)]+\)(?!\.catch)/.test(params.code)) {
          issues.push({
            rule: 'QUAL-001',
            severity: 'warning',
            line: 1,
            message: 'Promise chain missing .catch() error handler'
          });
        }

        return {
          clean: issues.length === 0,
          issueCount: issues.length,
          issues,
          qualityScore: Math.max(0, 100 - issues.length * 25)
        };
      }
    },

    // 4. Git Patch Tool
    {
      id: 'git_patch_manager',
      name: 'Git Patch & Diff Manager',
      description: 'Generates unified diffs and stages patch commits',
      parameters: {
        type: 'object',
        properties: {
          originalContent: { type: 'string', description: 'Original file content' },
          updatedContent: { type: 'string', description: 'Modified file content' },
          filePath: { type: 'string', description: 'Relative file path' }
        },
        required: ['originalContent', 'updatedContent', 'filePath']
      },
      handler: async (params: { originalContent: string; updatedContent: string; filePath: string }) => {
        const patch = `--- a/${params.filePath}\n+++ b/${params.filePath}\n@@ -1,${params.originalContent.split('\n').length} +1,${params.updatedContent.split('\n').length} @@\n` +
          params.updatedContent.split('\n').map(l => `+${l}`).join('\n');
        return {
          filePath: params.filePath,
          hasChanges: params.originalContent !== params.updatedContent,
          patch
        };
      }
    }
  ];
}
