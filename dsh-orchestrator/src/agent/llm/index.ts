/**
 * LLM integration entry point.
 *
 * `applyLlm` turns the offline agent team into an LLM-backed team while keeping the
 * deterministic brains as a fallback. It returns the same `AgentBlueprint[]` shape the
 * orchestrator already consumes, so no engine file changes.
 *
 * Configuration is resolved from explicit options first, then the environment:
 *   DEEPSEEK_API_KEY     (required to go live)
 *   DEEPSEEK_BASE_URL    default https://api.deepseek.com
 *   DEEPSEEK_MODEL       default deepseek-chat
 *   AETHER_LLM_TIMEOUT_MS
 *   AETHER_LLM_FALLBACK  "0" disables graceful degradation to the offline brain
 */
import { AgentBlueprint } from '../../scenarios/rate-limiter.js';
import { AgentBrain } from '../brain.js';
import { DeepSeekProvider, LlmProvider } from './provider.js';
import { createTelemetry, FallbackBrain, LlmBrain, LlmTelemetry } from './llm-brain.js';
import { SPEC_FACTORIES } from './specs.js';

export * from './provider.js';
export * from './prompt.js';
export * from './llm-brain.js';
export * from './specs.js';

export interface LlmConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  jsonMode?: boolean;
  /** fall back to the offline brain when a call or its validation fails (default true) */
  fallbackToOffline?: boolean;
  /** inject a provider — tests, or any OpenAI-compatible endpoint */
  provider?: LlmProvider;
}

export interface AppliedLlm {
  blueprints: AgentBlueprint[];
  telemetry: LlmTelemetry;
  label: string;
  brains: Array<{ agentId: string; role: string; brain: string }>;
}

function numberOrUndefined(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function flagOrUndefined(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  return !['0', 'false', 'off', 'no'].includes(raw.trim().toLowerCase());
}

export function resolveLlmConfig(overrides: LlmConfig = {}): LlmConfig {
  return {
    apiKey: overrides.apiKey ?? process.env.DEEPSEEK_API_KEY ?? process.env.AETHER_LLM_API_KEY,
    baseUrl: overrides.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? process.env.AETHER_LLM_BASE_URL,
    model: overrides.model ?? process.env.DEEPSEEK_MODEL ?? process.env.AETHER_LLM_MODEL,
    temperature: overrides.temperature,
    maxTokens: overrides.maxTokens,
    timeoutMs: overrides.timeoutMs ?? numberOrUndefined(process.env.AETHER_LLM_TIMEOUT_MS),
    maxRetries: overrides.maxRetries,
    jsonMode: overrides.jsonMode,
    fallbackToOffline: overrides.fallbackToOffline ?? flagOrUndefined(process.env.AETHER_LLM_FALLBACK) ?? true,
    provider: overrides.provider
  };
}

export function isLlmConfigured(config: LlmConfig): boolean {
  if (config.provider) return true;
  return typeof config.apiKey === 'string' && config.apiKey.trim().length > 0;
}

export function createProviderFromConfig(config: LlmConfig): LlmProvider {
  if (config.provider) return config.provider;
  return new DeepSeekProvider({
    apiKey: config.apiKey ?? '',
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    jsonMode: config.jsonMode
  });
}

export function describeProvider(provider: LlmProvider): string {
  const described = (provider as unknown as { describe?: () => string }).describe;
  return typeof described === 'function' ? described.call(provider) : `${provider.name}:${provider.model}`;
}

export interface ApplyLlmOptions {
  fallbackToOffline?: boolean;
  onFallback?: (error: Error, primaryName: string, agentId: string) => void;
}

/**
 * Replace the brain of every agent that has an LLM spec, keeping the offline brain as a
 * fallback when requested.
 */
export function applyLlm(
  blueprints: AgentBlueprint[],
  provider: LlmProvider,
  options: ApplyLlmOptions = {}
): AppliedLlm {
  const telemetry = createTelemetry();
  const fallbackToOffline = options.fallbackToOffline ?? true;
  const brains: AppliedLlm['brains'] = [];

  const updated = blueprints.map(blueprint => {
    const factory = SPEC_FACTORIES[blueprint.profile.role];
    if (!factory) {
      brains.push({ agentId: blueprint.profile.id, role: blueprint.profile.role, brain: blueprint.brain.name });
      return blueprint;
    }

    const llm = new LlmBrain(provider, factory(), telemetry);
    const brain: AgentBrain = fallbackToOffline
      ? new FallbackBrain(llm, blueprint.brain, telemetry, options.onFallback)
      : llm;

    brains.push({ agentId: blueprint.profile.id, role: blueprint.profile.role, brain: brain.name });

    return { profile: blueprint.profile, brain };
  });

  return { blueprints: updated, telemetry, label: describeProvider(provider), brains };
}

/** Offline team metadata, for a uniform display path. */
export function describeOfflineTeam(blueprints: AgentBlueprint[]): AppliedLlm['brains'] {
  return blueprints.map(b => ({ agentId: b.profile.id, role: b.profile.role, brain: b.brain.name }));
}
