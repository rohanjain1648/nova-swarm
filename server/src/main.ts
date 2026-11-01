/**
 * NOVA SWARM co-op relay entry point: an HTTP server for Render's health check
 * (and the game's wake-up probe) with a WebSocket server on the same port.
 * All room logic lives in RoomManager; this file only adapts sockets to it.
 */
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { RoomManager, type Conn } from "./rooms";

const port = Number(process.env.PORT ?? 8787);
const rooms = new RoomManager();

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: http, maxPayload: 256 * 1024 });

wss.on("connection", (ws: WebSocket) => {
  const conn: Conn = {
    send: (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
    close: () => ws.close(),
  };
  rooms.onOpen(conn);
  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      rooms.onBinary(conn, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    } else {
      rooms.onText(conn, data.toString());
    }
  });
  ws.on("close", () => rooms.onClose(conn));
  ws.on("error", () => ws.close());
});

setInterval(() => rooms.tick(), 1000).unref();

http.listen(port, () => {
  console.log(`novaswarm relay listening on :${port}`);
});
