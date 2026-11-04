/**
 * Tool Registry & MCP bridge.
 *
 * Fixes vs. the previous version:
 * - the timeout timer is always cleared (it used to keep the event loop alive for 10s
 *   after every single tool call)
 * - `isSandboxed` is actually consumed: sandboxed tools receive a hard deadline and are
 *   executed by handlers that enforce it inside an isolated vm context
 * - parameter *types* are validated, not just presence
 * - per-tool reliability metrics are recorded here so the optimizer reads real numbers
 */
import { ToolDefinition } from '../types/index.js';

export interface McpToolDeclaration {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolInvocationContext {
  [key: string]: any;
  /** hard deadline in ms; sandboxed handlers must honour it */
  timeoutMs?: number;
}

export interface ToolMetrics {
  toolId: string;
  calls: number;
  successes: number;
  failures: number;
  timeouts: number;
  totalMs: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private metrics: Map<string, ToolMetrics> = new Map();

  public register(tool: ToolDefinition): void {
    if (!tool.id) throw new Error('ToolDefinition.id is required');
    if (typeof tool.handler !== 'function') throw new Error(`Tool '${tool.id}' has no handler`);
    this.tools.set(tool.id, tool);
  }

  /** Import an external tool via MCP. Remote tools are always treated as sandboxed. */
  public registerMcpTool(
    decl: McpToolDeclaration,
    invoker: (toolName: string, args: any) => Promise<any>,
    timeoutMs = 8000
  ): void {
    this.register({
      id: `mcp_${decl.name}`,
      name: decl.name,
      description: decl.description,
      parameters: {
        type: 'object',
        properties: decl.inputSchema.properties ?? {},
        required: decl.inputSchema.required ?? []
      },
      isSandboxed: true,
      timeoutMs,
      handler: async (params: any) => invoker(decl.name, params)
    });
  }

  public get(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  public getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public has(toolId: string): boolean {
    return this.tools.has(toolId);
  }

  private metricsFor(toolId: string): ToolMetrics {
    let m = this.metrics.get(toolId);
    if (!m) {
      m = { toolId, calls: 0, successes: 0, failures: 0, timeouts: 0, totalMs: 0 };
      this.metrics.set(toolId, m);
    }
    return m;
  }

  public getMetrics(): ToolMetrics[] {
    return Array.from(this.metrics.values());
  }

  /** success / calls, or null when the tool has never run. */
  public getReliability(toolId: string): number | null {
    const m = this.metrics.get(toolId);
    if (!m || m.calls === 0) return null;
    return m.successes / m.calls;
  }

  private validateParams(tool: ToolDefinition, params: any): void {
    if (tool.parameters.required) {
      for (const key of tool.parameters.required) {
        if (params === undefined || params === null || params[key] === undefined) {
          throw new Error(`Tool '${tool.id}' missing required parameter '${key}'`);
        }
      }
    }

    const schema = tool.parameters.properties ?? {};
    for (const [key, def] of Object.entries(schema)) {
      const value = params?.[key];
      if (value === undefined || value === null) continue;

      const expected = def.type;
      const actual =
        Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;

      if (expected === 'number' && actual !== 'number') {
        throw new Error(`Tool '${tool.id}' parameter '${key}' expected number, received ${actual}`);
      }
      if (expected === 'string' && actual !== 'string') {
        throw new Error(`Tool '${tool.id}' parameter '${key}' expected string, received ${actual}`);
      }
      if (expected === 'boolean' && actual !== 'boolean') {
        throw new Error(`Tool '${tool.id}' parameter '${key}' expected boolean, received ${actual}`);
      }
      if (expected === 'array' && actual !== 'array') {
        throw new Error(`Tool '${tool.id}' parameter '${key}' expected array, received ${actual}`);
      }
      if (def.enum && !def.enum.includes(String(value))) {
        throw new Error(
          `Tool '${tool.id}' parameter '${key}' must be one of [${def.enum.join(', ')}], received '${String(value)}'`
        );
      }
    }
  }

  /**
   * Invoke a tool. Always resolves or rejects within `timeoutMs`, and never leaves a
   * dangling timer behind (the previous implementation leaked one per call).
   */
  public async invoke(toolId: string, params: any, context?: ToolInvocationContext): Promise<any> {
    const tool = this.tools.get(toolId);
    if (!tool) throw new Error(`Tool '${toolId}' not found in registry`);

    this.validateParams(tool, params);

    const timeoutMs = tool.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const metrics = this.metricsFor(toolId);
    metrics.calls++;

    const start = Date.now();
    let timer: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        metrics.timeouts++;
        reject(
          new Error(
            `Tool '${toolId}' timed out after ${timeoutMs}ms` +
              (tool.isSandboxed ? ' (sandbox deadline exceeded)' : '')
          )
        );
      }, timeoutMs);
      // do not let a pending tool deadline keep the process alive
      if (typeof timer.unref === 'function') timer.unref();
    });

    try {
      const ctx: ToolInvocationContext = { ...(context ?? {}), timeoutMs };
      const result = await Promise.race([Promise.resolve(tool.handler(params, ctx)), timeoutPromise]);
      metrics.successes++;
      return result;
    } catch (err) {
      metrics.failures++;
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      metrics.totalMs += Date.now() - start;
    }
  }
}
