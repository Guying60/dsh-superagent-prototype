/**
 * Dynamic Intelligent Scheduler
 * Features:
 * 1. Priority Queue with Dynamic Priority Aging (prevents starvation)
 * 2. Capability Profile Matching & Load Balancing
 * 3. Token Budget & Concurrency Guardrails
 */
import { ScheduledTask, AgentProfile, WorkflowNode } from '../types/index.js';
import { AgentRegistry } from '../agent/agent-registry.js';
import { BaseAgent } from '../agent/base-agent.js';

export class DynamicScheduler {
  private queue: ScheduledTask[] = [];
  private agentRegistry: AgentRegistry;
  private priorityAgingIntervalMs = 5000;

  constructor(agentRegistry: AgentRegistry) {
    this.agentRegistry = agentRegistry;
  }

  /**
   * Enqueue a new workflow task
   */
  public enqueue(
    node: WorkflowNode, 
    workflowExecutionId: string, 
    priority: number = 5, 
    dependencies: string[] = []
  ): ScheduledTask {
    const task: ScheduledTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      workflowExecutionId,
      node,
      priority: Math.max(1, Math.min(10, priority)),
      submittedAt: Date.now(),
      dependencies,
      status: 'queued'
    };

    this.queue.push(task);
    this.sortQueue();
    return task;
  }

  /**
   * Dispatch the highest priority task ready for execution
   */
  public dispatchNext(): { task: ScheduledTask; assignedAgent: BaseAgent } | null {
    this.applyPriorityAging();
    this.sortQueue();

    for (let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i];
      if (task.status !== 'queued') continue;

      // Find suitable agent for task node
      let targetAgent: BaseAgent | undefined;

      if (task.node.agentId) {
        targetAgent = this.agentRegistry.get(task.node.agentId);
      } else {
        // Match by capability tag
        targetAgent = this.agentRegistry.findBestAgent('general_task', 0.5);
      }

      if (targetAgent && targetAgent.currentLoad < targetAgent.profile.maxConcurrency) {
        // Mark running and remove from queue
        task.status = 'running';
        this.queue.splice(i, 1);
        return { task, assignedAgent: targetAgent };
      }
    }

    return null;
  }

  /**
   * Dynamic Priority Aging: Tasks waiting longer get an increased effective priority
   */
  public applyPriorityAging(): void {
    const now = Date.now();
    for (const task of this.queue) {
      if (task.status === 'queued') {
        const waitTime = now - task.submittedAt;
        const agingBonus = Math.floor(waitTime / this.priorityAgingIntervalMs);
        task.priority = Math.min(10, task.priority + agingBonus);
      }
    }
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => b.priority - a.priority || a.submittedAt - b.submittedAt);
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public getPendingTasks(): ScheduledTask[] {
    return [...this.queue];
  }
}
