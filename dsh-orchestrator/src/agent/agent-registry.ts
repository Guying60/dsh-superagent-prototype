/**
 * Agent Team Registry & Discovery Service
 */
import { AgentProfile, AgentRole } from '../types/index.js';
import { BaseAgent } from './base-agent.js';
import { ToolRegistry } from '../tools/tool-registry.js';

export class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map();
  private versions: Map<string, AgentProfile[]> = new Map(); // history of profiles by agentId
  private toolRegistry: ToolRegistry;

  constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  /**
   * Register or update an Agent with automatic version tracking
   */
  public register(profile: AgentProfile, customAgentClass?: typeof BaseAgent): BaseAgent {
    const existing = this.agents.get(profile.id);
    if (existing) {
      // track version
      const history = this.versions.get(profile.id) || [];
      history.push({ ...existing.profile });
      this.versions.set(profile.id, history);
    }

    const AgentClass = customAgentClass || BaseAgent;
    const agent = new AgentClass(profile, this.toolRegistry);
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
   * Find the most suitable agent for a given task based on capability score and current load
   */
  public findBestAgent(requiredCapability: string, minScore: number = 0.5): BaseAgent | undefined {
    const candidates = this.getAll().filter(agent => {
      const score = agent.profile.capabilities[requiredCapability] || 0;
      return score >= minScore && agent.currentLoad < agent.profile.maxConcurrency;
    });

    if (candidates.length === 0) {
      // Fallback: candidate with highest score regardless of load
      return this.getAll()
        .filter(a => (a.profile.capabilities[requiredCapability] || 0) >= minScore)
        .sort((a, b) => (b.profile.capabilities[requiredCapability] || 0) - (a.profile.capabilities[requiredCapability] || 0))[0];
    }

    // Rank candidates by composite score: capability * 0.7 + (1 - normalizedLoad) * 0.3
    candidates.sort((a, b) => {
      const scoreA = (a.profile.capabilities[requiredCapability] || 0) * 0.7 + 
        (1 - a.currentLoad / a.profile.maxConcurrency) * 0.3;
      const scoreB = (b.profile.capabilities[requiredCapability] || 0) * 0.7 + 
        (1 - b.currentLoad / b.profile.maxConcurrency) * 0.3;
      return scoreB - scoreA;
    });

    return candidates[0];
  }

  public getVersionHistory(agentId: string): AgentProfile[] {
    return this.versions.get(agentId) || [];
  }
}
