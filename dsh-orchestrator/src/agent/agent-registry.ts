/**
 * Agent Registry & Capability Discovery
 *
 * Fixes vs. the previous version:
 * - version history is a DEEP clone, so mutating a live profile can never rewrite history
 * - brains are injected here, so the engine can drive agents without knowing their internals
 * - exposes capacity queries used by the scheduler (real load balancing, not a stub)
 */
import { AgentProfile, AgentRole } from '../types/index.js';
import { BaseAgent } from './base-agent.js';
import { AgentBrain } from './brain.js';
import { ToolRegistry } from '../tools/tool-registry.js';

export interface RegisterOptions {
  brain?: AgentBrain;
  agentClass?: typeof BaseAgent;
}

export class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map();
  private versions: Map<string, AgentProfile[]> = new Map();
  private toolRegistry: ToolRegistry;

  constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  private static cloneProfile(p: AgentProfile): AgentProfile {
    return {
      ...p,
      capabilities: { ...p.capabilities },
      toolIds: [...p.toolIds]
    };
  }

  public register(profile: AgentProfile, options: RegisterOptions = {}): BaseAgent {
    const existing = this.agents.get(profile.id);
    if (existing) {
      const history = this.versions.get(profile.id) ?? [];
      history.push(AgentRegistry.cloneProfile(existing.profile));
      this.versions.set(profile.id, history);
    }

    const AgentClass = options.agentClass ?? BaseAgent;
    const agent = new AgentClass(profile, this.toolRegistry, options.brain);
    this.agents.set(profile.id, agent);
    return agent;
  }

  public get(agentId: string): BaseAgent | undefined {
    return this.agents.get(agentId);
  }

  public getAll(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  public getByRole(role: AgentRole): BaseAgent[] {
    return this.getAll().filter(a => a.role === role);
  }

  /**
   * Load-aware capability match.
   * score = 0.7 * capability + 0.3 * (1 - load / maxConcurrency)
   */
  public findBestAgent(requiredCapability: string, minScore = 0.5): BaseAgent | undefined {
    const withScore = this.getAll()
      .filter(a => (a.profile.capabilities[requiredCapability] ?? 0) >= minScore)
      .map(a => ({
        agent: a,
        capability: a.profile.capabilities[requiredCapability] ?? 0,
        available: a.hasCapacity()
      }));

    if (withScore.length === 0) return undefined;

    // Prefer agents with free capacity; only degrade to a busy agent if nothing else exists.
    const pool = withScore.some(c => c.available) ? withScore.filter(c => c.available) : withScore;

    pool.sort((a, b) => {
      const sa = a.capability * 0.7 + (1 - a.agent.currentLoad / Math.max(1, a.agent.profile.maxConcurrency)) * 0.3;
      const sb = b.capability * 0.7 + (1 - b.agent.currentLoad / Math.max(1, b.agent.profile.maxConcurrency)) * 0.3;
      return sb - sa;
    });

    return pool[0].agent;
  }

  /** Agents that currently have a free execution slot. */
  public getAvailable(): BaseAgent[] {
    return this.getAll().filter(a => a.hasCapacity());
  }

  public getTotalLoad(): number {
    return this.getAll().reduce((sum, a) => sum + a.currentLoad, 0);
  }

  public getTotalCapacity(): number {
    return this.getAll().reduce((sum, a) => sum + a.profile.maxConcurrency, 0);
  }

  public getVersionHistory(agentId: string): AgentProfile[] {
    return (this.versions.get(agentId) ?? []).map(AgentRegistry.cloneProfile);
  }

  public getTotalTokens(): number {
    return this.getAll().reduce((sum, a) => sum + a.profile.totalTokensUsed, 0);
  }
}
