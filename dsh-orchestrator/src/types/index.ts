/**
 * DSH Agent Orchestrator - Core Domain Model & Types
 * Philosophy: Take as little human attention as possible, give as much value as possible.
 */

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
  capabilities: Record<string, number>; // capability score 0.0 - 1.0 (e.g., { 'code_generation': 0.95, 'security_audit': 0.8 })
  systemPrompt: string;
  toolIds: string[];
  maxConcurrency: number;
  currentLoad: number;
  totalTokensUsed: number;
  temperature?: number;
  model?: string;
  version: string;
}

export interface AgentExecutionRequest {
  taskId: string;
  agentId: string;
  input: Record<string, any>;
  context?: Record<string, any>;
  retrievedDocs?: KnowledgeQueryResult[];
  systemPromptOverride?: string;
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
  confidence: number; // 0.0 - 1.0
  tokensUsed: number;
  durationMs: number;
  error?: string;
}

// ---------------- Knowledge & RAG ----------------

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
  chunkSize: number;
  chunkOverlap: number;
  hybridAlpha: number; // 0.0 = keyword only, 1.0 = vector only, 0.5 = balanced
}

// ---------------- Tools & MCP ----------------

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
  isSandboxed?: boolean;
  timeoutMs?: number;
  handler: (params: any, context?: any) => Promise<any>;
}

// ---------------- Workflow & DAG ----------------

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
  agentId?: string;
  toolId?: string;
  subworkflowId?: string;
  selfLoopConfig?: SelfLoopConfig;
  verificationSpec?: VerificationSpec;
  conditionFn?: (context: Record<string, any>) => string; // returns branch target node id
  inputTransformer?: (context: Record<string, any>) => any;
  outputKey?: string; // where to store in workflow context
  timeoutMs?: number;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: (context: Record<string, any>) => boolean;
}

export interface SelfLoopConfig {
  maxIterations: number;
  targetNodeId: string; // node being iteratively refined
  criticAgentId: string;
  verificationNodeId: string;
  convergenceThreshold: number; // e.g. 0.90
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
  timeoutMs?: number;
}

export type ExecutionStatus = 
  | 'pending' 
  | 'running' 
  | 'paused' 
  | 'completed' 
  | 'failed' 
  | 'needs_human';

export interface NodeExecutionRecord {
  nodeId: string;
  status: ExecutionStatus;
  startTime: number;
  endTime?: number;
  input: any;
  output: any;
  error?: string;
  iteration?: number;
  verification?: VerificationResult;
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
}

// ---------------- Verification & Feedback ----------------

export interface VerificationRule {
  name: string;
  check: (output: any, context: Record<string, any>) => { passed: boolean; message: string; score: number };
}

export interface VerificationSpec {
  rules: VerificationRule[];
  confidenceThreshold: number; // 0.0 - 1.0
  multiAgentVoting?: {
    auditorAgentIds: string[];
    minPassRatio: number; // e.g. 0.67
  };
  executableSandboxCheck?: {
    testScriptGenerator?: (output: any) => string;
    expectedExitCode?: number;
  };
}

export interface VerificationResult {
  passed: boolean;
  score: number; // 0.0 - 1.0
  ruleResults: Array<{ ruleName: string; passed: boolean; message: string; score: number }>;
  auditorReviews?: Array<{ agentId: string; approved: boolean; comments: string; confidence: number }>;
  sandboxTestResult?: { passed: boolean; output: string; exitCode: number };
  diagnosticFeedback?: string; // used by Self-Loop for prompt injection / targeted fixes
}

export interface HumanEscalationRequest {
  id: string;
  workflowExecutionId: string;
  nodeId: string;
  reason: string;
  question: string;
  recommendedAction?: string;
  options: string[];
  contextSnapshot: Record<string, any>;
  createdAt: number;
}

// ---------------- Scheduler ----------------

export interface ScheduledTask {
  id: string;
  workflowExecutionId: string;
  node: WorkflowNode;
  priority: number; // 1 (low) - 10 (urgent)
  submittedAt: number;
  dependencies: string[];
  status: 'queued' | 'running' | 'completed' | 'failed';
}
