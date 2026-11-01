import { afterAll, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";
import { createRelayServer, type RelayServer } from "../src/server";
import { RelayClient, wakeRelay } from "../../src/net/relayClient";
import type { RelayToClient } from "../../src/net/relayProtocol";

let relay: RelayServer;
let url: string;
const Ctor = WebSocket as unknown as typeof globalThis.WebSocket;
const clients: RelayClient[] = [];
const client = () => {
  const c = new RelayClient(url, Ctor);
  clients.push(c);
  return c;
};

/** Resolve once `pred` holds, polling every 20 ms; fail after `ms`. */
async function until(pred: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(async () => {
  relay = await createRelayServer(0);
  url = `ws://localhost:${relay.port}`;
});

afterAll(async () => {
  for (const c of clients) c.leave();
  await relay.close();
});

test("host then join exchanges a client->host message", async () => {
  const host = client();
  const got: RelayToClient[] = [];
  host.onMessage = (m) => got.push(m);
  const { code, slot } = await host.host("HOSTY");
  expect(slot).toBe(0);
  expect(host.status).toBe("open");

  const guest = client();
  const joined = await guest.join(code.toLowerCase(), "GUEST");
  expect(joined).toEqual({ code, slot: 1 });
  guest.send({ t: "send", data: { k: "ping" } });
  await until(() => got.some((m) => m.t === "msg"));
  expect(got.find((m) => m.t === "msg")).toEqual({ t: "msg", from: 1, data: { k: "ping" } });
});

test('join with unknown code rejects "not_found"', async () => {
  const c = client();
  await expect(c.join("ZZZZ", "X")).rejects.toBe("not_found");
});

test("host binary frames reach the client as ArrayBuffers", async () => {
  const host = client();
  const { code } = await host.host("H");
  const guest = client();
  const frames: ArrayBuffer[] = [];
  guest.onBinary = (b) => frames.push(b);
  await guest.join(code, "G");
  host.sendBinary(new Uint8Array([4, 5, 6]));
  await until(() => frames.length > 0);
  expect([...new Uint8Array(frames[0])]).toEqual([4, 5, 6]);
});

test("client reconnects with its token after the socket is killed server-side", async () => {
  const host = client();
  const rosters: RelayToClient[] = [];
  host.onMessage = (m) => m.t === "roster" && rosters.push(m);
  const { code } = await host.host("H");
  const guest = client();
  const statuses: string[] = [];
  guest.onStatus = (s) => statuses.push(s);
  await guest.join(code, "G");

  // The most recently connected socket on the server is the guest's.
  const sockets = [...relay.wss.clients];
  sockets[sockets.length - 1].terminate();

  await until(() => statuses.includes("reconnecting"));
  await until(() => guest.status === "open");
  expect(guest.slot).toBe(1);
  const last = rosters[rosters.length - 1];
  expect(last.t === "roster" && last.players.find((p) => p.slot === 1)?.connected).toBe(true);
});

test("wakeRelay resolves true against /health and false against a closed port", async () => {
  expect(await wakeRelay(url, 2000)).toBe(true);
  const dead = await createRelayServer(0);
  const deadUrl = `ws://localhost:${dead.port}`;
  await dead.close();
  const t0 = Date.now();
  expect(await wakeRelay(deadUrl, 500)).toBe(false);
  expect(Date.now() - t0).toBeLessThan(2500);
});

test("the relay drops a silently dead host (missed heartbeat) and tells clients", async () => {
  const hb = await createRelayServer(0, { heartbeatMs: 150 });
  const hbUrl = `ws://localhost:${hb.port}`;
  try {
    // A host whose socket never answers pings — like a phone that lost signal.
    const deadHost = new WebSocket(hbUrl, { autoPong: false });
    await new Promise((r) => deadHost.once("open", r));
    deadHost.send(JSON.stringify({ t: "host", name: "H" }));
    const code: string = await new Promise((r) =>
      deadHost.on("message", (d) => {
        const m = JSON.parse(d.toString());
        if (m.t === "welcome") r(m.code);
      }),
    );
    const guest = new RelayClient(hbUrl, Ctor);
    clients.push(guest);
    const got: RelayToClient[] = [];
    guest.onMessage = (m) => got.push(m);
    await guest.join(code, "G");
    await until(() => got.some((m) => m.t === "closed"), 3000);
    expect(hb.rooms.roomCount).toBe(0);
  } finally {
    await hb.close();
  }
});
