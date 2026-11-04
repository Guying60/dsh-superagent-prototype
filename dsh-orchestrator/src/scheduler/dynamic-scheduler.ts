/**
 * Dynamic Priority Scheduler
 *
 * Fixes vs. the previous version:
 * - priority aging no longer mutates `task.priority`. The old code did
 *   `task.priority = task.priority + floor(wait/tau)` on every poll, i.e. it *accumulated*
 *   the bonus, so after two dispatches every task saturated at 10 and the queue degenerated
 *   into FIFO. The documented formula (see PROPOSAL §4.1) is evaluated read-only:
 *       effective = min(10, base + floor((now - submittedAt) / tau))
 * - `dependencies` are actually enforced (they used to be accepted and ignored)
 * - capacity accounting uses a per-agent in-flight reservation, so two concurrent
 *   dispatches can never oversubscribe a slot
 * - failed tasks are requeued up to `maxRetries` and re-dispatched to the best *available*
 *   agent — a real fail-over path, not a silent drop
 */
import { ScheduledTask, SchedulerStats, WorkflowNode } from '../types/index.js';
import { AgentRegistry } from '../agent/agent-registry.js';
import { BaseAgent } from '../agent/base-agent.js';

export interface SchedulerOptions {
  /** aging period tau in ms */
  agingIntervalMs?: number;
  maxRetries?: number;
  pollIntervalMs?: number;
  /** hard wait budget before a queued task is declared starved */
  maxWaitMs?: number;
}

export type SchedulerEvent = (message: string, data?: Record<string, any>) => void;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, Math.max(1, ms)));

export class DynamicScheduler {
  private queue: ScheduledTask[] = [];
  private byId: Map<string, ScheduledTask> = new Map();
  private completedIds: Set<string> = new Set();
  private inflight: Map<string, number> = new Map();

  private readonly agingIntervalMs: number;
  private readonly maxRetries: number;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;

  private stats: SchedulerStats = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    dispatches: 0,
    agingPromotions: 0,
    maxObservedWaitMs: 0
  };

  constructor(
    private agentRegistry: AgentRegistry,
    options: SchedulerOptions = {},
    private onEvent?: SchedulerEvent
  ) {
    this.agingIntervalMs = options.agingIntervalMs ?? 5000;
    this.maxRetries = options.maxRetries ?? 1;
    this.pollIntervalMs = options.pollIntervalMs ?? 15;
    this.maxWaitMs = options.maxWaitMs ?? 60_000;
  }

  // ------------------------------------------------------------------ public

  public enqueue(
    node: WorkflowNode,
    runId: string,
    workflowExecutionId: string,
    priority = 5,
    dependencies: string[] = []
  ): ScheduledTask {
    const task: ScheduledTask = {
      id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      runId,
      workflowExecutionId,
      node,
      basePriority: Math.min(10, Math.max(1, Math.round(priority))),
      submittedAt: Date.now(),
      dependencies: [...dependencies],
      status: 'queued',
      attempts: 0
    };
    this.queue.push(task);
    this.byId.set(task.id, task);
    this.stats.queued++;
    return task;
  }

  /** The documented aging formula, evaluated without mutating the task. */
  public effectivePriority(task: ScheduledTask, now = Date.now()): number {
    const waited = Math.max(0, now - task.submittedAt);
    const bonus = Math.floor(waited / this.agingIntervalMs);
    return Math.min(10, task.basePriority + bonus);
  }

  public getStats(): SchedulerStats {
    return { ...this.stats, queued: this.queue.filter(t => t.status === 'queued').length };
  }

  public getPendingTasks(): ScheduledTask[] {
    const now = Date.now();
    return this.queue
      .filter(t => t.status === 'queued')
      .map(t => ({ ...t, effectivePriority: this.effectivePriority(t, now) }))
      .sort((a, b) => (b.effectivePriority ?? 0) - (a.effectivePriority ?? 0) || a.submittedAt - b.submittedAt);
  }

  public getInflight(agentId: string): number {
    return this.inflight.get(agentId) ?? 0;
  }

  public markDependencyComplete(taskId: string): void {
    this.completedIds.add(taskId);
  }

  /**
   * Wait until `taskId` is the highest effective-priority dispatchable task AND an agent
   * slot is free, then reserve that slot.
   */
  public async acquire(taskId: string): Promise<{ task: ScheduledTask; agent: BaseAgent }> {
    const deadline = Date.now() + this.maxWaitMs;

    for (;;) {
      const task = this.byId.get(taskId);
      if (!task) throw new Error(`Scheduler: unknown task '${taskId}'`);
      if (task.status === 'running' && task.assignedAgentId) {
        const agent = this.agentRegistry.get(task.assignedAgentId);
        if (agent) return { task, agent };
      }

      const now = Date.now();
      const queued = this.queue.filter(t => t.status === 'queued');
      const dispatchable = queued.filter(t => this.dependenciesMet(t));

      if (dispatchable.some(t => t.id === taskId)) {
        const head = dispatchable.reduce((best, t) =>
          this.effectivePriority(t, now) > this.effectivePriority(best, now) ||
          (this.effectivePriority(t, now) === this.effectivePriority(best, now) && t.submittedAt < best.submittedAt)
            ? t
            : best
        );

        if (head.id === taskId) {
          const agent = this.pickAgent(task);
          if (agent) {
            if (this.effectivePriority(task, now) > task.basePriority) this.stats.agingPromotions++;

            task.status = 'running';
            task.startedAt = now;
            task.assignedAgentId = agent.id;
            task.attempts++;
            this.inflight.set(agent.id, this.getInflight(agent.id) + 1);
            this.queue = this.queue.filter(t => t.id !== taskId);

            const wait = now - task.submittedAt;
            this.stats.maxObservedWaitMs = Math.max(this.stats.maxObservedWaitMs, wait);
            this.stats.dispatches++;
            this.stats.running++;

            this.onEvent?.(
              `dispatch ${task.node.name} → ${agent.profile.name} (p${this.effectivePriority(task, now)}${wait > 50 ? `, waited ${wait}ms` : ''})`,
              { taskId, agentId: agent.id, priority: this.effectivePriority(task, now), wait }
            );
            return { task, agent };
          }
        }
      }

      if (now > deadline) {
        throw new Error(`Scheduler: task '${taskId}' (${task.node.name}) starved after ${this.maxWaitMs}ms`);
      }
      await sleep(this.pollIntervalMs);
    }
  }

  /** Release a reserved slot; requeue on failure while retry budget remains. */
  public release(taskId: string, success: boolean, error?: string): 'completed' | 'retrying' | 'failed' {
    const task = this.byId.get(taskId);
    if (!task) return 'failed';

    if (task.assignedAgentId) {
      const next = Math.max(0, this.getInflight(task.assignedAgentId) - 1);
      this.inflight.set(task.assignedAgentId, next);
    }
    this.stats.running = Math.max(0, this.stats.running - 1);

    if (success) {
      task.status = 'completed';
      task.finishedAt = Date.now();
      this.markDependencyComplete(task.id);
      this.stats.completed++;
      return 'completed';
    }

    if (task.attempts <= this.maxRetries) {
      task.status = 'queued';
      task.assignedAgentId = undefined;
      task.submittedAt = Date.now();
      this.queue.push(task);
      this.stats.retried++;
      this.onEvent?.(`retry ${task.node.name} (attempt ${task.attempts + 1}/${this.maxRetries + 1})${error ? `: ${error}` : ''}`, { taskId });
      return 'retrying';
    }

    task.status = 'failed';
    task.finishedAt = Date.now();
    this.stats.failed++;
    return 'failed';
  }

  /**
   * Convenience wrapper used by the workflow engine: enqueue → acquire → run → release.
   */
  public async run<T>(
    node: WorkflowNode,
    runId: string,
    workflowExecutionId: string,
    priority: number,
    dependencies: string[],
    fn: (agent: BaseAgent, task: ScheduledTask) => Promise<T>
  ): Promise<T> {
    const task = this.enqueue(node, runId, workflowExecutionId, priority, dependencies);
    const { agent } = await this.acquire(task.id);

    try {
      const result = await fn(agent, task);
      this.release(task.id, true);
      return result;
    } catch (err: any) {
      const outcome = this.release(task.id, false, err?.message);
      if (outcome === 'retrying') {
        // re-acquire and try again (may land on a different, healthier agent)
        const retry = await this.acquire(task.id);
        try {
          const result = await fn(retry.agent, retry.task);
          this.release(task.id, true);
          return result;
        } catch (retryErr: any) {
          this.release(task.id, false, retryErr?.message);
          throw retryErr;
        }
      }
      throw err;
    }
  }

  // ----------------------------------------------------------------- private

  private dependenciesMet(task: ScheduledTask): boolean {
    if (task.dependencies.length === 0) return true;
    return task.dependencies.every(dep => {
      if (this.completedIds.has(dep)) return true;
      const other = this.byId.get(dep);
      return other ? other.status === 'completed' : true;
    });
  }

  private pickAgent(task: ScheduledTask): BaseAgent | undefined {
    const node = task.node;

    if (node.agentId) {
      const agent = this.agentRegistry.get(node.agentId);
      if (agent && this.hasSlot(agent)) return agent;
      // explicit pin has no room: fall through to capability routing as a fail-over
    }

    const capability = node.agentCapability;
    const candidates = this.agentRegistry
      .getAll()
      .filter(a => this.hasSlot(a))
      .filter(a => (capability ? (a.profile.capabilities[capability] ?? 0) >= 0.5 : true));

    if (candidates.length === 0) return undefined;

    const score = (a: BaseAgent) => {
      const cap = capability ? (a.profile.capabilities[capability] ?? 0) : 0.5;
      const load = this.getInflight(a.id) / Math.max(1, a.profile.maxConcurrency);
      return cap * 0.7 + (1 - load) * 0.3;
    };

    candidates.sort((a, b) => score(b) - score(a));
    return candidates[0];
  }

  private hasSlot(agent: BaseAgent): boolean {
    return this.getInflight(agent.id) < agent.profile.maxConcurrency;
  }
}
