/**
 * Declarative Workflow Engine
 *
 * Fixes vs. the previous version:
 * - `validate()` performs an actual DFS cycle detection (colours white/grey/black) and
 *   reports the offending cycle path. Previously a cyclic graph validated as `valid: true`
 *   and then looped forever in `execute()`, because `WorkflowDefinition.timeoutMs` was
 *   declared but never read.
 * - every declared node type is executed. `self_loop`, `verification` and `parallel_group`
 *   used to fall through to `default: { status: 'pass' }`, i.e. a DAG could declare
 *   "verify + self-heal" and the engine would silently announce success.
 * - `timeoutMs` and `maxSteps` are enforced between nodes; a run can no longer hang.
 * - a checkpoint is taken before *every* node (not only at t=0), so `rollback()` restores
 *   the nearest safe state instead of the initial one.
 * - agent nodes are dispatched through the DynamicScheduler (real queueing, load balancing
 *   and priority aging) instead of calling `agent.execute()` directly.
 * - `iterationCounts`, `needs_human` and `state.humanEscalation` are now produced.
 */
import {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowExecutionState,
  NodeExecutionRecord,
  ExecutionStatus,
  HumanEscalationRequest,
  VerificationSpec
} from '../types/index.js';
import { AgentRegistry } from '../agent/agent-registry.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { DynamicScheduler } from '../scheduler/dynamic-scheduler.js';
import { VerificationEngine } from '../verification/verification-engine.js';
import { SelfLoopEngine } from '../selfloop/self-loop-engine.js';
import { FeedbackOptimizer } from '../optimization/feedback-optimizer.js';

export interface WorkflowHooks {
  onNodeStart?: (node: WorkflowNode, record: NodeExecutionRecord) => void;
  onNodeEnd?: (node: WorkflowNode, record: NodeExecutionRecord) => void;
  onLog?: (message: string, data?: Record<string, any>) => void;
}

export interface WorkflowEngineOptions {
  agentRegistry: AgentRegistry;
  toolRegistry: ToolRegistry;
  scheduler?: DynamicScheduler;
  verificationEngine?: VerificationEngine;
  selfLoopEngine?: SelfLoopEngine;
  optimizer?: FeedbackOptimizer;
  subworkflowRegistry?: Map<string, WorkflowDefinition>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  cycle?: string[];
}

const DEFAULT_RUN_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_STEPS = 200;
const MAX_NESTING = 8;

export function deepClone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export class WorkflowEngine {
  private agentRegistry: AgentRegistry;
  private toolRegistry: ToolRegistry;
  private scheduler?: DynamicScheduler;
  private verificationEngine?: VerificationEngine;
  private selfLoopEngine?: SelfLoopEngine;
  private optimizer?: FeedbackOptimizer;
  private subworkflowRegistry: Map<string, WorkflowDefinition>;

  /** executionId -> stack of context checkpoints (most recent last) */
  private checkpoints: Map<string, Array<Record<string, any>>> = new Map();

  constructor(options: WorkflowEngineOptions) {
    this.agentRegistry = options.agentRegistry;
    this.toolRegistry = options.toolRegistry;
    this.scheduler = options.scheduler;
    this.verificationEngine = options.verificationEngine;
    this.selfLoopEngine = options.selfLoopEngine;
    this.optimizer = options.optimizer;
    this.subworkflowRegistry = options.subworkflowRegistry ?? new Map();
  }

  public registerSubworkflow(def: WorkflowDefinition): void {
    this.subworkflowRegistry.set(def.id, def);
  }

  // ------------------------------------------------------------------ validate

  public validate(workflow: WorkflowDefinition): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const nodeMap = this.buildNodeMap(workflow, errors);

    if (!nodeMap.has(workflow.entryNodeId)) {
      errors.push(`entry node '${workflow.entryNodeId}' does not exist`);
    }

    // edge endpoints
    for (const edge of workflow.edges) {
      if (!nodeMap.has(edge.from)) errors.push(`edge references unknown from-node '${edge.from}'`);
      if (!nodeMap.has(edge.to)) errors.push(`edge references unknown to-node '${edge.to}'`);
    }

    // per-node contract checks — a node that cannot execute is a definition error
    for (const node of workflow.nodes) {
      switch (node.type) {
        case 'agent':
          if (!node.agentId && !node.agentCapability) {
            errors.push(`agent node '${node.id}' needs agentId or agentCapability`);
          }
          if (node.agentId && !this.agentRegistry.get(node.agentId)) {
            errors.push(`agent node '${node.id}' references unregistered agent '${node.agentId}'`);
          }
          break;
        case 'tool':
          if (!node.toolId) errors.push(`tool node '${node.id}' is missing toolId`);
          else if (!this.toolRegistry.has(node.toolId)) errors.push(`tool node '${node.id}' references unknown tool '${node.toolId}'`);
          break;
        case 'condition':
          if (!node.conditionFn) errors.push(`condition node '${node.id}' is missing conditionFn`);
          break;
        case 'parallel_group': {
          const children = node.parallelChildIds ?? [];
          if (children.length === 0) errors.push(`parallel_group node '${node.id}' has no parallelChildIds`);
          for (const childId of children) {
            if (!nodeMap.has(childId)) errors.push(`parallel_group '${node.id}' references unknown child '${childId}'`);
          }
          break;
        }
        case 'subworkflow':
          if (!node.subworkflowId) errors.push(`subworkflow node '${node.id}' is missing subworkflowId`);
          else if (!this.subworkflowRegistry.has(node.subworkflowId)) {
            errors.push(`subworkflow node '${node.id}' references unregistered subworkflow '${node.subworkflowId}'`);
          }
          break;
        case 'verification':
          if (!node.verificationSpec) errors.push(`verification node '${node.id}' is missing verificationSpec`);
          break;
        case 'self_loop': {
          const cfg = node.selfLoopConfig;
          if (!cfg) {
            errors.push(`self_loop node '${node.id}' is missing selfLoopConfig`);
            break;
          }
          if (!nodeMap.has(cfg.targetNodeId)) errors.push(`self_loop '${node.id}' target '${cfg.targetNodeId}' does not exist`);
          if (!nodeMap.has(cfg.verificationNodeId)) errors.push(`self_loop '${node.id}' verification node '${cfg.verificationNodeId}' does not exist`);
          if (!this.agentRegistry.get(cfg.criticAgentId)) errors.push(`self_loop '${node.id}' critic '${cfg.criticAgentId}' is not registered`);
          if (cfg.maxIterations < 1) errors.push(`self_loop '${node.id}' maxIterations must be >= 1`);
          break;
        }
        default:
          errors.push(`node '${node.id}' has unknown type '${(node as any).type}'`);
      }
    }

    // reachability (parallel children are reached through their parent)
    const reachable = this.reachableFrom(workflow, nodeMap);
    for (const node of workflow.nodes) {
      if (!reachable.has(node.id)) warnings.push(`node '${node.id}' is unreachable from entry '${workflow.entryNodeId}'`);
    }

    // cycle detection
    const cycle = this.findCycle(workflow);
    if (cycle) {
      errors.push(`cycle detected: ${cycle.join(' → ')} (DAG requires an acyclic graph; use a self_loop node for iteration)`);
    }

    return { valid: errors.length === 0, errors, warnings, cycle: cycle ?? undefined };
  }

  /**
   * Iterative DFS with three colours. Returns the cycle path when a back-edge is found.
   */
  public findCycle(workflow: WorkflowDefinition): string[] | null {
    const adj = new Map<string, string[]>();
    for (const node of workflow.nodes) adj.set(node.id, []);
    for (const edge of workflow.edges) {
      if (!adj.has(edge.from)) adj.set(edge.from, []);
      adj.get(edge.from)!.push(edge.to);
    }

    const WHITE = 0;
    const GREY = 1;
    const BLACK = 2;
    const colour = new Map<string, number>();
    for (const id of adj.keys()) colour.set(id, WHITE);

    for (const start of adj.keys()) {
      if (colour.get(start) !== WHITE) continue;

      const stack: Array<{ id: string; idx: number }> = [{ id: start, idx: 0 }];
      const path: string[] = [start];
      colour.set(start, GREY);

      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const neighbours = adj.get(frame.id) ?? [];

        if (frame.idx >= neighbours.length) {
          colour.set(frame.id, BLACK);
          stack.pop();
          path.pop();
          continue;
        }

        const next = neighbours[frame.idx++];

        if (colour.get(next) === GREY) {
          const at = path.indexOf(next);
          return [...path.slice(at), next];
        }
        if (colour.get(next) === WHITE) {
          colour.set(next, GREY);
          path.push(next);
          stack.push({ id: next, idx: 0 });
        }
      }
    }

    return null;
  }

  // ------------------------------------------------------------------- execute

  public async execute(
    workflow: WorkflowDefinition,
    initialInput: Record<string, any> = {},
    hooks: WorkflowHooks & { runId?: string } = {}
  ): Promise<WorkflowExecutionState> {
    const validation = this.validate(workflow);
    if (!validation.valid) {
      throw new Error(`Invalid workflow '${workflow.id}': ${validation.errors.join('; ')}`);
    }

    const executionId = hooks.runId ?? `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const state: WorkflowExecutionState = {
      workflowExecutionId: executionId,
      workflowId: workflow.id,
      status: 'running',
      context: { ...initialInput },
      nodeRecords: {},
      currentActiveNodes: [workflow.entryNodeId],
      iterationCounts: {},
      startTime: Date.now(),
      totalTokens: 0,
      steps: 0
    };

    const nodeMap = new Map<string, WorkflowNode>();
    workflow.nodes.forEach(n => nodeMap.set(n.id, n));

    const deadline = state.startTime + (workflow.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS);
    const maxSteps = workflow.maxSteps ?? DEFAULT_MAX_STEPS;

    /** nodeId -> scheduler taskId of the most recent execution (for dependency wiring) */
    const taskIdByNode = new Map<string, string>();

    let currentNodeId: string | null = workflow.entryNodeId;

    while (currentNodeId && state.status === 'running') {
      if (Date.now() > deadline) {
        state.status = 'failed';
        hooks.onLog?.(`workflow deadline exceeded after ${workflow.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS}ms`);
        break;
      }
      if (state.steps >= maxSteps) {
        state.status = 'failed';
        hooks.onLog?.(`maxSteps (${maxSteps}) exceeded — possible unbounded traversal`);
        break;
      }

      const node = nodeMap.get(currentNodeId);
      if (!node) {
        state.status = 'failed';
        hooks.onLog?.(`next node '${currentNodeId}' not found`);
        break;
      }

      state.currentActiveNodes = [currentNodeId];
      state.steps++;

      this.pushCheckpoint(executionId, state.context);

      const record = await this.executeNode(node, state, hooks, { deadline, taskIdByNode, workflow });

      if (record.status === 'failed') {
        state.status = 'failed';
        break;
      }
      if (record.status === 'needs_human') {
        state.status = 'needs_human';
        state.humanEscalation = (record as any).escalation as HumanEscalationRequest | undefined;
        break;
      }

      currentNodeId = this.resolveNextNode(node, record, workflow, state.context);
    }

    state.endTime = Date.now();
    state.currentActiveNodes = [];
    if (state.status === 'running') state.status = 'completed';
    state.totalTokens = this.agentRegistry.getTotalTokens();
    return state;
  }

  public async executeNode(
    node: WorkflowNode,
    state: WorkflowExecutionState,
    hooks: WorkflowHooks = {},
    internal: {
      deadline?: number;
      taskIdByNode?: Map<string, string>;
      depth?: number;
      workflow?: WorkflowDefinition;
    } = {}
  ): Promise<NodeExecutionRecord> {
    const started = Date.now();
    const deadline = internal.deadline ?? started + DEFAULT_RUN_TIMEOUT_MS;
    const depth = internal.depth ?? 0;

    if (depth > MAX_NESTING) throw new Error(`workflow nesting deeper than ${MAX_NESTING}`);

    const input = node.inputTransformer ? node.inputTransformer(state.context) : this.snapshotContext(state.context);

    const record: NodeExecutionRecord = {
      nodeId: node.id,
      nodeName: node.name,
      status: 'running',
      startTime: started,
      input,
      output: null
    };

    hooks.onNodeStart?.(node, record);

    try {
      let output: any = null;

      switch (node.type) {
        // -------------------------------------------------------- agent
        case 'agent': {
          output = await this.runAgentNode(node, state, deadline, internal.taskIdByNode, hooks);
          break;
        }

        // --------------------------------------------------------- tool
        case 'tool': {
          if (!node.toolId) throw new Error(`node '${node.id}' missing toolId`);
          output = await this.toolRegistry.invoke(node.toolId, input, { timeoutMs: node.timeoutMs ?? 4000 });
          break;
        }

        // ---------------------------------------------------- condition
        case 'condition': {
          if (!node.conditionFn) throw new Error(`node '${node.id}' missing conditionFn`);
          // evaluated EXACTLY ONCE; the branch is reused by resolveNextNode
          const next = node.conditionFn(state.context);
          record.branchTaken = next;
          output = { branch: next };
          break;
        }

        // ------------------------------------------------ parallel group
        case 'parallel_group': {
          const childIds = node.parallelChildIds ?? [];
          const nodeMap = new Map<string, WorkflowNode>();
          // children live in the same workflow definition
          const wf = internal.workflow ?? this.findWorkflowOfNode(state.workflowId);
          if (wf) wf.nodes.forEach(n => nodeMap.set(n.id, n));

          const results = await Promise.allSettled(
            childIds.map(async childId => {
              const child = nodeMap.get(childId);
              if (!child) throw new Error(`parallel child '${childId}' not found`);
              const childRecord = await this.executeNode(child, state, hooks, {
                deadline,
                taskIdByNode: internal.taskIdByNode,
                depth: depth + 1,
                workflow: wf ?? undefined
              });
              return { childId, record: childRecord };
            })
          );

          const settled = results.map((r, i) => {
            const childId = childIds[i];
            if (r.status === 'fulfilled') return { childId, ok: r.value.record.status === 'completed', error: r.value.record.error };
            return { childId, ok: false, error: (r.reason as Error)?.message ?? 'unknown' };
          });

          if (settled.some(s => !s.ok)) {
            throw new Error(
              `parallel group '${node.id}' child failures: ${settled.filter(s => !s.ok).map(s => `${s.childId}: ${s.error}`).join('; ')}`
            );
          }
          output = { parallelCompleted: true, children: settled };
          break;
        }

        // -------------------------------------------------- subworkflow
        case 'subworkflow': {
          if (!node.subworkflowId) throw new Error(`node '${node.id}' missing subworkflowId`);
          const sub = this.subworkflowRegistry.get(node.subworkflowId);
          if (!sub) throw new Error(`subworkflow '${node.subworkflowId}' not registered`);

          const subEngine = new WorkflowEngine({
            agentRegistry: this.agentRegistry,
            toolRegistry: this.toolRegistry,
            scheduler: this.scheduler,
            verificationEngine: this.verificationEngine,
            selfLoopEngine: this.selfLoopEngine,
            optimizer: this.optimizer,
            subworkflowRegistry: this.subworkflowRegistry
          });
          const subState = await subEngine.execute(sub, input as Record<string, any>, {
            runId: `${state.workflowExecutionId}-${node.id}`,
            onLog: hooks.onLog
          });
          if (subState.status !== 'completed') {
            throw new Error(`subworkflow '${node.subworkflowId}' ended with status '${subState.status}'`);
          }
          output = subState.context;
          break;
        }

        // -------------------------------------------------- verification
        case 'verification': {
          if (!this.verificationEngine) throw new Error('VerificationEngine is not wired into this WorkflowEngine');
          if (!node.verificationSpec) throw new Error(`verification node '${node.id}' missing verificationSpec`);

          const targetKey = node.verifyTargetKey ?? 'lastOutput';
          const target = state.context[targetKey];
          const result = await this.verificationEngine.verify(target, node.verificationSpec, state.context);

          record.verification = result;
          state.context.lastVerification = result;
          if (node.outputKey) state.context[node.outputKey] = result;

          output = {
            passed: result.passed,
            score: result.score,
            blocking: result.blockingReasons ?? []
          };
          // a verification node is a gate that ROUTES, it does not abort the run
          hooks.onLog?.(
            `verify ${node.id}: ${result.passed ? 'PASSED' : 'BLOCKED'} score=${result.score.toFixed(3)}`,
            { nodeId: node.id, passed: result.passed, score: result.score }
          );
          break;
        }

        // ----------------------------------------------------- self loop
        case 'self_loop': {
          const cfg = node.selfLoopConfig;
          if (!cfg) throw new Error(`self_loop node '${node.id}' missing selfLoopConfig`);
          if (!this.selfLoopEngine) throw new Error('SelfLoopEngine is not wired into this WorkflowEngine');

          const wf = internal.workflow ?? this.findWorkflowOfNode(state.workflowId);
          if (!wf) throw new Error(`cannot resolve workflow '${state.workflowId}' for self_loop`);

          const targetNode = wf.nodes.find(n => n.id === cfg.targetNodeId);
          const verifyNode = wf.nodes.find(n => n.id === cfg.verificationNodeId);
          if (!targetNode) throw new Error(`self_loop target '${cfg.targetNodeId}' not found`);
          if (!verifyNode?.verificationSpec) throw new Error(`self_loop verification node '${cfg.verificationNodeId}' has no verificationSpec`);

          const spec: VerificationSpec = verifyNode.verificationSpec;

          const loopResult = await this.selfLoopEngine.runLoop(
            cfg,
            spec,
            state.context,
            async (loopInput, iteration, guidance, failedRules, previousVerification) => {
              // expose the loop state to the target node's agent call
              state.context.__loopIteration = iteration;
              state.context.__failedRules = failedRules;
              if (guidance) state.context.diagnosticFeedback = guidance;
              if (previousVerification) state.context.lastVerification = previousVerification;
              state.iterationCounts[node.id] = iteration;

              const targetRecord = await this.executeNode(targetNode, state, hooks, {
                deadline,
                taskIdByNode: internal.taskIdByNode,
                depth: depth + 1,
                workflow: wf
              });
              if (targetRecord.status !== 'completed') {
                throw new Error(`self_loop target '${targetNode.id}' failed: ${targetRecord.error}`);
              }
              return targetRecord.output;
            },
            {
              workflowExecutionId: state.workflowExecutionId,
              optimizer: this.optimizer,
              targetAgentId: targetNode.agentId,
              onVerify: rec => {
                hooks.onLog?.(
                  `self-loop ${node.id} iteration ${rec.iteration}: score=${rec.score.toFixed(3)} ` +
                    `${rec.passed ? 'converged' : 'retrying'}` +
                    (rec.failedRuleIds.length ? ` (this round blocked by: ${rec.failedRuleIds.join(', ')})` : '') +
                    (rec.cumulativeFailureIds.length > rec.failedRuleIds.length
                      ? ` [repaired so far: ${rec.cumulativeFailureIds.filter(id => !rec.failedRuleIds.includes(id)).join(', ')}]`
                      : ''),
                  { nodeId: node.id, iteration: rec.iteration, score: rec.score, passed: rec.passed }
                );
              }
            }
          );

          record.verification = loopResult.finalVerification;
          // the node's OUTPUT is the artifact it produced — that is what downstream
          // nodes need. The loop statistics travel on `record.meta` instead of
          // overwriting the artifact through outputKey.
          output = loopResult.finalOutput;
          record.meta = {
            converged: loopResult.converged,
            iterations: loopResult.totalIterations,
            score: loopResult.finalVerification.score
          };
          state.context.lastOutput = loopResult.finalOutput;
          state.context.lastVerification = loopResult.finalVerification;
          state.context.loopSummary = record.meta;

          // The verification gate really did execute (once per iteration). Surface it on
          // the timeline so the DAG never shows an "unexecuted" node that actually ran.
          const gateNow = Date.now();
          const gateRecord: NodeExecutionRecord = {
            nodeId: verifyNode.id,
            nodeName: verifyNode.name,
            status: 'completed',
            startTime: gateNow,
            endTime: gateNow,
            input: null,
            output: {
              passed: loopResult.finalVerification.passed,
              score: loopResult.finalVerification.score,
              blocking: loopResult.finalVerification.blockingReasons ?? []
            },
            verification: loopResult.finalVerification,
            meta: { iterations: loopResult.totalIterations, score: loopResult.finalVerification.score }
          };
          this.appendRecord(state, gateRecord);
          hooks.onNodeStart?.(verifyNode, gateRecord);
          hooks.onNodeEnd?.(verifyNode, gateRecord);

          if (!loopResult.converged) {
            record.status = 'needs_human';
            record.output = output;
            record.endTime = Date.now();
            (record as any).escalation = loopResult.humanEscalation;
            this.appendRecord(state, record);
            hooks.onNodeEnd?.(node, record);
            return record;
          }
          break;
        }

        default:
          throw new Error(`node '${node.id}' has unsupported type '${(node as any).type}'`);
      }

      record.status = 'completed';
      record.output = output;
      record.endTime = Date.now();

      if (node.outputKey) state.context[node.outputKey] = output;
      if (node.type !== 'verification' && node.type !== 'self_loop') state.context.lastOutput = output;
    } catch (err: any) {
      record.status = 'failed';
      record.error = err?.message ?? String(err);
      record.endTime = Date.now();
      hooks.onLog?.(`node ${node.id} failed: ${record.error}`, { nodeId: node.id });
    }

    this.appendRecord(state, record);
    hooks.onNodeEnd?.(node, record);
    return record;
  }

  // ------------------------------------------------------------- checkpoints

  public rollback(executionId: string, state: WorkflowExecutionState): boolean {
    const stack = this.checkpoints.get(executionId);
    if (!stack || stack.length === 0) return false;
    const snap = stack[stack.length - 1];
    state.context = deepClone(snap);
    return true;
  }

  public getCheckpointCount(executionId: string): number {
    return this.checkpoints.get(executionId)?.length ?? 0;
  }

  // ------------------------------------------------------------------ private

  private async runAgentNode(
    node: WorkflowNode,
    state: WorkflowExecutionState,
    deadline: number,
    taskIdByNode: Map<string, string> | undefined,
    hooks: WorkflowHooks
  ): Promise<any> {
    const executeOnce = async (agentId: string) => {
      const agent = this.agentRegistry.get(agentId);
      if (!agent) throw new Error(`agent '${agentId}' is not registered`);

      const failedRules = Array.isArray(state.context.__failedRules) ? state.context.__failedRules : nodeContextFailures(state);

      const request = {
        taskId: `${state.workflowExecutionId}-${node.id}-i${state.context.__loopIteration ?? 1}`,
        agentId: agent.id,
        input: { ...state.context, goal: state.context.goal ?? node.description ?? node.name },
        context: state.context,
        iteration: typeof state.context.__loopIteration === 'number' ? state.context.__loopIteration : 1,
        criticGuidance: state.context.diagnosticFeedback as string | undefined,
        failedRules
      };

      const remaining = Math.max(500, deadline - Date.now());
      const budget = Math.min(remaining, node.timeoutMs ?? remaining);

      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`agent node '${node.id}' exceeded its ${budget}ms budget`)), budget);
      });

      try {
        const result = await Promise.race([agent.execute(request), timeout]);
        if (!result.success) throw new Error(result.error ?? 'agent execution failed');
        return result;
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    const deps = taskIdByNode ? Array.from(taskIdByNode.values()).slice(-1) : [];

    if (this.scheduler) {
      return this.scheduler.run(
        node,
        state.workflowExecutionId,
        state.workflowExecutionId,
        node.priority ?? 5,
        deps,
        async agent => {
          const res = await executeOnce(agent.id);
          taskIdByNode?.set(node.id, res.taskId);
          return res.output;
        }
      );
    }

    // no scheduler wired: resolve the agent directly
    const agentId =
      node.agentId ??
      this.agentRegistry.findBestAgent(node.agentCapability ?? 'general_task', 0.4)?.id;
    if (!agentId) {
      throw new Error(
        `no agent available for node '${node.id}' (capability '${node.agentCapability ?? 'general_task'}')`
      );
    }
    const res = await executeOnce(agentId);
    taskIdByNode?.set(node.id, res.taskId);
    hooks.onLog?.(`agent ${agentId} completed node ${node.id}`, { nodeId: node.id, agentId });
    return res.output;
  }

  /** last verification failures exposed to the next agent call */
  private appendRecord(state: WorkflowExecutionState, record: NodeExecutionRecord): void {
    (state.nodeRecords[record.nodeId] ??= []).push(record);
    if (record.verification?.failedRuleIds?.length) {
      state.context.__failedRules = record.verification.failedRuleIds.map(id => ({
        id,
        ruleName: 'upstream',
        message: record.verification!.blockingReasons?.find(b => b.includes(id)) ?? '',
        severity: 'critical'
      }));
    }
  }

  private resolveNextNode(
    node: WorkflowNode,
    record: NodeExecutionRecord,
    workflow: WorkflowDefinition,
    context: Record<string, any>
  ): string | null {
    if (node.type === 'condition' && record.branchTaken) return record.branchTaken;

    const outgoing = workflow.edges.filter(e => e.from === node.id);
    if (outgoing.length === 0) return null;

    for (const edge of outgoing) {
      if (!edge.condition || edge.condition(context)) return edge.to;
    }
    return null;
  }

  private buildNodeMap(workflow: WorkflowDefinition, errors: string[]): Map<string, WorkflowNode> {
    const map = new Map<string, WorkflowNode>();
    for (const node of workflow.nodes) {
      if (map.has(node.id)) errors.push(`duplicate node id '${node.id}'`);
      else map.set(node.id, node);
    }
    return map;
  }

  private reachableFrom(workflow: WorkflowDefinition, nodeMap: Map<string, WorkflowNode>): Set<string> {
    const reachable = new Set<string>();
    const queue = [workflow.entryNodeId];

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (reachable.has(id) || !nodeMap.has(id)) continue;
      reachable.add(id);

      for (const edge of workflow.edges) if (edge.from === id) queue.push(edge.to);

      const node = nodeMap.get(id)!;
      if (node.type === 'condition' && node.conditionFn) {
        // branch targets are dynamic; treat every outgoing edge as reachable
        for (const edge of workflow.edges) if (edge.from === id) queue.push(edge.to);
      }
      if (node.type === 'parallel_group') for (const c of node.parallelChildIds ?? []) queue.push(c);
      if (node.type === 'self_loop' && node.selfLoopConfig) {
        queue.push(node.selfLoopConfig.targetNodeId, node.selfLoopConfig.verificationNodeId);
      }
    }
    return reachable;
  }

  private findWorkflowOfNode(workflowId: string): WorkflowDefinition | undefined {
    const registered = Array.from(this.subworkflowRegistry.values()).find(w => w.id === workflowId);
    return registered;
  }

  private snapshotContext(context: Record<string, any>): Record<string, any> {
    const copy: Record<string, any> = {};
    for (const [k, v] of Object.entries(context)) {
      if (k.startsWith('__')) continue;
      copy[k] = v;
    }
    return copy;
  }

  private pushCheckpoint(executionId: string, context: Record<string, any>): void {
    const stack = this.checkpoints.get(executionId) ?? [];
    try {
      stack.push(deepClone(this.snapshotContext(context)));
    } catch {
      /* non-serialisable context: skip checkpoint rather than crash the run */
    }
    while (stack.length > 20) stack.shift();
    this.checkpoints.set(executionId, stack);
  }
}

function nodeContextFailures(state: WorkflowExecutionState): any[] {
  return Array.isArray(state.context.__failedRules) ? state.context.__failedRules : [];
}
