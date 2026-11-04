/**
 * Multi-Tier Verification Engine
 * Capabilities:
 * 1. Deterministic Rule & Schema Validation
 * 2. Automated Sandbox Execution Test
 * 3. Multi-Agent Cross-Validation & Consensus Voting
 * 4. Composite Confidence Scoring
 */
import { 
  VerificationSpec, 
  VerificationResult, 
  ToolDefinition 
} from '../types/index.js';
import { AgentRegistry } from '../agent/agent-registry.js';
import { ToolRegistry } from '../tools/tool-registry.js';

export class VerificationEngine {
  private agentRegistry: AgentRegistry;
  private toolRegistry: ToolRegistry;

  constructor(agentRegistry: AgentRegistry, toolRegistry: ToolRegistry) {
    this.agentRegistry = agentRegistry;
    this.toolRegistry = toolRegistry;
  }

  /**
   * Run full multi-tier verification pipeline
   */
  public async verify(
    output: any, 
    spec: VerificationSpec, 
    context: Record<string, any> = {}
  ): Promise<VerificationResult> {
    const ruleResults: Array<{ ruleName: string; passed: boolean; message: string; score: number }> = [];

    // Tier 1: Deterministic Rule Checks
    let totalRuleScore = 0;
    if (spec.rules && spec.rules.length > 0) {
      for (const rule of spec.rules) {
        try {
          const res = rule.check(output, context);
          ruleResults.push({
            ruleName: rule.name,
            passed: res.passed,
            message: res.message,
            score: res.score
          });
          totalRuleScore += res.score;
        } catch (err: any) {
          ruleResults.push({
            ruleName: rule.name,
            passed: false,
            message: `Check execution threw exception: ${err.message}`,
            score: 0
          });
        }
      }
    } else {
      totalRuleScore = 1.0;
    }
    const ruleAvg = spec.rules && spec.rules.length > 0 ? totalRuleScore / spec.rules.length : 1.0;

    // Tier 2: Sandbox Test Execution (if configured)
    let sandboxResult: { passed: boolean; output: string; exitCode: number } | undefined;
    let sandboxScore = 1.0;

    if (spec.executableSandboxCheck) {
      try {
        const testRunner = this.toolRegistry.get('test_runner');
        if (testRunner) {
          const testCode = spec.executableSandboxCheck.testScriptGenerator 
            ? spec.executableSandboxCheck.testScriptGenerator(output)
            : context.testCode || '';
          
          const sourceCode = typeof output === 'string' ? output : (output.code || output.solution || JSON.stringify(output));
          
          const runnerRes = await testRunner.handler({
            testCode,
            sourceCode
          });

          const passed = runnerRes.success;
          sandboxScore = passed ? 1.0 : (runnerRes.report?.passed || 0) / Math.max(1, runnerRes.report?.total || 1);
          sandboxResult = {
            passed,
            output: passed ? `All ${runnerRes.report?.total || 1} test assertions passed` : `Failed assertions: ${(runnerRes.report?.errors || []).join('; ')}`,
            exitCode: passed ? 0 : 1
          };
        }
      } catch (err: any) {
        sandboxScore = 0;
        sandboxResult = {
          passed: false,
          output: `Sandbox test error: ${err.message}`,
          exitCode: 1
        };
      }
    }

    // Tier 3: Multi-Agent Cross-Validation & Consensus Voting
    let auditorReviews: Array<{ agentId: string; approved: boolean; comments: string; confidence: number }> = [];
    let agentScore = 1.0;

    if (spec.multiAgentVoting && spec.multiAgentVoting.auditorAgentIds.length > 0) {
      let approvedCount = 0;
      const totalAuditors = spec.multiAgentVoting.auditorAgentIds.length;

      for (const auditorId of spec.multiAgentVoting.auditorAgentIds) {
        const auditor = this.agentRegistry.get(auditorId);
        if (!auditor) continue;

        const auditRes = await auditor.execute({
          taskId: `audit-${Date.now()}-${auditorId}`,
          agentId: auditorId,
          input: {
            targetOutput: output,
            context
          }
        }, async (req, agent) => {
          // Auditor evaluation logic
          let approved = true;
          let comments = 'Review passed with no blockers.';
          let conf = 0.90;

          const targetStr = typeof output === 'string' ? output : JSON.stringify(output);

          if (agent.role === 'security_auditor') {
            if (/eval|exec|password|secret/i.test(targetStr)) {
              approved = false;
              comments = 'Security Auditor flagged risky keywords (eval/secret).';
              conf = 0.85;
            }
          } else if (agent.role === 'code_reviewer') {
            if (targetStr.length < 20) {
              approved = false;
              comments = 'Code Reviewer flagged empty or insufficient implementation.';
              conf = 0.95;
            }
          }

          return {
            output: { approved, comments },
            reasoning: comments,
            confidence: conf
          };
        });

        const isApproved = auditRes.output?.approved !== false && auditRes.success;
        if (isApproved) approvedCount++;

        auditorReviews.push({
          agentId: auditorId,
          approved: isApproved,
          comments: auditRes.output?.comments || auditRes.reasoning,
          confidence: auditRes.confidence
        });
      }

      const passRatio = totalAuditors > 0 ? approvedCount / totalAuditors : 1.0;
      agentScore = passRatio;
    }

    // Composite Score Calculation
    // Weighted: Rules (30%) + Sandbox Tests (40%) + Multi-Agent Consensus (30%)
    let compositeScore = 0;
    if (spec.executableSandboxCheck && spec.multiAgentVoting) {
      compositeScore = ruleAvg * 0.3 + sandboxScore * 0.4 + agentScore * 0.3;
    } else if (spec.executableSandboxCheck) {
      compositeScore = ruleAvg * 0.4 + sandboxScore * 0.6;
    } else if (spec.multiAgentVoting) {
      compositeScore = ruleAvg * 0.5 + agentScore * 0.5;
    } else {
      compositeScore = ruleAvg;
    }

    compositeScore = Number(compositeScore.toFixed(3));
    const passed = compositeScore >= spec.confidenceThreshold && 
      (!sandboxResult || sandboxResult.passed) &&
      ruleResults.every(r => r.passed);

    return {
      passed,
      score: compositeScore,
      ruleResults,
      auditorReviews: auditorReviews.length > 0 ? auditorReviews : undefined,
      sandboxTestResult: sandboxResult
    };
  }
}
