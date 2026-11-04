/**
 * `LlmBrain` — the cognitive plug-point backed by a remote model.
 *
 * It implements exactly the same `AgentBrain` contract as the offline deterministic brains,
 * which is the whole point: the workflow engine, scheduler, verifier and self-loop are
 * completely unaware that a model is in the loop.
 *
 * `FallbackBrain` wraps a primary and a fallback brain: a *transport* or *parse* failure
 * degrades gracefully to the offline brain instead of failing the run. A content failure
 * (the model produced code that fails the tests) is NOT a fallback trigger — that is what
 * the self-loop is for.
 */
import { AgentBrain, BrainContext, BrainOutput } from '../brain.js';
import { LlmError, LlmMessage, LlmProvider } from './provider.js';

export interface LlmTelemetry {
  calls: number;
  failures: number;
  fallbacks: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  lastError?: string;
  lastModel?: string;
}

export function createTelemetry(): LlmTelemetry {
  return { calls: 0, failures: 0, fallbacks: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

export interface ParsedLlmOutput {
  output: any;
  reasoning: string;
  confidence?: number;
}

export interface LlmBrainSpec {
  /** e.g. `llm:developer` */
  kind: string;
  name: string;
  temperature?: number;
  maxTokens?: number;
  system(ctx: BrainContext): string;
  user(ctx: BrainContext): string;
  /** throw to reject an unusable answer (triggers the fallback brain) */
  parse(content: string, ctx: BrainContext): ParsedLlmOutput;
}

export class LlmBrain implements AgentBrain {
  public readonly kind: string;
  public readonly name: string;

  constructor(
    private readonly provider: LlmProvider,
    private readonly spec: LlmBrainSpec,
    private readonly telemetry: LlmTelemetry
  ) {
    this.kind = spec.kind;
    this.name = spec.name;
  }

  public get model(): string {
    return this.provider.model;
  }

  public async think(ctx: BrainContext): Promise<BrainOutput> {
    const messages: LlmMessage[] = [
      { role: 'system', content: this.spec.system(ctx) },
      { role: 'user', content: this.spec.user(ctx) }
    ];

    this.telemetry.calls++;

    try {
      const response = await this.provider.chat(messages, {
        temperature: this.spec.temperature,
        maxTokens: this.spec.maxTokens
      });

      this.telemetry.promptTokens += response.usage.promptTokens;
      this.telemetry.completionTokens += response.usage.completionTokens;
      this.telemetry.totalTokens += response.usage.totalTokens;
      this.telemetry.lastModel = response.model;

      const parsed = this.spec.parse(response.content, ctx);

      return {
        output: parsed.output,
        reasoning: parsed.reasoning,
        confidence: parsed.confidence ?? 0.85,
        toolCalls: [],
        tokensUsed: response.usage.totalTokens
      };
    } catch (err: any) {
      this.telemetry.failures++;
      this.telemetry.lastError = err instanceof LlmError ? err.message : (err?.message ?? String(err));
      throw err;
    }
  }
}

/**
 * Try the primary brain; on any throw, run the fallback instead and record it.
 */
export class FallbackBrain implements AgentBrain {
  public readonly kind = 'llm+fallback';

  constructor(
    private readonly primary: LlmBrain,
    private readonly fallback: AgentBrain,
    private readonly telemetry: LlmTelemetry,
    private readonly onFallback?: (error: Error, primaryName: string, agentId: string) => void
  ) {}

  public get name(): string {
    return `${this.primary.name} ⇒ ${this.fallback.name}`;
  }

  public async think(ctx: BrainContext): Promise<BrainOutput> {
    try {
      return await this.primary.think(ctx);
    } catch (err: any) {
      this.telemetry.fallbacks++;
      const error = err instanceof Error ? err : new Error(String(err));
      this.onFallback?.(error, this.primary.name, ctx.agent.id);
      return this.fallback.think(ctx);
    }
  }
}
