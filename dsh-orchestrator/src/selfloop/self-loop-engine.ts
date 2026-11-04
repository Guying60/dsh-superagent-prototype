/**
 * Self-Loop & Iterative Optimization Engine
 * Implements the PDCA (Plan-Do-Check-Act) and Execution-Verification-Correction (EVC) Loop
 */
import { 
  SelfLoopConfig, 
  VerificationSpec, 
  VerificationResult, 
  HumanEscalationRequest, 
  AgentExecutionResult 
} from '../types/index.js';
import { AgentRegistry } from '../agent/agent-registry.js';
import { VerificationEngine } from '../verification/verification-engine.js';

export interface SelfLoopIterationRecord {
  iteration: number;
  input: any;
  output: any;
  verification: VerificationResult;
  criticFeedback?: string;
  durationMs: number;
}

export interface SelfLoopExecutionResult {
  converged: boolean;
  totalIterations: number;
  finalOutput: any;
  finalVerification: VerificationResult;
  history: SelfLoopIterationRecord[];
  humanEscalation?: HumanEscalationRequest;
}

export class SelfLoopEngine {
  private agentRegistry: AgentRegistry;
  private verificationEngine: VerificationEngine;

  constructor(agentRegistry: AgentRegistry, verificationEngine: VerificationEngine) {
    this.agentRegistry = agentRegistry;
    this.verificationEngine = verificationEngine;
  }

  /**
   * Run the Self-Loop optimization cycle on a target task
   */
  public async runLoop(
    config: SelfLoopConfig,
    verificationSpec: VerificationSpec,
    initialInput: Record<string, any>,
    targetExecutor: (input: Record<string, any>, iteration: number, criticGuidance?: string) => Promise<any>,
    workflowExecutionId: string = 'loop-exec'
  ): Promise<SelfLoopExecutionResult> {
    const history: SelfLoopIterationRecord[] = [];
    let currentInput = { ...initialInput };
    let criticGuidance: string | undefined = undefined;
    let converged = false;
    let finalOutput: any = null;
    let finalVerification: VerificationResult = {
      passed: false,
      score: 0,
      ruleResults: []
    };

    for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
      const iterStart = Date.now();

      // 1. DO (Execute): Run target agent with current input and optional critic guidance
      const output = await targetExecutor(currentInput, iteration, criticGuidance);
      finalOutput = output;

      // 2. CHECK (Verify): Perform multi-tier verification
      const verifyResult = await this.verificationEngine.verify(output, verificationSpec, currentInput);
      finalVerification = verifyResult;

      // Check convergence criteria
      if (verifyResult.passed && verifyResult.score >= config.convergenceThreshold) {
        converged = true;
        history.push({
          iteration,
          input: currentInput,
          output,
          verification: verifyResult,
          criticFeedback: undefined,
          durationMs: Date.now() - iterStart
        });
        break; // Successfully converged!
      }

      // 3. ACT (Critic / Reflect): If verification failed, invoke Critic Agent for diagnostic guidance
      let diagnosticFeedback = '';
      const criticAgent = this.agentRegistry.get(config.criticAgentId);

      if (criticAgent) {
        const criticRes = await criticAgent.execute({
          taskId: `${workflowExecutionId}-critic-iter${iteration}`,
          agentId: criticAgent.id,
          input: {
            taskGoal: currentInput.goal || 'Complete task reliably',
            attemptedOutput: output,
            verificationFailure: {
              score: verifyResult.score,
              ruleFailures: verifyResult.ruleResults.filter(r => !r.passed),
              sandboxTest: verifyResult.sandboxTestResult,
              auditorComments: verifyResult.auditorReviews
            }
          }
        }, async (req) => {
          // Construct structured diagnostic reasoning
          const fails = req.input.verificationFailure.ruleFailures.map((f: any) => `- ${f.ruleName}: ${f.message}`).join('\n');
          const testErr = req.input.verificationFailure.sandboxTest?.output || '';
          
          const feedback = `[Critic Analysis Iteration ${iteration}]\nIdentified defects:\n${fails}\n${testErr ? 'Test errors: ' + testErr : ''}\nActionable Corrective Plan:\n1. Eliminate security/logic defects directly.\n2. Fix boundary conditions.\n3. Verify test compliance.`;
          return {
            output: { feedback, correctiveAction: 'refine_code' },
            reasoning: feedback,
            confidence: 0.95
          };
        });

        diagnosticFeedback = criticRes.output?.feedback || criticRes.reasoning;
      } else {
        diagnosticFeedback = `Automatic Diagnostic: Verification score ${verifyResult.score} < ${config.convergenceThreshold}. Issues: ${verifyResult.ruleResults.filter(r => !r.passed).map(r => r.message).join(', ')}`;
      }

      verifyResult.diagnosticFeedback = diagnosticFeedback;
      criticGuidance = diagnosticFeedback;

      history.push({
        iteration,
        input: currentInput,
        output,
        verification: verifyResult,
        criticFeedback: diagnosticFeedback,
        durationMs: Date.now() - iterStart
      });

      // 4. PLAN: Inject feedback into context for next iteration
      currentInput = {
        ...currentInput,
        previousAttempt: output,
        diagnosticFeedback
      };
    }

    // If max iterations reached without convergence, trigger human escalation (DeepSeek Harness principle)
    let humanEscalation: HumanEscalationRequest | undefined;
    if (!converged) {
      humanEscalation = {
        id: `escalation-${Date.now()}`,
        workflowExecutionId,
        nodeId: config.targetNodeId,
        reason: `Self-Loop failed to converge after ${config.maxIterations} iterations. Last verification score: ${(finalVerification.score * 100).toFixed(1)}%.`,
        question: `The agent encountered persistent defects during self-loop verification. How would you like to proceed?`,
        recommendedAction: 'Accept partial fix and manually inspect boundary tests',
        options: [
          'Retry with widened token and iteration budget',
          'Accept current draft and proceed with manual patch',
          'Abort and rollback to last checkpoint'
        ],
        contextSnapshot: {
          lastOutput: finalOutput,
          verificationScore: finalVerification.score,
          failures: finalVerification.ruleResults.filter(r => !r.passed)
        },
        createdAt: Date.now()
      };
    }

    return {
      converged,
      totalIterations: history.length,
      finalOutput,
      finalVerification,
      history,
      humanEscalation
    };
  }
}
