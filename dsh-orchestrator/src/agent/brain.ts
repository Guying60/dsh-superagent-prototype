/**
 * Agent Brain — the cognitive plug-point.
 *
 * The engine (scheduler / workflow / self-loop) never knows *how* an agent thinks.
 * It only hands a `BrainContext` in and gets an artifact out. This is what makes the
 * platform swappable: `ScriptedBrain` runs offline & deterministically (demo / CI),
 * and an `LlmBrain` can be dropped in later without touching a single engine file.
 */
import {
  AgentProfile,
  AgentExecutionRequest,
  RuleFailure,
  ToolCallTrace
} from '../types/index.js';

export interface BrainContext {
  agent: AgentProfile;
  request: AgentExecutionRequest;
  /** accumulated structured failures across all self-loop iterations so far */
  failedRules: RuleFailure[];
  iteration: number;
  criticGuidance?: string;
  /** recent working memory (oldest first) */
  memory: Array<{ role: string; content: string }>;
  /** tool access, already authorization-checked by the owning agent */
  callTool?: (toolId: string, params: any) => Promise<ToolCallTrace>;
}

export interface BrainOutput {
  output: any;
  reasoning: string;
  confidence?: number;
  toolCalls?: ToolCallTrace[];
  /** token estimate reported upstream for budget accounting */
  tokensUsed?: number;
}

export interface AgentBrain {
  readonly kind: string;
  readonly name: string;
  think(ctx: BrainContext): Promise<BrainOutput>;
}

/** Rough, honest token estimate — clearly an approximation, never presented as measurement. */
export function estimateTokens(...texts: string[]): number {
  let chars = 0;
  for (const t of texts) chars += (t || '').length;
  return Math.max(1, Math.ceil(chars / 4));
}

/**
 * Deterministic offline brain: emits a stable, explainable artifact derived from context.
 * Used when no LLM provider is configured so the platform is runnable out of the box.
 */
export class DeterministicBrain implements AgentBrain {
  readonly kind = 'deterministic';
  readonly name = 'Deterministic Echo Brain';

  public async think(ctx: BrainContext): Promise<BrainOutput> {
    const caps = Object.keys(ctx.agent.capabilities).join(', ');
    const reasoning =
      `[${ctx.agent.name}] iteration ${ctx.iteration}: analyzed task ${ctx.request.taskId} ` +
      `using capabilities (${caps}); ` +
      (ctx.failedRules.length
        ? `reacting to ${ctx.failedRules.length} structured failure(s): ${ctx.failedRules.map(f => f.id ?? f.ruleName).join(', ')}.`
        : 'no prior failures to react to.');

    return {
      output: {
        agentId: ctx.agent.id,
        role: ctx.agent.role,
        iteration: ctx.iteration,
        taskId: ctx.request.taskId,
        observedFailures: ctx.failedRules
      },
      reasoning,
      confidence: ctx.failedRules.length === 0 ? 0.9 : 0.6 + Math.min(0.3, ctx.iteration * 0.1),
      tokensUsed: estimateTokens(reasoning, JSON.stringify(ctx.request.input))
    };
  }
}
