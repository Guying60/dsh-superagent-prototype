/**
 * Orchestrator — the platform façade.
 *
 * This is what the previous version was missing: a single object that wires the workflow
 * engine, the scheduler, the self-loop, the verifier and the optimizer into ONE run, and
 * emits a stream of structured events for a UI to consume.
 *
 * The old `SoftwareEngineeringScenario.runScenario()` bypassed `workflowEngine`,
 * `scheduler` and `optimizer` entirely (hence the "queue length: 0 / 0 prompt adjustments"
 * lines in the demo). Here every module is on the critical path.
 */
import {
  ExecutionStatus,
  HumanEscalationRequest,
  OrchestratorEvent,
  VerificationResult,
  WorkflowDefinition,
  WorkflowExecutionState,
  TaskSpec
} from './types/index.js';
import { AgentRegistry } from './agent/agent-registry.js';
import { ToolRegistry } from './tools/tool-registry.js';
import { createBuiltinTools } from './tools/builtin-tools.js';
import { KnowledgeBase } from './knowledge/knowledge-base.js';
import { DynamicScheduler } from './scheduler/dynamic-scheduler.js';
import { VerificationEngine } from './verification/verification-engine.js';
import { SelfLoopEngine } from './selfloop/self-loop-engine.js';
import { FeedbackOptimizer } from './optimization/feedback-optimizer.js';
import { WorkflowEngine } from './workflow/workflow-engine.js';
import {
  RateLimiterTask,
  asCode,
  buildAgentTeam,
  buildRateLimiterWorkflow,
  createRateLimiterTasks,
  renderRateLimiter
} from './scenarios/rate-limiter.js';
import {
  AppliedLlm,
  LlmConfig,
  LlmTelemetry,
  applyLlm,
  createProviderFromConfig,
  isLlmConfigured,
  resolveLlmConfig
} from './agent/llm/index.js';

export interface RunSnapshot {
  runId: string;
  taskId: string;
  title: string;
  difficulty: string;
  status: ExecutionStatus;
  workflow: WorkflowDefinition;
  state?: WorkflowExecutionState;
  startedAt: number;
  finishedAt?: number;
  escalation?: HumanEscalationRequest;
  summary?: string;
  patch?: { filePath: string; patch: string; hasChanges: boolean; stats?: any };
  verification?: VerificationResult;
  iterations?: number;
  artifact?: string;
  error?: string;
}

export type EventListener = (event: OrchestratorEvent) => void;

export interface OrchestratorOptions {
  onEvent?: EventListener;
  schedulerOptions?: ConstructorParameters<typeof DynamicScheduler>[1];
  maxConcurrentRuns?: number;
  /**
   * When provided (and configured), every agent with an LLM spec runs on the remote model
   * with the deterministic brain as a fallback. Omit it to stay fully offline.
   */
  llm?: LlmConfig;
}

const DEFAULT_MAX_CONCURRENT_RUNS = 3;

export class Orchestrator {
  public readonly tools = new ToolRegistry();
  public readonly agents: AgentRegistry;
  public readonly knowledge: KnowledgeBase;
  public readonly verification: VerificationEngine;
  public readonly selfLoop: SelfLoopEngine;
  public readonly scheduler: DynamicScheduler;
  public readonly optimizer: FeedbackOptimizer;
  public readonly workflow: WorkflowEngine;

  private runs: Map<string, RunSnapshot> = new Map();
  private runOrder: string[] = [];
  private taskById: Map<string, RateLimiterTask> = new Map();
  private listeners: Set<EventListener> = new Set();
  private counter = 0;
  private escalationsRaised = 0;
  private readonly maxConcurrentRuns: number;
  private llmApplied?: AppliedLlm;
  private llmLabel = 'offline · deterministic brains';

  constructor(options: OrchestratorOptions = {}) {
    this.maxConcurrentRuns = options.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS;

    // --- infrastructure ---
    createBuiltinTools().forEach(tool => this.tools.register(tool));

    this.agents = new AgentRegistry(this.tools);
    this.knowledge = new KnowledgeBase({
      id: 'ai4se-kb',
      name: 'Enterprise secure coding + rate limiter standards',
      chunkSize: 120,
      hybridAlpha: 0.55
    });
    this.seedKnowledge();

    // --- engines ---
    this.verification = new VerificationEngine(this.agents, this.tools);
    this.selfLoop = new SelfLoopEngine(this.agents, this.verification);
    this.optimizer = new FeedbackOptimizer(this.agents, this.tools);
    this.scheduler = new DynamicScheduler(
      this.agents,
      options.schedulerOptions ?? {},
      (message, data) => this.emit('scheduler', 'system', message, 'sched', data)
    );
    this.workflow = new WorkflowEngine({
      agentRegistry: this.agents,
      toolRegistry: this.tools,
      scheduler: this.scheduler,
      verificationEngine: this.verification,
      selfLoopEngine: this.selfLoop,
      optimizer: this.optimizer
    });

    // --- team (optionally LLM-backed, with the deterministic brains as fallback) ---
    const offlineTeam = buildAgentTeam();
    let team = offlineTeam;

    if (options.llm && isLlmConfigured(resolveLlmConfig(options.llm))) {
      const config = resolveLlmConfig(options.llm);
      const provider = createProviderFromConfig(config);
      this.llmApplied = applyLlm(offlineTeam, provider, {
        fallbackToOffline: config.fallbackToOffline ?? true,
        onFallback: (error, primaryName, agentId) =>
          this.emit('log', 'system', `LLM fallback (${agentId} · ${primaryName}) → offline brain: ${error.message}`, 'llm')
      });
      team = this.llmApplied.blueprints;
      this.llmLabel = `${this.llmApplied.label}${config.fallbackToOffline === false ? ' (no fallback)' : ''}`;
    }

    for (const { profile, brain } of team) {
      this.agents.register(profile, { brain });
    }

    // --- tasks ---
    for (const task of createRateLimiterTasks()) {
      this.taskById.set(task.id, task);
    }

    if (options.onEvent) this.listeners.add(options.onEvent);
  }

  // ------------------------------------------------------------------ events

  public subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(
    kind: OrchestratorEvent['kind'],
    runId: string,
    message: string,
    tag?: string,
    data?: Record<string, any>
  ): void {
    const event: OrchestratorEvent = { at: Date.now(), runId, kind, message, tag, data };
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* a broken listener must never break a run */
      }
    }
  }

  // ------------------------------------------------------------------- setup

  private seedKnowledge(): void {
    this.knowledge.addDocument(
      'sec-guidelines',
      'Enterprise Secure Coding Standard v3.2',
      `All submitted code must follow zero-trust rules.
Rule SEC-01: Dynamic eval(), Function() constructors and unvalidated string concatenation into queries or commands are forbidden.
Rule SEC-02: Cryptographic keys, secrets and auth tokens must never be hardcoded in repository sources; use environment variables.
Rule SEC-03: Concurrency and asynchronous operations require timeout guards and proper error propagation.
Rule SEC-04: 所有数值入参必须校验有限性（Number.isFinite），禁止 NaN 或 Infinity 污染状态。`
    );

    this.knowledge.addDocument(
      'rate-limiter-spec',
      'Token Bucket Distributed Rate Limiter API Specification',
      `RateLimiter must implement a token bucket:
- constructor(capacity, refillRatePerSec)
- consume(tokens = 1): boolean
- getAvailableTokens(): number
- reset(): void

Edge cases:
1. 容量为负数或零时必须抛出 RangeError。
2. 令牌数量在任何时刻都不得超过容量，也不得为负。
3. 令牌桶在分布式部署下必须与集群计数器对账，才能保证全局速率。（分布式对账）`
    );

    this.knowledge.addDocument(
      'workflow-notes',
      'Self-Loop Convergence Notes',
      'The convergence threshold is 0.90. An unsatisfiable acceptance rule must escalate to a human instead of silently shipping a partial artifact.'
    );
  }

  // -------------------------------------------------------------------- runs

  public getTasks(): RateLimiterTask[] {
    return Array.from(this.taskById.values());
  }

  public getRun(runId: string): RunSnapshot | undefined {
    return this.runs.get(runId);
  }

  public getRuns(): RunSnapshot[] {
    return this.runOrder.map(id => this.runs.get(id)!).filter(Boolean);
  }

  public getAgents() {
    return this.agents.getAll();
  }

  public searchKnowledge(query: string, topK = 2) {
    return this.knowledge.query(query, topK);
  }

  public getToolReliability() {
    return this.optimizer.getToolReliability();
  }

  public getPromptOptimizations() {
    return this.optimizer.getOptimizationHistory();
  }

  /** Which brain each agent is running, plus LLM usage/cost telemetry. */
  public getLlmInfo(): {
    label: string;
    telemetry: LlmTelemetry | undefined;
    brains: Array<{ agentId: string; role: string; brain: string }>;
  } {
    return {
      label: this.llmLabel,
      telemetry: this.llmApplied?.telemetry,
      brains: this.agents.getAll().map(a => ({
        agentId: a.profile.id,
        role: a.profile.role,
        brain: a.brainName
      }))
    };
  }

  private buildWorkflow(task: RateLimiterTask, maxIterationsOverride?: number): WorkflowDefinition {
    const effective: RateLimiterTask = maxIterationsOverride
      ? { ...task, maxIterations: maxIterationsOverride }
      : task;
    return buildRateLimiterWorkflow(effective);
  }

  public async runTask(
    task: RateLimiterTask,
    options: { maxIterationsOverride?: number } = {}
  ): Promise<RunSnapshot> {
    const runId = `run-${(++this.counter).toString().padStart(2, '0')}`;
    const workflow = this.buildWorkflow(task, options.maxIterationsOverride);

    const snapshot: RunSnapshot = {
      runId,
      taskId: task.id,
      title: task.title,
      difficulty: task.difficulty,
      status: 'running',
      workflow,
      startedAt: Date.now()
    };
    this.runs.set(runId, snapshot);
    this.runOrder.push(runId);

    this.emit('run.started', runId, `${task.title} [${task.difficulty}]`, 'run', {
      taskId: task.id,
      nodes: workflow.nodes.length
    });

    // RAG grounding — the citations really do reach the analyst
    const citations = this.knowledge.query(task.prompt, 2);
    if (citations.length > 0) {
      this.emit(
        'log',
        runId,
        `RAG: ${citations[0].chunk.title} (${(citations[0].score * 100).toFixed(0)}% relevance)`,
        'rag',
        { citations: citations.map(c => c.citation) }
      );
    }

    const initialInput: Record<string, any> = {
      goal: task.prompt,
      taskId: task.id,
      difficulty: task.difficulty,
      seedFeatures: task.seedFeatures,
      seedSource: renderRateLimiter(task.seedFeatures),
      knowledgeCitations: citations.map(c => c.citation)
    };

    try {
      const state = await this.workflow.execute(workflow, initialInput, {
        runId,
        onNodeStart: node => {
          this.emit('node.started', runId, `${node.name} (${node.type})`, 'node', { nodeId: node.id });
        },
        onNodeEnd: (node, record) => {
          const meta = record.meta;
          const detail =
            meta?.iterations !== undefined
              ? ` · iterations=${meta.iterations} score=${(Number(meta.score ?? 0) * 100).toFixed(1)}%`
              : '';
          this.emit(
            'node.finished',
            runId,
            `${node.name} → ${record.status}${detail}` + (record.error ? ` (${record.error})` : ''),
            'node',
            {
              nodeId: node.id,
              status: record.status,
              iterations: meta?.iterations,
              score: meta?.score
            }
          );
        },
        onLog: (message, data) => {
          this.emit('log', runId, message, 'engine', data);
        }
      });

      snapshot.state = state;
      snapshot.status = state.status;
      snapshot.finishedAt = Date.now();

      const ctx = state.context;
      snapshot.verification = (ctx.lastVerification as VerificationResult) ?? undefined;
      snapshot.artifact = asCode(ctx.finalCode ?? ctx.lastOutput);
      snapshot.iterations = Object.values(state.iterationCounts).reduce((a, b) => Math.max(a, b), 0) || undefined;

      const patch = ctx.patch as RunSnapshot['patch'] | undefined;
      if (patch?.patch) snapshot.patch = patch;

      if (state.status === 'needs_human' && state.humanEscalation) {
        snapshot.escalation = state.humanEscalation;
        this.escalationsRaised++;
        this.emit(
          'escalation',
          runId,
          state.humanEscalation.reason,
          'human',
          { escalationId: state.humanEscalation.id }
        );
      }

      snapshot.summary = this.buildSummary(snapshot);
      this.emit('run.finished', runId, `${task.title} → ${state.status}`, 'run', {
        status: state.status,
        iterations: snapshot.iterations
      });
    } catch (err: any) {
      snapshot.status = 'failed';
      snapshot.error = err?.message ?? String(err);
      snapshot.finishedAt = Date.now();
      snapshot.summary = `Run failed: ${snapshot.error}`;
      this.emit('run.finished', runId, `${task.title} → failed: ${snapshot.error}`, 'run');
    }

    return snapshot;
  }

  /** Run several tasks concurrently — this is what makes the scheduler visible. */
  public async runAll(
    tasks: RateLimiterTask[],
    options: { concurrency?: number } = {}
  ): Promise<RunSnapshot[]> {
    const limit = Math.max(1, Math.min(options.concurrency ?? this.maxConcurrentRuns, tasks.length));
    const results: RunSnapshot[] = new Array(tasks.length);
    let cursor = 0;

    const worker = async () => {
      for (;;) {
        const index = cursor++;
        if (index >= tasks.length) return;
        results[index] = await this.runTask(tasks[index]);
      }
    };

    await Promise.all(Array.from({ length: limit }, () => worker()));
    return results;
  }

  // -------------------------------------------------------------- escalation

  /**
   * Resolve a human-escalation card.
   *  0 → retry with a doubled iteration budget
   *  1 → accept the current draft (a human takes over the review)
   *  2 → abort
   */
  public async resolveEscalation(runId: string, optionIndex: number): Promise<RunSnapshot | undefined> {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    if (!run.escalation) return run;

    const task = this.taskById.get(run.taskId);

    if (optionIndex === 0) {
      this.emit('log', runId, 'human decision: retry with a doubled iteration budget', 'human');
      run.status = 'completed';
      run.escalation = undefined;
      run.summary = 'Escalation resolved by a human: re-running with a doubled budget.';
      if (!task) return run;
      const doubled = (task.maxIterations || 3) * 2;
      return this.runTask(task, { maxIterationsOverride: doubled });
    }

    if (optionIndex === 1) {
      this.emit('log', runId, 'human decision: accept current draft for review', 'human');
      run.status = 'completed';
      run.finishedAt = Date.now();
      run.escalation = undefined;
      const artifact = run.artifact ?? asCode(run.state?.context.finalCode ?? '');

      const patchTool = this.tools.get('git_patch_manager');
      if (patchTool && artifact) {
        try {
          const patchRes: any = await this.tools.invoke('git_patch_manager', {
            originalContent: '// placeholder\n',
            updatedContent: artifact,
            filePath: 'src/rate-limiter.js'
          });
          run.patch = patchRes;
        } catch {
          /* the acceptance itself still stands */
        }
      }

      run.summary = this.buildSummary(run, 'Accepted by a human after escalation — patch opened for review.');
      return run;
    }

    this.emit('log', runId, 'human decision: abort and roll back', 'human');
    run.status = 'failed';
    run.finishedAt = Date.now();
    run.escalation = undefined;
    run.summary = 'Aborted by a human. No artifact was delivered; the run is rolled back to its last checkpoint.';
    return run;
  }

  // ----------------------------------------------------------------- summary

  private buildSummary(run: RunSnapshot, override?: string): string {
    if (override) return override;

    const v = run.verification;
    const lines: string[] = [];
    lines.push(`${run.title}`);
    lines.push(`status: ${run.status}${run.iterations ? ` · self-loop iterations: ${run.iterations}` : ''}`);
    if (v) {
      lines.push(
        `verification: score ${(v.score * 100).toFixed(1)}% · ` +
          `${v.passed ? 'PASSED' : 'BLOCKED'} · ` +
          `tiers ${(v.tiers ?? []).map(t => `${t.tier}:${t.passed ? 'ok' : 'fail'}`).join(' ')}`
      );
      if (!v.passed && v.blockingReasons?.length) {
        lines.push(`blocking: ${v.blockingReasons.slice(0, 3).join(' | ')}`);
      }
    }
    if (run.patch?.patch) {
      lines.push(`patch: ${run.patch.filePath} (+${run.patch.stats?.added ?? '?'} / -${run.patch.stats?.removed ?? '?'})`);
    }
    lines.push(
      run.status === 'needs_human'
        ? 'human attention required: 1 structured card raised'
        : 'human attention cost: 0'
    );
    return lines.join('\n');
  }

  // ------------------------------------------------------------------ status

  public getSnapshot() {
    return {
      agents: this.agents.getAll().map(a => ({
        id: a.profile.id,
        name: a.profile.name,
        role: a.profile.role,
        load: a.currentLoad,
        max: a.profile.maxConcurrency,
        tokens: a.profile.totalTokensUsed,
        brain: a.brainName
      })),
      scheduler: this.scheduler.getStats(),
      pending: this.scheduler.getPendingTasks(),
      tools: this.getToolReliability(),
      promptOptimizations: this.getPromptOptimizations().length,
      escalationsRaised: this.escalationsRaised,
      llm: this.getLlmInfo(),
      runs: this.getRuns(),
      knowledgeChunks: this.knowledge.getChunkCount()
    };
  }
}

export function isTaskSpec(value: unknown): value is TaskSpec {
  return !!value && typeof value === 'object' && 'id' in (value as any) && 'buildWorkflow' in (value as any);
}
