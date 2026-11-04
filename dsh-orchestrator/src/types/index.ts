/**
 * AetherHarness / DSH-Orchestrator — Core Domain Model & Contracts
 *
 * Philosophy: Take as little human attention as possible, give as much value as possible.
 *
 * NOTE ON HONESTY: every field declared here is either produced or enforced by the
 * engine. Fields that used to be decorative (`timeoutMs`, `isSandboxed`) are now
 * actually consumed — see workflow-engine.ts / tool-registry.ts.
 */

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export type AgentRole =
  | 'orchestrator'
  | 'requirement_analyst'
  | 'architect'
  | 'developer'
  | 'code_reviewer'
  | 'security_auditor'
  | 'qa_verifier'
  | 'critic';

export interface AgentProfile {
  id: string;
  name: string;
  role: AgentRole;
  description: string;
  /** capability tag -> score in [0,1] */
  capabilities: Record<string, number>;
  systemPrompt: string;
  toolIds: string[];
  maxConcurrency: number;
  currentLoad: number;
  totalTokensUsed: number;
  temperature?: number;
  model?: string;
  version: string;
}

/** A single rule failure surfaced to the executing brain so it can repair. */
export interface RuleFailure {
  id?: string;
  ruleName: string;
  message: string;
  severity?: 'critical' | 'warning' | 'info';
}

export interface AgentExecutionRequest {
  taskId: string;
  agentId: string;
  input: Record<string, any>;
  context?: Record<string, any>;
  retrievedDocs?: KnowledgeQueryResult[];
  systemPromptOverride?: string;
  /** 1-based self-loop iteration, when executed inside a loop. */
  iteration?: number;
  /** Critic guidance produced by the previous iteration. */
  criticGuidance?: string;
  /** Structured failures of the previous attempt — drives repair brains. */
  failedRules?: RuleFailure[];
}

export interface ToolCallTrace {
  toolId: string;
  input: any;
  output: any;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface AgentExecutionResult {
  taskId: string;
  agentId: string;
  success: boolean;
  output: any;
  reasoning: string;
  toolCalls: ToolCallTrace[];
  confidence: number;
  tokensUsed: number;
  durationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Knowledge & RAG
// ---------------------------------------------------------------------------

export interface KnowledgeChunk {
  id: string;
  docId: string;
  title: string;
  content: string;
  metadata: Record<string, any>;
  embedding?: number[];
}

export interface KnowledgeQueryResult {
  chunk: KnowledgeChunk;
  score: number;
  matchType: 'keyword' | 'vector' | 'hybrid';
  citation: string;
}

export interface KnowledgeBaseConfig {
  id: string;
  name: string;
  description: string;
  /** soft target size of a chunk, measured in tokens (CJK-aware) */
  chunkSize: number;
  chunkOverlap: number;
  /** 0.0 = keyword only, 1.0 = vector only */
  hybridAlpha: number;
}

// ---------------------------------------------------------------------------
// Tools & MCP
// ---------------------------------------------------------------------------

export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description: string;
    enum?: string[];
  }>;
  required?: string[];
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  /** When true the handler runs in an isolated vm context with a hard timeout. */
  isSandboxed?: boolean;
  timeoutMs?: number;
  handler: (params: any, context?: any) => Promise<any>;
}

// ---------------------------------------------------------------------------
// Workflow & DAG
// ---------------------------------------------------------------------------

export type WorkflowNodeType =
  | 'agent'
  | 'tool'
  | 'condition'
  | 'parallel_group'
  | 'subworkflow'
  | 'verification'
  | 'self_loop';

export interface WorkflowNode {
  id: string;
  name: string;
  type: WorkflowNodeType;
  description?: string;

  // --- agent nodes ---
  agentId?: string;
  /** capability tag used for load-balanced routing when agentId is absent */
  agentCapability?: string;
  /** scheduling priority 1..10 (1 = background, 10 = urgent) */
  priority?: number;

  // --- tool nodes ---
  toolId?: string;

  // --- subworkflow nodes ---
  subworkflowId?: string;

  // --- parallel_group nodes ---
  /** node ids executed concurrently; their outputKeys land in context */
  parallelChildIds?: string[];

  // --- verification nodes ---
  verificationSpec?: VerificationSpec;
  /** context key holding the artifact to verify (default: `lastOutput`) */
  verifyTargetKey?: string;

  // --- self_loop nodes ---
  selfLoopConfig?: SelfLoopConfig;

  // --- control ---
  conditionFn?: (context: Record<string, any>) => string;
  inputTransformer?: (context: Record<string, any>) => any;
  outputKey?: string;
  /** hard per-node budget; enforced for sandboxed tools and agent calls */
  timeoutMs?: number;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: (context: Record<string, any>) => boolean;
}

export interface SelfLoopConfig {
  maxIterations: number;
  /** node re-executed on every iteration (the "DO" of PDCA) */
  targetNodeId: string;
  criticAgentId: string;
  /** verification node whose verificationSpec gates convergence */
  verificationNodeId: string;
  convergenceThreshold: number;
  autoPromptRefine?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entryNodeId: string;
  /** wall-clock budget for the whole run; enforced between nodes */
  timeoutMs?: number;
  /** hard guard against pathological chains */
  maxSteps?: number;
}

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'needs_human'
  | 'skipped';

export interface NodeExecutionRecord {
  nodeId: string;
  nodeName: string;
  status: ExecutionStatus;
  startTime: number;
  endTime?: number;
  input: any;
  output: any;
  error?: string;
  iteration?: number;
  verification?: VerificationResult;
  /** for condition nodes: the branch actually taken (evaluated exactly once) */
  branchTaken?: string;
  /** structured side-channel for the UI (e.g. self-loop iterations / score) */
  meta?: Record<string, any>;
}

export interface WorkflowExecutionState {
  workflowExecutionId: string;
  workflowId: string;
  status: ExecutionStatus;
  context: Record<string, any>;
  nodeRecords: Record<string, NodeExecutionRecord[]>;
  currentActiveNodes: string[];
  iterationCounts: Record<string, number>;
  humanEscalation?: HumanEscalationRequest;
  startTime: number;
  endTime?: number;
  totalTokens: number;
  steps: number;
}

// ---------------------------------------------------------------------------
// Verification & Feedback
// ---------------------------------------------------------------------------

export interface VerificationRule {
  /** stable id (e.g. EDGE-001) so repair strategies can key on it */
  id?: string;
  name: string;
  severity?: 'critical' | 'warning' | 'info';
  check: (output: any, context: Record<string, any>) => { passed: boolean; message: string; score: number };
}

export interface VerificationSpec {
  rules: VerificationRule[];
  confidenceThreshold: number;
  multiAgentVoting?: {
    auditorAgentIds: string[];
    minPassRatio: number;
  };
  executableSandboxCheck?: {
    /** generates test code; assertions may be prefixed with a rule id: "EDGE-001: ..." */
    testScriptGenerator?: (output: any, context: Record<string, any>) => string;
    expectedExitCode?: number;
    timeoutMs?: number;
  };
}

export interface VerificationTierResult {
  tier: 'Tier-1' | 'Tier-2' | 'Tier-3';
  name: string;
  passed: boolean;
  score: number;
  detail: string;
}

export interface VerificationResult {
  passed: boolean;
  score: number;
  ruleResults: Array<{ ruleId?: string; ruleName: string; passed: boolean; message: string; score: number; severity?: string }>;
  auditorReviews?: Array<{ agentId: string; approved: boolean; comments: string; confidence: number; signals?: string[] }>;
  sandboxTestResult?: { passed: boolean; output: string; exitCode: number; passedCount?: number; totalCount?: number };
  tiers?: VerificationTierResult[];
  diagnosticFeedback?: string;
  /** human-readable list of what actually blocked the verdict */
  blockingReasons?: string[];
  /** union of rule ids that failed across all three tiers — the repair keys */
  failedRuleIds?: string[];
}

export interface HumanEscalationRequest {
  id: string;
  workflowExecutionId: string;
  nodeId: string;
  reason: string;
  question: string;
  recommendedAction: string;
  /** index into `options` that the platform recommends; the TUI pre-selects it */
  recommendedOptionIndex?: number;
  options: string[];
  contextSnapshot: Record<string, any>;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export interface ScheduledTask {
  id: string;
  runId: string;
  workflowExecutionId: string;
  node: WorkflowNode;
  basePriority: number;
  submittedAt: number;
  dependencies: string[];
  status: 'queued' | 'running' | 'completed' | 'failed' | 'retrying';
  attempts: number;
  startedAt?: number;
  finishedAt?: number;
  effectivePriority?: number;
  assignedAgentId?: string;
}

export interface SchedulerStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  retried: number;
  dispatches: number;
  agingPromotions: number;
  maxObservedWaitMs: number;
}

// ---------------------------------------------------------------------------
// Orchestration events (consumed by the TUI)
// ---------------------------------------------------------------------------

export type EventKind =
  | 'run.started'
  | 'run.finished'
  | 'node.started'
  | 'node.finished'
  | 'loop.iteration'
  | 'verify'
  | 'escalation'
  | 'scheduler'
  | 'log';

export interface OrchestratorEvent {
  at: number;
  runId: string;
  kind: EventKind;
  message: string;
  /** short tag rendered in the log gutter */
  tag?: string;
  data?: Record<string, any>;
}

export interface RunSnapshotView {
  runId: string;
  taskId: string;
  title: string;
  status: ExecutionStatus;
}

// ---------------------------------------------------------------------------
// Task catalogue
// ---------------------------------------------------------------------------

export type TaskDifficulty = 'easy' | 'normal' | 'hard';

export interface TaskSpec {
  id: string;
  title: string;
  description: string;
  difficulty: TaskDifficulty;
  /** the artifact request handed to the requirement analyst */
  prompt: string;
  /** build the declarative DAG for this task */
  buildWorkflow: (engineRefs: { verificationSpec: VerificationSpec }) => WorkflowDefinition;
  verificationSpec: VerificationSpec;
  /** initial artifact; the developer brain refines it */
  seed?: Record<string, any>;
}
