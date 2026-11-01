import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { RoomManager, type Conn } from "./rooms";

export interface RelayServer {
  readonly port: number;
  readonly http: Server;
  readonly wss: WebSocketServer;
  readonly rooms: RoomManager;
  close(): Promise<void>;
}

/**
 * An HTTP server for Render's health check (and the game's wake-up probe)
 * with a WebSocket server on the same port. All room logic lives in
 * RoomManager; this only adapts `ws` sockets to it. Port 0 picks a free port.
 */
export function createRelayServer(port: number, opts: { heartbeatMs?: number } = {}): Promise<RelayServer> {
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

  // Heartbeat: a phone that drops off the network never sends a close frame,
  // so ping every socket and terminate any that missed the previous pong.
  // terminate() fires "close", which runs RoomManager's normal grace/cleanup.
  const alive = new WeakMap<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, opts.heartbeatMs ?? 15_000);
  heartbeat.unref();

  wss.on("connection", (ws: WebSocket) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
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

  const ticker = setInterval(() => rooms.tick(), 1000);
  ticker.unref();

  return new Promise((resolve) => {
    http.listen(port, () => {
      resolve({
        port: (http.address() as AddressInfo).port,
        http,
        wss,
        rooms,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(ticker);
            clearInterval(heartbeat);
            for (const c of wss.clients) c.terminate();
            wss.close(() => http.close(() => done()));
          }),
      });
    });
  });
}
