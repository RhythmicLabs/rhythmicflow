/**
 * MCP Connection Registry
 * Manages active WebSocket connections for MCP integration
 * Port of Python ConnectionRegistry to TypeScript
 */

import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";

export interface MCPConnection {
  id: string;
  websocket: WebSocket;
  connectedAt: Date;
  threadId: string;
}

/**
 * Singleton registry for managing MCP WebSocket connections
 */
export class MCPConnectionRegistry {
  private static instance: MCPConnectionRegistry;
  private _activeConnections: Map<string, MCPConnection> = new Map();
  private _latestConnectionId: string | null = null;

  private constructor() {}

  static getInstance(): MCPConnectionRegistry {
    if (!MCPConnectionRegistry.instance) {
      MCPConnectionRegistry.instance = new MCPConnectionRegistry();
    }
    return MCPConnectionRegistry.instance;
  }

  /**
   * Register a new WebSocket connection
   */
  register(websocket: WebSocket): string {
    const connectionId = uuidv4();
    const threadId = connectionId; // Use connection ID as thread ID for now

    const connection: MCPConnection = {
      id: connectionId,
      websocket,
      connectedAt: new Date(),
      threadId,
    };

    this._activeConnections.set(connectionId, connection);
    this._latestConnectionId = connectionId;

    console.info(`Registered MCP connection: ${connectionId}`);
    return connectionId;
  }

  /**
   * Deregister a WebSocket connection
   */
  deregister(connectionId: string): void {
    if (this._activeConnections.has(connectionId)) {
      this._activeConnections.delete(connectionId);
      if (this._latestConnectionId === connectionId) {
        this._latestConnectionId = null;
      }
      console.info(`Deregistered MCP connection: ${connectionId}`);
    }
  }

  /**
   * Get the latest active connection
   */
  getLatestConnection(): MCPConnection | null {
    if (
      this._latestConnectionId &&
      this._activeConnections.has(this._latestConnectionId)
    ) {
      return this._activeConnections.get(this._latestConnectionId)!;
    }
    return null;
  }

  /**
   * Get a specific connection by ID
   */
  getConnection(connectionId: string): MCPConnection | null {
    return this._activeConnections.get(connectionId) || null;
  }

  /**
   * Get all active connections
   */
  getAllConnections(): MCPConnection[] {
    return Array.from(this._activeConnections.values());
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this._activeConnections.size;
  }

  /**
   * Check if there are any active connections
   */
  hasActiveConnections(): boolean {
    return this._activeConnections.size > 0;
  }
}

// Export singleton instance
export const mcpConnectionRegistry = MCPConnectionRegistry.getInstance();
