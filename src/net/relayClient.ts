import { COOP } from "../game/config";
import { normalizeCode, type ClientToRelay, type ErrorReason, type RelayToClient } from "./relayProtocol";

export type RelayStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

interface Pending {
  resolve: (v: { code: string; slot: number }) => void;
  reject: (reason: ErrorReason | "unreachable") => void;
}

/**
 * Browser side of the co-op relay. Owns one WebSocket, turns host/join into
 * promises, and — once admitted to a room — quietly reconnects with its
 * session token for up to COOP.reconnectGraceMs if the socket drops.
 */
export class RelayClient {
  status: RelayStatus = "idle";
  slot = -1;
  code = "";

  /** Every text frame from the relay except `welcome` (which resolves host/join). */
  onMessage: (m: RelayToClient) => void = () => {};
  onBinary: (data: ArrayBuffer) => void = () => {};
  onStatus: (s: RelayStatus) => void = () => {};

  private ws: WebSocket | null = null;
  private token = "";
  private pending: Pending | null = null;
  private leaving = false;
  private retryUntil = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly socketCtor: typeof WebSocket = WebSocket,
  ) {}

  host(name: string): Promise<{ code: string; slot: number }> {
    return this.request({ t: "host", name });
  }

  join(code: string, name: string): Promise<{ code: string; slot: number }> {
    const clean = normalizeCode(code);
    if (!clean) return Promise.reject<{ code: string; slot: number }>("bad_code");
    return this.request({ t: "join", code: clean, name });
  }

  send(m: ClientToRelay): void {
    if (this.ws && this.ws.readyState === this.socketCtor.OPEN) this.ws.send(JSON.stringify(m));
  }

  sendBinary(b: Uint8Array): void {
    if (this.ws && this.ws.readyState === this.socketCtor.OPEN) this.ws.send(b);
  }

  /** Close for good (no reconnect). */
  leave(): void {
    this.leaving = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
    this.setStatus("closed");
  }

  // ---- Internals ------------------------------------------------------------
  private request(first: ClientToRelay): Promise<{ code: string; slot: number }> {
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.leaving = false;
      this.setStatus("connecting");
      this.open(first);
    });
  }

  private open(first: ClientToRelay): void {
    let ws: WebSocket;
    try {
      ws = new this.socketCtor(this.url);
    } catch {
      this.onSocketGone();
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify(first));
    ws.onmessage = (ev: MessageEvent) => {
      if (ws !== this.ws) return;
      if (typeof ev.data !== "string") {
        this.onBinary(ev.data as ArrayBuffer);
        return;
      }
      let m: RelayToClient;
      try {
        m = JSON.parse(ev.data) as RelayToClient;
      } catch {
        return;
      }
      this.handle(m);
    };
    ws.onclose = () => {
      if (ws === this.ws) this.onSocketGone();
    };
    ws.onerror = () => {
      // onclose always follows; handled there.
    };
  }

  private handle(m: RelayToClient): void {
    if (m.t === "welcome") {
      this.code = m.code;
      this.slot = m.slot;
      this.token = m.token;
      this.setStatus("open");
      this.pending?.resolve({ code: m.code, slot: m.slot });
      this.pending = null;
      return;
    }
    if (m.t === "error") {
      if (this.pending) {
        this.pending.reject(m.reason);
        this.pending = null;
        this.leave();
        return;
      }
      if (this.status === "reconnecting") {
        // The room or our slot is gone; stop trying.
        this.leave();
      }
    }
    if (m.t === "closed") this.leaving = true;
    this.onMessage(m);
  }

  private onSocketGone(): void {
    this.ws = null;
    if (this.pending) {
      this.pending.reject("unreachable");
      this.pending = null;
      this.setStatus("closed");
      return;
    }
    if (this.leaving || !this.token) {
      this.setStatus("closed");
      return;
    }
    if (this.status !== "reconnecting") {
      this.retryUntil = Date.now() + COOP.reconnectGraceMs;
      this.setStatus("reconnecting");
    }
    if (Date.now() >= this.retryUntil) {
      this.setStatus("closed");
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.leaving) this.open({ t: "rejoin", code: this.code, token: this.token });
    }, 1000);
  }

  private setStatus(s: RelayStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.onStatus(s);
  }
}

/** The relay's ws(s):// URL from the build, or null when co-op isn't configured. */
export function relayUrl(): string | null {
  return import.meta.env.VITE_RELAY_URL || null;
}

/**
 * Ping the relay's /health until it answers (Render's free tier sleeps and
 * takes up to a minute to wake). Resolves false once `timeoutMs` runs out.
 */
export async function wakeRelay(url: string, timeoutMs = 75_000): Promise<boolean> {
  const health = url.replace(/^ws/, "http").replace(/\/+$/, "") + "/health";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(1, Math.min(10_000, deadline - Date.now())));
    try {
      const res = await fetch(health, { signal: ctrl.signal });
      if (res.ok) return true;
    } catch {
      // Not up yet (or asleep); try again.
    } finally {
      clearTimeout(timer);
    }
    const wait = Math.min(3000, deadline - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  return false;
}
