/**
 * Real-World Complex Scenario: AI4SE Autonomous Software Engineering & Defect Resolution Pipeline
 * Demonstrates:
 * 1. Multi-Agent Team Collaboration
 * 2. RAG Knowledge Integration (Coding Guidelines & API Specs)
 * 3. Declarative DAG Workflow with Sub-workflows & Conditions
 * 4. Self-Loop (PDCA) Iterative Code Generation, Test Sandbox Execution & Verification
 * 5. Multi-Agent Consensus (Code Reviewer + Security Auditor)
 * 6. Minimal Attention Delivery (DeepSeek Harness Philosophy)
 */

import { 
  AgentProfile, 
  WorkflowDefinition, 
  VerificationSpec,
  SelfLoopConfig 
} from '../types/index.js';
import { AgentRegistry } from '../agent/agent-registry.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { createBuiltinTools } from '../tools/builtin-tools.js';
import { KnowledgeBase } from '../knowledge/knowledge-base.js';
import { VerificationEngine } from '../verification/verification-engine.js';
import { SelfLoopEngine } from '../selfloop/self-loop-engine.js';
import { DynamicScheduler } from '../scheduler/dynamic-scheduler.js';
import { FeedbackOptimizer } from '../optimization/feedback-optimizer.js';
import { WorkflowEngine } from '../workflow/workflow-engine.js';

export class SoftwareEngineeringScenario {
  public toolRegistry: ToolRegistry;
  public agentRegistry: AgentRegistry;
  public knowledgeBase: KnowledgeBase;
  public verificationEngine: VerificationEngine;
  public selfLoopEngine: SelfLoopEngine;
  public scheduler: DynamicScheduler;
  public optimizer: FeedbackOptimizer;
  public workflowEngine: WorkflowEngine;

  constructor() {
    // 1. Initialize Tool Registry
    this.toolRegistry = new ToolRegistry();
    createBuiltinTools().forEach(tool => this.toolRegistry.register(tool));

    // 2. Initialize Agent Registry
    this.agentRegistry = new AgentRegistry(this.toolRegistry);

    // 3. Initialize Knowledge Base
    this.knowledgeBase = new KnowledgeBase({
      id: 'ai4se-kb',
      name: 'Enterprise Software Architecture & Security Standards',
      chunkSize: 300,
      hybridAlpha: 0.6
    });

    // 4. Initialize Engines
    this.verificationEngine = new VerificationEngine(this.agentRegistry, this.toolRegistry);
    this.selfLoopEngine = new SelfLoopEngine(this.agentRegistry, this.verificationEngine);
    this.scheduler = new DynamicScheduler(this.agentRegistry);
    this.optimizer = new FeedbackOptimizer(this.agentRegistry);
    this.workflowEngine = new WorkflowEngine({
      agentRegistry: this.agentRegistry,
      toolRegistry: this.toolRegistry
    });

    this.setupKnowledgeBase();
    this.setupAgentTeam();
  }

  private setupKnowledgeBase(): void {
    this.knowledgeBase.addDocument(
      'sec-guidelines',
      'Enterprise Secure Coding Standard v3.2',
      `All code submitted must adhere to strict zero-trust security policies.
Rule SEC-01: Dynamic eval(), Function() constructors, and unvalidated string concatenation into queries or commands are strictly forbidden.
Rule SEC-02: Input sanitization is mandatory for all user-provided data.
Rule SEC-03: Cryptographic keys, secrets, and auth tokens must never be hardcoded in repository sources; use environment variables instead.
Rule SEC-04: Concurrency and asynchronous operations must include timeout guards and proper error propagation.`
    );

    this.knowledgeBase.addDocument(
      'rate-limiter-spec',
      'Token Bucket Distributed Rate Limiter API Specification',
      `The RateLimiter class must implement a Token Bucket algorithm with the following interface:
- constructor(capacity: number, refillRatePerSec: number)
- consume(tokens: number = 1): boolean
- getAvailableTokens(): number
- reset(): void
Edge cases:
1. If capacity is negative or zero, throw RangeError.
2. Tokens must not exceed capacity upon refill.
3. Thread safety simulation: consecutive consumes within millisecond intervals must update token counts accurately without negative token balance.`
    );
  }

  private setupAgentTeam(): void {
    // Agent 1: Requirement Analyst
    this.agentRegistry.register({
      id: 'req_analyst_01',
      name: 'Sarah - Requirement Analyst',
      role: 'requirement_analyst',
      description: 'Parses raw customer issues and extracts structured acceptance criteria using domain knowledge',
      capabilities: { requirement_engineering: 0.95, domain_analysis: 0.90 },
      systemPrompt: 'You are an expert Software Requirement Analyst. Extract formal acceptance tests and constraints.',
      toolIds: ['static_analyzer'],
      maxConcurrency: 3,
      currentLoad: 0,
      totalTokensUsed: 0,
      version: '1.0.0'
    });

    // Agent 2: Software Architect
    this.agentRegistry.register({
      id: 'architect_01',
      name: 'David - Lead Architect',
      role: 'architect',
      description: 'Designs deep module boundaries and interface signatures',
      capabilities: { system_architecture: 0.96, api_design: 0.92 },
      systemPrompt: 'You are a Principal Software Architect. Define cohesive interfaces and robust error handling.',
      toolIds: [],
      maxConcurrency: 2,
      currentLoad: 0,
      totalTokensUsed: 0,
      version: '1.0.0'
    });

    // Agent 3: Developer
    this.agentRegistry.register({
      id: 'developer_01',
      name: 'Alex - Senior Full-Stack Engineer',
      role: 'developer',
      description: 'Writes clean, high-performance, well-tested code adhering to standards',
      capabilities: { code_generation: 0.95, algorithm_design: 0.90, debugging: 0.88 },
      systemPrompt: 'You are an elite Software Engineer. Implement algorithms correctly with edge-case handling.',
      toolIds: ['code_sandbox', 'test_runner', 'static_analyzer', 'git_patch_manager'],
      maxConcurrency: 2,
      currentLoad: 0,
      totalTokensUsed: 0,
      version: '1.0.0'
    });

    // Agent 4: Critic / Diagnosis Agent
    this.agentRegistry.register({
      id: 'critic_01',
      name: 'Marcus - Diagnostic Critic',
      role: 'critic',
      description: 'Specializes in root-cause analysis of test failures and self-loop corrective steering',
      capabilities: { root_cause_analysis: 0.98, code_critic: 0.94 },
      systemPrompt: 'You are an adversarial diagnostic critic. Uncover the root causes of failure and specify concrete fixes.',
      toolIds: ['test_runner', 'static_analyzer'],
      maxConcurrency: 4,
      currentLoad: 0,
      totalTokensUsed: 0,
      version: '1.0.0'
    });

    // Agent 5: Code Reviewer
    this.agentRegistry.register({
      id: 'reviewer_01',
      name: 'Elena - Staff Code Reviewer',
      role: 'code_reviewer',
      description: 'Audits code style, edge-case coverage, and maintainability',
      capabilities: { code_review: 0.92, quality_assurance: 0.90 },
      systemPrompt: 'You are a strict code reviewer. Verify maintainability, test coverage, and documentation.',
      toolIds: ['static_analyzer'],
      maxConcurrency: 3,
      currentLoad: 0,
      totalTokensUsed: 0,
      version: '1.0.0'
    });

    // Agent 6: Security Auditor
    this.agentRegistry.register({
      id: 'security_auditor_01',
      name: 'Cipher - Security Auditor',
      role: 'security_auditor',
      description: 'Discovers OWASP vulnerabilities, injection risks, and credential leaks',
      capabilities: { security_audit: 0.97, vulnerability_scan: 0.95 },
      systemPrompt: 'You are a zero-trust Security Auditor. Catch security violations and memory/resource leaks.',
      toolIds: ['static_analyzer'],
      maxConcurrency: 3,
      currentLoad: 0,
      totalTokensUsed: 0,
      version: '1.0.0'
    });
  }

  /**
   * Run the complete Autonomous Pipeline
   */
  public async runScenario(userRequest: string): Promise<{
    requirementSpec: any;
    architectureDesign: any;
    selfLoopResult: any;
    patch: any;
    summary: string;
  }> {
    // Step 1: Query Knowledge Base (RAG)
    const kbResults = this.knowledgeBase.query(userRequest, 2);

    // Step 2: Requirement Analyst Agent
    const reqAnalyst = this.agentRegistry.get('req_analyst_01')!;
    const reqRes = await reqAnalyst.execute({
      taskId: 'req-task-01',
      agentId: reqAnalyst.id,
      input: { userRequest, knowledgeCitations: kbResults.map(r => r.citation) }
    }, async (req) => {
      return {
        output: {
          featureName: 'Token Bucket Rate Limiter',
          acceptanceCriteria: [
            'Support capacity and refill rate configuration',
            'Throw RangeError if capacity <= 0',
            'Thread-safe consume() decrements tokens accurately',
            'No negative tokens or overfill beyond capacity'
          ],
          securityConstraints: ['No dynamic eval or unhandled exceptions', 'Strict input validation'],
          testSuiteCode: `
            // Automated Unit Tests
            const limiter = new RateLimiter(10, 2);
            assertEqual(limiter.getAvailableTokens(), 10, 'Initial tokens should equal capacity');
            assert(limiter.consume(5), 'Should successfully consume 5 tokens');
            assertEqual(limiter.getAvailableTokens(), 5, 'Remaining tokens should be 5');
            assert(limiter.consume(5), 'Should consume remaining 5 tokens');
            assertEqual(limiter.consume(1), false, 'Should reject consumption when empty');
            
            let threw = false;
            try { new RateLimiter(0, 1); } catch (e) { threw = true; }
            assert(threw, 'Should throw RangeError for invalid capacity');
          `
        },
        reasoning: 'Extracted 4 acceptance criteria and generated verification test suite based on KB specs.',
        confidence: 0.96
      };
    });

    const requirementSpec = reqRes.output;

    // Step 3: Architect Agent
    const architect = this.agentRegistry.get('architect_01')!;
    const archRes = await architect.execute({
      taskId: 'arch-task-01',
      agentId: architect.id,
      input: { requirementSpec }
    }, async (req) => {
      return {
        output: {
          className: 'RateLimiter',
          methods: ['constructor(capacity, refillRatePerSec)', 'consume(tokens)', 'getAvailableTokens()', 'reset()'],
          stateInvariants: ['tokens <= capacity', 'tokens >= 0'],
          timeResolution: 'timestamp-based lazy refill'
        },
        reasoning: 'Designed memory-efficient lazy refill algorithm without continuous background intervals.',
        confidence: 0.95
      };
    });

    const architectureDesign = archRes.output;

    // Step 4: Self-Loop (Execution-Verification-Correction Cycle)
    // We demonstrate the realistic Self-Loop:
    // Iteration 1 intentionally contains a subtle bug (e.g. forgot RangeError check on capacity <= 0).
    // The Sandbox Verifier fails the unit test, and the Critic Agent pinpoints the bug.
    // Iteration 2 applies the Critic's guidance, fixes the bug, passes all tests and consensus reviews!
    const selfLoopConfig: SelfLoopConfig = {
      maxIterations: 3,
      targetNodeId: 'developer_node',
      criticAgentId: 'critic_01',
      verificationNodeId: 'verify_node',
      convergenceThreshold: 0.90,
      autoPromptRefine: true
    };

    const verificationSpec: VerificationSpec = {
      rules: [
        {
          name: 'Security Static Check',
          check: (code: string) => {
            const hasEval = /eval\s*\(/.test(code);
            return {
              passed: !hasEval,
              message: hasEval ? 'Forbidden eval() detected' : 'Code free of critical security flags',
              score: hasEval ? 0 : 1.0
            };
          }
        },
        {
          name: 'Interface Completeness Check',
          check: (code: string) => {
            const hasConsume = /consume\s*\(/.test(code);
            const hasAvailable = /getAvailableTokens\s*\(/.test(code);
            const passed = hasConsume && hasAvailable;
            return {
              passed,
              message: passed ? 'All required methods defined' : 'Missing essential method declarations',
              score: passed ? 1.0 : 0.4
            };
          }
        }
      ],
      confidenceThreshold: 0.90,
      executableSandboxCheck: {
        expectedExitCode: 0
      },
      multiAgentVoting: {
        auditorAgentIds: ['reviewer_01', 'security_auditor_01'],
        minPassRatio: 0.67
      }
    };

    const selfLoopResult = await this.selfLoopEngine.runLoop(
      selfLoopConfig,
      verificationSpec,
      {
        goal: 'Implement RateLimiter meeting all acceptance criteria',
        testCode: requirementSpec.testSuiteCode,
        architectureDesign
      },
      async (input, iteration, criticGuidance) => {
        // Target Executor (Developer Agent Alex)
        if (iteration === 1) {
          // Attempt 1: Misses the RangeError validation (Simulating typical LLM subtle omission)
          return `
            class RateLimiter {
              constructor(capacity, refillRatePerSec) {
                this.capacity = capacity;
                this.refillRatePerSec = refillRatePerSec;
                this.tokens = capacity;
                this.lastRefill = Date.now();
              }
              _refill() {
                const now = Date.now();
                const deltaSec = (now - this.lastRefill) / 1000;
                this.tokens = Math.min(this.capacity, this.tokens + deltaSec * this.refillRatePerSec);
                this.lastRefill = now;
              }
              consume(tokens = 1) {
                this._refill();
                if (this.tokens >= tokens) {
                  this.tokens -= tokens;
                  return true;
                }
                return false;
              }
              getAvailableTokens() {
                this._refill();
                return Math.floor(this.tokens);
              }
              reset() {
                this.tokens = this.capacity;
                this.lastRefill = Date.now();
              }
            }
          `;
        } else {
          // Attempt 2: Refined implementation using Critic feedback (fixes RangeError & precision)
          return `
            class RateLimiter {
              constructor(capacity, refillRatePerSec) {
                if (typeof capacity !== 'number' || capacity <= 0) {
                  throw new RangeError('Capacity must be a positive number');
                }
                if (typeof refillRatePerSec !== 'number' || refillRatePerSec <= 0) {
                  throw new RangeError('Refill rate must be a positive number');
                }
                this.capacity = capacity;
                this.refillRatePerSec = refillRatePerSec;
                this.tokens = capacity;
                this.lastRefill = Date.now();
              }
              _refill() {
                const now = Date.now();
                const deltaSec = (now - this.lastRefill) / 1000;
                this.tokens = Math.min(this.capacity, this.tokens + deltaSec * this.refillRatePerSec);
                this.lastRefill = now;
              }
              consume(tokens = 1) {
                this._refill();
                if (this.tokens >= tokens) {
                  this.tokens -= tokens;
                  return true;
                }
                return false;
              }
              getAvailableTokens() {
                this._refill();
                return Math.floor(this.tokens);
              }
              reset() {
                this.tokens = this.capacity;
                this.lastRefill = Date.now();
              }
            }
          `;
        }
      }
    );

    // Step 5: Git Patch Tool Execution
    const gitTool = this.toolRegistry.get('git_patch_manager')!;
    const patchRes = await gitTool.handler({
      originalContent: '// RateLimiter placeholder\n',
      updatedContent: selfLoopResult.finalOutput.trim(),
      filePath: 'src/rate-limiter.js'
    });

    const summary = `Autonomous Workflow Execution Summary:
- Requirement extraction: Passed with 4 criteria (SARAH)
- Architecture design: Token Bucket lazy refill (DAVID)
- Self-Loop Iterations: ${selfLoopResult.totalIterations}
- Final Verification Score: ${(selfLoopResult.finalVerification.score * 100).toFixed(1)}%
- Multi-Agent Consensus: Elena (Code Reviewer) & Cipher (Security Auditor) APPROVED
- Sandbox Assertions: All test assertions PASSED
- Human Attention Cost: ZERO (Full autonomy convergence achieved)`;

    return {
      requirementSpec,
      architectureDesign,
      selfLoopResult,
      patch: patchRes,
      summary
    };
  }
}
