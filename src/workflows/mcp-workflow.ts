/**
 * MCP Workflow Implementation
 * Extends BaseWorkflow system with Redis checkpointing for MCP processing
 * Port of Python MCPWorkflow logic
 */

import { type EventCache, type EventBus } from "@rhythmiclab/rhythmic-events";

import { Checkpointer } from "../types/checkpointer.js";
import { WorkflowPubSub } from "../state/pubsub.js";
import { WorkflowContext } from "../types/workflow.js";
import { BaseWorkflowState, StepHandler } from "../types/workflow.js";
import {
  MCPErrorCode,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPMessage,
  MCPMessageParser,
  MCPMethod,
  MCPTool,
  MCPToolList,
} from "../mcp/types.js";
import { BaseWorkflow } from "./base-workflow.js";
import { MCPConnectionRegistry } from "../mcp/connection-registry.js";

// MCP Workflow Steps
export enum MCPWorkflowStep {
  IDLE = "idle",
  PROCESSING_REQUEST = "processing_request",
  HANDLING_TOOL_CALL = "handling_tool_call",
  SENDING_RESPONSE = "sending_response",
  COMPLETED = "completed",
  ERROR = "error",
}

// MCP Workflow Status (extends BaseWorkflowStatus)
export enum MCPWorkflowStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

// MCP Workflow State extends base state
export interface MCPWorkflowState extends BaseWorkflowState<
  MCPWorkflowStep,
  MCPWorkflowStatus
> {
  // MCP protocol state
  latestMessage: MCPMessage | null;
  outgoingMessages: MCPMessage[];
  isInitialized: boolean;
  serverCapabilities: Record<string, unknown>;
  clientInfo: Record<string, unknown>;

  // Available tools (will be populated by tool handlers)
  availableTools: MCPTool[];

  // Request/Response tracking
  pendingRequestId?: string | number;
  processingError?: string;
}

// Tool handler function type
export type MCPToolHandler = (
  params: Record<string, unknown>,
  context: WorkflowContext,
) => Promise<unknown>;

export interface MCPWorkflowOptions {
  serverName?: string;
  serverVersion?: string;
}

/**
 * MCP Workflow extends BaseWorkflow to handle MCP protocol processing
 */
export class MCPWorkflow extends BaseWorkflow<
  MCPWorkflowState,
  MCPWorkflowStep
> {
  private toolHandlers: Map<
    string,
    {
      handler: MCPToolHandler;
      description: string;
      inputSchema: Record<string, unknown>;
    }
  > = new Map();
  private wsConnectionRegistry: MCPConnectionRegistry =
    MCPConnectionRegistry.getInstance();
  private serverOptions: Required<MCPWorkflowOptions>;

  constructor(
    eventCache: EventCache,
    eventBus: EventBus,
    options?: MCPWorkflowOptions,
  ) {
    super(
      new Checkpointer<MCPWorkflowState>(eventCache, "mcp"),
      new WorkflowPubSub(eventBus),
    );
    this.serverOptions = {
      serverName: options?.serverName ?? "rythmicflow",
      serverVersion: options?.serverVersion ?? "1.0.0",
    };
  }

  // --- BaseWorkflow abstract members ---

  protected readonly steps: MCPWorkflowStep[] = [
    MCPWorkflowStep.IDLE,
    MCPWorkflowStep.PROCESSING_REQUEST,
    MCPWorkflowStep.HANDLING_TOOL_CALL,
    MCPWorkflowStep.SENDING_RESPONSE,
    MCPWorkflowStep.COMPLETED,
  ];

  protected readonly handlers: Record<
    MCPWorkflowStep,
    StepHandler<MCPWorkflowState>
  > = {
    [MCPWorkflowStep.IDLE]: this.handleIdle.bind(this),
    [MCPWorkflowStep.PROCESSING_REQUEST]:
      this.handleProcessingRequest.bind(this),
    [MCPWorkflowStep.HANDLING_TOOL_CALL]: this.handleToolCall.bind(this),
    [MCPWorkflowStep.SENDING_RESPONSE]: this.handleSendingResponse.bind(this),
    [MCPWorkflowStep.COMPLETED]: this.handleCompleted.bind(this),
    [MCPWorkflowStep.ERROR]: this.handleError.bind(this),
  };

  protected readonly initialStep: MCPWorkflowStep = MCPWorkflowStep.IDLE;

  protected readonly terminalSteps: MCPWorkflowStep[] = [
    MCPWorkflowStep.COMPLETED,
    MCPWorkflowStep.ERROR,
  ];

  protected readonly channelPrefix: string = "mcp";

  // --- Public API ---

  /**
   * Register a tool handler
   */
  registerTool(
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: MCPToolHandler,
  ): void {
    this.toolHandlers.set(name, { handler, description, inputSchema });
  }

  /**
   * Create initial MCP workflow state
   */
  createInitialState(): MCPWorkflowState {
    return {
      latestMessage: null,
      outgoingMessages: [],
      isInitialized: false,
      serverCapabilities: {},
      clientInfo: {},
      availableTools: [],

      // Base workflow state
      stepHistory: [],
      currentStep: MCPWorkflowStep.IDLE,
      status: MCPWorkflowStatus.PENDING,
      retryCount: 0,
      maxRetries: 3,
      startTime: new Date().toISOString(),
      endTime: "",
      duration: 0,
      error: "",
      errorDetails: null,
    };
  }

  /**
   * Process an incoming MCP message
   */
  async processMessage(
    threadId: string,
    message: MCPMessage,
  ): Promise<MCPMessage[]> {
    const currentState =
      (await this.getStatus(threadId)) || this.createInitialState();

    // Update state with new message
    const updatedState: MCPWorkflowState = {
      ...currentState,
      latestMessage: message,
      outgoingMessages: [], // Clear outgoing messages for this request
    };

    // Run workflow
    const context: WorkflowContext = {
      threadId,
      jobId: threadId,
      userId: "system",
    };

    const result = await this.execute(updatedState, context);

    return result.state.outgoingMessages || [];
  }

  /**
   * Get current state (helper method)
   */
  private async getState(): Promise<MCPWorkflowState | null> {
    // This is a placeholder - in a real implementation, we'd need to store the current state
    // For now, return null to indicate we need to load from Redis
    return null;
  }

  // --- Step Handlers ---

  private async handleIdle(state: MCPWorkflowState): Promise<MCPWorkflowState> {
    if (!state.latestMessage) {
      return state; // No message to process
    }

    const message = state.latestMessage;

    // Handle initialize
    if (message.method === MCPMethod.INITIALIZE) {
      return this.handleInitialize(state, message);
    }

    // Handle tool list
    if (message.method === MCPMethod.LIST_TOOLS) {
      return this.handleListTools(state, message);
    }

    // Handle tool call
    if (message.method === MCPMethod.CALL_TOOL) {
      return {
        ...state,
        currentStep: MCPWorkflowStep.HANDLING_TOOL_CALL,
        pendingRequestId: message.id ?? undefined,
      };
    }

    // Handle ping
    if (message.method === MCPMethod.PING) {
      const pongResponse = MCPMessageParser.createNotification(MCPMethod.PONG);
      return {
        ...state,
        outgoingMessages: [...state.outgoingMessages, pongResponse],
        currentStep: MCPWorkflowStep.COMPLETED,
      };
    }

    // Unknown method
    const errorResponse = MCPMessageParser.createError(
      message.id ?? undefined,
      MCPErrorCode.METHOD_NOT_FOUND,
      `Method not found: ${message.method}`,
    );

    return {
      ...state,
      outgoingMessages: [...state.outgoingMessages, errorResponse],
      currentStep: MCPWorkflowStep.ERROR,
    };
  }

  private async handleProcessingRequest(
    state: MCPWorkflowState,
  ): Promise<MCPWorkflowState> {
    // This step handles general request processing
    return {
      ...state,
      currentStep: MCPWorkflowStep.COMPLETED,
    };
  }
  private async handleToolCall(
    state: MCPWorkflowState,
  ): Promise<MCPWorkflowState> {
    if (
      !state.latestMessage ||
      state.latestMessage.method !== MCPMethod.CALL_TOOL
    ) {
      return {
        ...state,
        processingError: "Invalid tool call message",
        currentStep: MCPWorkflowStep.ERROR,
      };
    }

    const message = state.latestMessage;
    const toolCall = message.params as {
      name: string;
      arguments?: Record<string, unknown>;
    };

    if (!toolCall.name) {
      const errorResponse = MCPMessageParser.createError(
        message.id || undefined,
        MCPErrorCode.INVALID_PARAMS,
        "Tool name is required",
      );
      return {
        ...state,
        outgoingMessages: [...state.outgoingMessages, errorResponse],
        currentStep: MCPWorkflowStep.ERROR,
      };
    }

    try {
      const entry = this.toolHandlers.get(toolCall.name);
      if (!entry) {
        const errorResponse = MCPMessageParser.createError(
          message.id ?? undefined,
          MCPErrorCode.METHOD_NOT_FOUND,
          `Tool not found: ${toolCall.name}`,
        );
        return {
          ...state,
          outgoingMessages: [...state.outgoingMessages, errorResponse],
          currentStep: MCPWorkflowStep.ERROR,
        };
      }

      // Execute tool handler
      const context: WorkflowContext = {
        threadId: "",
        jobId: "",
        userId: "system",
      };

      const toolResult = await entry.handler(toolCall.arguments || {}, context);

      // Create success response
      const response = MCPMessageParser.createResponse(
        message.id || undefined,
        toolResult,
      );

      return {
        ...state,
        outgoingMessages: [...state.outgoingMessages, response],
        currentStep: MCPWorkflowStep.SENDING_RESPONSE,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorResponse = MCPMessageParser.createError(
        message.id ?? undefined,
        MCPErrorCode.INTERNAL_ERROR,
        `Tool execution failed: ${errorMessage}`,
      );

      return {
        ...state,
        outgoingMessages: [...state.outgoingMessages, errorResponse],
        processingError: errorMessage,
        currentStep: MCPWorkflowStep.ERROR,
      };
    }
  }

  private async handleSendingResponse(
    state: MCPWorkflowState,
  ): Promise<MCPWorkflowState> {
    // This step handles response sending (already queued in outgoingMessages)
    return {
      ...state,
      currentStep: MCPWorkflowStep.COMPLETED,
    };
  }

  private async handleCompleted(
    state: MCPWorkflowState,
  ): Promise<MCPWorkflowState> {
    // Workflow completed successfully
    return state;
  }

  private async handleError(
    state: MCPWorkflowState,
  ): Promise<MCPWorkflowState> {
    // Handle error state
    if (!state.latestMessage) {
      return state;
    }

    // If we don't have an error response yet, create one
    if (state.outgoingMessages.length === 0) {
      const errorResponse = MCPMessageParser.createError(
        state.latestMessage.id || null,
        MCPErrorCode.INTERNAL_ERROR,
        state.processingError || "Unknown error occurred",
      );

      return {
        ...state,
        outgoingMessages: [errorResponse],
      };
    }

    return state;
  }

  // --- Specific Handler Methods ---

  private async handleInitialize(
    state: MCPWorkflowState,
    message: MCPMessage,
  ): Promise<MCPWorkflowState> {
    const initParams = message.params as MCPInitializeParams;

    const serverCapabilities = {
      tools: {
        listChanged: true,
      },
    };

    const serverInfo = {
      name: this.serverOptions.serverName,
      version: this.serverOptions.serverVersion,
    };

    const initResult: MCPInitializeResult = {
      protocolVersion: "2024-11-05",
      capabilities: serverCapabilities,
      serverInfo,
    };

    const response = MCPMessageParser.createResponse(
      message.id || undefined,
      initResult,
    );

    return {
      ...state,
      isInitialized: true,
      clientInfo: initParams.clientInfo,
      serverCapabilities,
      outgoingMessages: [...state.outgoingMessages, response],
      currentStep: MCPWorkflowStep.COMPLETED,
    };
  }

  private async handleListTools(
    state: MCPWorkflowState,
    message: MCPMessage,
  ): Promise<MCPWorkflowState> {
    const tools: MCPTool[] = Array.from(this.toolHandlers.entries()).map(
      ([toolName, entry]) => ({
        name: toolName,
        description: entry.description,
        inputSchema: entry.inputSchema as MCPTool["inputSchema"],
      }),
    );

    const toolList: MCPToolList = { tools };

    const response = MCPMessageParser.createResponse(
      message.id ?? undefined,
      toolList,
    );

    return {
      ...state,
      availableTools: tools,
      outgoingMessages: [...state.outgoingMessages, response],
      currentStep: MCPWorkflowStep.COMPLETED,
    };
  }
}
