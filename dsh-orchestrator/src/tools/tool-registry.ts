/**
 * Tool Registry & MCP (Model Context Protocol) Integration Layer
 */
import { ToolDefinition, ToolParameterSchema } from '../types/index.js';

export interface McpToolDeclaration {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  /**
   * Register a local or remote tool
   */
  public register(tool: ToolDefinition): void {
    this.tools.set(tool.id, tool);
  }

  /**
   * Import external tools via MCP (Model Context Protocol)
   */
  public registerMcpTool(
    mcpDeclaration: McpToolDeclaration, 
    mcpInvoker: (toolName: string, args: any) => Promise<any>
  ): void {
    const toolDef: ToolDefinition = {
      id: `mcp_${mcpDeclaration.name}`,
      name: mcpDeclaration.name,
      description: mcpDeclaration.description,
      parameters: {
        type: 'object',
        properties: mcpDeclaration.inputSchema.properties || {},
        required: mcpDeclaration.inputSchema.required || []
      },
      isSandboxed: true,
      handler: async (params: any) => {
        return await mcpInvoker(mcpDeclaration.name, params);
      }
    };
    this.register(toolDef);
  }

  public get(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  public getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Invoke a tool with parameter schema validation and timeout protection
   */
  public async invoke(toolId: string, params: any, context?: any): Promise<any> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Tool '${toolId}' not found in registry`);
    }

    // Validate required parameters
    if (tool.parameters.required) {
      for (const requiredKey of tool.parameters.required) {
        if (params === undefined || params[requiredKey] === undefined) {
          throw new Error(`Tool '${toolId}' missing required parameter '${requiredKey}'`);
        }
      }
    }

    const timeoutMs = tool.timeoutMs || 10000;

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Tool '${toolId}' execution timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    const executionPromise = tool.handler(params, context);

    return await Promise.race([executionPromise, timeoutPromise]);
  }
}
