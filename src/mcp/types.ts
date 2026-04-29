/**
 * MCP Protocol Types and JSON-RPC Message Handling
 * Implements Model Context Protocol specifications
 */

export interface JSONRPCMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

// MCP-specific message types
export interface MCPRequest extends JSONRPCMessage {
  method: string;
  params?: unknown;
}

export interface MCPResponse extends JSONRPCMessage {
  result?: unknown;
  error?: JSONRPCError;
}

export interface MCPNotification extends JSONRPCMessage {
  method: string;
  params?: unknown;
}

// MCP Protocol methods
export enum MCPMethod {
  INITIALIZE = "initialize",
  INITIALIZE_RESPONSE = "initialize_response",
  LIST_TOOLS = "tools/list",
  LIST_TOOLS_RESPONSE = "tools/list_response",
  CALL_TOOL = "tools/call",
  CALL_TOOL_RESPONSE = "tools/call_response",
  NOTIFICATION = "notification",
  PING = "ping",
  PONG = "pong",
}

// MCP Tool definitions
export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPToolList {
  tools: MCPTool[];
}

export interface MCPToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface MCPToolResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

// MCP Initialize message types
export interface MCPInitializeParams {
  protocolVersion: string;
  capabilities: {
    tools?: {
      listChanged?: boolean;
    };
    roots?: {
      listChanged?: boolean;
    };
  };
  clientInfo: {
    name: string;
    version: string;
  };
}

export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools: {
      listChanged?: boolean;
    };
    roots?: {
      listChanged?: boolean;
    };
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

// MCP State types for workflow
export interface MCPMessage {
  id?: string | number | null;
  type: "request" | "response" | "notification";
  method: string;
  params?: unknown;
  result?: unknown;
  error?: JSONRPCError;
  timestamp: string;
}

// Workflow state for MCP processing
export interface MCPState {
  latestMessage: MCPMessage | null;
  outgoingMessages: MCPMessage[];
  isInitialized: boolean;
  serverCapabilities: Record<string, unknown>;
  clientInfo: Record<string, unknown>;
}

// MCP Error codes
export enum MCPErrorCode {
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
  CUSTOM_ERROR = -32000,
}

// Message parsing utilities
export class MCPMessageParser {
  static parse(data: string): MCPMessage {
    try {
      const jsonMessage = JSON.parse(data) as JSONRPCMessage;

      return {
        id: jsonMessage.id,
        type: jsonMessage.method
          ? "request"
          : jsonMessage.result !== undefined || jsonMessage.error !== undefined
            ? "response"
            : "notification",
        method: jsonMessage.method || "",
        params: jsonMessage.params,
        result: jsonMessage.result,
        error: jsonMessage.error,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Failed to parse MCP message: ${error}`);
    }
  }

  static stringify(message: MCPMessage): string {
    const jsonMessage: JSONRPCMessage = {
      jsonrpc: "2.0",
    };

    if (message.id !== undefined) {
      jsonMessage.id = message.id;
    }

    if (message.type === "request" || message.type === "notification") {
      jsonMessage.method = message.method;
      if (message.params) {
        jsonMessage.params = message.params;
      }
    } else if (message.type === "response") {
      if (message.result !== undefined) {
        jsonMessage.result = message.result;
      }
      if (message.error) {
        jsonMessage.error = message.error;
      }
    }

    return JSON.stringify(jsonMessage);
  }

  static createResponse(
    id: string | number | null | undefined,
    result?: unknown,
    error?: JSONRPCError,
  ): MCPMessage {
    return {
      id,
      type: "response",
      method: "",
      result,
      error,
      timestamp: new Date().toISOString(),
    };
  }

  static createNotification(method: string, params?: unknown): MCPMessage {
    return {
      type: "notification",
      method,
      params,
      timestamp: new Date().toISOString(),
    };
  }

  static createError(
    id: string | number | null | undefined,
    code: number,
    message: string,
    data?: unknown,
  ): MCPMessage {
    return {
      id,
      type: "response",
      method: "",
      error: {
        code,
        message,
        data,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
