/**
 * AetherHarness / DSH-Orchestrator — public entry point.
 *
 * Everything the platform exposes lives here; `cli.ts` and `tui/*` are executable
 * surfaces and are intentionally NOT re-exported.
 */

export * from './types/index.js';

export * from './agent/brain.js';
export * from './agent/llm/index.js';
export * from './agent/base-agent.js';
export * from './agent/agent-registry.js';

export * from './knowledge/knowledge-base.js';

export * from './tools/tool-registry.js';
export * from './tools/builtin-tools.js';

export * from './workflow/workflow-engine.js';
export * from './scheduler/dynamic-scheduler.js';
export * from './selfloop/self-loop-engine.js';
export * from './verification/verification-engine.js';
export * from './optimization/feedback-optimizer.js';

export * from './scenarios/rate-limiter.js';

export * from './orchestrator.js';
export * from './tui/ansi.js';
export * from './demo.js';
