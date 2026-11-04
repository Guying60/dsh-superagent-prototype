/**
 * Multi-Tier Verification Engine
 *
 * Fixes vs. the previous version:
 * - Tier-3 had no discriminating power: the reviewer only rejected artifacts shorter
 *   than 20 characters and the auditor only matched /eval|exec|password|secret/. Any
 *   realistic code therefore scored a guaranteed 2/2 consensus, making the 30% weight a
 *   constant. Each auditor now emits *attributable signals* (rule ids) that a repair
 *   strategy can act on, and those signals feed back into the self-loop.
 * - Tier-2 goes through ToolRegistry.invoke (deadline + metrics) instead of calling
 *   `handler` directly and silently ignoring `expectedExitCode` / `timeoutMs`.
 * - per-tier results are returned for the TUI, and `passed` is defined by explicit
 *   blocking reasons rather than a single composite threshold.
 */
import { VerificationSpec, VerificationResult, VerificationTierResult } from '../types/index.js';
import { AgentRegistry } from '../agent/agent-registry.js';
import { ToolRegistry } from '../tools/tool-registry.js';

export interface AuditSignal {
  /** rule id, e.g. REV-001 — used as a repair key downstream */
  ruleId: string;
  message: string;
}

export interface AuditVerdict {
  approved: boolean;
  comments: string;
  signals: AuditSignal[];
  confidence: number;
}

export type AuditChecker = (
  target: string,
  context: Record<string, any>
) => AuditVerdict;

const has = (re: RegExp, text: string) => re.test(text);

/**
 * Deterministic audit heuristics.
 * These are exported so an audit brain can reuse exactly the same semantics — the
 * numbers a judge sees are produced by one implementation, not two that disagree.
 */
export const AUDIT_CHECKS: Record<string, AuditChecker> = {
  security_auditor: (target, _ctx) => {
    const signals: AuditSignal[] = [];

    if (has(/(^|[^.\w])eval\s*\(/, target) || has(/new\s+Function\s*\(/, target)) {
      signals.push({ ruleId: 'SEC-001', message: 'dynamic code execution (eval / new Function) is forbidden' });
    }
    if (has(/(api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/i, target)) {
      signals.push({ ruleId: 'SEC-002', message: 'hardcoded credential literal found' });
    }
    if (has(/constructor\s*\.\s*constructor|__proto__\s*\[/, target)) {
      signals.push({ ruleId: 'SEC-004', message: 'sandbox-escape pattern detected' });
    }
    // numeric API without NaN / Infinity hardening on the token argument
    if (has(/consume\s*\(/, target) && !has(/isFinite\(\s*tokens\s*\)/, target)) {
      signals.push({ ruleId: 'SEC-003', message: 'consume() never validates Number.isFinite(tokens) — NaN/Infinity can corrupt the bucket' });
    }

    const approved = signals.length === 0;
    return {
      approved,
      comments: approved
        ? 'Zero-trust review passed: no injection, credential or numeric-hardening findings.'
        : `Rejected with ${signals.length} signal(s): ${signals.map(s => s.ruleId).join(', ')}.`,
      signals,
      confidence: approved ? 0.93 : 0.88
    };
  },

  code_reviewer: (target, _ctx) => {
    const signals: AuditSignal[] = [];

    if (target.length < 60) {
      signals.push({ ruleId: 'REV-003', message: 'artifact is too small to be a credible implementation' });
    }
    if (has(/\bTODO\b|\bFIXME\b|\bXXX\b/, target)) {
      signals.push({ ruleId: 'REV-002', message: 'unresolved TODO/FIXME marker left behind' });
    }
    if (!has(/\/\/[^\n]*(invariant|不变量|guarantee|precondition)/i, target) && !has(/\/\*[\s\S]*?(invariant|guarantee|不变量)/i, target)) {
      signals.push({ ruleId: 'REV-001', message: 'state invariants are not documented next to the implementation' });
    }

    const approved = signals.length === 0;
    return {
      approved,
      comments: approved
        ? 'Maintainability review passed: invariants documented, no dangling markers.'
        : `Changes requested: ${signals.map(s => `${s.ruleId} (${s.message})`).join('; ')}.`,
      signals,
      confidence: approved ? 0.9 : 0.86
    };
  }
};

function genericAuditor(role: string): AuditChecker {
  return (target) => {
    const approved = target.trim().length > 0;
    return {
      approved,
      comments: approved ? `[${role}] no blocking findings.` : `[${role}] empty artifact.`,
      signals: approved ? [] : [{ ruleId: 'GEN-001', message: 'empty artifact' }],
      confidence: 0.6
    };
  };
}

export function auditFor(role: string): AuditChecker {
  return AUDIT_CHECKS[role] ?? genericAuditor(role);
}

const RULE_ID_RE = /\b([A-Z]{2,6}-\d{3})\b/g;

export function extractRuleIds(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(RULE_ID_RE)) found.add(m[1]);
  return Array.from(found);
}

function artifactToString(output: any): string {
  if (typeof output === 'string') return output;
  if (output == null) return '';
  return String(output.code ?? output.solution ?? output.artifact ?? JSON.stringify(output, null, 2));
}

export class VerificationEngine {
  constructor(
    private agentRegistry: AgentRegistry,
    private toolRegistry: ToolRegistry
  ) {}

  public async verify(
    output: any,
    spec: VerificationSpec,
    context: Record<string, any> = {},
    opts: { iteration?: number } = {}
  ): Promise<VerificationResult> {
    const tiers: VerificationTierResult[] = [];
    const blocking: string[] = [];
    const artifact = artifactToString(output);

    // ------------------------------------------------------------- Tier 1
    const ruleResults: VerificationResult['ruleResults'] = [];
    let totalRuleScore = 0;

    for (const rule of spec.rules ?? []) {
      try {
        const res = rule.check(output, context);
        ruleResults.push({
          ruleId: rule.id,
          ruleName: rule.name,
          passed: res.passed,
          message: res.message,
          score: res.score,
          severity: rule.severity ?? 'critical'
        });
        totalRuleScore += res.score;
      } catch (err: any) {
        ruleResults.push({
          ruleId: rule.id,
          ruleName: rule.name,
          passed: false,
          message: `rule threw: ${err?.message ?? String(err)}`,
          score: 0,
          severity: rule.severity ?? 'critical'
        });
      }
    }

    const ruleCount = spec.rules?.length ?? 0;
    const ruleAvg = ruleCount > 0 ? totalRuleScore / ruleCount : 1;
    const failedRules = ruleResults.filter(r => !r.passed);
    const criticalFailed = failedRules.filter(r => (r.severity ?? 'critical') === 'critical');

    for (const r of criticalFailed) blocking.push(`Tier-1 ${r.ruleId ?? r.ruleName}: ${r.message}`);

    tiers.push({
      tier: 'Tier-1',
      name: `${ruleCount - failedRules.length}/${ruleCount} rules passed`,
      passed: criticalFailed.length === 0,
      score: ruleAvg,
      detail: failedRules.length === 0
        ? 'all deterministic rules satisfied'
        : failedRules.map(r => `${r.ruleId ?? r.ruleName} ✗ ${r.message}`).join(' | ')
    });

    // ------------------------------------------------------------- Tier 2
    let sandboxScore = 1;
    let sandboxResult: VerificationResult['sandboxTestResult'];
    const sandboxFailedRuleIds: string[] = [];

    if (spec.executableSandboxCheck) {
      const gen = spec.executableSandboxCheck.testScriptGenerator;
      const testCode = gen ? gen(output, context) : (context.testCode ?? '');

      if (!testCode) {
        sandboxScore = 0;
        sandboxResult = { passed: false, output: 'no test script could be produced (testScriptGenerator returned empty)', exitCode: 2 };
        blocking.push('Tier-2: empty test suite');
      } else {
        try {
          const runnerRes: any = await this.toolRegistry.invoke(
            'test_runner',
            { testCode, sourceCode: artifact },
            { timeoutMs: spec.executableSandboxCheck.timeoutMs ?? 4000 }
          );

          const report = runnerRes?.report ?? { passed: 0, failed: 1, errors: ['malformed runner output'], total: 1 };
          const passedAll = runnerRes?.success === true;
          sandboxScore = (report.total ?? 0) > 0 ? (report.passed ?? 0) / report.total : 0;

          const errorText = (report.errors ?? []).join('\n');
          for (const id of extractRuleIds(errorText)) if (!sandboxFailedRuleIds.includes(id)) sandboxFailedRuleIds.push(id);

          sandboxResult = {
            passed: passedAll,
            output: passedAll
              ? `all ${report.total} assertion(s) passed`
              : `${report.failed}/${report.total} assertion(s) failed: ${errorText.replace(/\n/g, ' ; ')}`,
            exitCode: passedAll ? 0 : 1,
            passedCount: report.passed,
            totalCount: report.total
          };

          if (!passedAll) blocking.push(`Tier-2: ${report.failed}/${report.total} assertions failed`);
        } catch (err: any) {
          sandboxScore = 0;
          sandboxResult = { passed: false, output: `sandbox error: ${err?.message ?? String(err)}`, exitCode: 1 };
          blocking.push(`Tier-2: sandbox failed to run (${err?.message ?? String(err)})`);
        }
      }

      tiers.push({
        tier: 'Tier-2',
        name: sandboxResult?.passed
          ? `${sandboxResult.totalCount ?? 0}/${sandboxResult.totalCount ?? 0} assertions`
          : `${sandboxResult?.passedCount ?? 0}/${sandboxResult?.totalCount ?? 0} assertions`,
        passed: sandboxResult?.passed === true,
        score: sandboxScore,
        detail: sandboxResult?.output ?? ''
      });
    }

    // ------------------------------------------------------------- Tier 3
    let consensusScore = 1;
    let auditorReviews: VerificationResult['auditorReviews'];

    if (spec.multiAgentVoting && spec.multiAgentVoting.auditorAgentIds.length > 0) {
      const ids = spec.multiAgentVoting.auditorAgentIds;
      auditorReviews = [];
      let approvedCount = 0;

      for (const auditorId of ids) {
        const auditor = this.agentRegistry.get(auditorId);
        if (!auditor) {
          auditorReviews.push({
            agentId: auditorId,
            approved: false,
            comments: 'auditor is not registered in the registry',
            confidence: 0
          });
          continue;
        }

        const execution = await auditor.execute({
          taskId: `audit-${Date.now().toString(36)}-${auditorId}`,
          agentId: auditorId,
          input: { auditTarget: artifact, context, iteration: opts.iteration },
          iteration: opts.iteration
        });

        let verdict = execution.output as Partial<AuditVerdict> | undefined;

        // A brain that does not implement an audit falls back to the deterministic checks.
        if (!verdict || typeof (verdict as any).approved !== 'boolean') {
          verdict = auditFor(auditor.role)(artifact, context);
        }

        const signals = (verdict.signals ?? []).map(s => s.ruleId);
        const approved = verdict.approved === true;

        if (approved) approvedCount++;
        else blocking.push(`Tier-3 ${auditorId}: ${signals.join(', ') || 'rejected without signals'}`);

        auditorReviews.push({
          agentId: auditorId,
          approved,
          comments: verdict.comments ?? execution.reasoning,
          confidence: verdict.confidence ?? execution.confidence,
          signals
        });
      }

      const ratio = ids.length > 0 ? approvedCount / ids.length : 1;
      consensusScore = ratio;
      const minRatio = spec.multiAgentVoting.minPassRatio;
      if (ratio < minRatio) blocking.push(`Tier-3: consensus ${approvedCount}/${ids.length} below required ${(minRatio * 100).toFixed(0)}%`);

      tiers.push({
        tier: 'Tier-3',
        name: `${approvedCount}/${ids.length} auditors approved`,
        passed: ratio >= minRatio,
        score: ratio,
        detail: auditorReviews.map(r => `${r.agentId}: ${r.approved ? '✓' : '✗'} ${r.comments}`).join(' | ')
      });
    }

    // -------------------------------------------------------- composite score
    let score: number;
    const hasSandbox = !!spec.executableSandboxCheck;
    const hasVoting = !!spec.multiAgentVoting;

    if (hasSandbox && hasVoting) score = ruleAvg * 0.3 + sandboxScore * 0.4 + consensusScore * 0.3;
    else if (hasSandbox) score = ruleAvg * 0.4 + sandboxScore * 0.6;
    else if (hasVoting) score = ruleAvg * 0.5 + consensusScore * 0.5;
    else score = ruleAvg;

    score = Number(score.toFixed(3));

    if (score < spec.confidenceThreshold) {
      blocking.push(`composite score ${score.toFixed(3)} < threshold ${spec.confidenceThreshold.toFixed(2)}`);
    }

    const passed =
      criticalFailed.length === 0 &&
      (!sandboxResult || sandboxResult.passed) &&
      (!auditorReviews || consensusScore >= (spec.multiAgentVoting?.minPassRatio ?? 1)) &&
      score >= spec.confidenceThreshold;

    const result: VerificationResult = {
      passed,
      score,
      ruleResults,
      auditorReviews: auditorReviews && auditorReviews.length > 0 ? auditorReviews : undefined,
      sandboxTestResult: sandboxResult,
      tiers,
      blockingReasons: blocking,
      failedRuleIds: Array.from(
        new Set([
          ...failedRules.map(r => r.ruleId).filter((x): x is string => !!x),
          ...sandboxFailedRuleIds,
          ...(auditorReviews ?? []).flatMap(r => r.signals ?? [])
        ])
      )
    };

    return result;
  }
}
