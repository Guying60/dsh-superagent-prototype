/**
 * Feedback & Self-Optimization Engine
 * Features:
 * 1. Prompt Auto-Refinement based on failure diagnostics
 * 2. Tool Selection & Ranking Adaptation based on call history
 * 3. Workflow Path Self-Healing & Alternative Routing
 */
import { AgentRegistry } from '../agent/agent-registry.js';
import { VerificationResult, WorkflowNode, WorkflowDefinition } from '../types/index.js';

export interface PromptOptimizationRecord {
  agentId: string;
  originalPrompt: string;
  refinedPrompt: string;
  appliedFix: string;
  timestamp: number;
}

export class FeedbackOptimizer {
  private agentRegistry: AgentRegistry;
  private promptHistory: PromptOptimizationRecord[] = [];
  private toolSuccessStats: Map<string, { calls: number; successes: number }> = new Map();

  constructor(agentRegistry: AgentRegistry) {
    this.agentRegistry = agentRegistry;
  }

  /**
   * 1. Prompt Auto-Refinement
   * Enhances an agent's system prompt with guardrails derived from verification failures
   */
  public autoRefinePrompt(
    agentId: string, 
    verification: VerificationResult
  ): PromptOptimizationRecord | null {
    const agent = this.agentRegistry.get(agentId);
    if (!agent) return null;

    const failedRules = verification.ruleResults.filter(r => !r.passed);
    const sandboxErrors = verification.sandboxTestResult?.output || '';
    
    if (failedRules.length === 0 && !sandboxErrors) return null;

    const originalPrompt = agent.profile.systemPrompt;
    const additions: string[] = [];

    for (const rule of failedRules) {
      additions.push(`- CRITICAL REQUIREMENT: Avoid failure '${rule.ruleName}'. Requirement: ${rule.message}`);
    }

    if (sandboxErrors) {
      additions.push(`- TESTING GUARDRAIL: Previous attempt failed tests with error: ${sandboxErrors}. Ensure code strictly satisfies all assertion types and edge conditions.`);
    }

    const refinedPrompt = `${originalPrompt}\n\n[AUTOMATIC SELF-OPTIMIZATION GUARDRAILS]\n${additions.join('\n')}`;
    agent.updateSystemPrompt(refinedPrompt);

    const record: PromptOptimizationRecord = {
      agentId,
      originalPrompt,
      refinedPrompt,
      appliedFix: additions.join('; '),
      timestamp: Date.now()
    };

    this.promptHistory.push(record);
    return record;
  }

  /**
   * 2. Tool Selection Adaptation
   * Records tool invocation success and computes reliability scores
   */
  public recordToolCall(toolId: string, success: boolean): void {
    const stats = this.toolSuccessStats.get(toolId) || { calls: 0, successes: 0 };
    stats.calls++;
    if (success) stats.successes++;
    this.toolSuccessStats.set(toolId, stats);
  }

  public getToolReliabilityScore(toolId: string): number {
    const stats = this.toolSuccessStats.get(toolId);
    if (!stats || stats.calls === 0) return 1.0; // default optimism
    return stats.successes / stats.calls;
  }

  /**
   * 3. Workflow Path Self-Healing
   * Re-routes failed node to alternative candidate agent
   */
  public healWorkflowNode(node: WorkflowNode, requiredCapability: string): boolean {
    if (node.type !== 'agent') return false;
    
    const fallbackAgent = this.agentRegistry.findBestAgent(requiredCapability, 0.7);
    if (fallbackAgent && fallbackAgent.id !== node.agentId) {
      const prev = node.agentId;
      node.agentId = fallbackAgent.id;
      return true;
    }
    return false;
  }

  public getOptimizationHistory(): PromptOptimizationRecord[] {
    return [...this.promptHistory];
  }
}
