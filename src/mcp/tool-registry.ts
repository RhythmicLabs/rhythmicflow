import type { WorkflowContext } from "../types/workflow.js";
import type { MCPToolResult } from "./types.js";

export interface ToolDefinition<TParams = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
  handler: (
    params: TParams,
    context: WorkflowContext,
  ) => Promise<MCPToolResult>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  registerMany(tools: ToolDefinition[]): this {
    for (const tool of tools) {
      this.register(tool);
    }
    return this;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  size(): number {
    return this.tools.size;
  }
}

export function createToolRegistry(tools?: ToolDefinition[]): ToolRegistry {
  const registry = new ToolRegistry();
  if (tools) registry.registerMany(tools);
  return registry;
}
