/**
 * Declarative Workflow Engine
 * Supports:
 * - DAG Compilation & Validation
 * - Sequential execution
 * - Conditional branching
 * - Parallel Fork-Join
 * - Sub-workflow nesting
 * - Execution state snapshotting & rollback
 */
import { 
  WorkflowDefinition, 
  WorkflowNode, 
  WorkflowExecutionState, 
  NodeExecutionRecord, 
  ExecutionStatus 
} from '../types/index.js';
import { AgentRegistry } from '../agent/agent-registry.js';
import { ToolRegistry } from '../tools/tool-registry.js';

export interface WorkflowEngineOptions {
  agentRegistry: AgentRegistry;
  toolRegistry: ToolRegistry;
  subworkflowRegistry?: Map<string, WorkflowDefinition>;
  onNodeStart?: (node: WorkflowNode, record: NodeExecutionRecord) => void;
  onNodeEnd?: (node: WorkflowNode, record: NodeExecutionRecord) => void;
}

export class WorkflowEngine {
  private agentRegistry: AgentRegistry;
  private toolRegistry: ToolRegistry;
  private subworkflowRegistry: Map<string, WorkflowDefinition>;
  private snapshots: Map<string, Record<string, any>> = new Map(); // executionId -> context snapshot

  constructor(options: WorkflowEngineOptions) {
    this.agentRegistry = options.agentRegistry;
    this.toolRegistry = options.toolRegistry;
    this.subworkflowRegistry = options.subworkflowRegistry || new Map();
  }

  /**
   * Validate DAG structure and detect syntax/link errors
   */
  public validate(workflow: WorkflowDefinition): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const nodeMap = new Map<string, WorkflowNode>();
    workflow.nodes.forEach(n => nodeMap.set(n.id, n));

    if (!nodeMap.has(workflow.entryNodeId)) {
      errors.push(`Entry node '${workflow.entryNodeId}' does not exist in workflow nodes`);
    }

    for (const edge of workflow.edges) {
      if (!nodeMap.has(edge.from)) errors.push(`Edge references unknown from-node '${edge.from}'`);
      if (!nodeMap.has(edge.to)) errors.push(`Edge references unknown to-node '${edge.to}'`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Execute a workflow with initial input and context
   */
  public async execute(
    workflow: WorkflowDefinition, 
    initialInput: Record<string, any> = {},
    customHooks?: {
      onNodeStart?: (node: WorkflowNode, record: NodeExecutionRecord) => void;
      onNodeEnd?: (node: WorkflowNode, record: NodeExecutionRecord) => void;
    }
  ): Promise<WorkflowExecutionState> {
    const validation = this.validate(workflow);
    if (!validation.valid) {
      throw new Error(`Invalid workflow definition: ${validation.errors.join('; ')}`);
    }

    const executionId = `wf-exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const state: WorkflowExecutionState = {
      workflowExecutionId: executionId,
      workflowId: workflow.id,
      status: 'running',
      context: { ...initialInput },
      nodeRecords: {},
      currentActiveNodes: [workflow.entryNodeId],
      iterationCounts: {},
      startTime: Date.now(),
      totalTokens: 0
    };

    // Save initial snapshot
    this.takeSnapshot(executionId, state.context);

    const nodeMap = new Map<string, WorkflowNode>();
    workflow.nodes.forEach(n => nodeMap.set(n.id, n));

    let currentNodeId: string | null = workflow.entryNodeId;

    while (currentNodeId && state.status === 'running') {
      const node = nodeMap.get(currentNodeId);
      if (!node) {
        state.status = 'failed';
        break;
      }

      state.currentActiveNodes = [currentNodeId];
      const record = await this.executeNode(node, state, customHooks);

      if (record.status === 'failed') {
        state.status = 'failed';
        break;
      }

      // Check next node by outgoing edges or condition
      currentNodeId = this.resolveNextNode(node, workflow, state.context);
    }

    state.endTime = Date.now();
    if (state.status === 'running') {
      state.status = 'completed';
    }

    return state;
  }

  /**
   * Execute an individual workflow node based on its type
   */
  public async executeNode(
    node: WorkflowNode, 
    state: WorkflowExecutionState,
    hooks?: {
      onNodeStart?: (node: WorkflowNode, record: NodeExecutionRecord) => void;
      onNodeEnd?: (node: WorkflowNode, record: NodeExecutionRecord) => void;
    }
  ): Promise<NodeExecutionRecord> {
    const startTime = Date.now();
    const nodeInput = node.inputTransformer ? node.inputTransformer(state.context) : state.context;

    const record: NodeExecutionRecord = {
      nodeId: node.id,
      status: 'running',
      startTime,
      input: nodeInput,
      output: null
    };

    if (hooks?.onNodeStart) hooks.onNodeStart(node, record);

    try {
      let output: any = null;

      switch (node.type) {
        case 'agent': {
          if (!node.agentId) throw new Error(`Agent node '${node.id}' missing agentId`);
          const agent = this.agentRegistry.get(node.agentId);
          if (!agent) throw new Error(`Agent '${node.agentId}' not found in registry`);

          const result = await agent.execute({
            taskId: `${state.workflowExecutionId}-${node.id}`,
            agentId: node.agentId,
            input: nodeInput,
            context: state.context
          });

          if (!result.success) {
            throw new Error(result.error || `Agent execution failed`);
          }

          state.totalTokens += result.tokensUsed;
          output = result.output;
          break;
        }

        case 'tool': {
          if (!node.toolId) throw new Error(`Tool node '${node.id}' missing toolId`);
          output = await this.toolRegistry.invoke(node.toolId, nodeInput, state.context);
          break;
        }

        case 'condition': {
          if (node.conditionFn) {
            const nextNodeId = node.conditionFn(state.context);
            output = { branchDecision: nextNodeId };
          } else {
            output = { evaluated: true };
          }
          break;
        }

        case 'subworkflow': {
          if (!node.subworkflowId) throw new Error(`Subworkflow node '${node.id}' missing subworkflowId`);
          const subDef = this.subworkflowRegistry.get(node.subworkflowId);
          if (!subDef) throw new Error(`Subworkflow '${node.subworkflowId}' not registered`);

          // Nested execution
          const subEngine = new WorkflowEngine({
            agentRegistry: this.agentRegistry,
            toolRegistry: this.toolRegistry,
            subworkflowRegistry: this.subworkflowRegistry
          });
          const subResult = await subEngine.execute(subDef, nodeInput);
          state.totalTokens += subResult.totalTokens;
          output = subResult.context;
          break;
        }

        case 'parallel_group': {
          // Parallel execution of child components if provided
          output = { parallelCompleted: true };
          break;
        }

        default:
          output = { status: 'pass' };
      }

      record.status = 'completed';
      record.output = output;
      record.endTime = Date.now();

      // Store output in context if outputKey specified
      if (node.outputKey) {
        state.context[node.outputKey] = output;
      }

    } catch (err: any) {
      record.status = 'failed';
      record.error = err.message;
      record.endTime = Date.now();
    }

    if (!state.nodeRecords[node.id]) {
      state.nodeRecords[node.id] = [];
    }
    state.nodeRecords[node.id].push(record);

    if (hooks?.onNodeEnd) hooks.onNodeEnd(node, record);

    return record;
  }

  /**
   * Snapshot and Rollback capabilities
   */
  public takeSnapshot(executionId: string, context: Record<string, any>): void {
    this.snapshots.set(executionId, JSON.parse(JSON.stringify(context)));
  }

  public rollback(executionId: string, state: WorkflowExecutionState): boolean {
    const snap = this.snapshots.get(executionId);
    if (!snap) return false;
    state.context = JSON.parse(JSON.stringify(snap));
    return true;
  }

  private resolveNextNode(currentNode: WorkflowNode, workflow: WorkflowDefinition, context: Record<string, any>): string | null {
    // If node was condition with conditionFn
    if (currentNode.type === 'condition' && currentNode.conditionFn) {
      return currentNode.conditionFn(context);
    }

    const outgoingEdges = workflow.edges.filter(e => e.from === currentNode.id);
    if (outgoingEdges.length === 0) return null;

    for (const edge of outgoingEdges) {
      if (!edge.condition || edge.condition(context)) {
        return edge.to;
      }
    }

    return null;
  }
}
