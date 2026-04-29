import { createServer, Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { MCPService } from "./service.js";

export class MCPWebSocketServer {
  private server: Server;
  private wss: WebSocketServer;

  constructor(
    private readonly service: MCPService,
    private readonly serverConfig: {
      port: number;
      enableCors?: boolean;
      nodeEnv?: string;
      logLevel?: string;
    },
  ) {
    this.server = createServer();
    this.wss = new WebSocketServer({
      server: this.server,
      path: "/operator",
    });
    this.setupWebSocketHandlers();
  }

  private setupWebSocketHandlers(): void {
    this.wss.on("connection", (ws: WebSocket, req) => {
      console.info(
        `MCP WebSocket connection established from ${req.socket.remoteAddress}`,
      );
      this.service.handleConnection(ws);
    });

    this.wss.on("error", (error) => {
      console.error("MCP WebSocket server error:", error);
    });

    this.server.on("error", (error) => {
      console.error("MCP HTTP server error:", error);
    });
  }

  async start(): Promise<void> {
    const port = this.serverConfig.port;
    return new Promise((resolve, reject) => {
      this.server.listen(port, () => {
        console.info(`MCP WebSocket server listening on port ${port}`);
        console.info(`MCP WebSocket endpoint: ws://localhost:${port}/operator`);
        resolve();
      });
      this.server.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close(() => {
        this.server.close(() => {
          console.info("MCP WebSocket server stopped");
          resolve();
        });
      });
    });
  }
}
