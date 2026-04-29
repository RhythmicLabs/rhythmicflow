import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { MCPService } from "./service.js";

export function createMCPServer(service: MCPService): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: true,
    path: "/operator",
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    console.info(
      `WebSocket connection established from ${req.socket.remoteAddress}`,
    );
    service.handleConnection(ws);
  });

  wss.on("error", (error) => {
    console.error("WebSocket server error:", error);
  });

  return wss;
}

export function handleUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
}
