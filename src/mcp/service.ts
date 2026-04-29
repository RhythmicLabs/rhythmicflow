import { WebSocket } from "ws";
import { EventBus, EventCache } from "@rhythmiclab/rhythmic-events";

import { mcpConnectionRegistry } from "./connection-registry.js";
import { MCPMessageParser, MCPMessage } from "./types.js";
import { MCPWorkflow, MCPWorkflowOptions } from "../workflows/mcp-workflow.js";
import {
  ToolRegistry,
  ToolDefinition,
  createToolRegistry,
} from "./tool-registry.js";

export class MCPService {
  private workflow: MCPWorkflow;
  private toolRegistry: ToolRegistry;

  constructor(
    toolRegistry?: ToolRegistry,
    eventCache?: EventCache,
    eventBus?: EventBus,
    serverOptions?: MCPWorkflowOptions,
  ) {
    const cache =
      eventCache ?? new EventCache({ maxSize: 1000, ttl: 3_600_000 });
    const bus = eventBus ?? new EventBus({ enableCache: false });
    this.toolRegistry = toolRegistry ?? createToolRegistry();
    this.workflow = new MCPWorkflow(cache, bus, serverOptions);
    this.syncToolsToWorkflow();
  }

  private syncToolsToWorkflow(): void {
    for (const tool of this.toolRegistry.getAll()) {
      this.workflow.registerTool(
        tool.name,
        tool.description,
        tool.inputSchema,
        tool.handler,
      );
    }
  }

  registerTool(tool: ToolDefinition): void {
    this.toolRegistry.register(tool);
    this.workflow.registerTool(
      tool.name,
      tool.description,
      tool.inputSchema,
      tool.handler,
    );
  }

  registerTools(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  async handleConnection(websocket: WebSocket): Promise<void> {
    const connectionId = mcpConnectionRegistry.register(websocket);
    console.info(`MCP Server connected: ${connectionId}`);

    websocket.on("message", async (data: Buffer) => {
      await this.handleMessage(connectionId, data.toString());
    });

    websocket.on("close", () => {
      this.handleDisconnection(connectionId);
    });

    websocket.on("error", (error) => {
      console.error(`WebSocket error for connection ${connectionId}:`, error);
      this.handleDisconnection(connectionId);
    });

    try {
      const initialMessages = await this.workflow.processMessage(connectionId, {
        type: "notification",
        method: "ping",
        timestamp: new Date().toISOString(),
      });
      for (const message of initialMessages) {
        await this.sendMessage(websocket, message);
      }
    } catch (error) {
      console.error(
        `Failed to initialize MCP workflow for ${connectionId}:`,
        error,
      );
    }
  }

  private async handleMessage(
    connectionId: string,
    data: string,
  ): Promise<void> {
    const connection = mcpConnectionRegistry.getConnection(connectionId);
    if (!connection) {
      console.error(`Connection not found: ${connectionId}`);
      return;
    }

    try {
      const message = MCPMessageParser.parse(data);
      const outgoingMessages = await this.workflow.processMessage(
        connectionId,
        message,
      );
      for (const outgoingMessage of outgoingMessages) {
        await this.sendMessage(connection.websocket, outgoingMessage);
      }
    } catch (error) {
      const errorResponse = MCPMessageParser.createError(
        null,
        -32603,
        error instanceof Error ? error.message : String(error),
      );
      await this.sendMessage(connection.websocket, errorResponse);
    }
  }

  private handleDisconnection(connectionId: string): void {
    console.info(`MCP Server disconnected: ${connectionId}`);
    mcpConnectionRegistry.deregister(connectionId);
  }

  private async sendMessage(
    websocket: WebSocket,
    message: MCPMessage,
  ): Promise<void> {
    try {
      websocket.send(MCPMessageParser.stringify(message));
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  }

  getWorkflow(): MCPWorkflow {
    return this.workflow;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }
}
