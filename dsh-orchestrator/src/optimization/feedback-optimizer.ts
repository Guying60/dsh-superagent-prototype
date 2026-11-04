/**
 * Feedback & Self-Optimization
 *
 * Fixes vs. the previous version:
 * - every method here is now invoked by the running system (previously the class was
 *   instantiated by the scenario and then never called — the demo printed "0 adjustments")
 * - prompt refinement is idempotent: re-applying the same failure does not keep appending
 *   identical guardrails (the old code grew the system prompt without bound)
 * - tool reliability is read from real ToolRegistry metrics instead of manual bookkeeping
 */
import { AgentRegistry } from '../agent/agent-registry.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { VerificationResult, WorkflowNode, RuleFailure } from '../types/index.js';

export interface PromptOptimizationRecord {
  agentId: string;
  addedGuardrails: string[];
  appliedFix: string;
  timestamp: number;
  iteration?: number;
}

const GUARDRAIL_MARK = '[AUTOMATIC SELF-OPTIMIZATION GUARDRAILS]';

export class FeedbackOptimizer {
  private promptHistory: PromptOptimizationRecord[] = [];

  constructor(
    private agentRegistry: AgentRegistry,
    private toolRegistry?: ToolRegistry
  ) {}

  /**
   * Append structured negative constraints derived from real verification failures.
   * Idempotent: a guardrail already present in the prompt is not appended again.
   */
  public autoRefinePrompt(
    agentId: string,
    verification: VerificationResult,
    iteration?: number
  ): PromptOptimizationRecord | null {
    const agent = this.agentRegistry.get(agentId);
    if (!agent) return null;

    const failures: RuleFailure[] = [
      ...verification.ruleResults
        .filter(r => !r.passed)
        .map(r => ({ id: r.ruleId, ruleName: r.ruleName, message: r.message, severity: r.severity as any })),
      ...(verification.auditorReviews ?? [])
        .filter(r => !r.approved)
        .flatMap(r => (r.signals ?? []).map(id => ({ id, ruleName: `auditor:${r.agentId}`, message: r.comments })))
    ];

    if (!verification.sandboxTestResult?.passed && verification.sandboxTestResult) {
      failures.push({
        id: verification.sandboxTestResult.output.match(/\b([A-Z]{2,6}-\d{3})\b/)?.[1],
        ruleName: 'sandbox',
        message: verification.sandboxTestResult.output
      });
    }

    if (failures.length === 0) return null;

    const current = agent.profile.systemPrompt;
    const additions: string[] = [];

    for (const f of failures) {
      const key = f.id ?? f.ruleName;
      const line = `- MUST satisfy ${key}: ${f.message} (severity: ${f.severity ?? 'critical'})`;
      if (!current.includes(line) && !additions.includes(line)) additions.push(line);
    }

    if (additions.length === 0) return null;

    const marker = current.includes(GUARDRAIL_MARK)
      ? ''
      : `\n\n${GUARDRAIL_MARK}`;
    agent.updateSystemPrompt(`${current}${marker}\n${additions.join('\n')}`);

    const record: PromptOptimizationRecord = {
      agentId,
      addedGuardrails: additions,
      appliedFix: additions.map(a => a.replace(/^- /, '')).join('; '),
      timestamp: Date.now(),
      iteration
    };
    this.promptHistory.push(record);
    return record;
  }

  /** Mean reported reliability of every tool that has actually been called. */
  public getToolReliability(): Array<{ toolId: string; reliability: number; calls: number }> {
    if (!this.toolRegistry) return [];
    return this.toolRegistry
      .getMetrics()
      .filter(m => m.calls > 0)
      .map(m => ({ toolId: m.toolId, reliability: m.successes / m.calls, calls: m.calls }))
      .sort((a, b) => b.calls - a.calls);
  }

  /** Path self-healing: re-route a node to the best alternative agent for a capability. */
  public healWorkflowNode(node: WorkflowNode, requiredCapability: string): { healed: boolean; from?: string; to?: string } {
    if (node.type !== 'agent') return { healed: false };

    const fallback = this.agentRegistry.findBestAgent(requiredCapability, 0.7);
    if (fallback && fallback.id !== node.agentId) {
      const from = node.agentId;
      node.agentId = fallback.id;
      return { healed: true, from, to: fallback.id };
    }
    return { healed: false };
  }

  public getOptimizationHistory(): PromptOptimizationRecord[] {
    return [...this.promptHistory];
  }
}
