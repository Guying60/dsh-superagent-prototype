/**
 * Self-Loop (PDCA / EVC) Engine
 *
 * Fixes vs. the previous version:
 * - repair is now driven by STRUCTURED failure data (rule ids from all three tiers),
 *   not by an `iteration === 1 ? buggyCode : fixedCode` branch inside the scenario.
 *   A brain that cannot fix an unfixable rule will therefore genuinely fail to converge
 *   and escalate — which is what makes the escalation path real.
 * - failures accumulate across iterations, so progress is monotone and one pass can fix
 *   several independent defects at once.
 * - the optimizer is wired in: repeated failures refine the executor's prompt (idempotently).
 * - every iteration emits a structured record for the TUI.
 */
import {
  SelfLoopConfig,
  VerificationSpec,
  VerificationResult,
  HumanEscalationRequest,
  RuleFailure
} from '../types/index.js';
import { AgentRegistry } from '../agent/agent-registry.js';
import { VerificationEngine } from '../verification/verification-engine.js';
import { FeedbackOptimizer } from '../optimization/feedback-optimizer.js';

export interface SelfLoopIterationRecord {
  iteration: number;
  output: any;
  verification: VerificationResult;
  /** failures produced by THIS iteration only */
  failedRuleIds: string[];
  /** union of every failure seen so far in the loop */
  cumulativeFailureIds: string[];
  criticFeedback?: string;
  durationMs: number;
  score: number;
  passed: boolean;
  /** this revision scored lower than the best one seen so far */
  regression?: boolean;
  bestScoreSoFar?: number;
}

export interface SelfLoopExecutionResult {
  converged: boolean;
  totalIterations: number;
  finalOutput: any;
  finalVerification: VerificationResult;
  /** which iteration produced the delivered artifact */
  bestIteration?: number;
  /** a later revision scored worse than an earlier one */
  regression?: boolean;
  history: SelfLoopIterationRecord[];
  humanEscalation?: HumanEscalationRequest;
  accumulatedFailures: RuleFailure[];
}

export interface SelfLoopRunOptions {
  workflowExecutionId?: string;
  optimizer?: FeedbackOptimizer;
  /** agent whose prompt should be refined when `autoPromptRefine` is on */
  targetAgentId?: string;
  onIteration?: (record: SelfLoopIterationRecord) => void;
  onVerify?: (record: SelfLoopIterationRecord) => void;
}

export type LoopExecutor = (
  input: Record<string, any>,
  iteration: number,
  criticGuidance: string | undefined,
  failedRules: RuleFailure[],
  /** verification result of the previous iteration (undefined on the first) */
  previousVerification?: VerificationResult
) => Promise<any>;

/** Pull every attributable failure out of a verification result. */
export function collectFailures(v: VerificationResult): RuleFailure[] {
  const out: RuleFailure[] = [];

  for (const r of v.ruleResults) {
    if (!r.passed) {
      out.push({
        id: r.ruleId,
        ruleName: r.ruleName,
        message: r.message,
        severity: (r.severity as RuleFailure['severity']) ?? 'critical'
      });
    }
  }

  for (const review of v.auditorReviews ?? []) {
    if (review.approved) continue;
    for (const id of review.signals ?? []) {
      out.push({ id, ruleName: `auditor:${review.agentId}`, message: review.comments, severity: 'critical' });
    }
  }

  if (v.sandboxTestResult && !v.sandboxTestResult.passed) {
    // sandbox assertions are tagged with rule ids: "EDGE-001: ..."
    const ids = Array.from(v.sandboxTestResult.output.matchAll(/\b([A-Z]{2,6}-\d{3})\b/g)).map(m => m[1]);
    if (ids.length === 0) {
      out.push({ id: undefined, ruleName: 'sandbox', message: v.sandboxTestResult.output, severity: 'critical' });
    }
    for (const id of new Set(ids)) {
      out.push({ id, ruleName: 'sandbox assertion', message: v.sandboxTestResult.output, severity: 'critical' });
    }
  }

  for (const reason of v.blockingReasons ?? []) {
    const m = reason.match(/\b([A-Z]{2,6}-\d{3})\b/);
    if (m) out.push({ id: m[1], ruleName: 'blocking', message: reason, severity: 'critical' });
  }

  return dedupe(out);
}

function dedupe(list: RuleFailure[]): RuleFailure[] {
  const seen = new Set<string>();
  const out: RuleFailure[] = [];
  for (const f of list) {
    const key = f.id ?? `${f.ruleName}:${f.message.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

export class SelfLoopEngine {
  constructor(
    private agentRegistry: AgentRegistry,
    private verificationEngine: VerificationEngine
  ) {}

  public async runLoop(
    config: SelfLoopConfig,
    spec: VerificationSpec,
    seedInput: Record<string, any>,
    executor: LoopExecutor,
    options: SelfLoopRunOptions = {}
  ): Promise<SelfLoopExecutionResult> {
    const workflowExecutionId = options.workflowExecutionId ?? `loop-${Date.now().toString(36)}`;
    const history: SelfLoopIterationRecord[] = [];

    let accumulated: RuleFailure[] = [];
    let guidance: string | undefined;
    let converged = false;
    let finalOutput: any = null;
    let finalVerification: VerificationResult = { passed: false, score: 0, ruleResults: [] };
    let previousVerification: VerificationResult | undefined;
    let iterationInput: Record<string, any> = { ...seedInput };
    /**
     * Rule ids the executor itself declared it cannot satisfy (e.g. a requirement that
     * needs infrastructure the agent has no access to). This is domain knowledge the
     * engine cannot derive, and it is what decides whether "more budget" is a sane
     * recommendation or just a way to burn tokens.
     */
    const unresolvedRuleIds = new Set<string>();

    /**
     * A rewriting executor (an LLM, especially) can *regress*: it produces a worse
     * artifact than an earlier iteration. The loop therefore remembers the best-scoring
     * artifact and delivers that one, and it tells the executor when it regressed.
     */
    let bestOutput: any = undefined;
    let bestVerification: VerificationResult | undefined;
    let bestIteration = 0;
    let sawRegression = false;

    for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
      const started = Date.now();

      // 1. DO
      const output = await executor(iterationInput, iteration, guidance, accumulated, previousVerification);
      finalOutput = output;

      const declaredUnresolved = (output as { unresolved?: unknown } | null)?.unresolved;
      if (Array.isArray(declaredUnresolved)) {
        for (const id of declaredUnresolved) {
          if (typeof id === 'string' && id.length > 0) unresolvedRuleIds.add(id);
        }
      }

      // 2. CHECK
      const verification = await this.verificationEngine.verify(output, spec, iterationInput, { iteration });
      finalVerification = verification;
      previousVerification = verification;

      const bestBefore = bestVerification;
      const regressed = bestBefore !== undefined && verification.score < bestBefore.score;
      if (regressed) sawRegression = true;
      if (!bestBefore || verification.score > bestBefore.score) {
        bestOutput = output;
        bestVerification = verification;
        bestIteration = iteration;
      }

      const record: SelfLoopIterationRecord = {
        iteration,
        output,
        verification,
        failedRuleIds: verification.failedRuleIds ?? [],
        cumulativeFailureIds: [],
        criticFeedback: undefined,
        durationMs: Date.now() - started,
        score: verification.score,
        passed: verification.passed,
        regression: regressed,
        bestScoreSoFar: bestVerification?.score
      };

      // 3. EVAL
      const convergedNow = verification.passed && verification.score >= config.convergenceThreshold;
      if (convergedNow) {
        converged = true;
        history.push(record);
        options.onVerify?.(record);
        options.onIteration?.(record);
        break;
      }

      // 4. ACT — accumulate structure, then ask the critic to explain it
      accumulated = dedupe([...accumulated, ...collectFailures(verification)]);
      record.cumulativeFailureIds = accumulated.map(f => f.id).filter((x): x is string => !!x);

      const criticAgent = this.agentRegistry.get(config.criticAgentId);
      if (criticAgent) {
        const criticRes = await criticAgent.execute({
          taskId: `${workflowExecutionId}-critic-i${iteration}`,
          agentId: criticAgent.id,
          input: {
            goal: iterationInput.goal ?? 'satisfy the acceptance criteria',
            iteration,
            failedRules: accumulated,
            blockingReasons: verification.blockingReasons ?? [],
            sandboxOutput: verification.sandboxTestResult?.output ?? null,
            auditor: verification.auditorReviews ?? []
          },
          iteration
        });

        const out = criticRes.output;
        guidance =
          typeof out === 'string'
            ? out
            : (out?.feedback as string | undefined) ??
              criticRes.reasoning;
      } else {
        guidance =
          `Automatic diagnosis (no critic agent configured): ${accumulated
            .map(f => `${f.id ?? f.ruleName} → ${f.message}`)
            .join(' ; ')}`;
      }
      record.criticFeedback = guidance;

      verification.diagnosticFeedback = guidance;

      // 5. PLAN — one chance to sharpen the executor's standing instructions
      if (config.autoPromptRefine && options.optimizer && options.targetAgentId) {
        options.optimizer.autoRefinePrompt(options.targetAgentId, verification, iteration);
      }

      iterationInput = {
        ...iterationInput,
        previousAttempt: output,
        diagnosticFeedback: guidance,
        regressionWarning: regressed
          ? `The revision in iteration ${iteration} scored LOWER (${verification.score.toFixed(2)}) than the best so far ` +
            `(${(bestBefore?.score ?? 0).toFixed(2)}, iteration ${bestIteration}). Discard whatever caused the regression ` +
            `and keep the logic that already passed.`
          : undefined
      };

      history.push(record);
      options.onVerify?.(record);
      options.onIteration?.(record);
    }

    // Deliver the BEST artifact, not the most recent one: a late regression must never
    // silently downgrade what we hand to a reviewer.
    const deliveredOutput = converged ? finalOutput : (bestOutput !== undefined ? bestOutput : finalOutput);
    const deliveredVerification = converged ? finalVerification : (bestVerification ?? finalVerification);
    const deliveredIteration = converged ? history.length : bestIteration;

    let humanEscalation: HumanEscalationRequest | undefined;
    if (!converged) {
      const unresolved = Array.from(unresolvedRuleIds);
      const options = [
        'Retry with a doubled iteration budget',
        'Accept current draft and open a patch for human review',
        'Abort the task and roll back to the last checkpoint'
      ];

      // If the agent itself said "I cannot satisfy X", recommending another round would
      // just burn tokens to re-prove it. Recommend acceptance instead.
      const recommendedOptionIndex = unresolved.length > 0 ? 1 : 0;

      humanEscalation = {
        id: `escalation-${Date.now().toString(36)}`,
        workflowExecutionId,
        nodeId: config.targetNodeId,
        reason:
          `Self-Loop did not converge after ${config.maxIterations} iteration(s). ` +
          `Best score ${(deliveredVerification.score * 100).toFixed(1)}% (iteration ${deliveredIteration}). ` +
          `Still blocking: ${(deliveredVerification.blockingReasons ?? []).slice(0, 3).join(' | ') || 'unknown'}.` +
          (sawRegression
            ? ` The last revision regressed, so the best artifact is attached rather than the most recent one.`
            : '') +
          (unresolved.length > 0
            ? ` The agent reported that it cannot satisfy ${unresolved.join(', ')} — more iterations will not change that.`
            : ' The last iterations were still making progress, so a larger budget may converge.'),
        question: 'The agent could not satisfy every acceptance rule within the iteration budget. How should we proceed?',
        recommendedAction: options[recommendedOptionIndex],
        recommendedOptionIndex,
        options,
        contextSnapshot: {
          bestScore: deliveredVerification.score,
          bestIteration: deliveredIteration,
          regression: sawRegression,
          blockingReasons: deliveredVerification.blockingReasons ?? [],
          failedRuleIds: deliveredVerification.failedRuleIds ?? [],
          unresolvedRuleIds: unresolved
        },
        createdAt: Date.now()
      };
    }

    return {
      converged,
      totalIterations: history.length,
      finalOutput: deliveredOutput,
      finalVerification: deliveredVerification,
      bestIteration: deliveredIteration,
      regression: sawRegression,
      history,
      humanEscalation,
      accumulatedFailures: accumulated
    };
  }
}
