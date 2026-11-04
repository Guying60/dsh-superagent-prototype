/**
 * Base Agent Implementation with Memory, Tools Binding & Execution Loop
 */
import { 
  AgentProfile, 
  AgentExecutionRequest, 
  AgentExecutionResult, 
  ToolCallTrace 
} from '../types/index.js';
import { ToolRegistry } from '../tools/tool-registry.js';

export interface AgentMemoryEntry {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export class BaseAgent {
  public profile: AgentProfile;
  protected memory: AgentMemoryEntry[] = [];
  protected toolRegistry?: ToolRegistry;

  constructor(profile: AgentProfile, toolRegistry?: ToolRegistry) {
    this.profile = { ...profile };
    this.toolRegistry = toolRegistry;
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

  public addMemory(entry: Omit<AgentMemoryEntry, 'timestamp'>): void {
    this.memory.push({
      ...entry,
      timestamp: Date.now()
    });
    // keep sliding window of recent memories
    if (this.memory.length > 50) {
      this.memory.shift();
    }
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

  /**
   * Execute task logic. Supports deterministic execution, tool calls, and LLM reasoning.
   */
  public async execute(
    request: AgentExecutionRequest, 
    customHandler?: (req: AgentExecutionRequest, agent: BaseAgent) => Promise<{ output: any; reasoning: string; toolCalls?: ToolCallTrace[]; confidence?: number }>
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    this.profile.currentLoad++;

    try {
      this.addMemory({
        role: 'user',
        content: JSON.stringify(request.input),
        metadata: { taskId: request.taskId }
      });

      let output: any;
      let reasoning = '';
      let toolCalls: ToolCallTrace[] = [];
      let confidence = 0.90;

      if (customHandler) {
        const res = await customHandler(request, this);
        output = res.output;
        reasoning = res.reasoning;
        toolCalls = res.toolCalls || [];
        if (res.confidence !== undefined) confidence = res.confidence;
      } else {
        // Default simulated reasoning based on role and capabilities
        reasoning = `[${this.profile.name}] Analyzed input using capabilities: ${Object.keys(this.profile.capabilities).join(', ')}`;
        output = {
          processedBy: this.profile.id,
          role: this.profile.role,
          result: `Default execution output for task ${request.taskId}`,
          receivedInput: request.input
        };
      }

      const durationMs = Date.now() - startTime;
      const tokensUsed = Math.floor(reasoning.length / 3) + 120;
      this.profile.totalTokensUsed += tokensUsed;

      this.addMemory({
        role: 'assistant',
        content: typeof output === 'string' ? output : JSON.stringify(output),
        metadata: { taskId: request.taskId, durationMs, confidence }
      });

      return {
        taskId: request.taskId,
        agentId: this.profile.id,
        success: true,
        output,
        reasoning,
        toolCalls,
        confidence,
        tokensUsed,
        durationMs
      };
    } catch (err: any) {
      return {
        taskId: request.taskId,
        agentId: this.profile.id,
        success: false,
        output: null,
        reasoning: `Error occurred during execution: ${err.message}`,
        toolCalls: [],
        confidence: 0,
        tokensUsed: 50,
        durationMs: Date.now() - startTime,
        error: err.message
      };
    } finally {
      this.profile.currentLoad = Math.max(0, this.profile.currentLoad - 1);
    }
  }

  /**
   * Helper to execute a tool registered with this agent
   */
  public async callTool(toolId: string, params: any): Promise<ToolCallTrace> {
    if (!this.toolRegistry) {
      throw new Error(`ToolRegistry not bound to agent ${this.profile.id}`);
    }
    if (!this.profile.toolIds.includes(toolId)) {
      throw new Error(`Tool '${toolId}' is not authorized for agent '${this.profile.id}'`);
    }

    const start = Date.now();
    try {
      const output = await this.toolRegistry.invoke(toolId, params);
      return {
        toolId,
        input: params,
        output,
        durationMs: Date.now() - start,
        success: true
      };
    } catch (err: any) {
      return {
        toolId,
        input: params,
        output: null,
        durationMs: Date.now() - start,
        success: false,
        error: err.message
      };
    }
  }
}
