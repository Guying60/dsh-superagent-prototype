/**
 * Base Agent — profile, sliding working memory, tool binding and a brain slot.
 *
 * Behaviour is delegated to an `AgentBrain`; this class only owns the deterministic
 * concerns: load accounting, memory window, token estimation and error isolation.
 */
import {
  AgentProfile,
  AgentExecutionRequest,
  AgentExecutionResult,
  ToolCallTrace,
  RuleFailure
} from '../types/index.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { AgentBrain, BrainContext, DeterministicBrain, estimateTokens } from './brain.js';

export interface AgentMemoryEntry {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

const MEMORY_WINDOW = 50;

export class BaseAgent {
  public profile: AgentProfile;
  protected memory: AgentMemoryEntry[] = [];
  protected toolRegistry?: ToolRegistry;
  protected brain: AgentBrain;

  constructor(profile: AgentProfile, toolRegistry?: ToolRegistry, brain?: AgentBrain) {
    // deep-ish copy so external mutation of the profile cannot silently corrupt the agent
    this.profile = {
      ...profile,
      capabilities: { ...profile.capabilities },
      toolIds: [...profile.toolIds]
    };
    this.toolRegistry = toolRegistry;
    this.brain = brain ?? new DeterministicBrain();
  }

  public get id(): string {
    return this.profile.id;
  }

  public get role(): string {
    return this.profile.role;
  }

  public get currentLoad(): number {
    return this.profile.currentLoad;
  }

  public get brainName(): string {
    return this.brain.name;
  }

  public setBrain(brain: AgentBrain): void {
    this.brain = brain;
  }

  public addMemory(entry: Omit<AgentMemoryEntry, 'timestamp'>): void {
    this.memory.push({ ...entry, timestamp: Date.now() });
    while (this.memory.length > MEMORY_WINDOW) this.memory.shift();
  }

  public getMemories(): AgentMemoryEntry[] {
    return [...this.memory];
  }

  public clearMemory(): void {
    this.memory = [];
  }

  public updateSystemPrompt(newPrompt: string): void {
    this.profile.systemPrompt = newPrompt;
  }

  /** Reject execution when the agent is already at its concurrency ceiling. */
  public hasCapacity(): boolean {
    return this.profile.currentLoad < this.profile.maxConcurrency;
  }

  public async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    this.profile.currentLoad++;

    const failedRules: RuleFailure[] = request.failedRules ?? [];

    try {
      this.addMemory({
        role: 'user',
        content: JSON.stringify(request.input).slice(0, 2000),
        metadata: { taskId: request.taskId, iteration: request.iteration }
      });

      const ctx: BrainContext = {
        agent: this.profile,
        request,
        failedRules,
        iteration: request.iteration ?? 1,
        criticGuidance: request.criticGuidance,
        memory: this.memory.slice(-8).map(m => ({ role: m.role, content: m.content })),
        callTool: (toolId, params) => this.callTool(toolId, params)
      };

      const res = await this.brain.think(ctx);

      const reasoning = res.reasoning || '';
      const tokensUsed =
        res.tokensUsed ??
        estimateTokens(reasoning, JSON.stringify(request.input), JSON.stringify(res.output ?? null));

      this.profile.totalTokensUsed += tokensUsed;

      const outputText = typeof res.output === 'string' ? res.output : JSON.stringify(res.output ?? null);
      this.addMemory({
        role: 'assistant',
        content: outputText.slice(0, 2000),
        metadata: { taskId: request.taskId, confidence: res.confidence, iteration: request.iteration }
      });

      return {
        taskId: request.taskId,
        agentId: this.profile.id,
        success: true,
        output: res.output,
        reasoning,
        toolCalls: res.toolCalls ?? [],
        confidence: res.confidence ?? 0.9,
        tokensUsed,
        durationMs: Date.now() - startTime
      };
    } catch (err: any) {
      const message = err?.message ?? String(err);
      return {
        taskId: request.taskId,
        agentId: this.profile.id,
        success: false,
        output: null,
        reasoning: `Agent execution failed: ${message}`,
        toolCalls: [],
        confidence: 0,
        tokensUsed: estimateTokens(message),
        durationMs: Date.now() - startTime,
        error: message
      };
    } finally {
      this.profile.currentLoad = Math.max(0, this.profile.currentLoad - 1);
    }
  }

  /** Invoke an authorized tool and always return a trace instead of throwing. */
  public async callTool(toolId: string, params: any): Promise<ToolCallTrace> {
    const start = Date.now();

    if (!this.toolRegistry) {
      return { toolId, input: params, output: null, durationMs: 0, success: false, error: `ToolRegistry not bound to agent ${this.profile.id}` };
    }
    if (!this.profile.toolIds.includes(toolId)) {
      return { toolId, input: params, output: null, durationMs: 0, success: false, error: `Tool '${toolId}' is not authorized for agent '${this.profile.id}'` };
    }

    try {
      const output = await this.toolRegistry.invoke(toolId, params);
      return { toolId, input: params, output, durationMs: Date.now() - start, success: true };
    } catch (err: any) {
      return { toolId, input: params, output: null, durationMs: Date.now() - start, success: false, error: err?.message ?? String(err) };
    }
  }
}
